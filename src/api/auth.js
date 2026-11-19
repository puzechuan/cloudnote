import { getSessionUser } from '../auth.js';
import { DAY_MS, LIMITS, ROLE } from '../config.js';
import { genId, hashPassword } from '../lib/crypto.js';
import { verifyCaptcha } from './captcha.js';
import {
  clearSessionCookie,
  json,
  parseCookies,
  readJson,
  setSessionCookie
} from '../lib/http.js';
import { createSession, deleteSession, deleteSessionsForUser } from '../db/sessions.js';
import { isRegistrationEnabled } from '../db/settings.js';
import {
  createUser,
  findCredentials,
  findByUsername,
  findPasswordHash,
  updatePassword
} from '../db/users.js';

/** 公开接口：当前是否允许新用户注册。 */
export async function registrationStatus(_request, env) {
  try {
    return json({ enabled: await isRegistrationEnabled(env) });
  } catch (error) {
    console.error('获取注册开关失败:', error);
    // 读取失败时不阻断注册入口，真正的限制仍由 register 接口校验。
    return json({ enabled: true });
  }
}

export async function register(request, env) {
  try {
    if (!(await isRegistrationEnabled(env))) {
      return json({ error: '管理员已关闭新用户注册' }, 403);
    }

    const data = await readJson(request);
    const { username, password } = data;

    if (!username || !password) return json({ error: '用户名或密码缺失' }, 400);
    if (typeof username !== 'string' || typeof password !== 'string') {
      return json({ error: '用户名和密码必须是字符串' }, 400);
    }
    if (username.length < 3 || username.length > 20) {
      return json({ error: '用户名长度必须在3-20个字符之间' }, 400);
    }

    const captchaCheck = await verifyCaptcha(env, data.captchaId, data.captchaCode);
    if (!captchaCheck.ok) {
      return json({ error: captchaCheck.error }, 400);
    }

    if (await findByUsername(env, username)) {
      return json({ error: '用户名已存在' }, 400);
    }

    const id = genId();
    await createUser(env, {
      id,
      username,
      passwordHash: await hashPassword(password),
      role: ROLE.KNIGHT,
      expireUntil: Date.now() + LIMITS.EMPTY_ACCOUNT_DAYS * DAY_MS
    });

    const token = await createSession(env, id);
    return setSessionCookie(json({ ok: true }), token, request);
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) {
      return json({ error: '用户名已存在' }, 400);
    }
    console.error('注册失败:', error);
    return json({ error: '注册失败: ' + error.message }, 500);
  }
}

export async function login(request, env) {
  try {
    const data = await readJson(request);
    const { username, password } = data;

    if (!username || !password) return json({ error: '用户名或密码缺失' }, 400);

    const credentials = await findCredentials(env, username);
    if (!credentials) return json({ error: '用户不存在' }, 400);

    if ((await hashPassword(password)) !== credentials.password_hash) {
      return json({ error: '密码错误' }, 400);
    }

    const token = await createSession(env, credentials.id);
    return setSessionCookie(json({ ok: true }), token, request);
  } catch (error) {
    console.error('登录失败:', error);
    return json({ error: '登录失败: ' + error.message }, 500);
  }
}

export async function logout(request, env) {
  try {
    const token = parseCookies(request).session;
    if (token) {
      try {
        await deleteSession(env, token);
      } catch (error) {
        console.error('删除 session 失败:', error);
      }
    }

    return clearSessionCookie(json({ ok: true }), request);
  } catch (error) {
    console.error('登出失败:', error);
    return json({ error: '登出失败: ' + error.message }, 500);
  }
}

export async function me(request, env) {
  try {
    const user = await getSessionUser(request, env);
    return json({ user: user || null });
  } catch (error) {
    console.error('获取用户信息失败:', error);
    return json({ user: null }, 500);
  }
}

export async function changePassword(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: '未登录' }, 401);

  try {
    const { oldPassword, newPassword } = await readJson(request);
    if (!oldPassword || !newPassword) return json({ error: '参数缺失' }, 400);

    const credentials = await findPasswordHash(env, user.id);
    if (!credentials || credentials.password_hash !== (await hashPassword(oldPassword))) {
      return json({ error: '原密码错误' }, 400);
    }

    await updatePassword(env, user.id, await hashPassword(newPassword));

    // 修改密码后让已有会话全部失效，要求用户重新登录。
    const token = parseCookies(request).session;
    if (token) await deleteSession(env, token);
    await deleteSessionsForUser(env, user.id);

    return clearSessionCookie(json({ ok: true }), request);
  } catch (error) {
    console.error('修改密码失败:', error);
    return json({ error: '修改密码失败: ' + error.message }, 500);
  }
}
