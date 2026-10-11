// 站点配置 + 手工内容。
// 拖进 content/ 与 assets/music/ 的文件由 tools/build-content.mjs 扫描后写进 content.auto.js，
// 这里只需要放"站点本身"的信息；手工条目（可选）会与自动内容合并，同 id 以这里为准。
window.SITE = {
  name: 'x1shang',
  url: 'https://x1shang.top',          // 部署后的地址，用于 RSS / Atom 里的绝对链接
  github: 'x1shang',
  since: '2026-10-11',                 // 建站日期，用于"关于"页天数
  intro: '把探索写成文字，把想法变成作品。这里收藏我的学术记录、长短思考，以及镜头与旋律里的日常。',

  // —— 手工内容（一般留空，直接往文件夹里拖文件即可）——
  papers: [],      // { id, title, date, authors, venue, url, abstract, tags }
  articles: [],    // { id, title, date, summary, body, format, tags }
  assertions: [],  // { id, date, body, format }
  photos: [],      // { id, src, thumb, title, date, location, tags }
  tracks: [],      // { id, title, artist, src, date, lyrics }
  friends: [],     // { name, url, description, date }

  // 作品区：静态清单（与导航页 navigation-page 页面下方的作品区一致），不再联网读取 GitHub。
  // stars 是写入时的星数快照，只用于"先热度后时间"排序；date 是最近推送日期。
  repositories: [
    { name: 'Wetbulb-Calculator', html_url: 'https://github.com/x1shang/Wetbulb-Calculator', description: 'RDFZ 降水相态研究组的科研级气象工具：湿球与露点温度双向计算，集成 14 种国际公式', language: 'Python', stars: 11, date: '2026-10-09' },
    { name: 'Aippt', html_url: 'https://github.com/x1shang/Aippt', description: 'a handy & lite-sized tool using api to generate .pptx from .md files', language: 'Python', stars: 1, date: '2026-10-08' },
    { name: 'frocloud-DIYPCmarket', html_url: 'https://github.com/x1shang/frocloud-DIYPCmarket', description: '自 25 年 8 月以来的 DIY 市场行情档案，内含 GPU / CPU 天梯图', language: 'Python', stars: 0, date: '2026-10-08' },
    { name: 'Chariot_strom_of_gear', html_url: 'https://github.com/x1shang/Chariot_strom_of_gear', description: 'Arduino source code and related files for the student mechanical competition project', language: 'C++', stars: 0, date: '2026-10-10' },
    { name: 'dsh-koin-lily-news', html_url: 'https://github.com/x1shang/dsh-koin-lily-news', description: '菲奖级白河乡资讯DSH插件', language: 'JavaScript', stars: 2, date: '2026-08-26' },
    { name: 'complex-sweeper-helper', html_url: 'https://github.com/x1shang/complex-sweeper-helper', description: '复扫雷 Complexweeper 的 AI 助手：读窗口 → 识别棋盘 → 5 态约束求解 → 概率热力图', language: 'Python', stars: 0, date: '2026-10-09' },
    { name: 'navigation-page', html_url: 'https://github.com/x1shang/navigation-page', description: 'x1shang 的个人导航页', language: 'HTML', stars: 0, date: '2026-10-10' },
    { name: 'python-2024-2025', html_url: 'https://github.com/x1shang/python-2024-2025', description: 'My inchoate programming trove. Want some crispy potatoes?', language: 'Python', stars: 0, date: '2026-10-09' }
  ]
};
