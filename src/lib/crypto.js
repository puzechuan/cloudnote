/** 生成 32 位十六进制随机 ID（与旧版数据格式保持一致）。 */
export function genId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 十六进制摘要，用于密码散列（沿用旧版格式）。 */
export async function hashPassword(password) {
  if (!password) return '';
  const data = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
