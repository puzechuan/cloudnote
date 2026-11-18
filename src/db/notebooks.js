export function listByUser(env, userId) {
  return env.DB.prepare(
    'SELECT id, title, updated_at, length(content) AS char_count FROM notebooks WHERE user_id = ? ORDER BY updated_at DESC'
  )
    .bind(userId)
    .all();
}

export function countByUser(env, userId) {
  return env.DB.prepare('SELECT COUNT(*) AS c FROM notebooks WHERE user_id = ?')
    .bind(userId)
    .first();
}

/**
 * 标题 + 正文搜索，按更新时间倒序，并返回命中位置附近的正文摘要。
 *
 * 用 instr() 而不是 LIKE：
 * - D1 对 LIKE / GLOB 的模式串有 50 字节上限，instr 没有；
 * - % 和 _ 会作为普通字符处理，用户搜「100%」不会变成通配符；
 * - lower() 负责 ASCII 大小写不敏感，中文不受影响。
 */
export function searchByUser(env, userId, query, limit = 50) {
  return env.DB.prepare(
    `WITH matches AS (
       SELECT id, title, updated_at, content,
              length(content) AS char_count,
              instr(lower(content), lower(?)) AS hit_pos
       FROM notebooks
       WHERE user_id = ?
     )
     SELECT id, title, updated_at, char_count,
            CASE
              WHEN hit_pos > 0 THEN substr(content, max(1, hit_pos - 24), 120)
              WHEN length(content) > 0 THEN substr(content, 1, 120)
              ELSE ''
            END AS snippet
     FROM matches
     WHERE hit_pos > 0 OR instr(lower(title), lower(?)) > 0
     ORDER BY updated_at DESC
     LIMIT ?`
  )
    .bind(query, userId, query, limit)
    .all();
}

export function create(env, { id, userId, title, content }) {
  const now = Date.now();
  return env.DB.prepare(
    'INSERT INTO notebooks (id, user_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(id, userId, title, content, now, now)
    .run();
}

export function findByIdForUser(env, id, userId) {
  return env.DB.prepare('SELECT * FROM notebooks WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first();
}

/** 公开分享页使用，不校验所属用户。 */
export function findById(env, id) {
  return env.DB.prepare('SELECT title, content FROM notebooks WHERE id = ?').bind(id).first();
}

export function update(env, id, userId, { title, content }) {
  return env.DB.prepare(
    'UPDATE notebooks SET title = ?, content = ?, updated_at = ? WHERE id = ? AND user_id = ?'
  )
    .bind(title, content, Date.now(), id, userId)
    .run();
}

export function remove(env, id, userId) {
  return env.DB.prepare('DELETE FROM notebooks WHERE id = ? AND user_id = ?').bind(id, userId).run();
}

export function removeAllForUser(env, userId) {
  return env.DB.prepare('DELETE FROM notebooks WHERE user_id = ?').bind(userId).run();
}

export function setSharedToken(env, id, token) {
  return env.DB.prepare('UPDATE notebooks SET shared_token = ? WHERE id = ?').bind(token, id).run();
}
