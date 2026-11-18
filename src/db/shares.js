import { DAY_MS, DAY_SECONDS, LIMITS } from '../config.js';

/**
 * 分享链接存储。
 *
 * - 绑定 `SHARES` KV 时使用 KV（旧 beta 版的部署方式）。
 * - 否则使用 D1 的 `shares` 表（默认）。
 */

export async function createShare(env, token, notebookId) {
  if (env.SHARES) {
    await env.SHARES.put(`sh:${token}`, JSON.stringify({ id: notebookId }), {
      expirationTtl: LIMITS.SHARE_DAYS * DAY_SECONDS
    });
    return;
  }

  await env.DB.prepare(
    'INSERT OR REPLACE INTO shares (token, notebook_id, expire_at) VALUES (?, ?, ?)'
  )
    .bind(token, notebookId, Date.now() + LIMITS.SHARE_DAYS * DAY_MS)
    .run();
}

export async function getSharedNotebookId(env, token) {
  if (!token) return null;

  if (env.SHARES) {
    const raw = await env.SHARES.get(`sh:${token}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw).id || null;
    } catch {
      return null;
    }
  }

  const row = await env.DB.prepare(
    'SELECT notebook_id FROM shares WHERE token = ? AND (expire_at IS NULL OR expire_at > ?)'
  )
    .bind(token, Date.now())
    .first();
  return row?.notebook_id || null;
}

/** 列出某个用户自己创建的分享链接（只包含仍在的笔记）。 */
export function listSharesByUser(env, userId) {
  return env.DB.prepare(
    `SELECT s.token,
            s.notebook_id,
            s.expire_at,
            n.title AS notebook_title
       FROM shares s
       JOIN notebooks n ON n.id = s.notebook_id
      WHERE n.user_id = ?
      ORDER BY s.expire_at DESC
      LIMIT 200`
  )
    .bind(userId)
    .all();
}

/** 按分享令牌查询，兼容 KV / D1 两种存储。 */
export async function findShare(env, token) {
  if (!token) return null;

  if (env.SHARES) {
    const raw = await env.SHARES.get(`sh:${token}`);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return { token, notebook_id: parsed.id || null, expire_at: null };
    } catch {
      return null;
    }
  }

  return env.DB.prepare(
    'SELECT token, notebook_id, expire_at FROM shares WHERE token = ?'
  )
    .bind(token)
    .first();
}

/** 删除分享令牌（幂等）。 */
export async function deleteShare(env, token) {
  if (!token) return;

  if (env.SHARES) {
    await env.SHARES.delete(`sh:${token}`);
    return;
  }

  await env.DB.prepare('DELETE FROM shares WHERE token = ?').bind(token).run();
}

/** 撤销后同步清空笔记上的 shared_token，避免分享入口仍显示旧链接。 */
export function clearSharedToken(env, notebookId, token) {
  if (!notebookId) return;
  return env.DB.prepare(
    'UPDATE notebooks SET shared_token = NULL WHERE id = ? AND shared_token = ?'
  )
    .bind(notebookId, token)
    .run();
}

/** 更新分享链接的到期时间（null 表示长期有效）。 */
export function updateShareExpiry(env, token, expireAt) {
  return env.DB.prepare('UPDATE shares SET expire_at = ? WHERE token = ?')
    .bind(expireAt, token)
    .run();
}

/** 删除某个用户创建的全部分享，并清空其笔记上的 shared_token。 */
export async function deleteSharesByUser(env, userId) {
  const [deleted] = await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM shares WHERE notebook_id IN (SELECT id FROM notebooks WHERE user_id = ?)'
    ).bind(userId),
    env.DB.prepare('UPDATE notebooks SET shared_token = NULL WHERE user_id = ?').bind(userId)
  ]);

  return deleted?.meta?.changes || 0;
}
