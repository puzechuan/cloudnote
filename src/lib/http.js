const CORS_HEADERS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
});

/** JSON 响应（保留旧版 API 的 CORS 行为）。 */
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...CORS_HEADERS
    }
  });
}

/** HTML 响应。 */
export function html(markup, status = 200, extraHeaders = {}) {
  return new Response(markup, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      ...extraHeaders
    }
  });
}

/** 纯文本响应。 */
export function text(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' }
  });
}

export function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      'Access-Control-Allow-Headers': 'Content-Type, Cookie',
      'Access-Control-Max-Age': '86400'
    }
  });
}

/** 读取 JSON 请求体，非法 JSON 时退化为空对象。 */
export function readJson(request) {
  return request.json().catch(() => ({}));
}

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/** 解析 Cookie 头为对象；损坏的值直接跳过。 */
export function parseCookies(request) {
  const cookies = {};
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (!name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

function sessionCookie(token, request, { expired = false } = {}) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  const maxAge = expired ? '; Max-Age=0' : '';
  return `session=${token}; Path=/; HttpOnly; SameSite=Lax${maxAge}${secure}`;
}

export function setSessionCookie(response, token, request) {
  response.headers.append('Set-Cookie', sessionCookie(token, request));
  return response;
}

export function clearSessionCookie(response, request) {
  response.headers.append('Set-Cookie', sessionCookie('', request, { expired: true }));
  return response;
}
