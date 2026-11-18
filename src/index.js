import { cleanupExpiredAccounts } from './db/cleanup.js';
import { cleanupExpiredCaptchas } from './db/captchas.js';
import { getSessionUser } from './auth.js';
import { handleApi } from './api/index.js';
import { handleAdminPage } from './pages/admin.js';
import { redirectNotFound, serveNotFoundPage } from './pages/not-found.js';
import { handleShare } from './pages/share.js';
import { handleOptions } from './lib/http.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return handleOptions();

    if (url.pathname.startsWith('/api/')) return handleApi(request, env);
    if (url.pathname.startsWith('/share/')) return handleShare(request, env);
    if (url.pathname === '/404' || url.pathname === '/404.html') {
      return serveNotFoundPage(request, env);
    }
    if (url.pathname === '/myshare' || url.pathname === '/myshare.html') {
      const user = await getSessionUser(request, env);
      if (!user) return redirectNotFound(request, 'login');
      return env.ASSETS.fetch(new Request(new URL('/myshare.html', request.url)));
    }
    if (url.pathname === '/admin' || url.pathname === '/admin.html') {
      return handleAdminPage(request, env);
    }

    // 其余路径交给 Workers 静态资源（public/ 目录）。
    const response = await env.ASSETS.fetch(request);
    if (response.status === 404) return serveNotFoundPage(request, env);
    return response;
  },

  /** Cron Trigger：每天清理一次过期账号和过期验证码。 */
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      cleanupExpiredCaptchas(env).catch((error) => {
        console.error('清理过期验证码失败:', error);
      })
    );
    ctx.waitUntil(cleanupExpiredAccounts(env));
  }
};
