import { getSessionUser, isPriest } from '../auth.js';
import { DAY_MS, LIMITS, ROLE } from '../config.js';
import { genId } from '../lib/crypto.js';
import { json, readJson } from '../lib/http.js';
import * as store from '../db/notebooks.js';
import { createShare, getSharedNotebookId } from '../db/shares.js';
import { clearExpire, updateExpire } from '../db/users.js';

export async function list(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: '未登录' }, 401);

  const query = (new URL(request.url).searchParams.get('q') || '').trim().slice(0, 100);

  try {
    if (query) {
      const { results } = isPriest(user)
        ? await store.searchAll(env, query)
        : await store.searchByUser(env, user.id, query);
      return json({ notebooks: results || [], query });
    }

    const { results } = isPriest(user)
      ? await store.listAll(env)
      : await store.listByUser(env, user.id);
    return json({ notebooks: results || [] });
  } catch (error) {
    console.error('获取笔记列表失败:', error);
    return json({ error: '获取笔记列表失败: ' + error.message }, 500);
  }
}

export async function create(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: '未登录' }, 401);
  if (isPriest(user)) return json({ error: '祭司为只读角色，无法新建或导入笔记' }, 403);

  try {
    if (user.role === ROLE.KNIGHT) {
      const count = await store.countByUser(env, user.id);
      if (count && count.c >= LIMITS.KNIGHT_NOTEBOOKS) {
        return json({ error: `骑士账号限制 ${LIMITS.KNIGHT_NOTEBOOKS} 个笔记本` }, 403);
      }
    }

    const data = await readJson(request);
    const id = genId();
    await store.create(env, {
      id,
      userId: user.id,
      title: data.title || '无标题笔记本',
      content: data.content || ''
    });

    // 有笔记的账号不再进入过期队列。
    await clearExpire(env, user.id);
    return json({ ok: true, id });
  } catch (error) {
    console.error('创建笔记失败:', error);
    return json({ error: '创建笔记失败: ' + error.message }, 500);
  }
}

export async function get(request, env, id) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: '未登录' }, 401);

  try {
    const notebook = isPriest(user)
      ? await store.findByIdWithAuthor(env, id)
      : await store.findByIdForUser(env, id, user.id);
    if (!notebook) return json({ error: '未找到笔记' }, 404);
    return json({ notebook });
  } catch (error) {
    console.error('获取笔记失败:', error);
    return json({ error: '获取笔记失败: ' + error.message }, 500);
  }
}

export async function update(request, env, id) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: '未登录' }, 401);
  if (isPriest(user)) return json({ error: '祭司为只读角色，无法编辑笔记' }, 403);

  try {
    const notebook = await store.findByIdForUser(env, id, user.id);
    if (!notebook) return json({ error: '未找到笔记' }, 404);

    const data = await readJson(request);
    await store.update(env, id, user.id, {
      title: data.title ?? notebook.title,
      content: data.content ?? notebook.content
    });
    return json({ ok: true });
  } catch (error) {
    console.error('更新笔记失败:', error);
    return json({ error: '更新笔记失败: ' + error.message }, 500);
  }
}

export async function remove(request, env, id) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: '未登录' }, 401);
  if (isPriest(user)) return json({ error: '祭司为只读角色，无法删除笔记' }, 403);

  try {
    await store.remove(env, id, user.id);

    // 删除最后一篇笔记后，普通账号在 10 天后过期。
    const count = await store.countByUser(env, user.id);
    if (count && count.c === 0 && user.role !== ROLE.EMPEROR) {
      await updateExpire(env, user.id, Date.now() + LIMITS.EMPTY_ACCOUNT_DAYS * DAY_MS);
    }

    return json({ ok: true });
  } catch (error) {
    console.error('删除笔记失败:', error);
    return json({ error: '删除笔记失败: ' + error.message }, 500);
  }
}

export async function share(request, env, id) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: '未登录' }, 401);
  if (isPriest(user)) return json({ error: '祭司为只读角色，无法分享笔记' }, 403);

  try {
    const notebook = await store.findByIdForUser(env, id, user.id);
    if (!notebook) return json({ error: '未找到笔记' }, 404);

    const origin = new URL(request.url).origin;

    // 已有分享链接时复用原 token，不再生成新链接；过期则刷新同一 token 的有效期。
    const existingToken = notebook.shared_token;
    if (existingToken) {
      const existingNotebookId = await getSharedNotebookId(env, existingToken);
      if (!existingNotebookId || existingNotebookId === notebook.id) {
        if (!existingNotebookId) {
          await createShare(env, existingToken, notebook.id);
        }
        return json({
          ok: true,
          reused: true,
          link: `${origin}/share/${existingToken}`
        });
      }
    }

    const token = genId();
    await createShare(env, token, id);
    await store.setSharedToken(env, id, token);

    return json({
      ok: true,
      reused: false,
      link: `${origin}/share/${token}`
    });
  } catch (error) {
    console.error('分享笔记失败:', error);
    return json({ error: '分享笔记失败: ' + error.message }, 500);
  }
}
