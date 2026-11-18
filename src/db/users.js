const PUBLIC_COLUMNS = 'id, username, role';

export function findById(env, id) {
  return env.DB.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`).bind(id).first();
}

export function findByUsername(env, username) {
  return env.DB.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE username = ?`).bind(username).first();
}

export function findCredentials(env, username) {
  return env.DB.prepare('SELECT id, password_hash FROM users WHERE username = ?')
    .bind(username)
    .first();
}

export function findPasswordHash(env, id) {
  return env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(id).first();
}

export function createUser(env, { id, username, passwordHash, role, expireUntil = null }) {
  return env.DB.prepare(
    'INSERT INTO users (id, username, password_hash, role, expire_until) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(id, username, passwordHash, role, expireUntil)
    .run();
}

export function listUsers(env) {
  return env.DB.prepare('SELECT id, username, role FROM users').all();
}

export function updatePassword(env, id, passwordHash) {
  return env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(passwordHash, id).run();
}

export function updateRole(env, id, role) {
  return env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, id).run();
}

export function updateExpire(env, id, expireUntil) {
  return env.DB.prepare('UPDATE users SET expire_until = ? WHERE id = ?').bind(expireUntil, id).run();
}

export function clearExpire(env, id) {
  return env.DB.prepare('UPDATE users SET expire_until = NULL WHERE id = ?').bind(id).run();
}

export function deleteUser(env, id) {
  return env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
}
