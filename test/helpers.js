import { readdir, readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import worker from '../src/index.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 把 Node 内置 SQLite 包装成 Worker 里 D1 的最小接口。 */
export function createD1(sqlite) {
  return {
    prepare(sql) {
      let params = [];
      const statement = {
        bind(...values) {
          params = values;
          return statement;
        },
        async first(column) {
          const row = sqlite.prepare(sql).get(...params);
          if (!row) return null;
          if (column) return row[column];
          return { ...row };
        },
        async all() {
          const rows = sqlite.prepare(sql).all(...params);
          return { success: true, results: rows.map((row) => ({ ...row })), meta: {} };
        },
        async run() {
          const result = sqlite.prepare(sql).run(...params);
          return {
            success: true,
            results: [],
            meta: {
              changes: Number(result.changes),
              last_row_id: Number(result.lastInsertRowid)
            }
          };
        }
      };
      return statement;
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }
  };
}

/** 内存版 KV，支持 expirationTtl。 */
export function createKv() {
  const store = new Map();
  return {
    async get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt && entry.expiresAt <= Date.now()) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    async put(key, value, options = {}) {
      store.set(key, {
        value: String(value),
        expiresAt: options.expirationTtl ? Date.now() + options.expirationTtl * 1000 : null
      });
    },
    async delete(key) {
      store.delete(key);
    }
  };
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

/** 模拟 Workers 静态资源绑定。 */
export function createAssets() {
  return {
    async fetch(input) {
      const url = new URL(input instanceof Request ? input.url : String(input));
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';

      const publicDir = path.join(ROOT, 'public');
      const filePath = path.resolve(publicDir, `.${pathname}`);
      if (!filePath.startsWith(publicDir + path.sep)) {
        return new Response('Not Found', { status: 404 });
      }

      try {
        const body = await readFile(filePath);
        return new Response(body, {
          headers: { 'content-type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream' }
        });
      } catch {
        return new Response('Not Found', { status: 404 });
      }
    }
  };
}

/** 创建一套测试环境（独立内存数据库 + 静态资源 + 可选 KV）。 */
export async function createEnv({ kv = false } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  const migrationsDir = path.join(ROOT, 'migrations');
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    sqlite.exec(await readFile(path.join(migrationsDir, file), 'utf8'));
  }

  const env = {
    DB: createD1(sqlite),
    ASSETS: createAssets()
  };
  if (kv) {
    env.SESSIONS = createKv();
    env.SHARES = createKv();
  }
  return { env, sqlite };
}

/** 调用 Worker 并解析 JSON / Set-Cookie，便于断言。 */
export async function call(
  env,
  pathname,
  { method = 'GET', body, cookie, autoCaptcha = true } = {}
) {
  let payload = body;

  // 测试默认自动带一个有效验证码；专门的验证码用例可传 autoCaptcha: false。
  if (
    autoCaptcha &&
    pathname === '/api/register' &&
    method === 'POST' &&
    body &&
    !body.captchaId
  ) {
    const captchaId = randomUUID().replace(/-/g, '');
    const captchaCode = 'ABC123';
    const codeHash = createHash('sha256').update(captchaCode).digest('hex');
    await env.DB.prepare(
      'INSERT INTO captchas (id, code_hash, expire_at) VALUES (?, ?, ?)'
    )
      .bind(captchaId, codeHash, Date.now() + 60000)
      .run();
    payload = { ...body, captchaId, captchaCode };
  }

  const headers = {};
  if (payload !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = `session=${cookie}`;

  const request = new Request(new URL(pathname, 'https://example.com'), {
    method,
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });

  const response = await worker.fetch(request, env, { waitUntil() {} });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // 非 JSON 页面
  }

  const setCookie = response.headers.get('set-cookie') || '';
  const match = setCookie.match(/session=([^;]*)/);

  return {
    status: response.status,
    headers: response.headers,
    text,
    data,
    setCookie,
    cookie: match ? match[1] : null
  };
}
