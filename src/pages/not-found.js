import { html, text } from '../lib/http.js';

/** 返回 404 页面，状态码保持 404。 */
export async function serveNotFoundPage(request, env) {
  const asset = await env.ASSETS.fetch(new Request(new URL('/404.html', request.url)));
  if (!asset.ok) return text('Not Found', 404);

  return html(await asset.text(), 404, {
    'Cache-Control': 'no-store'
  });
}

/** 跳转到 404 页面，可选 reason：share / login。 */
export function redirectNotFound(request, reason) {
  const target = new URL('/404', request.url);
  if (reason) target.searchParams.set('reason', reason);
  return Response.redirect(target.toString(), 302);
}

/** 分享不存在或已过期：跳转到带分享提示的 404 页面。 */
export function redirectShareNotFound(request) {
  return redirectNotFound(request, 'share');
}
