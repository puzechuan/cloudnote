import { json } from '../lib/http.js';
import * as admin from './admin.js';
import * as auth from './auth.js';
import * as captcha from './captcha.js';
import * as notebooks from './notebooks.js';
import * as shares from './shares.js';

/**
 * /api/* 路由。
 * 路径参数保持与旧版一致：笔记 ID 为 32 位十六进制字符串。
 */
export async function handleApi(request, env) {
  const path = new URL(request.url).pathname.slice('/api'.length) || '/';

  try {
    if (path === '/register' && request.method === 'POST') return auth.register(request, env);
    if (path === '/login' && request.method === 'POST') return auth.login(request, env);
    if (path === '/logout' && request.method === 'POST') return auth.logout(request, env);
    if (path === '/captcha' && request.method === 'GET') return captcha.issue(request, env);
    if (path === '/me' && request.method === 'GET') return auth.me(request, env);
    if (path === '/change-password' && request.method === 'POST') return auth.changePassword(request, env);

    if (path === '/notebooks' && request.method === 'GET') return notebooks.list(request, env);
    if (path === '/notebooks' && request.method === 'POST') return notebooks.create(request, env);

    if (path === '/shares' && request.method === 'GET') return shares.list(request, env);
    if (path === '/shares' && request.method === 'DELETE') return shares.clearAll(request, env);

    if (path.startsWith('/shares/') && request.method === 'PATCH') {
      const parts = path.split('/').filter(Boolean);
      return shares.updateExpiry(request, env, parts[1]);
    }

    if (path.startsWith('/shares/') && request.method === 'DELETE') {
      const parts = path.split('/').filter(Boolean);
      return shares.revoke(request, env, parts[1]);
    }

    if (path.startsWith('/notebooks/')) {
      const parts = path.split('/').filter(Boolean);
      if (parts.length < 2) return json({ error: '无效的笔记ID' }, 400);

      const id = parts[1];
      if (path === `/notebooks/${id}/share`) {
        if (request.method === 'POST') return notebooks.share(request, env, id);
      } else if (path === `/notebooks/${id}`) {
        if (request.method === 'GET') return notebooks.get(request, env, id);
        if (request.method === 'PUT') return notebooks.update(request, env, id);
        if (request.method === 'DELETE') return notebooks.remove(request, env, id);
      }
    }

    if (path === '/admin/users' && request.method === 'GET') return admin.list(request, env);

    if (path.startsWith('/admin/users/') && request.method === 'POST') {
      const parts = path.split('/').filter(Boolean);
      return admin.modify(request, env, parts[2]);
    }

    return json({ error: 'API端点不存在' }, 404);
  } catch (error) {
    console.error('API处理错误:', error);
    return json({ error: '服务器内部错误: ' + error.message }, 500);
  }
}
