#!/usr/bin/env node
/**
 * cloudnote 一键部署脚本。
 *
 * 流程：
 *   1. 检查 Node / 依赖 / Cloudflare 登录
 *   2. 复用或创建 D1，并同步 wrangler.jsonc 的 database_id
 *   3. 执行 init_cloudnote_db.sql（幂等）
 *   4. 部署 Worker
 *   5. 访问部署地址做一次状态检查
 *
 * 用法：
 *   npm run deploy:auto
 *   npm run deploy:auto -- --dry-run
 */
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(root, 'wrangler.jsonc');
const initPath = path.join(root, 'init_cloudnote_db.sql');
const wranglerBin = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const tmpDir = path.join(root, '.wrangler', 'tmp');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const showHelp = args.includes('--help') || args.includes('-h');

function fail(message) {
  throw new Error(message);
}

function step(index, total, message) {
  console.log(`\n[${index}/${total}] ${message}`);
}

function readConfig() {
  if (!existsSync(configPath)) fail('未找到 wrangler.jsonc');

  const text = readFileSync(configPath, 'utf8');
  const name = text.match(/"name"\s*:\s*"([^"]+)"/)?.[1];
  const d1Block = text.match(/"d1_databases"\s*:\s*\[([\s\S]*?)\]/)?.[1] || '';
  const binding = d1Block.match(/"binding"\s*:\s*"([^"]+)"/)?.[1];
  const databaseName = d1Block.match(/"database_name"\s*:\s*"([^"]+)"/)?.[1];
  const databaseId = d1Block.match(/"database_id"\s*:\s*"([^"]+)"/)?.[1];

  return { text, name, binding, databaseName, databaseId };
}

function updateConfigDatabaseId(id) {
  const config = readConfig();
  if (config.databaseId === id) return;

  let next;
  if (config.databaseId) {
    next = config.text.replace(
      /("database_id"\s*:\s*")[^"]*(")/,
      `$1${id}$2`
    );
  } else {
    next = config.text.replace(
      /("database_name"\s*:\s*"[^"]+")/,
      `$1,\n      "database_id": "${id}"`
    );
  }

  if (next === config.text) {
    fail('无法自动写入 database_id，请手动修改 wrangler.jsonc');
  }

  copyFileSync(configPath, configPath + '.bak');
  writeFileSync(configPath, next, 'utf8');
  console.log(`已更新 wrangler.jsonc 的 database_id（备份：wrangler.jsonc.bak）`);
}

function spawnWrangler(wrArgs, { capture = false } = {}) {
  mkdirSync(tmpDir, { recursive: true });

  return spawnSync(process.execPath, [wranglerBin, ...wrArgs], {
    cwd: root,
    env: { ...process.env, TMP: tmpDir, TEMP: tmpDir },
    stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8'
  });
}

function runWrangler(wrArgs, options = {}) {
  const result = spawnWrangler(wrArgs, options);
  if (result.error) fail(result.error.message);
  if (result.status !== 0) {
    const detail = options.capture ? String(result.stdout || '').trim() : '';
    fail(
      `wrangler ${wrArgs.join(' ')} 失败（退出码 ${result.status}）` +
        (detail ? `\n${detail}` : '')
    );
  }
  return options.capture ? String(result.stdout || '') : '';
}

function ensureDependencies() {
  if (existsSync(wranglerBin)) return;

  if (dryRun) {
    console.log('未安装依赖；实际运行时会先执行 npm install');
    return;
  }

  console.log('未找到 Wrangler，执行 npm install...');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['install'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });

  if (result.status !== 0 || !existsSync(wranglerBin)) {
    fail('依赖安装失败，请手动执行 npm install');
  }
}

function ensureAuth() {
  if (dryRun) return;

  const probe = spawnWrangler(['whoami', '--json'], { capture: true });
  if (probe.status === 0) {
    console.log('Cloudflare 已登录');
    return;
  }

  console.log('当前未登录 Cloudflare，启动 wrangler login...');
  runWrangler(['login']);
  runWrangler(['whoami', '--json'], { capture: true });
}

function parseJsonArray(raw) {
  const start = raw.indexOf('[');
  if (start < 0) fail('无法解析 wrangler d1 list --json 的输出');
  return JSON.parse(raw.slice(start));
}

function listDatabases() {
  return parseJsonArray(runWrangler(['d1', 'list', '--json'], { capture: true }));
}

function prepareDatabase(config) {
  const databases = listDatabases();

  let target = null;
  if (config.databaseId) {
    target = databases.find(
      (db) => String(db.uuid).toLowerCase() === config.databaseId.toLowerCase()
    );
  }

  if (!target) {
    const matches = databases.filter((db) => db.name === config.databaseName);
    if (matches.length > 1) {
      fail(
        `存在多个同名 D1「${config.databaseName}」，请先在 Cloudflare 控制台清理后重试`
      );
    }
    target = matches[0] || null;
  }

  if (target) {
    console.log(`复用已有 D1：${target.name} (${target.uuid})`);
    updateConfigDatabaseId(target.uuid);
    return target;
  }

  console.log(`未找到 D1「${config.databaseName}」，正在创建...`);
  copyFileSync(configPath, configPath + '.bak');
  runWrangler([
    'd1',
    'create',
    config.databaseName,
    '--binding',
    config.binding,
    '--update-config'
  ]);

  const created = listDatabases().find((db) => db.name === config.databaseName);
  if (created) {
    updateConfigDatabaseId(created.uuid);
    return created;
  }

  const latest = readConfig();
  if (latest.databaseId) {
    return {
      name: config.databaseName,
      uuid: latest.databaseId
    };
  }

  fail('D1 创建后未在账号中找到，请检查 Cloudflare 控制台');
}

function printHelp() {
  console.log(
    [
      'cloudnote 一键部署',
      '',
      '用法：',
      '  npm run deploy:auto              实际部署',
      '  npm run deploy:auto -- --dry-run 只检查配置，不访问 Cloudflare',
      '',
      '说明：',
      '  - 首次运行会启动 wrangler login',
      '  - 会自动复用或创建 wrangler.jsonc 中配置的 D1',
      '  - 会执行 init_cloudnote_db.sql（幂等，不会清空数据）',
      '  - 修改数据库配置时会在 wrangler.jsonc.bak 留一份备份'
    ].join('\n')
  );
}

async function main() {
  if (showHelp) {
    printHelp();
    return;
  }

  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) {
    fail(`需要 Node.js >= 22.12，当前为 ${process.versions.node}`);
  }

  const config = readConfig();
  if (!config.name) fail('wrangler.jsonc 缺少 name');
  if (!config.binding) fail('wrangler.jsonc 缺少 d1_databases.binding');
  if (!config.databaseName) fail('wrangler.jsonc 缺少 d1_databases.database_name');
  if (!existsSync(initPath)) fail('缺少 init_cloudnote_db.sql');

  console.log(`Worker：${config.name}`);
  console.log(`D1：${config.databaseName}（binding: ${config.binding}）`);

  if (dryRun) {
    console.log(`database_id：${config.databaseId || '未配置'}`);
    console.log('\n[dry-run] 配置检查通过；未登录、未创建资源、未执行 SQL、未部署。');
    return;
  }

  ensureDependencies();

  step(1, 5, '检查 Cloudflare 登录');
  ensureAuth();

  step(2, 5, '准备 D1 数据库');
  const database = prepareDatabase(config);
  console.log(`使用 D1：${database.name} (${database.uuid})`);

  step(3, 5, '初始化数据库');
  runWrangler([
    'd1',
    'execute',
    config.binding,
    '--remote',
    '--yes',
    '--file=init_cloudnote_db.sql'
  ]);

  step(4, 5, '部署 Worker');
  const deployOutput = runWrangler(['deploy'], { capture: true });
  console.log(deployOutput.trim());

  const urls = [...deployOutput.matchAll(/https:\/\/[^\s]+/g)]
    .map((match) => match[0].replace(/[.,)]$/, ''));
  const url =
    urls.find((item) => item.includes('workers.dev')) ||
    urls.find(
      (item) =>
        !item.includes('dash.cloudflare.com') &&
        !item.includes('developers.cloudflare.com')
    );

  if (!url) {
    console.log('\n部署完成；请在 Wrangler 输出中查看访问地址。');
    return;
  }

  step(5, 5, '检查访问');
  try {
    const response = await fetch(url);
    console.log(`访问 ${url} -> HTTP ${response.status}`);
    if (!response.ok) {
      console.warn('首页状态不是 200，请检查部署和域名配置。');
    }
  } catch (error) {
    console.warn(`访问检查失败（不影响部署）：${error.message}`);
  }

  console.log(`\n部署完成：${url}`);
}

main().catch((error) => {
  console.error('\n部署失败：' + error.message);
  process.exit(1);
});
