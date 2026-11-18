import { DAY_MS, DAY_SECONDS, LIMITS } from '../config.js';
import { genId } from '../lib/crypto.js';

/**
 * 会话存储。
 *
 * - 绑定 `SESSIONS` KV 时使用 KV（旧 beta 版的部署方式）。
 * - 否则使用 D1 的 `sessions` 表（默认）。
 */

function usesKv(env) {
  return Boolean(env.SESSIONS);
}

export async function createSession(env, userId) {
  if (!userId) throw new Error('用户ID不能为空');

  const token = genId();
  if (usesKv(env)) {
    await env.SESSIONS.put(`s:${token}`, userId, {
      expirationTtl: LIMITS.SESSION_DAYS * DAY_SECONDS
    });
  } else {
    await env.DB.prepare(
      'INSERT OR REPLACE INTO sessions (token, user_id, expire_at) VALUES (?, ?, ?)'
    )
      .bind(token, userId, Date.now() + LIMITS.SESSION_DAYS * DAY_MS)
      .run();
  }
  return token;
}

export async function getSessionUserId(env, token) {
  if (!token) return null;

  if (usesKv(env)) {
    return (await env.SESSIONS.get(`s:${token}`)) || null;
  }

  const row = await env.DB.prepare(
    'SELECT user_id FROM sessions WHERE token = ? AND (expire_at IS NULL OR expire_at > ?)'
  )
    .bind(token, Date.now())
    .first();
  return row?.user_id || null;
}

export async function deleteSession(env, token) {
  if (!token) return;

  if (usesKv(env)) {
    await env.SESSIONS.delete(`s:${token}`);
  } else {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  }
}

export async function deleteSessionsForUser(env, userId) {
  if (usesKv(env)) return; // KV 会话会在 TTL 后自动过期
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}
