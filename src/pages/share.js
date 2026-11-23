import { findShare, getSharedNotebookId } from '../db/shares.js';
import { findByIdWithAuthor } from '../db/notebooks.js';
import { findById as findUserById } from '../db/users.js';
import { escapeHtml, html, text } from '../lib/http.js';
import { redirectShareNotFound } from './not-found.js';

/** 取正文首段作为社交分享摘要。 */
function contentSnippet(content, limit = 140) {
  const flat = String(content || '').replace(/\s+/g, ' ').trim();
  if (!flat) return '来自 cloudnote 的分享笔记';
  return flat.length > limit ? flat.slice(0, limit) + '…' : flat;
}

export function renderSharePage(title, content, sharer = null) {
  const rawTitle = title && String(title).trim();
  const noteTitle = rawTitle || '无标题笔记';
  const safeTitle = escapeHtml(noteTitle);
  const safeSharer = sharer && String(sharer).trim();
  // 分享者即链接创建者（如祭司分享他人笔记）；旧链接回退为笔记作者。
  const eyebrow = safeSharer
    ? `由${escapeHtml(safeSharer)}分享的笔记`
    : 'cloudnote 笔记分享';
  const hasContent = typeof content === 'string' && content.trim() !== '';
  const body = hasContent
    ? `<div class="note-content">${escapeHtml(content)}</div>`
    : '<div class="note-content note-empty">这篇笔记还没有内容。</div>';

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#080808" media="(prefers-color-scheme: dark)">
  <title>${safeTitle} · cloudnote</title>
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="cloudnote">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${escapeHtml(contentSnippet(content))}">
  <link rel="stylesheet" href="/css/share.css">
</head>
<body>
  <header class="app-bar">
    <a class="brand" href="/" aria-label="cloudnote 首页">
      <span class="brand-mark" aria-hidden="true"></span>
      <span class="brand-name">cloudnote</span>
    </a>
    <a class="top-link" href="/">打开 cloudnote</a>
  </header>

  <main class="page">
    <article class="note-card">
      <header class="note-head">
        <p class="note-eyebrow">${eyebrow}</p>
        <h1 class="note-title">${safeTitle}</h1>
      </header>
      ${body}
      <footer class="note-foot">
        <span class="pill">只读分享</span>
        <span class="note-foot-brand">cloudnote</span>
      </footer>
    </article>
  </main>
</body>
</html>`;
}

/** 公开分享页：/share/:token */
export async function handleShare(request, env) {
  try {
    const match = new URL(request.url).pathname.match(/^\/share\/([^/?#]+)\/?$/);
    if (!match) return redirectShareNotFound(request);

    const token = match[1];
    const notebookId = await getSharedNotebookId(env, token);
    if (!notebookId) return redirectShareNotFound(request);

    const notebook = await findByIdWithAuthor(env, notebookId);
    if (!notebook) return redirectShareNotFound(request);

    // 分享者优先取链接创建者（如祭司分享他人笔记），旧链接回退为笔记作者。
    let sharer = null;
    const share = await findShare(env, token);
    if (share?.created_by) {
      const creator = await findUserById(env, share.created_by);
      sharer = creator?.username || null;
    }
    if (!sharer) sharer = notebook.author || null;

    return html(renderSharePage(notebook.title, notebook.content, sharer), 200, {
      'Cache-Control': 'public, max-age=3600'
    });
  } catch (error) {
    console.error('处理分享失败:', error);
    return text('分享链接无效', 500);
  }
}
