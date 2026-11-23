import { DAY_MS, DAY_SECONDS, LIMITS } from '../config.js';

// 分享创建者表在部分部署方式下不会被 init SQL 创建（例如只跑 wrangler deploy）。
// 这里按环境惰性执行 CREATE TABLE IF NOT EXISTS，保证幂等且不依赖部署命令。
const creatorsTableReady = new WeakMap();

async function ensureCreatorsTable(env) {
  if (env.SHARES) return; // KV 模式把创建者存在 KV 值里，不需要该表
  let ready = creatorsTableReady.get(env);
  if (!ready) {
    ready = env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS share_creators (
         token TEXT PRIMARY KEY,
         created_by TEXT
       )`
    )
      .run()
      .then(() => true)
      .catch((error) => {
        creatorsTableReady.delete(env); // 失败后允许下次重试
        throw error;
      });
    creatorsTableReady.set(env, ready);
  }
  await ready;
}

/**
 * 分享链接存储。
 *
 * - 绑定 `SHARES` KV 时使用 KV（旧 beta 版的部署方式）。
 * - 否则使用 D1 的 `shares` 表（默认）。
 */

export async function createShare(env, token, notebookId, createdBy = null) {
  if (env.SHARES) {
    await env.SHARES.put(`sh:${token}`, JSON.stringify({ id: notebookId, createdBy }), {
      expirationTtl: LIMITS.SHARE_DAYS * DAY_SECONDS
    });
    return;
  }

  await env.DB.prepare(
    'INSERT OR REPLACE INTO shares (token, notebook_id, expire_at) VALUES (?, ?, ?)'
  )
    .bind(token, notebookId, Date.now() + LIMITS.SHARE_DAYS * DAY_MS)
    .run();

  if (createdBy) {
    await ensureCreatorsTable(env);
    await env.DB.prepare(
      'INSERT OR REPLACE INTO share_creators (token, created_by) VALUES (?, ?)'
    )
      .bind(token, createdBy)
      .run();
  }
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

/**
 * 列出用户可管理的分享链接（只包含仍在的笔记）：
 * 自己笔记上的分享，或自己创建的分享（如祭司分享他人笔记）。
 */
export async function listSharesByUser(env, userId) {
  await ensureCreatorsTable(env);
  return env.DB.prepare(
    `SELECT s.token,
            s.notebook_id,
            s.expire_at,
            n.title AS notebook_title,
            n.user_id AS note_owner_id,
            owner.username AS author,
            sc.created_by
       FROM shares s
       JOIN notebooks n ON n.id = s.notebook_id
       LEFT JOIN users owner ON owner.id = n.user_id
       LEFT JOIN share_creators sc ON sc.token = s.token
      WHERE n.user_id = ? OR sc.created_by = ?
      ORDER BY s.expire_at DESC
      LIMIT 200`
  )
    .bind(userId, userId)
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
      return {
        token,
        notebook_id: parsed.id || null,
        expire_at: null,
        created_by: parsed.createdBy || null
      };
    } catch {
      return null;
    }
  }

  await ensureCreatorsTable(env);
  return env.DB.prepare(
    `SELECT s.token, s.notebook_id, s.expire_at, sc.created_by
       FROM shares s
       LEFT JOIN share_creators sc ON sc.token = s.token
      WHERE s.token = ?`
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

  await ensureCreatorsTable(env);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM shares WHERE token = ?').bind(token),
    env.DB.prepare('DELETE FROM share_creators WHERE token = ?').bind(token)
  ]);
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

/** 删除用户可管理的全部分享（自己笔记上的，或自己创建的），并清空对应笔记的 shared_token。 */
export async function deleteSharesByUser(env, userId) {
  await ensureCreatorsTable(env);
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT s.token, s.notebook_id
       FROM shares s
       JOIN notebooks n ON n.id = s.notebook_id
       LEFT JOIN share_creators sc ON sc.token = s.token
      WHERE n.user_id = ? OR sc.created_by = ?`
  )
    .bind(userId, userId)
    .all();

  const targets = results || [];
  if (targets.length === 0) return 0;

  const statements = [];
  for (const { token, notebook_id } of targets) {
    statements.push(env.DB.prepare('DELETE FROM shares WHERE token = ?').bind(token));
    statements.push(env.DB.prepare('DELETE FROM share_creators WHERE token = ?').bind(token));
    statements.push(
      env.DB.prepare('UPDATE notebooks SET shared_token = NULL WHERE id = ? AND shared_token = ?')
        .bind(notebook_id, token)
    );
  }
  await env.DB.batch(statements);
  return targets.length;
}
