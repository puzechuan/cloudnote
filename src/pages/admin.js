import { getSessionUser, isEmperor } from '../auth.js';
import { redirectNotFound } from './not-found.js';

/**
 * 后台页面守卫，通过后返回 public/admin.html。
 * API 权限在 /api/admin/* 内再次校验。
 */
export async function handleAdminPage(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return redirectNotFound(request, 'login');
  if (!isEmperor(user)) return redirectNotFound(request, 'forbidden');

  return env.ASSETS.fetch(new Request(new URL('/admin.html', request.url)));
}
