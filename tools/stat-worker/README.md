# stat-worker — `stat.x1shang.top`（Workers + D1 自建访客统计）

> 计划：[`计划-Cloudflare迁移与统计自建.md`](../../../计划-Cloudflare迁移与统计自建.md) §5（Phase 2）
> 目标：取代 GoatCounter —— 采集端与数据端都在自己域名下，**精确计数（无采样）**，数据落在自己的 D1 里。
>
> ✅ **2026-10-16 已上线**：Worker `x1shang-stats` + D1（region APAC）+ 自定义域 `stat.x1shang.top`（橙云）；
> beacon 已进 `index.html` 与全部 24 个预渲染页，与 GoatCounter 双跑中。验收证据见计划 §5.3 / §5.5。
> **下面"部署"一节是按实际跑通的顺序重写过的**（原文里"控制台建 Worker / 挂自定义域"两步已不需要）。

| 文件 | 作用 |
| --- | --- |
| `src/index.js` | 一个 Worker，四个端点（`/s.js` `/c` `/api/stats` `/api/export`） |
| `wrangler.toml` | 部署配置（D1 binding、自定义域） |
| `schema.sql` | D1 表结构（`hits(day, path, n)`） |
| `README.md` | 本文件 |

---

## 端点

| 端点 | 方法 | 用途 | 鉴权 |
| --- | --- | --- | --- |
| `/s.js` | GET | beacon 脚本（~0.5 KB，自己托管，无第三方依赖） | 公开 |
| `/c` | POST | 采集：浏览器回报一次页面浏览 | 公开，但**校验 Origin/Referer ∈ `*.x1shang.top`** + path 正则 + body ≤ 1 KB |
| `/api/stats?days=30` | GET | 数据端，给 CI / 本地取数用 | `Authorization: Bearer <API_TOKEN>` |
| `/api/export` | GET | 全量导出（备份） | 同上 |
| `/robots.txt` | GET | 计数器主机不做内容，整站 `Disallow` | 公开 |

**`/c` 永远返回 204**（合法、非法、垃圾都一样），不给探测者任何反馈。

## 与 `stats.json` 的契约（**别改字段名**）

`/api/stats` 返回的对象与 `tools/fetch-stats.mjs` 写出的 `stats.json` **同形状**，多一个 `source` 字段：

```json
{
  "source": "selfhosted",
  "site": "https://stat.x1shang.top/",
  "updated": "2026-10-16T00:30:00.000Z",
  "days": 30,
  "total": 42,
  "allTime": 185,
  "series": [{ "d": "2026-09-17", "n": 3 }, "…共 days 条，逐日补零，绝不缺日"],
  "pages": { "/articles/foo/": 12, "/": 30 }
}
```

- `total` = 窗口内 PV 合计；`allTime` = 终身 PV；`pages` = 终身按页 PV（**文章热度**用它）。
- `series` 一定是 `days` 条、升序、缺失日补 0 —— 关于页那张图靠它，**缺一天图就断**。
- Phase 3 的 `fetch-stats.mjs` 会把它当 provider 直接用，`build-content.mjs` 零改动（§6.1）。

## 部署（2026-10-16 实际跑通的顺序）

```powershell
cd x1shang/tools/stat-worker

# ① 登录（人：浏览器点 Authorize 即可）
npx wrangler@latest login

# ② 建库 —— **记下输出的 database_id**（本库：57681a30-9059-433a-84b5-5e5d7288f1ca，region APAC）
npx wrangler@latest d1 create x1shang-stats
#    然后把 wrangler.toml 里的 database_id 换成它

# ③ 建表
npx wrangler@latest d1 execute x1shang-stats --remote --file=./schema.sql

# ④ 生成并写入 API token（值同时要存进密码管理器/本地文件 + GitHub 仓库 Secrets）
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
#    注意：这一步时 Worker 还不存在是正常的，wrangler 会问"要不要新建"→ 是（非交互下自动 yes）
$tok | npx wrangler@latest secret put API_TOKEN
#    同值再填到 GitHub 仓库 Secrets：STATS_API_TOKEN，并加 STATS_API_URL=https://stat.x1shang.top

# ⑤ 部署（wrangler.toml 里 workers_dev=false + [[routes]] custom_domain=true）
npx wrangler@latest deploy
#    这一条命令同时完成：上传脚本 → 建 stat 的 DNS 记录（橙云）→ 签证书 → 绑路由
```

**三个实测踩到的点**

1. **`workers_dev = true` 会让 deploy 直接失败**：本账号没注册 workers.dev 子域 → `You need to register a workers.dev subdomain before publishing to workers.dev` 后 exit 1。用 `workers_dev = false` + `[[routes]] custom_domain = true` 绕过（也**不需要**去控制台手动挂域）。
2. **不必先去控制台建 Worker**：`secret put` 会自动建（见上）。
3. **beacon 只需改 `index.html` 一处**（下面"接 beacon"原文说两处，是多余的）：

**接 beacon** —— 只改 `x1shang/index.html` 的 `</body>` 前一行即可：

```html
<script defer src="https://stat.x1shang.top/s.js"></script>
```

预渲染页（`articles/*/index.html` 等 24 个）是拿 `index.html` 当模板生成的（`tools/build-content.mjs` 的 `writeShell()`），**改模板即全量继承**；实测 rebuild 后 25 个文件命中 beacon。改完 `npm run build` → `npm run deploy`。

> ⚠️ 这一阶段 **GoatCounter 的 snippet 与 `data-goatcounter` 原样不动**（双跑 2 周，§6.1）。

## 本地自测（**部署前先跑**）

```powershell
node tools/stat-worker/smoke-test.mjs
```

用一个内存版 D1 假实现把四个端点整体跑一遍（46 项断言）：beacon 体积与指向、`/c` 的 12 种垃圾请求**一律不写库且都返回 204**、同一页 3 次是 `n=3` 而不是 3 行、`/api/stats` 的**字段与 `stats.json` 逐字段一致**且 `series` 逐日补零、鉴权 401、`days` 夹取、`/api/export` 形状。

> 它是真抓到过东西的：2026-10-16 首跑发现 `/../../etc/passwd` **能进库** —— §5.1 给的正则只管**字符集**，而 `.` 和 `/` 都在白名单里，`..` 能过。已加 `..` / `//` 两道单独拦截。

## 验收（§5.3）

```powershell
# 1) 国内直连 beacon 脚本
curl.exe -sS -o NUL -w "%{http_code} %{size_download} bytes\n" https://stat.x1shang.top/s.js

# 2) 打开线上站点 → 看 D1 里有没有那天那一页
npx wrangler@latest d1 execute x1shang-stats --remote --command "select * from hits order by day desc limit 5"

# 3) 数据端（形状必须与 stats.json 一致）
curl.exe -sS -H "Authorization: Bearer <API_TOKEN>" "https://stat.x1shang.top/api/stats?days=30"

# 4) 伪造请求不写库（三条都应返回 204，且库里行数不变）
curl.exe -sS -o NUL -w "%{http_code}\n" -X POST -d '{"p":"/"}' https://stat.x1shang.top/c                                  # 无 Origin
curl.exe -sS -o NUL -w "%{http_code}\n" -X POST -H "Origin: https://evil.example" -d '{"p":"/"}' https://stat.x1shang.top/c  # 非法 Origin
curl.exe -sS -o NUL -w "%{http_code}\n" -X POST -H "Origin: https://x1shang.top" -d '{"p":"/../../etc/passwd"}' https://stat.x1shang.top/c  # 非法 path

# 5) 全量导出落进仓库备份（§8.7：数据别只在别人手里）
curl.exe -sS -H "Authorization: Bearer <API_TOKEN>" https://stat.x1shang.top/api/export -o tools/stat-export.json
```

## 日常运维

| 场景 | 命令 |
| --- | --- |
| 看某页终身量 | `npx wrangler@latest d1 execute x1shang-stats --remote --command "select path, sum(n) n from hits group by path order by n desc limit 20"` |
| 看最近 7 天 | `npx wrangler@latest d1 execute x1shang-stats --remote --command "select day, sum(n) n from hits group by day order by day desc limit 7"` |
| 全库导出（两种都行） | `npx wrangler@latest d1 export x1shang-stats --remote --output=backup.sql` ／ `GET /api/export` |
| 改 token | `npx wrangler@latest secret put API_TOKEN` + 同步改仓库 Secrets |
| 看实时日志 | `npx wrangler@latest tail x1shang-stats` |
| 完全回滚 | 删 beacon 两行 → `npm run build && npm run deploy`（§5.4）；Worker/D1 留着不影响任何东西 |

## 已知取舍（都是"想清楚才这么做的"，不是漏做）

- **口径是 PV（页面浏览量），不是 UV。** 与 GoatCounter 的"访客数"不同口径，双跑期绝对值会有差异 —— §6.1 的验收标准是**趋势一致 + 不缺日**，不是数字相等。要 UV 见 §5.1 的 `visitors(day, vid_hash)`（日盐 + IP + UA 的 SHA256，只存哈希），列为 Phase 2.5 可选项。上线后**关于页文案要从"近 30 天 N 位访客"改成"N 次浏览"**（§8.8）。
- **日界是 UTC**（`src/index.js` 的 `DAY_OFFSET_MINUTES = 0`），与 §5.1 的 schema 注释一致。改成 `480` 会按北京时间切天，但**已入库的历史行不会跟着变** → 双跑对比会出现断层。**上线前定好，之后别动。**
- **同路径去重**：`visibilitychange→hidden` 和 `pagehide` 都会触发，不去重会一次访问记两次；beacon 里用"上一次已发路径"挡住。同时接管了 SPA 的 `pushState/replaceState/popstate`，站内切文章各算一次浏览 —— 比计划 §5.1 的示意片段更准（纯 `sendBeacon` 版会把一次会话里的多篇文章算成 1）。
- **防刷只做到"够用"**：Origin 校验 + path 正则 + 长度/体积上限 + `INSERT … ON CONFLICT` 幂等写法。**没有**做速率限制（§5.1 标为可选，需要额外 KV binding）。真正的滥用迹象看 D1 行数突增即可。
- **无 cookie / 无 IP / 无 UA / 无第三方脚本** —— 采集端只发一个 path。
