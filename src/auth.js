import { ROLE } from './config.js';
import { parseCookies } from './lib/http.js';
import { getSessionUserId } from './db/sessions.js';
import { findById } from './db/users.js';

/** 从 Cookie 会话解析当前登录用户，失败时返回 null。 */
export async function getSessionUser(request, env) {
  try {
    const token = parseCookies(request).session;
    if (!token) return null;

    const userId = await getSessionUserId(env, token);
    if (!userId) return null;

    return (await findById(env, userId)) || null;
  } catch (error) {
    console.error('获取会话用户失败:', error);
    return null;
  }
}

export function isEmperor(user) {
  return user?.role === ROLE.EMPEROR;
}
