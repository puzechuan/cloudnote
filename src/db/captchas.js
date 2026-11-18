/** 图片验证码存储（D1）。 */

export function createCaptcha(env, id, codeHash, expireAt) {
  return env.DB.prepare(
    'INSERT INTO captchas (id, code_hash, expire_at) VALUES (?, ?, ?)'
  )
    .bind(id, codeHash, expireAt)
    .run();
}

export function findCaptcha(env, id) {
  return env.DB.prepare(
    'SELECT id, code_hash, expire_at FROM captchas WHERE id = ?'
  )
    .bind(id)
    .first();
}

export function deleteCaptcha(env, id) {
  return env.DB.prepare('DELETE FROM captchas WHERE id = ?').bind(id).run();
}

export function cleanupExpiredCaptchas(env) {
  return env.DB.prepare('DELETE FROM captchas WHERE expire_at <= ?')
    .bind(Date.now())
    .run();
}
