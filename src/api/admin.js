import { getSessionUser, isEmperor } from '../auth.js';
import { ASSIGNABLE_ROLES, DAY_MS, ROLE } from '../config.js';
import { hashPassword } from '../lib/crypto.js';
import { json, readJson } from '../lib/http.js';
import { deleteSessionsForUser } from '../db/sessions.js';
import { removeAllForUser } from '../db/notebooks.js';
import { isRegistrationEnabled, setRegistrationEnabled } from '../db/settings.js';
import {
  deleteUser,
  findById,
  listUsers,
  updateExpire,
  updatePassword,
  updateRole
} from '../db/users.js';

/** 仅皇帝可用的后台接口。 */
async function requireEmperor(request, env) {
  const user = await getSessionUser(request, env);
  if (!isEmperor(user)) return { response: json({ error: '权限不足' }, 403) };
  return { user };
}

export async function list(request, env) {
  const { response } = await requireEmperor(request, env);
  if (response) return response;

  try {
    const { results } = await listUsers(env);
    return json({ users: results || [] });
  } catch (error) {
    console.error('管理员获取用户列表失败:', error);
    return json({ error: '获取用户列表失败: ' + error.message }, 500);
  }
}

export async function getSettings(request, env) {
  const { response } = await requireEmperor(request, env);
  if (response) return response;

  try {
    return json({ registrationEnabled: await isRegistrationEnabled(env) });
  } catch (error) {
    console.error('管理员获取系统设置失败:', error);
    return json({ error: '获取系统设置失败: ' + error.message }, 500);
  }
}

export async function updateSettings(request, env) {
  const { response } = await requireEmperor(request, env);
  if (response) return response;

  try {
    const data = await readJson(request);
    if (typeof data.registrationEnabled !== 'boolean') {
      return json({ error: 'registrationEnabled 必须是布尔值' }, 400);
    }

    await setRegistrationEnabled(env, data.registrationEnabled);
    return json({ ok: true, registrationEnabled: data.registrationEnabled });
  } catch (error) {
    console.error('管理员更新系统设置失败:', error);
    return json({ error: '更新系统设置失败: ' + error.message }, 500);
  }
}

export async function modify(request, env, uid) {
  const { response } = await requireEmperor(request, env);
  if (response) return response;

  try {
    const target = await findById(env, uid);
    if (!target) return json({ error: '用户不存在' }, 404);
    if (target.role === ROLE.EMPEROR) return json({ error: '无法修改皇帝账号' }, 403);

    const data = await readJson(request);

    switch (data.action) {
      case 'delete':
        await removeAllForUser(env, uid);
        await deleteSessionsForUser(env, uid);
        await deleteUser(env, uid);
        return json({ ok: true });

      case 'demote':
        await updateRole(env, uid, ROLE.KNIGHT);
        await removeAllForUser(env, uid);
        return json({ ok: true });

      case 'set-expire': {
        const days = Number.parseInt(data.days, 10) || 7;
        await updateExpire(env, uid, Date.now() + days * DAY_MS);
        return json({ ok: true });
      }

      case 'reset-password': {
        const newPassword = data.newPassword || 'password123';
        await updatePassword(env, uid, await hashPassword(newPassword));
        return json({ ok: true, newPassword });
      }

      case 'change-role': {
        const role = ASSIGNABLE_ROLES.includes(data.role) ? data.role : ROLE.KNIGHT;
        await updateRole(env, uid, role);
        return json({ ok: true });
      }

      default:
        return json({ error: '未知操作' }, 400);
    }
  } catch (error) {
    console.error('管理员修改用户失败:', error);
    return json({ error: '修改用户失败: ' + error.message }, 500);
  }
}
