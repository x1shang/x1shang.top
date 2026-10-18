-- tools/stat-worker/schema.sql
--
-- D1（SQLite）表结构 —— 计划 §5.1
-- 执行：npx wrangler@latest d1 execute x1shang-stats --remote --file=./schema.sql
--
-- 为什么按「天 + 路径」预聚合而不是记原始事件：
--   个人站的量级是每天几十次请求，预聚合后行数 = 有访问的天数 × 页面数（几百行封顶），
--   查询永远是一次 GROUP BY，D1 免费额度（行写入 10 万/天、读取 500 万/天）完全用不完；
--   而且**终身按页总量**（文章热度）天然就在这张表里，不用另算。

CREATE TABLE IF NOT EXISTS hits (
  day  TEXT    NOT NULL,          -- 'YYYY-MM-DD'（UTC；见 src/index.js 的 DAY_OFFSET_MINUTES）
  path TEXT    NOT NULL,          -- 浏览器原始 path，如 '/articles/%E7%BB%93…/'（与 stats.json 的 pages 键约定一致）
  n    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path)
);

-- series 走主键前缀（day），pages（GROUP BY path）走这个索引
CREATE INDEX IF NOT EXISTS idx_hits_path ON hits(path);

-- v2：增量升级。hits 保留旧 PV；visits 仅从启用新逻辑起累计，不反推历史人数。
CREATE TABLE IF NOT EXISTS visits (
  day TEXT NOT NULL,
  path TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path)
);
CREATE INDEX IF NOT EXISTS idx_visits_path ON visits(path);

CREATE TABLE IF NOT EXISTS sessions (
  visitor_key TEXT PRIMARY KEY,    -- HMAC(API_TOKEN, site + IP + UA)，不保存原文
  session_id TEXT NOT NULL UNIQUE, -- 随机 UUID，与累计表没有关联字段
  expires_at INTEGER NOT NULL     -- 首次访问后 8 小时，不随刷新延长
);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS session_paths (
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  PRIMARY KEY (session_id, path)
);

CREATE TABLE IF NOT EXISTS stats_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
