-- 0001_init.sql
-- 初始化点我! 记事本所需的全部表结构。
-- 会话、分享默认也存放在同一个 D1 数据库中（绑定 KV 时则使用 KV）。

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE,
  password_hash TEXT,
  role          TEXT,
  expire_until  INTEGER
);

CREATE TABLE IF NOT EXISTS notebooks (
  id           TEXT PRIMARY KEY,
  user_id      TEXT,
  title        TEXT,
  content      TEXT,
  created_at   INTEGER,
  updated_at   INTEGER,
  shared_token TEXT
);

CREATE INDEX IF NOT EXISTS idx_notebooks_user_updated
  ON notebooks (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_notebooks_shared_token
  ON notebooks (shared_token);

CREATE INDEX IF NOT EXISTS idx_users_expire_until
  ON users (expire_until);

CREATE TABLE IF NOT EXISTS sessions (
  token     TEXT PRIMARY KEY,
  user_id   TEXT,
  expire_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sessions_user
  ON sessions (user_id);

CREATE TABLE IF NOT EXISTS shares (
  token       TEXT PRIMARY KEY,
  notebook_id TEXT,
  expire_at   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_shares_notebook
  ON shares (notebook_id);

-- 初始管理员：admin / password
-- 密码为 SHA-256("password")，部署后请立即在页面中修改。
INSERT OR IGNORE INTO users (id, username, password_hash, role)
VALUES (
  '00000000000000000000000000000001',
  'admin',
  '37d99011904228e26f40b0d62eb4b53fb9bccb9e04fbc30ea00d49b6a8fd5a68',
  '皇帝'
);
