-- 0002_captchas.sql
-- 注册图片验证码：仅保存验证码哈希，过期后清理。

CREATE TABLE IF NOT EXISTS captchas (
  id        TEXT PRIMARY KEY,
  code_hash TEXT,
  expire_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_captchas_expire_at
  ON captchas (expire_at);
