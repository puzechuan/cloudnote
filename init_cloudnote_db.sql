-- ============================================================================
-- cloudnote 数据库初始化
-- 目标：Cloudflare D1（SQLite）
-- 新环境执行一次即可；已有数据库重复执行不会清空数据。
-- ============================================================================

-- ------------------------------------------------------------------ 用户
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE,
  password_hash TEXT,
  role          TEXT,
  expire_until  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_users_expire_until
  ON users (expire_until);

-- ------------------------------------------------------------------ 笔记
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

-- ------------------------------------------------------------------ 会话
CREATE TABLE IF NOT EXISTS sessions (
  token     TEXT PRIMARY KEY,
  user_id   TEXT,
  expire_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sessions_user
  ON sessions (user_id);

-- ------------------------------------------------------------------ 分享
CREATE TABLE IF NOT EXISTS shares (
  token       TEXT PRIMARY KEY,
  notebook_id TEXT,
  expire_at   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_shares_notebook
  ON shares (notebook_id);

-- 分享链接的创建者：与笔记作者解耦，使祭司能管理自己生成的分享。
-- 管理权 = 笔记作者 或 链接创建者；旧的分享没有此记录，仍按笔记作者管理。
CREATE TABLE IF NOT EXISTS share_creators (
  token      TEXT PRIMARY KEY,
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_share_creators_user
  ON share_creators (created_by);

-- ------------------------------------------------------------------ 验证码
CREATE TABLE IF NOT EXISTS captchas (
  id        TEXT PRIMARY KEY,
  code_hash TEXT,
  expire_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_captchas_expire_at
  ON captchas (expire_at);

-- ------------------------------------------------------------------ 系统设置
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- 默认允许新用户注册；皇帝可在管理面板中关闭。
INSERT OR IGNORE INTO settings (key, value) VALUES ('registration_enabled', '1');

-- ------------------------------------------------------------------ 种子账号
-- 默认管理员：admin / 123456aaa
-- 首次登录后请立即修改密码，不要在生产环境长期使用默认凭据。
-- 注意：INSERT OR IGNORE 不会覆盖已存在 admin 的密码。
INSERT OR IGNORE INTO users (id, username, password_hash, role)
VALUES (
  '00000000000000000000000000000001',
  'admin',
  '3704f976a0ac82c4fb8be5743f07a57183a3a095b73ca3ef6f1a710db8720c53',
  '皇帝'
);
