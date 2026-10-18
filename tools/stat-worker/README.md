# stat.x1shang.top

Cloudflare Worker + D1 自建统计，与 GoatCounter 同时采集。站上使用哪一侧的数据仍由 `STATS_PROVIDER` 决定，缺省为 GoatCounter。

## 计数规则

v2 按 [GoatCounter 默认会话规则](https://www.goatcounter.com/help/sessions) 统计 **visits**：

- 同一 IP + User-Agent 识别为同一匿名会话，从首次访问起固定 8 小时。
- 会话内同一页面只计一次；刷新、离开后返回不重复计数。访问另一页另计一次。
- 跨 UTC 午夜不重开会话；超过 8 小时后的访问创建新会话。
- 各页 visits 之和是页面去重访问量，不能解释为全站不同人数。
- `/articles/foo/` 与 `/articles/foo` 合并；URI 编码统一。哈希文章、断言、论文路由映射到真实路径。
- 忽略 Cloudflare 已识别的机器人及常见爬虫 UA。此过滤表不与 GoatCounter 完全一致，数字不保证相等。

数据库不保存原始 IP / UA，也不使用 cookie 或浏览器存储。服务端以现有 `API_TOKEN` 为 HMAC 密钥生成临时访客键，绑定随机 UUID；后续采集或有鉴权的取数会清理已过期的会话及已见路径，累计数字不受影响。更换 API token 会重置当前会话的识别。

与 GoatCounter 的区别：临时会话存在 D1，跨 Worker 实例共享；GoatCounter 的会话在服务端内存中。本站只采集路径，不采集来源、设备、地理位置等维度。

## 历史数据

旧 `hits` 表的 PV 原样保留，并继续作为原始浏览次数累计。新的 `visits` 表从 v2 首次有效访问起累计，API 的 `since` 标明起点。没有原始访客标识的历史 PV 无法还原成 visits，禁止混合两种历史口径。

## API

| 路径 | 用途 |
| --- | --- |
| `GET /s.js` | 公开采集脚本，覆盖直接加载、哈希详情路由、History API 和前进后退 |
| `POST /c` | 上报 `{ "p": "/articles/foo/" }`，检查来源、路径、体积及机器人 |
| `GET /api/stats?days=30` | 默认返回 visits；兼容原 `stats.json` 字段 |
| `GET /api/stats?days=30&metric=pageviews` | 单独查询原始 PV（含 v1 历史） |
| `GET /api/export` | `data` 保持旧 PV 备份，新增 `visits`、`visitsSince`，不导出临时身份 |
| `GET /` | 版本及计数口径 |

统计和导出需要 `Authorization: Bearer <API_TOKEN>`；采集端不携带 token，并且始终返回 204。来源须为 `x1shang.top` 或其子域；由 Cloudflare 提供 IP，不接受客户端自报身份。

统计返回示例：

```json
{
  "source": "selfhosted",
  "metric": "visits",
  "sessionHours": 8,
  "since": "2026-10-18T00:00:00.000Z",
  "site": "https://stat.x1shang.top/",
  "updated": "2026-10-18T01:00:00.000Z",
  "days": 1,
  "total": 2,
  "allTime": 2,
  "series": [{ "d": "2026-10-18", "n": 2 }],
  "pages": { "/": 1, "/articles/foo": 1 }
}
```

日期按 UTC，`series` 升序补零。`tools/fetch-stats.mjs` 显式请求 visits，并拒绝将旧版 PV API 当成 visits 使用；双跑日志用 `sh_metric` 区分新旧口径，从 `sh_since` 开始对比。

## 检查和部署

在本目录运行，测试需要 Node 22.13+：

```powershell
npm test

# 升级前备份；.backups 已被 git 忽略
New-Item -ItemType Directory -Force .backups
npx wrangler d1 export x1shang-stats --remote --output .backups/before-v2.sql

# 只增加表与索引，可重复执行；不删除、不重写历史数据
npx wrangler d1 execute x1shang-stats --remote --file schema.sql
npx wrangler deploy
```

沿用现有 Worker、D1 binding、自定义域与 `API_TOKEN`，不需要新增 secret。`wrangler.toml` 保持 `workers_dev = false`。

本账号未注册 workers.dev 子域，Cloudflare 会拒绝注册 Cron Trigger（10063）。清理放在采集事务及取数路径内，不依赖定时触发器；无流量时临时记录留到下一次采集/取数再删除。

测试使用真实 SQLite 执行 SQL，并在 VM 中执行采集脚本；覆盖并发去重、固定会话过期、跨午夜、哈希路由、过滤、增量迁移和导出。独立的 provider 测试在临时目录中验证默认来源、切换、旧 PV 拒绝和失败回退，不改真实快照。

回滚 Worker 时可部署旧版本；新增表留存，原 `hits` 与旧导出格式仍兼容。回滚会让默认统计接口重新成为 PV，v2 取数脚本会拒绝它并回退 GoatCounter。
