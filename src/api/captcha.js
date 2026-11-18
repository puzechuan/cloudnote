import { genId } from '../lib/crypto.js';
import {
  generateCaptchaCode,
  hashCaptchaCode,
  renderCaptchaSvg
} from '../lib/captcha.js';
import {
  cleanupExpiredCaptchas,
  createCaptcha,
  deleteCaptcha,
  findCaptcha
} from '../db/captchas.js';
import { json } from '../lib/http.js';

export const CAPTCHA_TTL_MS = 5 * 60 * 1000;

/** 生成一张图片验证码，返回 id 与 data URI 图片。 */
export async function issue(request, env) {
  try {
    await cleanupExpiredCaptchas(env);

    const code = generateCaptchaCode();
    const id = genId();
    await createCaptcha(env, id, await hashCaptchaCode(code), Date.now() + CAPTCHA_TTL_MS);

    const svg = renderCaptchaSvg(code);
    const response = json({
      id,
      image: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
      ttl: CAPTCHA_TTL_MS
    });
    response.headers.set('Cache-Control', 'no-store, max-age=0');
    return response;
  } catch (error) {
    console.error('生成验证码失败:', error);
    return json({ error: '生成验证码失败' }, 500);
  }
}

/** 校验并消费验证码：无论对错都只能使用一次。 */
export async function verifyCaptcha(env, id, code) {
  const value = String(code || '').trim().toUpperCase();

  if (!id || typeof id !== 'string') {
    return { ok: false, error: '验证码已过期，请刷新' };
  }
  if (!value) {
    return { ok: false, error: '请输入验证码' };
  }
  if (value.length !== 6) {
    return { ok: false, error: '验证码错误，请重试' };
  }

  const row = await findCaptcha(env, id);
  if (!row) {
    return { ok: false, error: '验证码已过期，请刷新' };
  }

  await deleteCaptcha(env, id);

  if (row.expire_at <= Date.now()) {
    return { ok: false, error: '验证码已过期，请刷新' };
  }

  if (row.code_hash !== (await hashCaptchaCode(value))) {
    return { ok: false, error: '验证码错误，请重试' };
  }

  return { ok: true };
}
