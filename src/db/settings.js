const REGISTRATION_ENABLED_KEY = 'registration_enabled';

/** 读取一个系统设置；不存在时返回 fallback。 */
export async function getSetting(env, key, fallback = null) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? row.value : fallback;
}

/** 写入一个系统设置（存在则覆盖）。 */
export function setSetting(env, key, value) {
  return env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
    .bind(key, value)
    .run();
}

/** 是否允许新用户注册；默认允许。 */
export async function isRegistrationEnabled(env) {
  const value = await getSetting(env, REGISTRATION_ENABLED_KEY, '1');
  return value !== '0';
}

/** 开启或关闭新用户注册。 */
export function setRegistrationEnabled(env, enabled) {
  return setSetting(env, REGISTRATION_ENABLED_KEY, enabled ? '1' : '0');
}
