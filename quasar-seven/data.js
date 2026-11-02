/* ============================================================
   原味情诗 · 替代心声 —— 展示页文本
   改文字只改这个文件，不用动 app.js。

   rows[].left   左侧滚轮里的朗读内容；空字符串 = 一个空拍
   rows[].right  右侧累积出现的展示内容，可以没有
   rows[].quote  草稿里标红的句子 —— 亮色段用链接蓝，暗色段用播放器红
   rows[].img    左侧滚轮里用这张图代替文字（拼贴诗原图）
   rows[].gong   到这一行触发右侧的“共”字翻转
   rows[].time   第五节歌词在音频里的开始秒数
   rows[].reset  到这里把右侧累积清掉（第四节的“黑屏”）
   rows[].dark   这一行开始转暗色（第四节的“黑屏”之后）

   section.full  = true   这一节全屏、只留一栏（零、四）
   section.center= true   全屏时文字居中（四）
   section.scene = true   全屏时字号放大一号（四）
   section.dark  = true   这一节整体用暗色（第五、六节）
   section.timed = true   这一节跟着音频走（五）
   section.bg    = 'six'  第六节的底图
   section.cue   = 这一节播放栏预备哪一段音乐
   ============================================================ */
window.QINGSHI = {
  title: '替代心声',
  eyebrow: '原味情诗 · 朗诵',

  cues: {
    bgm: {
      kind: 'bgm', src: 'audio/yunhaiming.mp3', title: '云海鸣', artist: '爱之光',
      start: 0, end: 134,
      hint: '前 2:14 · 点击播放', glyph: '云'
    },
    song: {
      kind: 'song', src: 'audio/gongshengcao.mp3', title: '共生草', artist: '她演唱的片段',
      start: 0, end: null,
      hint: '点击播放，歌词随音乐滚动', glyph: '共'
    },
    tail: {
      kind: 'tail', src: 'audio/yunhaiming.mp3', title: '云海鸣', artist: '爱之光',
      start: 326, end: null,
      hint: '尾声 5:26— · 点击播放', glyph: '云'
    }
  },

  sections: [
    {
      id: 'zero',
      label: '零',
      full: true,
      cue: null,
      rows: [
        {
          /* 首屏一次性展示：全屏、一栏，读的人在画外念那四句。 */
          left: '',
          right: [
            { kind: 'exam', html: '<span class="exam-kicker">26 北京高考记叙文题</span><span class="exam-title">《含英咀华》</span>' },
            { kind: 'quote', html: '（2）“含英咀华”指含着花朵，细细咀嚼，品味花的芬芳，比喻仔细琢磨、领会诗文中的精华。这种反复品味、用心体悟的过程，在阅读经典、鉴赏艺术、感悟生活等诸多方面都非常重要。含英咀华的过程，往往是一段难忘的经历……' },
            { kind: 'prompt', html: '请以“含英咀华”为题目，<s>写一篇记叙文</s>。写一首诗。' },
            { kind: 'body', html: '英就是我的诗作，我当年亲笔写下的诗作；华也许就是那段已经不再的时光吧' },
            { kind: 'note', html: '既然，“原味情诗”，所以标色的词句，都是当年的痕迹。' }
          ]
        }
      ]
    },

    {
      id: 'one',
      label: '一',
      cue: 'bgm',
      rows: [
        {
          left: '我愿问这个世界', quote: true,
          right: [
            { kind: 'cite', html: '节选自《我愿问这个世界》' },
            { kind: 'date', text: '——2025.4.21' }
          ]
        },
        { left: '问波涛，', quote: true },
        {
          left: '问沧海，', quote: true,
          right: [{ kind: 'image', src: 'assets/section1.jpg', alt: '第一节配图：黄色礼物、十八岁生日卡与日文卡片', w: 1600, h: 565 }]
        },
        { left: '问巍巍的南山-', quote: true },
        {
          left: '我喜欢上一个女孩子有什么错', quote: true,
          right: [{ kind: 'note', html: '（原文如此）' }]
        },
        { left: '我只想', quote: true },
        { left: '与你能在夜晚一同数着星星 互道晚安', quote: true },
        { left: '在你失去希望的时候，轻轻抱抱你', quote: true }
      ]
    },

    {
      id: 'two',
      label: '二',
      cue: 'bgm',
      rows: [
        {
          left: '不知为何',
          right: [{ kind: 'image', src: 'assets/section2.jpg', alt: '第二节配图：聊天记录、月亮与手机截图', tall: true, w: 933, h: 1400 }]
        },
        { left: '友谊边界渐渐消弭' },
        { left: '你写过《并蒂莲》' },
        {
          left: '我便给自己的诗 取名《共生草》',
          gong: true,
          right: [{ kind: 'note', html: '「共」刚好和「并」旋转对称' }]
        },
        { left: '可是，' },
        { left: '你忽然疏远了我' },
        { left: '无人角落，你问' },
        { left: '“他们都说，你喜欢我。”' },
        { left: '“不要这样啊。”' },
        { left: '“没有必要啊。”' }
      ]
    },

    {
      id: 'three',
      label: '三',
      cue: 'bgm',
      rows: [
        { left: '可我没想到，老师布置的拼贴诗' },
        { left: '你会写下' },
        {
          left: '风俗欢声 无端造次', quote: true, img: 'assets/poem-01.png',
          right: [
            { kind: 'cite', html: '《拼贴诗》' },
            { kind: 'date', text: '——2025.5.12' }
          ]
        },
        { left: '不流通的 异养污浊', quote: true, img: 'assets/poem-02.png' },
        {
          left: '浅斟低唱 替代心声的词作，存在', quote: true, img: 'assets/poem-03.png',
          right: [{ kind: 'image', src: 'assets/section3.jpg', alt: '我们一起创作的板报', w: 1600, h: 1460 }]
        },
        {
          left: '生生死死 秋雨打萍', quote: true, img: 'assets/poem-04.png',
          right: [{ kind: 'caption', text: '我们一起创作的板报' }]
        },
        { left: '但你听到了平静', quote: true, img: 'assets/poem-05.png' },
        { left: '被遗弃的 或失恋的', quote: true, img: 'assets/poem-06.png' },
        { left: '蹂躏过的滴血的灵魂', quote: true, img: 'assets/poem-07.png' },
        { left: '内心世界冥心孤往', quote: true, img: 'assets/poem-08.png' },
        { left: '他放下 今后', quote: true, img: 'assets/poem-09.png' },
        { left: '谁仍沉沦', quote: true, img: 'assets/poem-10.png' },
        {
          left: '他们没有读懂',
          right: [{ kind: 'aside', html: '显然老师也没有读懂' }]
        },
        {
          left: '可是我却在那张纸上',
          right: [{ kind: 'aside', html: '因为这首诗被作为优秀作业展示贴到了班级侧扎板上' }]
        },
        {
          left: '读到了自己。',
          right: [{ kind: 'aside', html: '我也由此才读到了这首诗' }]
        },
        { left: '“你……在写我？”我问。' },
        { left: '结果这次，轮到你说不出话' },
        { left: '你只是轻轻地笑' }
      ]
    },

    {
      id: 'four',
      label: '四',
      full: true,
      center: true,
      scene: true,
      cue: 'bgm',
      rows: [
        {
          /* 亮色：全屏独白 */
          left: '',
          right: [
            { kind: 'monologue', html: '<p>可是，我还是不懂</p><p>你说的，“浅斟低唱”</p><p>是什么。</p>' }
          ]
        },
        {
          /* 黑屏：清空前文，转暗色；新版草稿的这一句放在黑屏上 */
          left: '直到电影结束，片尾曲响起。',
          dark: true,
          reset: true,
          right: [
            { kind: 'memory', html: '<span class="memory-date">2025年5月，电影节。</span><span class="memory-body">班级电影播放完毕，我看着人员表划过，片尾曲渐而响起。<br>词句我再熟悉不过</span>' }
          ]
        },
        {
          left: '我听见你的声音，',
          dark: true,
          right: [{ kind: 'reveal', html: '《共生草》。' }]
        },
        {
          left: '唱着我写下的词。',
          dark: true,
          right: [{ kind: 'body', html: '原来，这是你说的“浅斟低唱”' }]
        }
      ]
    },

    {
      id: 'five',
      label: '五',
      timed: true,
      dark: true,
      cue: 'song',
      /* 每句的起点（秒）：按 原材料/时间轴.md 标的时间。
         第 1–7 句 0–23s，第 8–13 句 29–49s，第 14–19 句 53–91s。 */
      rows: [
        {
          left: '拂去笺上灰', quote: true, time: 0,
          right: [
            {
              kind: 'note-block',
              html: '<span class="label">小注</span>主歌格律为自创《寄生草（改）》名作《共生草》<br>节选第四到六节<span class="date">——2025.5.27</span>'
            }
          ]
        },
        { left: '再填旧歌谣', quote: true, time: 5 },
        { left: '鬓几斑 不改少年狂傲', quote: true, time: 12 },
        { left: '满腔血 何妨纸上空潦？', quote: true, time: 15 },
        {
          left: '敬一杯 为了故去青春年少', quote: true, time: 18,
          right: [{ kind: 'image', src: 'assets/section5.jpg', alt: '第五节配图：黑胶唱片与手写封套', w: 553, h: 533 }]
        },
        { left: '拥抱梦 再莫问枯荣几度消', quote: true, time: 21 },
        { left: '向光明 此身长向野云邀', quote: true, time: 23 },
        { left: '我遥遥地望见了光明——在远方', quote: true, time: 29 },
        { left: '我遥遥地看见了天晴——的出口', quote: true, time: 35 },
        { left: '尽管我还身置在云中', quote: true, time: 41 },
        { left: '我却知道我并——不孤寂', quote: true, time: 44 },
        { left: '身边不再是一片黑暗', quote: true, time: 47 },
        { left: '而是现出了一朵身影', quote: true, time: 49 },
        { left: '待把浮名掷了 唱破春晓', quote: true, time: 53 },
        { left: '破碎的相片缺着昨天', quote: true, time: 62 },
        { left: '稚嫩的笔触画不出妥协', quote: true, time: 67 },
        { left: '排行榜外还有未名星野', quote: true, time: 76 },
        { left: '共生草探向已知边界', quote: true, time: 88 },
        {
          left: '因为我们选择与新月共享残缺', quote: true, time: 91,
          right: [
            { kind: 'gift', html: '一段回声，一条电码，一支副歌。<br>这是我这个春天<span class="ink">收到的</span>最好的礼物。' }
          ]
        }
      ]
    },

    {
      id: 'six',
      label: '六',
      dark: true,
      cue: 'tail',
      bg: 'six',
      rows: [
        { left: '再后来，高考之后，我们的故事迎来了终局。' },
        { left: '可是，' },
        { left: '我们早已难以分割' },
        { left: '再告诉我一则有趣的轶事' },
        { left: '我依然会这样歪一歪头' },
        { left: '这本来一直是你的习惯。' },
        { left: '我甚至还从没来得及，告诉你' },
        {
          left: '···-··---···-·-·-----··-', morse: true,
          right: [{ kind: 'thanks', text: '谢谢聆听\n如果有打动到你，请点头' }]
        }
      ]
    }
  ]
};
