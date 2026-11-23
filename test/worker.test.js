import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import worker from '../src/index.js';
import { CAPTCHA_FONT, generateCaptchaCode, renderCaptchaSvg } from '../src/lib/captcha.js';
import { call, createEnv } from './helpers.js';

test('静态资源、OPTIONS 与 404', async () => {
  const { env } = await createEnv();

  const home = await call(env, '/');
  assert.equal(home.status, 200);
  assert.match(home.text, /cloudnote/);
  assert.match(home.text, /\/js\/app\.js/);

  const css = await call(env, '/css/app.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);

  const missing = await call(env, '/missing-page');
  assert.equal(missing.status, 404);
  assert.match(missing.text, /该页面不存在/);
  assert.match(missing.text, /返回首页/);

  const options = await call(env, '/api/me', { method: 'OPTIONS' });
  assert.equal(options.status, 204);
  assert.equal(options.headers.get('access-control-allow-origin'), '*');
  assert.match(options.headers.get('access-control-allow-headers'), /Cookie/);
});

test('404 页面：未知页面与失效分享', async () => {
  const { env } = await createEnv();

  let res = await call(env, '/missing-page');
  assert.equal(res.status, 404);
  assert.match(res.text, /该页面不存在/);
  assert.match(res.text, /返回首页/);

  res = await call(env, '/404');
  assert.equal(res.status, 404);
  assert.match(res.text, /该页面不存在/);

  res = await call(env, '/404?reason=share');
  assert.equal(res.status, 404);
  assert.match(res.text, /data-share="该分享已经被删除或者不存在。"/);
  assert.match(res.text, /分享不存在/);

  res = await call(env, '/404?reason=login');
  assert.equal(res.status, 404);
  assert.match(res.text, /data-login="需要登录"/);
  assert.match(res.text, /请先登录后再访问这个页面/);

  res = await call(env, '/404?reason=forbidden');
  assert.equal(res.status, 404);
  assert.match(res.text, /data-forbidden="权限不足"/);
  assert.match(res.text, /你没有权限访问这个页面/);

  res = await call(env, '/share/deadbeef');
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /\/404\?reason=share/);

  res = await call(env, '/api/not-a-route');
  assert.equal(res.status, 404);
  assert.ok(res.data && res.data.error);
});

test('注册、登录、会话与修改密码', async () => {
  const { env } = await createEnv();

  let res = await call(env, '/api/me');
  assert.deepEqual(res.data, { user: null });

  res = await call(env, '/api/register', {
    method: 'POST',
    body: { username: 'tester', password: 'secret123' }
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, { ok: true });
  assert.ok(res.cookie);

  const cookie = res.cookie;
  res = await call(env, '/api/me', { cookie });
  assert.equal(res.data.user.username, 'tester');
  assert.equal(res.data.user.role, '骑士');

  res = await call(env, '/api/login', {
    method: 'POST',
    body: { username: 'tester', password: 'wrong-password' }
  });
  assert.equal(res.status, 400);
  assert.equal(res.data.error, '密码错误');

  res = await call(env, '/api/register', {
    method: 'POST',
    body: { username: 'ab', password: 'secret123' }
  });
  assert.equal(res.status, 400);

  res = await call(env, '/api/register', {
    method: 'POST',
    body: { username: 'tester', password: 'secret123' }
  });
  assert.equal(res.status, 400);
  assert.equal(res.data.error, '用户名已存在');

  res = await call(env, '/api/change-password', {
    method: 'POST',
    cookie,
    body: { oldPassword: 'nope', newPassword: 'new-secret' }
  });
  assert.equal(res.status, 400);
  assert.equal(res.data.error, '原密码错误');

  res = await call(env, '/api/change-password', {
    method: 'POST',
    cookie,
    body: { oldPassword: 'secret123', newPassword: 'new-secret' }
  });
  assert.equal(res.status, 200);
  // 修改密码后清除会话 cookie，并让旧会话失效
  assert.equal(res.cookie, '');
  res = await call(env, '/api/me', { cookie });
  assert.deepEqual(res.data, { user: null });

  res = await call(env, '/api/logout', { method: 'POST', cookie });
  assert.equal(res.status, 200);
  assert.equal(res.cookie, '');

  res = await call(env, '/api/me', { cookie });
  assert.deepEqual(res.data, { user: null });

  res = await call(env, '/api/login', {
    method: 'POST',
    body: { username: 'tester', password: 'new-secret' }
  });
  assert.equal(res.status, 200);
  assert.ok(res.cookie);
});

test('注册图片验证码：生成、必填、错误、过期与一次性', async () => {
  const { env, sqlite } = await createEnv();
  const code = 'ABC123';
  const codeHash = createHash('sha256').update(code).digest('hex');

  function insertCaptcha(id, expireAt) {
    sqlite
      .prepare('INSERT INTO captchas (id, code_hash, expire_at) VALUES (?, ?, ?)')
      .run(id, codeHash, expireAt);
  }

  // 生成接口：返回 id 与图片，图片里没有文本节点
  let res = await call(env, '/api/captcha');
  assert.equal(res.status, 200);
  assert.match(res.data.id, /^[0-9a-f]{32}$/);
  assert.match(res.data.image, /^data:image\/svg\+xml/);
  assert.match(res.headers.get('cache-control'), /no-store/);

  const svg = decodeURIComponent(res.data.image.split(',')[1]);
  assert.match(svg, /^<svg/);
  assert.ok(!svg.includes('<text'));

  // 缺少验证码
  res = await call(env, '/api/register', {
    method: 'POST',
    body: { username: 'capuser', password: 'cap-pass' },
    autoCaptcha: false
  });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /验证码/);

  // 错误验证码会被消费
  const wrongId = 'a'.repeat(32);
  insertCaptcha(wrongId, Date.now() + 60000);
  res = await call(env, '/api/register', {
    method: 'POST',
    body: {
      username: 'capuser',
      password: 'cap-pass',
      captchaId: wrongId,
      captchaCode: 'XXXXXX'
    },
    autoCaptcha: false
  });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /验证码错误/);
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) AS c FROM captchas WHERE id = ?').get(wrongId).c,
    0
  );

  // 过期验证码
  const expiredId = 'b'.repeat(32);
  insertCaptcha(expiredId, Date.now() - 1000);
  res = await call(env, '/api/register', {
    method: 'POST',
    body: {
      username: 'capuser',
      password: 'cap-pass',
      captchaId: expiredId,
      captchaCode: code
    },
    autoCaptcha: false
  });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /过期/);

  // 正确验证码（大小写不敏感），注册成功且只能使用一次
  const okId = 'c'.repeat(32);
  insertCaptcha(okId, Date.now() + 60000);
  res = await call(env, '/api/register', {
    method: 'POST',
    body: {
      username: 'capuser',
      password: 'cap-pass',
      captchaId: okId,
      captchaCode: 'abc123'
    },
    autoCaptcha: false
  });
  assert.equal(res.status, 200);
  assert.ok(res.cookie);

  res = await call(env, '/api/register', {
    method: 'POST',
    body: {
      username: 'capuser2',
      password: 'cap-pass',
      captchaId: okId,
      captchaCode: code
    },
    autoCaptcha: false
  });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /过期/);

  // 生成器：6 位、字母数字混合、图片不含验证码文本
  for (let i = 0; i < 200; i += 1) {
    const generated = generateCaptchaCode();
    assert.equal(generated.length, 6);
    assert.match(generated, /^[A-Z2-9]{6}$/);
    assert.match(generated, /[A-Z]/);
    assert.match(generated, /[2-9]/);
  }

  const rendered = renderCaptchaSvg('ABC123');
  assert.ok(!rendered.includes('ABC123'));
  assert.ok(!rendered.includes('<text'));
  assert.match(rendered, /^<svg/);

  for (const ch of 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789') {
    assert.ok(CAPTCHA_FONT[ch], `缺少字形 ${ch}`);
    assert.equal(CAPTCHA_FONT[ch].length, 7);
    for (const row of CAPTCHA_FONT[ch]) assert.match(row, /^[01]{5}$/);
  }

  // 每日 Cron 也会清理过期验证码
  const staleId = 'd'.repeat(32);
  insertCaptcha(staleId, Date.now() - 1000);
  const waitUntil = [];
  await worker.scheduled({}, env, { waitUntil: (promise) => waitUntil.push(promise) });
  await Promise.all(waitUntil);
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) AS c FROM captchas WHERE id = ?').get(staleId).c,
    0
  );
});

test('笔记 CRUD、权限隔离与公开分享', async () => {
  const { env, sqlite } = await createEnv();

  let res = await call(env, '/api/register', {
    method: 'POST',
    body: { username: 'writer', password: 'write-pass' }
  });
  const cookie = res.cookie;
  assert.ok(cookie);

  res = await call(env, '/api/notebooks', {
    method: 'POST',
    cookie,
    body: { title: '第一篇', content: '<b>hello</b>' }
  });
  assert.equal(res.status, 200);
  assert.match(res.data.id, /^[0-9a-f]{32}$/);
  const notebookId = res.data.id;

  res = await call(env, '/api/notebooks', { cookie });
  assert.equal(res.data.notebooks.length, 1);
  assert.equal(res.data.notebooks[0].title, '第一篇');

  res = await call(env, `/api/notebooks/${notebookId}`, { cookie });
  assert.equal(res.data.notebook.content, '<b>hello</b>');

  res = await call(env, `/api/notebooks/${notebookId}`, {
    method: 'PUT',
    cookie,
    body: { title: '改名了', content: 'updated <script>alert(1)</script>' }
  });
  assert.equal(res.status, 200);

  res = await call(env, `/api/notebooks/${notebookId}`, { cookie });
  assert.equal(res.data.notebook.title, '改名了');

  res = await call(env, `/api/notebooks/${notebookId}/share`, { method: 'POST', cookie });
  assert.equal(res.status, 200);
  assert.match(res.data.link, /^https:\/\/example\.com\/share\/[0-9a-f]{32}$/);

  const firstLink = res.data.link;
  const token = firstLink.split('/').pop();
  res = await call(env, `/share/${token}`);
  assert.equal(res.status, 200);
  assert.match(res.text, /upd&lt;script&gt;|updated &lt;script&gt;/);
  assert.ok(!res.text.includes('<script>alert(1)</script>'));
  assert.match(res.text, /<span class="brand-name">cloudnote<\/span>/);
  assert.match(res.text, /href="\/css\/share\.css"/);
  assert.match(res.text, /只读分享/);

  // 再次分享复用原链接，不生成新 token
  res = await call(env, `/api/notebooks/${notebookId}/share`, { method: 'POST', cookie });
  assert.equal(res.status, 200);
  assert.equal(res.data.link, firstLink);
  assert.equal(res.data.reused, true);

  // 原链接过期后再分享，仍复用原 token，并刷新有效期
  sqlite.prepare('UPDATE shares SET expire_at = ? WHERE token = ?').run(Date.now() - 1000, token);
  res = await call(env, `/share/${token}`);
  assert.equal(res.status, 302);

  res = await call(env, `/api/notebooks/${notebookId}/share`, { method: 'POST', cookie });
  assert.equal(res.status, 200);
  assert.equal(res.data.link, firstLink);
  assert.equal(res.data.reused, true);

  res = await call(env, `/share/${token}`);
  assert.equal(res.status, 200);

  res = await call(env, '/share/does-not-exist');
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /\/404\?reason=share/);

  res = await call(env, '/api/register', {
    method: 'POST',
    body: { username: 'intruder', password: 'intrude-pass' }
  });
  const intruderCookie = res.cookie;

  res = await call(env, `/api/notebooks/${notebookId}`, { cookie: intruderCookie });
  assert.equal(res.status, 404);
  res = await call(env, `/api/notebooks/${notebookId}`, {
    method: 'DELETE',
    cookie: intruderCookie
  });
  assert.equal(res.status, 200);
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) AS c FROM notebooks WHERE id = ?').get(notebookId).c,
    1
  );

  res = await call(env, `/api/notebooks/${notebookId}`, { method: 'DELETE', cookie });
  assert.equal(res.status, 200);

  let row = sqlite.prepare('SELECT expire_until FROM users WHERE username = ?').get('writer');
  assert.ok(row.expire_until > Date.now());

  res = await call(env, '/api/notebooks', {
    method: 'POST',
    cookie,
    body: { title: '新笔记', content: '' }
  });
  assert.equal(res.status, 200);
  row = sqlite.prepare('SELECT expire_until FROM users WHERE username = ?').get('writer');
  assert.equal(row.expire_until, null);

  res = await call(env, '/api/notebooks/');
  assert.equal(res.status, 400);
  assert.equal(res.data.error, '无效的笔记ID');

  res = await call(env, '/api/unknown-endpoint');
  assert.equal(res.status, 404);
  assert.equal(res.data.error, 'API端点不存在');
});

test('搜索笔记：标题与内容、大小写、特殊字符与用户隔离', async () => {
  const { env } = await createEnv();

  let res = await call(env, '/api/register', {
    method: 'POST',
    body: { username: 'searcher', password: 'search-pass' }
  });
  const cookie = res.cookie;

  const create = async (title, content) => {
    const r = await call(env, '/api/notebooks', {
      method: 'POST',
      cookie,
      body: { title, content }
    });
    assert.equal(r.status, 200);
    return r.data.id;
  };

  const titleMatch = await create('项目计划', '本周没有进展');
  const contentMatch = await create('每周备忘', '包含 Alpha 关键词与 项目 内容');
  await create('无关笔记', 'nothing here');
  const deepMatch = await create('长文', 'x'.repeat(300) + ' 深处关键词 ' + 'y'.repeat(100));

  // 标题与正文都能命中
  res = await call(env, '/api/notebooks?q=' + encodeURIComponent('项目'), { cookie });
  assert.equal(res.status, 200);
  assert.equal(res.data.notebooks.length, 2);
  assert.deepEqual(
    res.data.notebooks.map((n) => n.id).sort(),
    [titleMatch, contentMatch].sort()
  );

  // 仅标题命中时，摘要给正文开头
  const titleHit = res.data.notebooks.find((n) => n.id === titleMatch);
  assert.match(titleHit.snippet, /本周没有进展/);
  assert.equal(titleHit.char_count, '本周没有进展'.length);

  // 列表接口同样返回正文字数
  res = await call(env, '/api/notebooks', { cookie });
  const listed = res.data.notebooks.find((n) => n.id === contentMatch);
  assert.equal(listed.char_count, '包含 Alpha 关键词与 项目 内容'.length);

  // 仅正文命中时，摘要包含命中词
  res = await call(env, '/api/notebooks?q=alpha', { cookie });
  assert.equal(res.data.notebooks.length, 1);
  assert.equal(res.data.notebooks[0].id, contentMatch);
  assert.match(res.data.notebooks[0].snippet, /Alpha/);

  // ASCII 大小写不敏感
  res = await call(env, '/api/notebooks?q=ALPHA', { cookie });
  assert.equal(res.data.notebooks.length, 1);

  // 命中位置在正文深处时，摘要仍围绕命中词
  res = await call(env, '/api/notebooks?q=' + encodeURIComponent('深处关键词'), { cookie });
  assert.equal(res.data.notebooks.length, 1);
  assert.equal(res.data.notebooks[0].id, deepMatch);
  assert.match(res.data.notebooks[0].snippet, /深处关键词/);

  // % 和 _ 按普通字符处理，不当作通配符
  res = await call(env, '/api/notebooks?q=' + encodeURIComponent('%'), { cookie });
  assert.equal(res.data.notebooks.length, 0);
  res = await call(env, '/api/notebooks?q=' + encodeURIComponent('_'), { cookie });
  assert.equal(res.data.notebooks.length, 0);

  // 空白 q 等价于普通列表
  res = await call(env, '/api/notebooks?q=%20', { cookie });
  assert.equal(res.data.notebooks.length, 4);

  // 未登录不可搜索
  res = await call(env, '/api/notebooks?q=alpha');
  assert.equal(res.status, 401);

  // 搜索按用户隔离
  res = await call(env, '/api/register', {
    method: 'POST',
    body: { username: 'nosy', password: 'nosy-pass' }
  });
  res = await call(env, '/api/notebooks?q=alpha', { cookie: res.cookie });
  assert.equal(res.data.notebooks.length, 0);
});

test('兼容仅 wrangler deploy：share_creators 表不存在时自动创建', async () => {
  const { env, sqlite } = await createEnv();

  // 模拟生产库未执行 init SQL：删掉创建者表
  sqlite.prepare('DROP TABLE IF EXISTS share_creators').run();
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE name='share_creators'").get().c,
    0
  );

  // 作者建笔记，祭司首次分享应自动建表并记录创建者
  let res = await call(env, '/api/register', {
    method: 'POST',
    body: { username: 'legacy-owner', password: 'pass-1234' }
  });
  const ownerCookie = res.cookie;
  res = await call(env, '/api/notebooks', {
    method: 'POST',
    cookie: ownerCookie,
    body: { title: '旧环境的笔记', content: 'x' }
  });
  const notebook = res.data.id;

  res = await call(env, '/api/register', {
    method: 'POST',
    body: { username: 'legacy-priest', password: 'pass-1234' }
  });
  const priestCookie = res.cookie;
  const priestId = sqlite
    .prepare('SELECT id FROM users WHERE username = ?')
    .get('legacy-priest').id;
  sqlite.prepare('UPDATE users SET role = ? WHERE id = ?').run('祭司', priestId);

  res = await call(env, `/api/notebooks/${notebook}/share`, {
    method: 'POST',
    cookie: priestCookie
  });
  assert.equal(res.status, 200, '表不存在时分享应成功');

  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE name='share_creators'").get().c,
    1,
    '应自动建表'
  );
  const token = res.data.link.split('/').pop();
  res = await call(env, '/api/shares', { cookie: priestCookie });
  assert.ok(res.data.shares.some((s) => s.token === token), '祭司应能列出自己创建的分享');
});

test('祭司：可查看/搜索/分享所有用户的笔记，但不可写', async () => {
  const { env, sqlite } = await createEnv();

  // 两名普通用户各建一篇笔记
  let res = await call(env, '/api/register', {
    method: 'POST',
    body: { username: 'priest-writer-a', password: 'pass-1234' }
  });
  const cookieA = res.cookie;
  res = await call(env, '/api/notebooks', {
    method: 'POST',
    cookie: cookieA,
    body: { title: '甲的秘密', content: 'Alpha 内容' }
  });
  const notebookA = res.data.id;

  res = await call(env, '/api/register', {
    method: 'POST',
    body: { username: 'priest-writer-b', password: 'pass-1234' }
  });
  const cookieB = res.cookie;
  res = await call(env, '/api/notebooks', {
    method: 'POST',
    cookie: cookieB,
    body: { title: '乙的备忘', content: 'Beta 内容' }
  });
  const notebookB = res.data.id;

  // 第三人提升为祭司（祭司无自己的笔记）
  res = await call(env, '/api/register', {
    method: 'POST',
    body: { username: 'priest-viewer', password: 'pass-1234' }
  });
  const priestCookie = res.cookie;
  const priestId = sqlite
    .prepare('SELECT id FROM users WHERE username = ?')
    .get('priest-viewer').id;
  sqlite.prepare('UPDATE users SET role = ? WHERE id = ?').run('祭司', priestId);

  res = await call(env, '/api/me', { cookie: priestCookie });
  assert.equal(res.data.user.role, '祭司');

  // 列表：能看到所有人的笔记，且带作者名
  res = await call(env, '/api/notebooks', { cookie: priestCookie });
  assert.equal(res.status, 200);
  const ids = res.data.notebooks.map((n) => n.id).sort();
  assert.deepEqual(ids, [notebookA, notebookB].sort());
  assert.ok(res.data.notebooks.every((n) => n.author), '每条笔记应带作者名');

  // 搜索：跨所有用户命中
  res = await call(env, '/api/notebooks?q=Alpha', { cookie: priestCookie });
  assert.equal(res.data.notebooks.length, 1);
  assert.equal(res.data.notebooks[0].id, notebookA);

  // 读取任意用户的笔记详情
  res = await call(env, `/api/notebooks/${notebookB}`, { cookie: priestCookie });
  assert.equal(res.status, 200);
  assert.equal(res.data.notebook.title, '乙的备忘');
  assert.equal(res.data.notebook.author, 'priest-writer-b');

  // 只读：新建、编辑、删除被拒绝
  res = await call(env, '/api/notebooks', {
    method: 'POST',
    cookie: priestCookie,
    body: { title: '祭司不能建', content: '' }
  });
  assert.equal(res.status, 403);
  res = await call(env, `/api/notebooks/${notebookA}`, {
    method: 'PUT',
    cookie: priestCookie,
    body: { title: '改了', content: '改了' }
  });
  assert.equal(res.status, 403);
  res = await call(env, `/api/notebooks/${notebookA}`, {
    method: 'DELETE',
    cookie: priestCookie
  });
  assert.equal(res.status, 403);

  // 祭司可以分享任意用户的笔记
  res = await call(env, `/api/notebooks/${notebookA}/share`, {
    method: 'POST',
    cookie: priestCookie
  });
  assert.equal(res.status, 200);
  assert.match(res.data.link, /^https:\/\/example\.com\/share\/[0-9a-f]{32}$/);
  const priestShareToken = res.data.link.split('/').pop();
  res = await call(env, `/share/${priestShareToken}`);
  assert.equal(res.status, 200);
  assert.match(res.text, /甲的秘密/);

  // 分享链接同时出现在原作者与创建者（祭司）的「我的分享」中
  res = await call(env, '/api/shares', { cookie: cookieA });
  assert.ok(res.data.shares.some((s) => s.token === priestShareToken), '作者应看到该分享');
  res = await call(env, '/api/shares', { cookie: priestCookie });
  const priestShare = res.data.shares.find((s) => s.token === priestShareToken);
  assert.ok(priestShare, '祭司作为创建者应看到该分享');
  assert.equal(priestShare.author, 'priest-writer-a');
  assert.equal(priestShare.created_by_me, true);

  // 无关第三方不能管理该分享
  res = await call(env, `/api/shares/${priestShareToken}`, {
    method: 'PATCH',
    cookie: cookieB,
    body: { days: 7 }
  });
  assert.equal(res.status, 404);

  // 祭司可管理自己生成的分享：改有效期 + 撤销
  res = await call(env, `/api/shares/${priestShareToken}`, {
    method: 'PATCH',
    cookie: priestCookie,
    body: { days: 7 }
  });
  assert.equal(res.status, 200);
  res = await call(env, `/api/shares/${priestShareToken}`, {
    method: 'DELETE',
    cookie: priestCookie
  });
  assert.equal(res.status, 200);
  res = await call(env, `/share/${priestShareToken}`);
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /\/404\?reason=share/);

  // 原作者数据未被改动（分享与撤销不修改笔记内容/归属）
  res = await call(env, `/api/notebooks/${notebookA}`, { cookie: cookieA });
  assert.equal(res.data.notebook.title, '甲的秘密');

  // 普通用户依然只能看到自己的笔记
  res = await call(env, '/api/notebooks', { cookie: cookieA });
  assert.deepEqual(res.data.notebooks.map((n) => n.id), [notebookA]);
});

test('祭司：一键清空只删自己创建的分享，不影响作者自己的分享', async () => {
  const { env, sqlite } = await createEnv();

  // 作者建两篇笔记：一篇留给祭司分享，一篇自己生成分享
  let res = await call(env, '/api/register', {
    method: 'POST',
    body: { username: 'owner-user', password: 'pass-1234' }
  });
  const ownerCookie = res.cookie;
  const makeNote = async (title) => {
    const r = await call(env, '/api/notebooks', {
      method: 'POST',
      cookie: ownerCookie,
      body: { title, content: 'x' }
    });
    return r.data.id;
  };
  const priestTarget = await makeNote('给祭司分享的笔记');
  const ownerNotebook = await makeNote('作者自己的笔记');
  res = await call(env, `/api/notebooks/${ownerNotebook}/share`, {
    method: 'POST',
    cookie: ownerCookie
  });
  const ownerToken = res.data.link.split('/').pop();

  // 提升第二人为祭司，由祭司分享作者的第一篇笔记（首次生成，创建者=祭司）
  res = await call(env, '/api/register', {
    method: 'POST',
    body: { username: 'priest-clear', password: 'pass-1234' }
  });
  const priestCookie = res.cookie;
  const priestId = sqlite
    .prepare('SELECT id FROM users WHERE username = ?')
    .get('priest-clear').id;
  sqlite.prepare('UPDATE users SET role = ? WHERE id = ?').run('祭司', priestId);
  res = await call(env, `/api/notebooks/${priestTarget}/share`, {
    method: 'POST',
    cookie: priestCookie
  });
  assert.equal(res.status, 200);
  const priestToken = res.data.link.split('/').pop();

  // 祭司一键清空：只删自己创建的分享
  res = await call(env, '/api/shares', { method: 'DELETE', cookie: priestCookie });
  assert.equal(res.status, 200);
  assert.equal(res.data.deleted, 1);

  res = await call(env, `/share/${priestToken}`);
  assert.equal(res.status, 302, '祭司创建的分享应被清空');
  res = await call(env, `/share/${ownerToken}`);
  assert.equal(res.status, 200, '作者自己创建的分享应保留');

  // 作者的分享列表仍完整
  res = await call(env, '/api/shares', { cookie: ownerCookie });
  assert.ok(res.data.shares.some((s) => s.token === ownerToken));
});

test('祭司：可由皇帝在后台分配角色，且免于过期清理', async () => {
  const { env, sqlite } = await createEnv();

  let res = await call(env, '/api/register', {
    method: 'POST',
    body: { username: 'priest-candidate', password: 'pass-1234' }
  });
  const userCookie = res.cookie;
  const userId = sqlite
    .prepare('SELECT id FROM users WHERE username = ?')
    .get('priest-candidate').id;

  // 非皇帝不能改角色
  res = await call(env, `/api/admin/users/${userId}`, {
    method: 'POST',
    cookie: userCookie,
    body: { action: 'change-role', role: '祭司' }
  });
  assert.equal(res.status, 403);

  // 皇帝可分配祭司角色
  res = await call(env, '/api/login', {
    method: 'POST',
    body: { username: 'admin', password: '123456aaa' }
  });
  const adminCookie = res.cookie;
  res = await call(env, `/api/admin/users/${userId}`, {
    method: 'POST',
    cookie: adminCookie,
    body: { action: 'change-role', role: '祭司' }
  });
  assert.equal(res.status, 200);
  res = await call(env, '/api/me', { cookie: userCookie });
  assert.equal(res.data.user.role, '祭司');

  // 祭司无笔记且已过期，Cron 不应清理它
  sqlite
    .prepare('UPDATE users SET expire_until = ? WHERE id = ?')
    .run(Date.now() - 1000, userId);
  const waitUntil = [];
  await worker.scheduled({}, env, { waitUntil: (promise) => waitUntil.push(promise) });
  await Promise.all(waitUntil);
  const survivor = sqlite.prepare('SELECT COUNT(*) AS c FROM users WHERE id = ?').get(userId);
  assert.equal(survivor.c, 1);
});

test('骑士账号最多 8 个笔记本', async () => {
  const { env } = await createEnv();

  let res = await call(env, '/api/register', {
    method: 'POST',
    body: { username: 'knight', password: 'knight-pass' }
  });
  const cookie = res.cookie;

  for (let i = 0; i < 8; i += 1) {
    res = await call(env, '/api/notebooks', {
      method: 'POST',
      cookie,
      body: { title: `笔记 ${i}`, content: '' }
    });
    assert.equal(res.status, 200, `第 ${i + 1} 个笔记本应该创建成功`);
  }

  res = await call(env, '/api/notebooks', {
    method: 'POST',
    cookie,
    body: { title: '第九个', content: '' }
  });
  assert.equal(res.status, 403);
  assert.match(res.data.error, /8/);
});

test('管理员后台：鉴权、改角色、重置密码与删除用户', async () => {
  const { env } = await createEnv();

  let res = await call(env, '/api/register', {
    method: 'POST',
    body: { username: 'player', password: 'player-pass' }
  });
  const playerCookie = res.cookie;

  res = await call(env, '/admin');
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /\/404\?reason=login/);

  res = await call(env, '/admin.html');
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /\/404\?reason=login/);

  res = await call(env, '/admin', { cookie: playerCookie });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /\/404\?reason=forbidden/);

  res = await call(env, '/api/admin/users', { cookie: playerCookie });
  assert.equal(res.status, 403);

  res = await call(env, '/api/login', {
    method: 'POST',
    body: { username: 'admin', password: '123456aaa' }
  });
  assert.equal(res.status, 200);
  const adminCookie = res.cookie;

  res = await call(env, '/admin', { cookie: adminCookie });
  assert.equal(res.status, 200);
  assert.match(res.text, /管理员面板/);

  res = await call(env, '/admin.html', { cookie: adminCookie });
  assert.equal(res.status, 200);
  assert.match(res.text, /管理员面板/);

  res = await call(env, '/api/admin/users', { cookie: adminCookie });
  assert.equal(res.status, 200);
  const users = res.data.users;
  assert.equal(users.length, 2);
  const player = users.find((user) => user.username === 'player');
  const emperor = users.find((user) => user.role === '皇帝');
  assert.ok(player);
  assert.ok(emperor);

  res = await call(env, `/api/admin/users/${player.id}`, {
    method: 'POST',
    cookie: adminCookie,
    body: { action: 'change-role', role: '贵族' }
  });
  assert.equal(res.status, 200);

  res = await call(env, '/api/me', { cookie: playerCookie });
  assert.equal(res.data.user.role, '贵族');

  res = await call(env, `/api/admin/users/${player.id}`, {
    method: 'POST',
    cookie: adminCookie,
    body: { action: 'set-expire', days: 3 }
  });
  assert.equal(res.status, 200);

  res = await call(env, '/api/login', {
    method: 'POST',
    body: { username: 'player', password: 'password123' }
  });
  assert.equal(res.status, 400);

  res = await call(env, `/api/admin/users/${player.id}`, {
    method: 'POST',
    cookie: adminCookie,
    body: { action: 'reset-password' }
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.newPassword, 'password123');

  res = await call(env, '/api/login', {
    method: 'POST',
    body: { username: 'player', password: 'password123' }
  });
  assert.equal(res.status, 200);

  res = await call(env, `/api/admin/users/${emperor.id}`, {
    method: 'POST',
    cookie: adminCookie,
    body: { action: 'delete' }
  });
  assert.equal(res.status, 403);
  assert.equal(res.data.error, '无法修改皇帝账号');

  res = await call(env, `/api/admin/users/${player.id}`, {
    method: 'POST',
    cookie: adminCookie,
    body: { action: 'delete' }
  });
  assert.equal(res.status, 200);

  res = await call(env, '/api/admin/users', { cookie: adminCookie });
  assert.equal(res.data.users.length, 1);

  res = await call(env, '/api/login', {
    method: 'POST',
    body: { username: 'player', password: 'password123' }
  });
  assert.equal(res.status, 400);
  assert.equal(res.data.error, '用户不存在');
});

test('皇帝后台：注册开关控制新用户注册', async () => {
  const { env } = await createEnv();

  // 先注册一个已有用户，关闭注册后它仍应能登录和保持会话。
  let res = await call(env, '/api/register', {
    method: 'POST',
    body: { username: 'existing', password: 'existing-pass' }
  });
  assert.equal(res.status, 200);
  const existingCookie = res.cookie;

  res = await call(env, '/api/registration');
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, { enabled: true });

  // 未登录和普通用户都不能读写设置。
  res = await call(env, '/api/admin/settings');
  assert.equal(res.status, 403);
  res = await call(env, '/api/admin/settings', { cookie: existingCookie });
  assert.equal(res.status, 403);
  res = await call(env, '/api/admin/settings', {
    method: 'PUT',
    cookie: existingCookie,
    body: { registrationEnabled: false }
  });
  assert.equal(res.status, 403);

  res = await call(env, '/api/login', {
    method: 'POST',
    body: { username: 'admin', password: '123456aaa' }
  });
  assert.equal(res.status, 200);
  const adminCookie = res.cookie;

  res = await call(env, '/api/admin/settings', { cookie: adminCookie });
  assert.equal(res.status, 200);
  assert.equal(res.data.registrationEnabled, true);

  res = await call(env, '/api/admin/settings', {
    method: 'PUT',
    cookie: adminCookie,
    body: {}
  });
  assert.equal(res.status, 400);

  // 关闭注册。
  res = await call(env, '/api/admin/settings', {
    method: 'PUT',
    cookie: adminCookie,
    body: { registrationEnabled: false }
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.registrationEnabled, false);

  res = await call(env, '/api/registration');
  assert.deepEqual(res.data, { enabled: false });

  res = await call(env, '/api/register', {
    method: 'POST',
    body: { username: 'blocked', password: 'blocked-pass' }
  });
  assert.equal(res.status, 403);
  assert.match(res.data.error, /关闭/);

  // 已注册用户不受影响：密码登录、旧会话都仍然有效。
  res = await call(env, '/api/login', {
    method: 'POST',
    body: { username: 'existing', password: 'existing-pass' }
  });
  assert.equal(res.status, 200);

  res = await call(env, '/api/me', { cookie: existingCookie });
  assert.equal(res.data.user.username, 'existing');

  res = await call(env, '/api/login', {
    method: 'POST',
    body: { username: 'blocked', password: 'blocked-pass' }
  });
  assert.equal(res.status, 400);
  assert.equal(res.data.error, '用户不存在');

  // 重新开启后可以继续注册。
  res = await call(env, '/api/admin/settings', {
    method: 'PUT',
    cookie: adminCookie,
    body: { registrationEnabled: true }
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.registrationEnabled, true);

  res = await call(env, '/api/register', {
    method: 'POST',
    body: { username: 'after', password: 'after-pass' }
  });
  assert.equal(res.status, 200);
});

test('我的分享：普通用户列出并撤销自己的分享链接', async () => {
  const { env } = await createEnv();

  // 普通用户创建笔记并分享
  let res = await call(env, '/api/register', {
    method: 'POST',
    body: { username: 'sharer', password: 'sharer-pass' }
  });
  const userCookie = res.cookie;

  res = await call(env, '/api/notebooks', {
    method: 'POST',
    cookie: userCookie,
    body: { title: '分享的笔记', content: 'hello share' }
  });
  const notebookId = res.data.id;

  res = await call(env, `/api/notebooks/${notebookId}/share`, {
    method: 'POST',
    cookie: userCookie
  });
  assert.equal(res.status, 200);
  const token = res.data.link.split('/').pop();

  // 未登录跳 404 登录提示；普通用户登录后可访问
  res = await call(env, '/myshare');
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /\/404\?reason=login/);

  res = await call(env, '/myshare', { cookie: userCookie });
  assert.equal(res.status, 200);
  assert.match(res.text, /我的分享/);

  // 未登录不能访问接口
  res = await call(env, '/api/shares');
  assert.equal(res.status, 401);

  // 自己的分享列表
  res = await call(env, '/api/shares', { cookie: userCookie });
  assert.equal(res.status, 200);
  const item = res.data.shares.find((share) => share.token === token);
  assert.ok(item, '列表中应包含自己的分享');
  assert.equal(item.notebook_title, '分享的笔记');
  assert.equal(item.expired, false);
  assert.ok(item.expire_at > Date.now());

  // 其他用户看不到、也撤不掉
  res = await call(env, '/api/register', {
    method: 'POST',
    body: { username: 'other', password: 'other-pass' }
  });
  const otherCookie = res.cookie;

  res = await call(env, '/api/shares', { cookie: otherCookie });
  assert.equal(res.data.shares.length, 0);

  res = await call(env, `/api/shares/${token}`, {
    method: 'DELETE',
    cookie: otherCookie
  });
  assert.equal(res.status, 404);

  // 自己撤销
  res = await call(env, `/api/shares/${token}`, {
    method: 'DELETE',
    cookie: userCookie
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, { ok: true });

  // 链接立即失效：跳到带分享提示的 404 页面
  res = await call(env, `/share/${token}`);
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /\/404\?reason=share/);

  // 列表不再包含，笔记上的 shared_token 已清除
  res = await call(env, '/api/shares', { cookie: userCookie });
  assert.equal(res.data.shares.some((share) => share.token === token), false);

  res = await call(env, `/api/notebooks/${notebookId}`, { cookie: userCookie });
  assert.equal(res.data.notebook.shared_token, null);

  // 撤销后再次分享会生成新链接
  res = await call(env, `/api/notebooks/${notebookId}/share`, {
    method: 'POST',
    cookie: userCookie
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.reused, false);
  assert.notEqual(res.data.link.split('/').pop(), token);

  // 重复撤销返回 404
  res = await call(env, `/api/shares/${token}`, {
    method: 'DELETE',
    cookie: userCookie
  });
  assert.equal(res.status, 404);
  assert.equal(res.data.error, '分享不存在');
});

test('我的分享：一键删除全部分享链接', async () => {
  const { env } = await createEnv();

  // alice 创建两篇笔记并分享
  let res = await call(env, '/api/register', {
    method: 'POST',
    body: { username: 'alice', password: 'alice-pass' }
  });
  const aliceCookie = res.cookie;

  const aliceNotebooks = [];
  for (const title of ['A1', 'A2']) {
    res = await call(env, '/api/notebooks', {
      method: 'POST',
      cookie: aliceCookie,
      body: { title, content: '' }
    });
    aliceNotebooks.push(res.data.id);
  }

  const aliceTokens = [];
  for (const notebookId of aliceNotebooks) {
    res = await call(env, `/api/notebooks/${notebookId}/share`, {
      method: 'POST',
      cookie: aliceCookie
    });
    aliceTokens.push(res.data.link.split('/').pop());
  }

  // bob 也有一条分享
  res = await call(env, '/api/register', {
    method: 'POST',
    body: { username: 'bob', password: 'bob-pass' }
  });
  const bobCookie = res.cookie;

  res = await call(env, '/api/notebooks', {
    method: 'POST',
    cookie: bobCookie,
    body: { title: 'B1', content: '' }
  });
  const bobNotebook = res.data.id;

  res = await call(env, `/api/notebooks/${bobNotebook}/share`, {
    method: 'POST',
    cookie: bobCookie
  });
  const bobToken = res.data.link.split('/').pop();

  // 未登录不能批量删除
  res = await call(env, '/api/shares', { method: 'DELETE' });
  assert.equal(res.status, 401);

  // alice 一键删除
  res = await call(env, '/api/shares', { method: 'DELETE', cookie: aliceCookie });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, { ok: true, deleted: 2 });

  // alice 的链接全部失效，bob 的分享不受影响
  for (const token of aliceTokens) {
    const share = await call(env, `/share/${token}`);
    assert.equal(share.status, 302);
    assert.match(share.headers.get('location'), /\/404\?reason=share/);
  }

  let share = await call(env, `/share/${bobToken}`);
  assert.equal(share.status, 200);

  // 列表与 shared_token 同步清理
  let list = await call(env, '/api/shares', { cookie: aliceCookie });
  assert.equal(list.data.shares.length, 0);

  list = await call(env, '/api/shares', { cookie: bobCookie });
  assert.equal(list.data.shares.length, 1);
  assert.equal(list.data.shares[0].token, bobToken);

  res = await call(env, `/api/notebooks/${aliceNotebooks[0]}`, { cookie: aliceCookie });
  assert.equal(res.data.notebook.shared_token, null);

  res = await call(env, `/api/notebooks/${bobNotebook}`, { cookie: bobCookie });
  assert.equal(res.data.notebook.shared_token, bobToken);

  // 再次删除返回 0
  res = await call(env, '/api/shares', { method: 'DELETE', cookie: aliceCookie });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, { ok: true, deleted: 0 });
});

test('我的分享：编辑链接有效期', async () => {
  const { env, sqlite } = await createEnv();

  let res = await call(env, '/api/register', {
    method: 'POST',
    body: { username: 'expiryuser', password: 'expiry-pass' }
  });
  const cookie = res.cookie;

  res = await call(env, '/api/notebooks', {
    method: 'POST',
    cookie,
    body: { title: '有效期笔记', content: 'x' }
  });
  const notebookId = res.data.id;

  res = await call(env, `/api/notebooks/${notebookId}/share`, { method: 'POST', cookie });
  const token = res.data.link.split('/').pop();

  // 未登录不能编辑
  res = await call(env, `/api/shares/${token}`, { method: 'PATCH', body: { days: 7 } });
  assert.equal(res.status, 401);

  // 改成 7 天
  res = await call(env, `/api/shares/${token}`, {
    method: 'PATCH',
    cookie,
    body: { days: 7 }
  });
  assert.equal(res.status, 200);
  assert.ok(res.data.expire_at > Date.now() + 6 * 86400000);
  assert.ok(res.data.expire_at < Date.now() + 8 * 86400000);

  res = await call(env, '/api/shares', { cookie });
  let item = res.data.shares.find((share) => share.token === token);
  assert.ok(item);
  assert.equal(item.expired, false);
  assert.ok(item.expire_at > Date.now());

  // 改为长期有效
  res = await call(env, `/api/shares/${token}`, {
    method: 'PATCH',
    cookie,
    body: { days: null }
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.expire_at, null);

  res = await call(env, '/api/shares', { cookie });
  item = res.data.shares.find((share) => share.token === token);
  assert.equal(item.expire_at, null);
  assert.equal(item.expired, false);

  res = await call(env, `/share/${token}`);
  assert.equal(res.status, 200);

  // 过期后编辑可以恢复
  sqlite.prepare('UPDATE shares SET expire_at = ? WHERE token = ?').run(Date.now() - 1000, token);
  res = await call(env, `/share/${token}`);
  assert.equal(res.status, 302);

  res = await call(env, `/api/shares/${token}`, {
    method: 'PATCH',
    cookie,
    body: { days: 30 }
  });
  assert.equal(res.status, 200);

  res = await call(env, `/share/${token}`);
  assert.equal(res.status, 200);

  // 非法天数
  for (const days of [0, 366, 1.5, '7', undefined]) {
    res = await call(env, `/api/shares/${token}`, {
      method: 'PATCH',
      cookie,
      body: { days }
    });
    assert.equal(res.status, 400);
  }

  // 其他用户不能编辑
  res = await call(env, '/api/register', {
    method: 'POST',
    body: { username: 'other-expiry', password: 'other-pass' }
  });
  const otherCookie = res.cookie;

  res = await call(env, `/api/shares/${token}`, {
    method: 'PATCH',
    cookie: otherCookie,
    body: { days: 7 }
  });
  assert.equal(res.status, 404);
});

test('可选 KV 模式：会话与分享不写入 D1', async () => {
  const { env, sqlite } = await createEnv({ kv: true });

  let res = await call(env, '/api/register', {
    method: 'POST',
    body: { username: 'kvuser', password: 'kv-pass' }
  });
  assert.equal(res.status, 200);
  const cookie = res.cookie;

  res = await call(env, '/api/me', { cookie });
  assert.equal(res.data.user.username, 'kvuser');

  res = await call(env, '/api/notebooks', {
    method: 'POST',
    cookie,
    body: { title: 'KV 笔记', content: 'kv' }
  });
  const notebookId = res.data.id;

  res = await call(env, `/api/notebooks/${notebookId}/share`, { method: 'POST', cookie });
  const token = res.data.link.split('/').pop();
  assert.match(token, /^[0-9a-f]{32}$/);
  const firstLink = res.data.link;

  res = await call(env, `/share/${token}`);
  assert.equal(res.status, 200);
  assert.match(res.text, /KV 笔记/);

  res = await call(env, `/api/notebooks/${notebookId}/share`, { method: 'POST', cookie });
  assert.equal(res.status, 200);
  assert.equal(res.data.link, firstLink);
  assert.equal(res.data.reused, true);

  res = await call(env, '/api/shares', { method: 'DELETE', cookie });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /KV/);

  assert.equal(sqlite.prepare('SELECT COUNT(*) AS c FROM sessions').get().c, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS c FROM shares').get().c, 0);

  res = await call(env, '/api/logout', { method: 'POST', cookie });
  assert.equal(res.status, 200);
  res = await call(env, '/api/me', { cookie });
  assert.deepEqual(res.data, { user: null });
});

test('Cron 清理：只删除过期且无笔记的普通账号', async () => {
  const { env, sqlite } = await createEnv();

  await call(env, '/api/register', {
    method: 'POST',
    body: { username: 'empty-account', password: 'pass-1234' }
  });
  let res = await call(env, '/api/register', {
    method: 'POST',
    body: { username: 'active-account', password: 'pass-1234' }
  });
  await call(env, '/api/notebooks', {
    method: 'POST',
    cookie: res.cookie,
    body: { title: '还有笔记', content: '' }
  });

  const past = Date.now() - 1000;
  const markExpired = sqlite.prepare('UPDATE users SET expire_until = ? WHERE username = ?');
  markExpired.run(past, 'empty-account');
  markExpired.run(past, 'active-account');
  markExpired.run(past, 'admin');

  const waitUntil = [];
  await worker.scheduled({}, env, { waitUntil: (promise) => waitUntil.push(promise) });
  await Promise.all(waitUntil);

  const remaining = sqlite
    .prepare('SELECT username FROM users ORDER BY username')
    .all()
    .map((row) => row.username);
  assert.deepEqual(remaining, ['active-account', 'admin']);

  const emptySessions = sqlite
    .prepare('SELECT COUNT(*) AS c FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)')
    .get('empty-account').c;
  assert.equal(emptySessions, 0);
});
