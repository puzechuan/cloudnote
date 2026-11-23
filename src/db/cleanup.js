import { ROLE } from '../config.js';

/**
 * 清理过期账号：
 * 只删除「已到过期时间、没有任何笔记、且不是皇帝或祭司」的账号及其会话。
 * 祭司为只读角色，自身可以不拥有笔记，因此与皇帝一样豁免清理。
 * 返回删除的账号数量。
 */
export async function cleanupExpiredAccounts(env) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT users.id
         FROM users
        WHERE users.expire_until IS NOT NULL
          AND users.expire_until <= ?
          AND users.role NOT IN (?, ?)
          AND NOT EXISTS (
            SELECT 1 FROM notebooks WHERE notebooks.user_id = users.id
          )`
    )
      .bind(Date.now(), ROLE.EMPEROR, ROLE.PRIEST)
      .all();

    const expired = results || [];
    if (expired.length === 0) return 0;

    const statements = [];
    for (const { id } of expired) {
      statements.push(env.DB.prepare('DELETE FROM notebooks WHERE user_id = ?').bind(id));
      statements.push(env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
      statements.push(env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id));
    }
    await env.DB.batch(statements);
    return expired.length;
  } catch (error) {
    console.error('清理过期账户失败:', error);
    return 0;
  }
}
