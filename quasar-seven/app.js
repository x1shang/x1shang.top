(() => {
  'use strict';

  const DATA = window.QINGSHI;
  if (!DATA || !Array.isArray(DATA.sections)) {
    document.body.innerHTML = '<p style="padding:40px;font:16px sans-serif">缺少 data.js，页面没有文字可显示。</p>';
    return;
  }
  const SECTIONS = DATA.sections;
  const CUES = DATA.cues || {};

  /* 把所有节拉平成一条连续的滚轮：换节时左侧不重置，只清空右侧。
     节与节之间插入一条纯视觉的空行（不占交互步）。 */
  const FLAT = [];
  SECTIONS.forEach((sec, si) => {
    sec.start = FLAT.length;
    const secDark = !!sec.dark;
    sec.rows.forEach((row, ri) => {
      FLAT.push({ ...row, sec: si, row: ri, dark: row.dark ?? secDark });
    });
    sec.end = FLAT.length - 1;
  });
  const LAST = FLAT.length - 1;
  const TIMED_SECTION = SECTIONS.findIndex((s) => s.timed);
  const TIMED_ROWS = TIMED_SECTION >= 0 ? SECTIONS[TIMED_SECTION].rows : [];

  const $ = (sel) => document.querySelector(sel);
  const root = document.documentElement;
  const stage = $('#stage');
  const wheel = $('#wheel');
  const wheelViewport = $('#wheelViewport');
  const stack = $('#stack');
  const stackFade = $('#stackFade');
  const chapter = $('#chapter');
  const chapterNow = $('#chapterNow');
  const hint = $('#hint');
  const hintMain = $('#hintMain');
  const hintKeys = $('#hintKeys');
  const veil = $('#veil');
  const gongOverlay = $('#gongOverlay');

  let step = 0;
  let currentSection = 0;
  let hintGone = false;
  let rightTimer = 0;
  let sectionPending = false;
  let lockUntil = 0;
  let gongTimer = 0;

  function isDark() { return root.dataset.theme === 'dark'; }

  function applyTheme(dark) {
    root.dataset.theme = dark ? 'dark' : 'light';
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.content = dark ? 'dark' : 'light';
  }

  function applyLayout(secIndex) {
    stage.classList.toggle('is-full', !!SECTIONS[secIndex].full);
    stage.classList.toggle('is-center', !!SECTIONS[secIndex].center);
    stage.classList.toggle('is-scene', !!SECTIONS[secIndex].scene);
    stage.classList.toggle('is-six', SECTIONS[secIndex].bg === 'six');
  }

  function isLocked() { return performance.now() < lockUntil; }

  /* ============================================================
     左：网易云式歌词滚轮
     ============================================================ */
  const OPACITY = [1, 0.56, 0.32, 0.16, 0.07];
  const SCALE = [1, 0.955, 0.925, 0.9, 0.885];

  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ESC_MAP[c]);

  function lyricHTML(text) {
    return String(text)
      .split(/(\s+)/)
      .map((part) => {
        if (!part) return '';
        if (/^\s+$/.test(part)) return '<span class="caesura"></span>';
        return esc(part);
      })
      .join('');
  }

  const wheelNodes = [];
  const lineForStep = new Array(FLAT.length);
  const nodeIndexForStep = new Array(FLAT.length);

  FLAT.forEach((row, i) => {
    if (i > 0 && FLAT[i - 1].sec !== row.sec) {
      const spacer = document.createElement('div');
      spacer.className = 'line is-spacer';
      spacer.setAttribute('aria-hidden', 'true');
      wheel.appendChild(spacer);
      wheelNodes.push(spacer);
    }
    const el = document.createElement('div');
    el.className = 'line'
      + (row.quote ? ' is-quote' : '')
      + (row.morse ? ' is-morse' : '')
      + (row.img ? ' is-image' : '')
      + (!row.left && !row.img ? ' is-blank' : '');
    if (row.img) {
      el.innerHTML = '<img class="line-img" src="' + esc(row.img) + '" alt="" draggable="false">';
    } else if (row.left) {
      el.innerHTML = lyricHTML(row.left);
    }
    el.setAttribute('aria-hidden', 'true');
    wheel.appendChild(el);
    nodeIndexForStep[i] = wheelNodes.length;
    wheelNodes.push(el);
    lineForStep[i] = el;
  });

  function paintWheel(animate) {
    const active = lineForStep[step];
    const activeIndex = nodeIndexForStep[step] == null ? 0 : nodeIndexForStep[step];
    wheelNodes.forEach((el, i) => {
      const d = Math.min(4, Math.abs(i - activeIndex));
      el.classList.toggle('is-active', el === active);
      el.style.opacity = String(OPACITY[d]);
      el.style.setProperty('--scale', String(SCALE[d]));
    });
    if (!active) return;
    const viewportH = wheelViewport.clientHeight;
    const y = viewportH / 2 - (active.offsetTop + active.offsetHeight / 2);
    if (animate) {
      wheel.style.transform = `translate3d(0,${y}px,0)`;
    } else {
      wheel.style.transition = 'none';
      wheel.style.transform = `translate3d(0,${y}px,0)`;
      void wheel.offsetHeight;
      wheel.style.transition = '';
    }
  }

  /* ============================================================
     右：本节累积展示，换节清空
     ============================================================ */
  function itemsFor(secIndex, rowIndex) {
    const rows = SECTIONS[secIndex].rows;
    /* 有 reset 的行是“黑屏重来”：从这一行重新累积。 */
    let start = 0;
    for (let i = rowIndex; i >= 0; i--) {
      if (rows[i] && rows[i].reset) { start = i; break; }
    }
    const out = [];
    for (let i = start; i <= rowIndex; i++) {
      const right = rows[i] && rows[i].right;
      if (right && right.length) out.push(...right);
    }
    return out;
  }

  function makeItem(item, newIndex, isNew) {
    const el = document.createElement('div');
    el.className = 'ri ri-' + (item.kind || 'body') + (item.tall ? ' tall' : '');
    if (isNew) {
      el.classList.add('is-new');
      el.style.setProperty('--i', String(newIndex));
    }
    if (item.kind === 'image') {
      const img = document.createElement('img');
      img.src = item.src;
      img.alt = item.alt || '';
      img.loading = 'eager';
      img.decoding = 'async';
      img.draggable = false;
      if (item.w) img.width = item.w;
      if (item.h) img.height = item.h;
      el.appendChild(img);
    } else if (item.kind === 'caption') {
      el.textContent = item.text || '';
    } else if (item.html != null) {
      el.innerHTML = item.html;
    } else {
      el.textContent = item.text != null ? item.text : '';
    }
    return el;
  }

  function renderRight({ flip = true, allNew = false, animate = true } = {}) {
    const secIndex = FLAT[step].sec;
    const rowIndex = FLAT[step].row;
    const items = itemsFor(secIndex, rowIndex);
    const oldCount = stack.childElementCount;
    const h0 = stack.offsetHeight;

    stack.replaceChildren();
    const startNew = allNew ? 0 : oldCount;
    items.forEach((item, i) => {
      const isNew = animate && i >= startNew;
      stack.appendChild(makeItem(item, isNew ? i - startNew : 0, isNew));
    });

    const h1 = stack.offsetHeight;
    if (!flip) {
      stack.style.transition = 'none';
      stack.style.transform = 'translateY(-50%)';
      requestAnimationFrame(() => { stack.style.transition = ''; });
      return;
    }
    const dy = (h1 - h0) / 2;
    if (!dy) return;
    stack.style.transition = 'none';
    stack.style.transform = `translateY(calc(-50% + ${dy}px))`;
    void stack.offsetHeight;
    stack.style.transition = 'transform .62s cubic-bezier(.22,.61,.36,1)';
    stack.style.transform = 'translateY(-50%)';
  }

  /* ============================================================
     章节 / 翻页
     ============================================================ */
  function setChapter(secIndex) {
    const label = SECTIONS[secIndex].label;
    chapterNow.textContent = label;
    chapter.setAttribute('aria-label', '第' + label + '节');
    if (chapterNow.animate) {
      chapterNow.animate(
        [{ opacity: 0, transform: 'translateY(-3px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 340, easing: 'ease-out' }
      );
    }
  }

  function markStarted() {
    if (hintGone) return;
    hintGone = true;
    hint.classList.add('is-gone');
  }

  function onSectionChange(secIndex, prevSec, dir) {
    prepareCue(SECTIONS[secIndex].cue || null);
    updatePlayerCopy();
  }

  function go(n, { instant = false, dir = 1 } = {}) {
    n = Math.max(0, Math.min(LAST, n));
    if (n === step) return;
    const prevSec = currentSection;
    const prevDark = isDark();
    step = n;
    const target = FLAT[n];
    const sec = target.sec;
    const nextDark = !!target.dark;
    const changed = sec !== prevSec;
    currentSection = sec;
    markStarted();
    paintWheel(!instant);
    syncGong(target);
    syncMorse(target);

    if (changed) setChapter(sec);

    /* 亮 -> 暗 / 暗 -> 亮：先压黑，换主题、换版式、换内容，再亮出来。 */
    if (nextDark !== prevDark) {
      clearTimeout(rightTimer);
      rightTimer = 0;
      sectionPending = false;
      stackFade.classList.remove('is-out');
      lockUntil = performance.now() + 1250;
      veil.classList.add('is-on');
      setTimeout(() => {
        applyTheme(nextDark);
        /* 版式总是按当前节重算：哪怕上一次节切换的 180ms 计时被这次换主题打断。 */
        applyLayout(sec);
        renderRight({ flip: false, allNew: true, animate: true });
        stackFade.classList.remove('is-out');
        if (changed) onSectionChange(sec, prevSec, dir);
        setTimeout(() => veil.classList.remove('is-on'), 150);
      }, 560);
      return;
    }

    if (changed) {
      stackFade.classList.add('is-out');
      sectionPending = true;
      clearTimeout(rightTimer);
      rightTimer = setTimeout(() => {
        /* 用最新的 currentSection：快速连点时，只按最后停下的那一节换版式。 */
        applyLayout(currentSection);
        renderRight({ flip: false, allNew: true, animate: true });
        stackFade.classList.remove('is-out');
        sectionPending = false;
      }, 180);
      onSectionChange(sec, prevSec, dir);
    } else if (sectionPending) {
      /* 节切换的 180ms 还没走完，又点了一下：只更新滚轮，
         右栏等切换计时器到点后按最新一行统一渲染，别把版式计时器清掉。 */
      stackFade.classList.add('is-out');
    } else {
      clearTimeout(rightTimer);
      rightTimer = 0;
      stackFade.classList.remove('is-out');
      renderRight({ flip: true, allNew: false, animate: true });
    }
  }

  function isTimedPlaying() {
    return TIMED_SECTION >= 0
      && currentSection === TIMED_SECTION
      && currentCue
      && currentCue.kind === 'song'
      && !audio.paused
      && !audio.ended;
  }

  function seekToTimed(rowIndex) {
    if (TIMED_SECTION < 0 || !currentCue || currentCue.kind !== 'song') return;
    const row = TIMED_ROWS[rowIndex];
    if (!row) return;
    let t = row.time;
    if (typeof t !== 'number' || !Number.isFinite(t)) {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
      t = (audio.duration * rowIndex) / TIMED_ROWS.length;
    }
    if (!Number.isFinite(t)) return;
    try { audio.currentTime = (currentCue.start || 0) + t; } catch (_) { return; }
    timedIndex = rowIndex;
    updatePlayerCopy();
  }

  function next() {
    if (isLocked()) return;
    if (isTimedPlaying()) return;
    if (step >= LAST) return;
    const target = step + 1;
    const fromTimed = currentSection === TIMED_SECTION;
    go(target, { dir: 1 });
    if (fromTimed && FLAT[target].sec === TIMED_SECTION) seekToTimed(FLAT[target].row);
    markStarted();
  }

  function prev() {
    if (isLocked()) return;
    if (isTimedPlaying()) return;
    if (step <= 0) return;
    const target = step - 1;
    const fromTimed = currentSection === TIMED_SECTION;
    go(target, { dir: -1 });
    if (fromTimed && FLAT[target].sec === TIMED_SECTION) seekToTimed(FLAT[target].row);
    markStarted();
  }

  function jumpTo(n) {
    if (isLocked()) return;
    if (n === step) return;
    if (isTimedPlaying()) audio.pause();
    go(n, { instant: true, dir: n < step ? -1 : 1 });
  }

  /* ============================================================
     第二节的“共”字翻转
     ============================================================ */
  function hideGong() {
    clearTimeout(gongTimer);
    gongOverlay.classList.remove('is-on');
  }

  function showGong() {
    hideGong();
    void gongOverlay.offsetWidth;
    gongOverlay.classList.add('is-on');
    gongTimer = setTimeout(() => gongOverlay.classList.remove('is-on'), 3300);
  }

  function syncGong(row) {
    if (row && row.gong) showGong();
    else hideGong();
  }

  /* ============================================================
     第六节末尾：自动播放的摩斯电码
     1=G3 2=A3 3=E4，每格四分音符，最后一个二分音符；
     音符之间没有空拍，字母之间只留半拍。
     码形由字母本身决定；凑齐一个字母就变成字母。
     ============================================================ */
  const MORSE_SEQ = [
    { letter: 'I', code: '..', pitches: [2, 2] },
    { letter: 'L', code: '.-..', pitches: [1, 3, 1, 1] },
    { letter: 'O', code: '---', pitches: [3, 3, 3] },
    { letter: 'V', code: '...-', pitches: [1, 1, 1, 3] },
    { letter: 'E', code: '.', pitches: [1] },
    { letter: 'Y', code: '-.--', pitches: [3, 1, 3, 3] },
    { letter: 'O', code: '---', pitches: [3, 3, 3] },
    { letter: 'U', code: '..-', pitches: [1, 1, 3] }
  ];
  const MORSE_PITCH = { 1: 196.00, 2: 220.00, 3: 329.63 };
  const MORSE_BEAT = 0.5;

  let morseCtx = null;
  let morseRun = 0;
  let morseLine = null;
  let morseRaw = '';
  let morseTimers = [];
  let morseNodes = [];

  function ensureMorseCtx() {
    if (!morseCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) morseCtx = new AC();
    }
    return morseCtx;
  }

  function stopMorse() {
    morseRun++;
    morseTimers.forEach((id) => clearTimeout(id));
    morseTimers = [];
    morseNodes.forEach(({ osc, gain }) => {
      try { osc.stop(); } catch (_) { /* 已经停了 */ }
      try { gain.disconnect(); } catch (_) { /* ignore */ }
    });
    morseNodes = [];
    if (morseLine && morseLine.isConnected) morseLine.textContent = morseRaw;
    morseLine = null;
    morseRaw = '';
  }

  function syncMorse(row) {
    if (row && row.morse) startMorse();
    else stopMorse();
  }

  function showThanks() {
    if (!FLAT[step] || !FLAT[step].morse) return;
    const el = stack.querySelector('.ri-thanks');
    if (el) el.classList.add('is-shown');
  }

  async function startMorse() {
    stopMorse();
    morseLine = lineForStep[step];
    if (!morseLine) return;
    morseRaw = morseLine.textContent;
    const run = morseRun;

    const staleThanks = stack.querySelector('.ri-thanks');
    if (staleThanks) staleThanks.classList.remove('is-shown');

    const live = document.createElement('span');
    live.className = 'morse-live';
    morseLine.replaceChildren(live);

    let completed = [];
    let partial = '';
    const render = () => {
      let html = completed.map((l) => '<span class="morse-letter">' + l + '</span>').join(' ');
      if (partial) html += (html ? ' ' : '') + '<span class="morse-part">' + partial + '</span>';
      live.innerHTML = html;
    };
    render();

    let ctx = null;
    try {
      ctx = ensureMorseCtx();
      if (ctx && ctx.state === 'suspended') await ctx.resume();
    } catch (_) { ctx = null; }
    if (run !== morseRun) return;

    const t0 = ctx ? ctx.currentTime + 0.06 : 0;
    const scheduleAt = (rel, fn) => {
      const delay = Math.max(0, (ctx ? 60 : 0) + rel * 1000);
      morseTimers.push(setTimeout(() => {
        if (run !== morseRun) return;
        fn();
      }, delay));
    };
    const noteAt = (rel, pitch, dur) => {
      if (!ctx) return;
      const start = t0 + rel;
      const beep = dur;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = MORSE_PITCH[pitch] || 196.00;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.16, start + 0.012);
      gain.gain.setValueAtTime(0.16, start + Math.max(0.03, beep - 0.03));
      gain.gain.linearRampToValueAtTime(0.0001, start + beep);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + beep + 0.02);
      morseNodes.push({ osc, gain });
    };

    let t = 0;
    MORSE_SEQ.forEach((letter, li) => {
      const codes = letter.code.split('');
      codes.forEach((ch, ni) => {
        const lastNote = ni === codes.length - 1;
        const finalNote = li === MORSE_SEQ.length - 1 && lastNote;
        const dur = finalNote ? MORSE_BEAT * 2 : MORSE_BEAT;
        const sym = ch === '.' ? '·' : '-';
        scheduleAt(t, () => { partial += sym; render(); });
        noteAt(t, letter.pitches[ni], dur);
        if (lastNote) {
          scheduleAt(t + dur, () => {
            completed = completed.concat(letter.letter);
            partial = '';
            render();
          });
        }
        if (finalNote) {
          scheduleAt(t + dur + 0.4, showThanks);
        }
        t += dur;
      });
      /* 字母之间只多留半拍；音符本身首尾相接，没有空拍。 */
      t += MORSE_BEAT / 2;
    });
  }

  /* ============================================================
     音乐播放器：按节自动预备对应 cue，不自动播放
     ============================================================ */
  const audio = $('#audio');
  const player = $('#player');
  const openPlayerBtn = $('#openPlayer');
  const playToggle = $('#play-toggle');
  const modeBtn = $('#play-mode');
  const modeTip = $('#play-mode-tip');
  const closeBtn = $('#close-player');
  const timeEl = $('#time');
  const seek = $('#seek');
  const titleEl = $('#now-title');
  const lyricEl = $('#now-lyric');
  const coverGlyph = $('#coverGlyph');

  const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.4v13.2L19 12z"/></svg>';
  const PAUSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 5.4h3.2v13.2H7.5zM13.3 5.4h3.2v13.2h-3.2z"/></svg>';
  const MODE_ICON = {
    order: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h8.6M4 12h6.2M4 18h8.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M15.6 9.2 19 12l-3.4 2.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    random: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/><path d="m18 14 4 4-4 4"/></svg>',
    single: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><path d="M11 10h1v4"/></svg>'
  };
  const MODE_ORDER = ['order', 'random', 'single'];
  const MODE_LABEL = { order: '顺序播放', random: '随机播放', single: '单曲循环' };

  let currentCueKey = null;
  let currentCue = null;
  let currentSrc = '';
  let pendingStart = null;
  let pendingPlay = false;
  let audioFailed = false;
  let playMode = 'order';
  let timedIndex = -1;
  let playNotice = '';
  let lastGlyph = coverGlyph.textContent;
  let rafId = 0;
  let lastTick = 0;
  let modeTipTimer = 0;
  let seekBusy = false;

  const fmt = (n) => {
    if (!Number.isFinite(n) || n < 0) n = 0;
    return Math.floor(n / 60) + ':' + String(Math.floor(n % 60)).padStart(2, '0');
  };

  function setNotice(text) {
    playNotice = text;
    lyricEl.textContent = text;
  }

  function setGlyph(glyph) {
    if (lastGlyph === glyph) return;
    lastGlyph = glyph;
    coverGlyph.textContent = glyph;
    if (coverGlyph.animate) {
      coverGlyph.animate(
        [{ opacity: 0, transform: 'scale(.76)' }, { opacity: 1, transform: 'scale(1)' }],
        { duration: 340, easing: 'cubic-bezier(.22,.61,.36,1)' }
      );
    }
  }

  function clipStart() { return currentCue ? currentCue.start : 0; }

  function clipEnd() {
    if (!currentCue) return 0;
    if (currentCue.end != null) return currentCue.end;
    if (audio.readyState >= 1 && Number.isFinite(audio.duration)) return audio.duration;
    return currentCue.start;
  }

  function clipDur() { return Math.max(0, clipEnd() - clipStart()); }

  function clipPos() {
    return Math.max(0, Math.min(clipDur(), audio.currentTime - clipStart()));
  }

  function prepareCue(key) {
    const nextKey = key || null;
    if (nextKey === currentCueKey) return;
    const next = nextKey ? CUES[nextKey] : null;
    audio.pause();
    paintPlayToggle();
    playNotice = '';
    audioFailed = false;
    pendingPlay = false;
    currentCueKey = nextKey;
    currentCue = next;

    if (!next) {
      currentSrc = '';
      pendingStart = null;
      timedIndex = -1;
      try {
        audio.removeAttribute('src');
        audio.load();
      } catch (_) { /* ignore */ }
      updatePlayerCopy();
      updateTime();
      return;
    }

    timedIndex = -1;
    if (currentSrc !== next.src) {
      currentSrc = next.src;
      audio.src = next.src;
      audio.preload = 'metadata';
      audio.load();
      pendingStart = next.start;
    } else {
      pendingStart = next.start;
      if (audio.readyState >= 1) {
        try { audio.currentTime = next.start; } catch (_) { /* ignore */ }
        pendingStart = null;
      }
    }
    updatePlayerCopy();
    updateTime();
  }

  function updatePlayerCopy() {
    if (!currentCue) {
      titleEl.textContent = '音乐';
      setGlyph('♪');
      lyricEl.textContent = playNotice || '进入第一节后准备 BGM';
      return;
    }
    titleEl.textContent = currentCue.title + (currentCue.artist ? ' · ' + currentCue.artist : '');
    setGlyph(currentCue.glyph || '♪');

    if (playNotice) { lyricEl.textContent = playNotice; return; }
    if (audioFailed) { lyricEl.textContent = '音频待放入 ' + currentCue.src; return; }

    if (currentCue.kind === 'song') {
      if (audio.currentTime > 0.05 || !audio.paused) {
        const row = timedIndex >= 0 ? TIMED_ROWS[timedIndex] : TIMED_ROWS[0];
        lyricEl.textContent = (row && row.left) || '♪';
      } else {
        lyricEl.textContent = currentCue.hint;
      }
      return;
    }

    if (!audio.paused) {
      lyricEl.textContent = '纯音乐 · ' + (currentCue.kind === 'tail' ? '尾声' : '前 2:14');
    } else if (audio.currentTime > currentCue.start + 0.1) {
      lyricEl.textContent = '已暂停 · 纯音乐';
    } else {
      lyricEl.textContent = currentCue.hint;
    }
  }

  function paintPlayToggle() {
    const paused = audio.paused;
    playToggle.innerHTML = paused ? PLAY_ICON : PAUSE_ICON;
    const label = paused ? '播放' : '暂停';
    playToggle.setAttribute('aria-label', label);
    playToggle.title = label;
  }

  function paintMode() {
    const label = '播放模式：' + MODE_LABEL[playMode] + '（点击切换）';
    modeBtn.innerHTML = MODE_ICON[playMode];
    modeBtn.setAttribute('aria-label', label);
    modeBtn.title = label;
  }

  function showModeTip(text) {
    modeTip.textContent = text;
    modeTip.classList.add('is-show');
    clearTimeout(modeTipTimer);
    modeTipTimer = setTimeout(() => modeTip.classList.remove('is-show'), 1200);
  }

  function setPlayMode(mode) {
    playMode = MODE_ORDER.includes(mode) ? mode : 'order';
    paintMode();
    showModeTip(MODE_LABEL[playMode]);
  }

  function updateTime() {
    const start = clipStart();
    const dur = clipDur();
    const pos = Math.max(0, Math.min(dur, audio.currentTime - start));
    timeEl.textContent = fmt(pos) + ' / ' + fmt(dur);
    if (!seekBusy) {
      const percent = dur > 0 ? Math.min(100, Math.max(0, (pos / dur) * 100)) : 0;
      seek.value = String(percent);
      seek.style.setProperty('--seek', percent + '%');
    }
    if (currentCue && currentCue.end != null && !audio.paused && audio.currentTime >= currentCue.end - 0.02) {
      if (playMode === 'single') {
        try { audio.currentTime = start; } catch (_) { return; }
        audio.play().catch(() => {});
      } else {
        audio.pause();
        try { audio.currentTime = currentCue.end; } catch (_) { /* ignore */ }
      }
      updatePlayerCopy();
    }
  }

  async function play() {
    if (!currentCue) { setNotice('进入第一节后播放'); return; }
    if (audioFailed) {
      audioFailed = false;
      playNotice = '';
      currentSrc = '';
      pendingStart = currentCue.start;
      try {
        audio.removeAttribute('src');
        audio.load();
      } catch (_) { /* ignore */ }
    }
    if (pendingStart != null && audio.readyState < 1) {
      pendingPlay = true;
      updatePlayerCopy();
      return;
    }
    const end = clipEnd();
    if (Number.isFinite(end) && audio.currentTime >= end - 0.05) {
      try { audio.currentTime = clipStart(); } catch (_) { /* ignore */ }
    }
    if (!audio.src && currentCue.src) {
      currentSrc = currentCue.src;
      audio.src = currentCue.src;
      pendingStart = currentCue.start;
      audio.load();
      pendingPlay = true;
      updatePlayerCopy();
      return;
    }
    updatePlayerCopy();
    try {
      await audio.play();
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      if (err && err.name === 'NotAllowedError') { setNotice('点击播放键开始播放'); return; }
      if (!audio.error) setNotice('无法播放，请检查音频文件');
    }
  }

  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function startLoop() {
    stopLoop();
    const tick = (ts) => {
      if (audio.paused || audio.ended) { rafId = 0; return; }
      if (ts - lastTick > 110) {
        lastTick = ts;
        updateTime();
        updateTimedFromAudio();
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  /* 第五节：按 time 走；如果 time 缺失，按总时长均分。 */
  function currentTimedIndex(t) {
    const rows = TIMED_ROWS;
    if (!rows.length) return 0;
    const allTimed = rows.every((r) => typeof r.time === 'number' && Number.isFinite(r.time));
    if (allTimed) {
      let idx = 0;
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].time <= t + 0.08) idx = i;
      }
      return idx;
    }
    const d = audio.duration;
    if (!Number.isFinite(d) || d <= 0) return 0;
    const p = Math.min(1, Math.max(0, t / d));
    return Math.min(rows.length - 1, Math.floor(p * rows.length));
  }

  function updateTimedFromAudio() {
    if (!currentCue || currentCue.kind !== 'song') return;
    if (TIMED_SECTION < 0) return;
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const idx = currentTimedIndex(audio.currentTime - (currentCue.start || 0));
    if (idx !== timedIndex) {
      timedIndex = idx;
      updatePlayerCopy();
    }
    if (currentSection === TIMED_SECTION) {
      const target = SECTIONS[TIMED_SECTION].start + idx;
      if (target !== step) go(target, { dir: 0 });
    }
  }

  /* 事件 */
  audio.addEventListener('loadedmetadata', () => {
    audioFailed = false;
    if (pendingStart != null) {
      try { audio.currentTime = pendingStart; } catch (_) { /* ignore */ }
      pendingStart = null;
    }
    if (currentCue && currentCue.kind === 'song') {
      timedIndex = currentTimedIndex(audio.currentTime - (currentCue.start || 0));
    }
    updateTime();
    updatePlayerCopy();
    if (pendingPlay) {
      pendingPlay = false;
      play();
    }
  });
  audio.addEventListener('durationchange', () => { updateTime(); updatePlayerCopy(); });
  audio.addEventListener('timeupdate', () => {
    updateTime();
    updateTimedFromAudio();
  });
  audio.addEventListener('play', () => {
    paintPlayToggle();
    startLoop();
    updatePlayerCopy();
  });
  audio.addEventListener('playing', () => {
    audioFailed = false;
    playNotice = '';
    pendingPlay = false;
    paintPlayToggle();
    updatePlayerCopy();
    updateTimedFromAudio();
  });
  audio.addEventListener('pause', () => {
    paintPlayToggle();
    stopLoop();
    updatePlayerCopy();
  });
  audio.addEventListener('ended', () => {
    paintPlayToggle();
    stopLoop();
    updatePlayerCopy();
    if (playMode === 'single') {
      try { audio.currentTime = clipStart(); } catch (_) { return; }
      play();
    }
  });
  audio.addEventListener('error', () => {
    if (!currentCue) return;
    audioFailed = true;
    setNotice('音频待放入 ' + currentCue.src);
    paintPlayToggle();
  });
  seek.addEventListener('pointerdown', () => { seekBusy = true; });
  seek.addEventListener('pointerup', () => { seekBusy = false; updateTime(); });
  seek.addEventListener('change', () => { seekBusy = false; updateTime(); });
  seek.addEventListener('input', () => {
    if (!currentCue) return;
    const dur = clipDur();
    if (!(dur > 0)) return;
    try { audio.currentTime = clipStart() + (Number(seek.value) / 100) * dur; } catch (_) { /* ignore */ }
    updateTime();
    updateTimedFromAudio();
  });

  playToggle.addEventListener('click', () => {
    if (!audio.paused) { audio.pause(); return; }
    play();
  });
  modeBtn.addEventListener('click', () => {
    const i = MODE_ORDER.indexOf(playMode);
    setPlayMode(MODE_ORDER[(i + 1) % MODE_ORDER.length]);
  });
  closeBtn.addEventListener('click', () => {
    audio.pause();
    player.hidden = true;
    openPlayerBtn.hidden = false;
  });
  openPlayerBtn.addEventListener('click', () => {
    player.hidden = false;
    openPlayerBtn.hidden = true;
  });

  /* ============================================================
     输入：点击 / 键盘
     ============================================================ */
  document.addEventListener('click', (event) => {
    if (event.target.closest('#player, #openPlayer, button, a, input, label')) return;
    next();
  });

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target && target.closest && target.closest('input, textarea, select')) return;
    const key = event.key;
    if (target && target.closest && target.closest('button') && (key === ' ' || key === 'Enter')) return;
    if (key === 'ArrowRight' || key === 'PageDown' || key === ' ' || key === 'Enter') {
      event.preventDefault();
      next();
    } else if (key === 'ArrowLeft' || key === 'PageUp' || key === 'Backspace') {
      event.preventDefault();
      prev();
    } else if (key === 'Home') {
      event.preventDefault();
      jumpTo(0);
    } else if (key === 'f' || key === 'F') {
      event.preventDefault();
      toggleFullscreen();
    }
  });

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch (_) { /* 浏览器不允许就算了 */ }
  }

  window.addEventListener('resize', () => {
    paintWheel(false);
    if (!stack.style.transform || stack.style.transform === 'translateY(-50%)') return;
    stack.style.transition = 'none';
    stack.style.transform = 'translateY(-50%)';
    requestAnimationFrame(() => { stack.style.transition = ''; });
  });

  /* ============================================================
     启动
     ============================================================ */
  $('#eyebrow').textContent = DATA.eyebrow || '';
  $('#brandTitle').textContent = DATA.title || '';
  document.title = (DATA.title || '替代心声') + ' · 原味情诗';
  applyTheme(!!FLAT[0].dark);
  applyLayout(0);
  if (SECTIONS[0].full) {
    hintMain.textContent = '点击任意处 · 开始';
    hintKeys.style.display = 'none';
  }
  setChapter(0);
  paintPlayToggle();
  paintMode();
  prepareCue(SECTIONS[0].cue || null);
  updateTime();
  updatePlayerCopy();

  requestAnimationFrame(() => {
    paintWheel(false);
    renderRight({ flip: false, allNew: true, animate: true });
  });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => paintWheel(false)).catch(() => {});
  }
  setTimeout(() => paintWheel(false), 600);
})();
