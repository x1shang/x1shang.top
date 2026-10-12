// 站点配置 + 手工内容。
// 拖进 content/ 与 assets/music/ 的文件由 tools/build-content.mjs 扫描后写进 content.auto.js，
// 这里只需要放"站点本身"的信息；手工条目（可选）会与自动内容合并，同 id 以这里为准。
window.SITE = {
  name: 'x1shang',
  url: 'https://x1shang.top',          // 部署后的地址，用于 RSS / Atom / sitemap / OG 里的绝对链接
  github: 'x1shang',
  since: '2026-10-11',                 // 建站日期，用于"关于"页天数
  intro: '把探索写成文字，把想法变成作品。这里收藏我的学术记录、长短思考，以及镜头与旋律里的日常。',

  // —— 手工内容（一般留空，直接往文件夹里拖文件即可）——
  papers: [],      // { id, title, date, authors, venue, url, abstract, tags }
  articles: [],    // { id, title, date, summary, body, format, tags }
  assertions: [],  // { id, date, body, format }
  photos: [],      // { id, src, thumb, title, date, location, tags }
  tracks: [],      // { id, title, artist, src, date, lyrics }；网易云曲目由 assets/music/ 里只写 netease: <歌曲ID> 的 .md 自动生成
  friends: [],     // { name, url, description, date }

  // 作品清单不在这里：侧栏与首页的「作品」直接外链到站外导航页，
  // 磁贴入口与作品区（含星数快照）都在那边维护。原来的 repositories 快照已随作品页一起移除
  // （2026-10-11，git 历史里还找得到）。
};
