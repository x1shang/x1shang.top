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
