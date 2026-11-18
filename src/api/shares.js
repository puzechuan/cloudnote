import { getSessionUser } from '../auth.js';
import { DAY_MS } from '../config.js';
import { json, readJson } from '../lib/http.js';
import { findByIdForUser } from '../db/notebooks.js';
import {
  clearSharedToken,
  deleteShare,
  deleteSharesByUser,
  findShare,
  listSharesByUser,
  updateShareExpiry
} from '../db/shares.js';

/** 当前用户创建的全部分享链接。 */
export async function list(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: '未登录' }, 401);

  if (env.SHARES) {
    return json({ shares: [], storage: 'kv' });
  }

  try {
    const { results } = await listSharesByUser(env, user.id);
    const now = Date.now();
    return json({
      shares: (results || []).map((row) => ({
        token: row.token,
        notebook_id: row.notebook_id,
        notebook_title: row.notebook_title,
        expire_at: row.expire_at,
        expired: row.expire_at != null && row.expire_at <= now
      })),
      now
    });
  } catch (error) {
    console.error('获取分享列表失败:', error);
    return json({ error: '获取分享列表失败: ' + error.message }, 500);
  }
}

/** 一键删除当前用户的全部共享链接。 */
export async function clearAll(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: '未登录' }, 401);

  if (env.SHARES) {
    return json({ error: '当前部署使用 KV 存储分享链接，无法批量清除' }, 400);
  }

  try {
    const deleted = await deleteSharesByUser(env, user.id);
    return json({ ok: true, deleted });
  } catch (error) {
    console.error('清空分享失败:', error);
    return json({ error: '清空分享失败: ' + error.message }, 500);
  }
}

/** 编辑某条分享链接的有效期；days = null 表示长期有效。 */
export async function updateExpiry(request, env, token) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: '未登录' }, 401);

  if (env.SHARES) {
    return json({ error: '当前部署使用 KV 存储分享链接，无法编辑有效期' }, 400);
  }

  if (!token) return json({ error: '无效的分享令牌' }, 400);

  let body;
  try {
    body = await readJson(request);
  } catch {
    return json({ error: '请求内容无效' }, 400);
  }

  const { days } = body || {};
  let expireAt;

  if (days === null) {
    expireAt = null;
  } else if (Number.isInteger(days) && days >= 1 && days <= 365) {
    expireAt = Date.now() + days * DAY_MS;
  } else {
    return json({ error: '有效期必须在 1-365 天之间' }, 400);
  }

  try {
    const share = await findShare(env, token);
    if (!share || !share.notebook_id) return json({ error: '分享不存在' }, 404);

    const notebook = await findByIdForUser(env, share.notebook_id, user.id);
    if (!notebook) return json({ error: '分享不存在' }, 404);

    await updateShareExpiry(env, token, expireAt);
    return json({ ok: true, expire_at: expireAt });
  } catch (error) {
    console.error('更新分享有效期失败:', error);
    return json({ error: '更新分享有效期失败: ' + error.message }, 500);
  }
}

/** 撤销当前用户自己的某条分享链接。 */
export async function revoke(request, env, token) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: '未登录' }, 401);
  if (!token) return json({ error: '无效的分享令牌' }, 400);

  try {
    const share = await findShare(env, token);
    if (!share || !share.notebook_id) return json({ error: '分享不存在' }, 404);

    // 只能撤销自己笔记的分享，返回 404 避免泄露他人令牌是否存在
    const notebook = await findByIdForUser(env, share.notebook_id, user.id);
    if (!notebook) return json({ error: '分享不存在' }, 404);

    await deleteShare(env, token);
    await clearSharedToken(env, share.notebook_id, token);

    return json({ ok: true });
  } catch (error) {
    console.error('撤销分享失败:', error);
    return json({ error: '撤销分享失败: ' + error.message }, 500);
  }
}
