#!/usr/bin/env node
/**
 * Wrangler 启动包装器。
 *
 * Miniflare 默认把运行时临时文件放在操作系统临时目录（Windows 的 %TEMP%）。
 * 在受限沙箱 / 部分 Windows 环境中，进程只能写工作区，workerd 创建
 * `miniflare-email-store` 时会报 `CreateDirectory: #5 拒绝访问`。
 *
 * 这里把 TMP / TEMP 指向项目内的 .wrangler/tmp，再启动本地 Wrangler，
 * 让 Miniflare 的临时文件始终落在可写目录中。
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = path.join(root, '.wrangler', 'tmp');
mkdirSync(tmpDir, { recursive: true });

const wranglerBin = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const child = spawn(process.execPath, [wranglerBin, ...process.argv.slice(2)], {
  cwd: root,
  env: { ...process.env, TMP: tmpDir, TEMP: tmpDir },
  stdio: 'inherit'
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
