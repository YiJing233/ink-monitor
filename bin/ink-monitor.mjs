#!/usr/bin/env node
/**
 * ink-monitor CLI
 *
 *   npx ink-monitor login               open browser to OAuth
 *   npx ink-monitor provider add <type> [name]   prompts for key
 *   npx ink-monitor stock add <sym> <mkt>
 *   npx ink-monitor demo                load sample data
 *   npx ink-monitor deploy [--target=vercel|gh-pages|local]
 *   npx ink-monitor open                print /display URL
 *
 * Auth model: paste a `INK_MONITOR_TOKEN` env var (an API token) OR run
 * `ink-monitor login` which opens a browser to OAuth and stores the token
 * in ~/.ink-monitor/config.json.
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const API = process.env.INK_MONITOR_API || 'https://ink-monitor.example.com';
const CFG_DIR = join(homedir(), '.ink-monitor');
const CFG_FILE = join(CFG_DIR, 'config.json');

function loadCfg() {
  if (!existsSync(CFG_FILE)) return {};
  try { return JSON.parse(readFileSync(CFG_FILE, 'utf8')); } catch { return {}; }
}
function saveCfg(cfg) {
  if (!existsSync(CFG_DIR)) mkdirSync(CFG_DIR, { recursive: true });
  writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2));
  process.chmod(CFG_FILE, 0o600);
}
function getToken() {
  const envTok = process.env.INK_MONITOR_TOKEN;
  if (envTok) return envTok;
  const cfg = loadCfg();
  return cfg.token;
}
async function api(path, opts = {}) {
  const token = getToken();
  if (!token && !path.startsWith('/auth/')) {
    throw new Error('Not logged in. Run `npx ink-monitor login` or set INK_MONITOR_TOKEN.');
  }
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`HTTP ${res.status}: ${t}`);
  }
  return res.status === 204 ? null : res.json();
}

const [, , cmd, ...rest] = process.argv;

function help() {
  console.log(`ink-monitor — CLI for the e-ink monitor

Commands:
  login                              OAuth login (opens browser)
  provider add <type> [name]         add a provider (openai|anthropic|custom|demo)
  stock add <symbol> <market>        add a stock (us|cn|hk)
  demo                               load sample data
  list                               show current config
  open                               print the /display URL
  deploy [--target=vercel|local]     one-click deploy
  help                               this message

Environment:
  INK_MONITOR_API     base URL (default: ${API})
  INK_MONITOR_TOKEN   API token (overrides config file)
`);
}

async function login() {
  // Open a localhost listener for the OAuth callback
  const server = createServer(async (req, res) => {
    if (req.url?.startsWith('/callback')) {
      const url = new URL(req.url, 'http://localhost');
      const token = url.searchParams.get('token');
      if (token) {
        saveCfg({ ...loadCfg(), token });
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Logged in</h1><p>You can close this tab.</p>');
        console.log('✓ Saved token to', CFG_FILE);
      } else {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>Missing token</h1>');
      }
      server.close();
      process.exit(0);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  server.listen(0, () => {
    const { port } = server.address();
    const redirect = `http://localhost:${port}/callback`;
    const authUrl = `${API}/auth/cli?redirect=${encodeURIComponent(redirect)}`;
    console.log('Opening browser to', authUrl);
    const opener = process.platform === 'darwin' ? 'open'
      : process.platform === 'win32' ? 'start'
      : 'xdg-open';
    try {
      require('node:child_process').execSync(`${opener} "${authUrl}"`, { stdio: 'ignore' });
    } catch {
      console.log('Could not open browser. Open this URL manually:');
      console.log('  ' + authUrl);
    }
  });
}

async function providerAdd(type, name) {
  if (!['openai', 'anthropic', 'custom', 'demo'].includes(type)) {
    throw new Error('type must be openai|anthropic|custom|demo');
  }
  let apiKey = '';
  let baseUrl, endpoint, jsonPath, refreshSeconds;
  if (type === 'demo') {
    name = name || 'Demo plan';
  } else {
    apiKey = await prompt('API key: ', { secret: true });
    if (!apiKey) throw new Error('API key is required');
  }
  if (type === 'openai' || type === 'anthropic') {
    const def = type === 'openai' ? 'https://api.openai.com' : 'https://api.anthropic.com';
    const defEp = type === 'openai' ? '/v1/usage' : '/v1/messages';
    baseUrl = (await prompt(`Base URL [${def}]: `)) || def;
    endpoint = (await prompt(`Endpoint [${defEp}]: `)) || defEp;
  }
  if (type === 'custom') {
    baseUrl = await prompt('Base URL: ');
    endpoint = await prompt('Endpoint path: ');
    jsonPath = await prompt('JSON paths (used|limit|reset): ');
  }
  const r = await prompt('Refresh seconds (15–86400) [60]: ');
  refreshSeconds = r ? Number(r) : 60;
  const body = { name: name || `${type} provider`, type, refresh_seconds: refreshSeconds };
  if (apiKey) body.api_key = apiKey;
  if (baseUrl) body.base_url = baseUrl;
  if (endpoint) body.endpoint = endpoint;
  if (jsonPath) body.json_path = jsonPath;
  const res = await api('/api/providers', { method: 'POST', body: JSON.stringify(body) });
  console.log('✓ Added provider', res.id);
}

async function stockAdd(symbol, market) {
  if (!['us', 'cn', 'hk'].includes(market)) {
    throw new Error('market must be us|cn|hk');
  }
  const name = await prompt('Display name (optional): ');
  const refresh = await prompt('Refresh seconds (15–86400) [60]: ');
  const body = { symbol, market, refresh_seconds: refresh ? Number(refresh) : 60 };
  if (name) body.display_name = name;
  const res = await api('/api/stocks', { method: 'POST', body: JSON.stringify(body) });
  console.log('✓ Added stock', symbol, '(', res.id, ')');
}

async function demo() {
  const res = await api('/api/demo', { method: 'POST' });
  console.log(`✓ Added ${res.addedProvider} demo provider and ${res.addedStocks} sample stock(s)`);
}

async function listAll() {
  const [prov, stocks, settings] = await Promise.all([
    api('/api/providers'),
    api('/api/stocks'),
    api('/api/settings'),
  ]);
  console.log('Providers:');
  for (const p of prov.providers) {
    console.log(`  - ${p.name} (${p.type}) refresh=${p.refresh_seconds || 'default'}s`);
  }
  console.log('Stocks:');
  for (const s of stocks.stocks) {
    console.log(`  - ${s.symbol} (${s.market})${s.display_name ? ' ' + s.display_name : ''}`);
  }
  console.log('Settings:', settings.settings);
}

async function openDisplay() {
  const userId = (loadCfg().userId) || (await api('/api/me')).id;
  const url = `${API}/display?u=${userId}`;
  console.log(url);
  const opener = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
    : 'xdg-open';
  try {
    require('node:child_process').execSync(`${opener} "${url}"`, { stdio: 'ignore' });
  } catch {
    /* no-op */
  }
}

async function deploy(target) {
  target = target || 'vercel';
  console.log(`Deploy target: ${target}`);
  if (target === 'vercel') {
    console.log('→ Vercel:');
    console.log('   1. Push this repo to GitHub');
    console.log('   2. Visit https://vercel.com/new and import the repo');
    console.log('   3. Set ENCRYPTION_KEY, GITHUB_ID, GITHUB_SECRET in env');
    console.log('   4. Deploy. Then visit /signin on the production URL.');
  } else if (target === 'local') {
    console.log('→ Local self-host:');
    console.log('   git clone <this-repo> && cd ink-monitor');
    console.log('   pnpm install && pnpm rebuild better-sqlite3');
    console.log('   ENCRYPTION_KEY=$(openssl rand -hex 32) pnpm start');
    console.log('   Open http://localhost:3000');
  } else {
    console.log('Unknown target. Use --target=vercel or --target=local');
  }
}

function prompt(q, { secret = false } = {}) {
  return new Promise((resolve) => {
    process.stdout.write(q);
    let buf = '';
    const onData = (ch) => {
      const s = ch.toString('utf8');
      if (s === '\n' || s === '\r' || s === '') {
        process.stdin.removeListener('data', onData);
        process.stdin.pause();
        if (!secret) process.stdout.write('\n');
        resolve(buf.trim());
      } else if (s === '') {
        process.exit(1);
      } else if (s === '' || s === '\b') {
        buf = buf.slice(0, -1);
        if (!secret) process.stdout.write('\b \b');
      } else {
        buf += s;
        if (!secret) process.stdout.write(s);
      }
    };
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

(async () => {
  try {
    switch (cmd) {
      case 'login': await login(); break;
      case 'provider': {
        const [sub, type, name] = rest;
        if (sub !== 'add' || !type) throw new Error('usage: provider add <type> [name]');
        await providerAdd(type, name);
        break;
      }
      case 'stock': {
        const [sub, sym, mkt] = rest;
        if (sub !== 'add' || !sym || !mkt) throw new Error('usage: stock add <symbol> <us|cn|hk>');
        await stockAdd(sym, mkt);
        break;
      }
      case 'demo': await demo(); break;
      case 'list': await listAll(); break;
      case 'open': await openDisplay(); break;
      case 'deploy': {
        const flag = rest.find((r) => r.startsWith('--target='));
        const t = flag ? flag.split('=')[1] : 'vercel';
        await deploy(t);
        break;
      }
      case 'help':
      case '--help':
      case '-h':
      case undefined:
        help();
        break;
      default:
        help();
        throw new Error(`Unknown command: ${cmd}`);
    }
  } catch (e) {
    console.error('✗', (e && e.message) || String(e));
    process.exit(1);
  }
})();
