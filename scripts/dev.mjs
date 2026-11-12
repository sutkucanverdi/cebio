#!/usr/bin/env node
/**
 * Cebio'yu tek komutla çalıştırır: backend (FastAPI) + frontend (Vite).
 *
 *   npm run dev      veya     dev.bat dosyasına çift tıkla
 *
 * - Portların boş olduğunu kontrol eder, doluysa hangi portun dolu olduğunu söyler
 * - İki sunucuyu tek pencerede, renkli [api] / [web] etiketleriyle başlatır
 * - Frontend hazır olunca tarayıcıyı açar
 * - Ctrl+C ile ikisini birlikte kapatır; biri çökerse diğerini de kapatır
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Port 8000/8001 başka projelerle (ChainPulse) çakıştığı için Cebio API 8010'da çalışır
const API_PORT = Number(process.env.CEBIO_API_PORT || 8010);
const WEB_PORT = Number(process.env.CEBIO_WEB_PORT || 3000);
const OPEN_BROWSER = process.env.CEBIO_NO_BROWSER !== '1';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const python = path.join(root, 'venv', isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python');

const color = (code, text) => `\x1b[${code}m${text}\x1b[0m`;
const tag = { api: color('36', '[api]'), web: color('35', '[web]'), dev: color('32', '[dev]') };
const log = (msg) => console.log(`${tag.dev} ${msg}`);
const fail = (msg) => {
  console.error(`${color('31', '[hata]')} ${msg}`);
  process.exit(1);
};

/** Port gerçekten boş mu? IPv4 ve IPv6'yı ayrı ayrı dener (Vite 'localhost'u ::1'e bağlayabiliyor). */
function canBind(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => resolve(!['EADDRINUSE', 'EACCES'].includes(err.code)));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

async function portFree(port) {
  return (await canBind(port, '127.0.0.1')) && (await canBind(port, '::1'));
}

function waitForHttp(url, timeoutMs = 60_000) {
  const started = Date.now();
  return new Promise((resolve) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) resolve(false);
        else setTimeout(attempt, 500);
      });
      req.setTimeout(2000, () => req.destroy());
    };
    attempt();
  });
}

function openBrowser(url) {
  const cmd = isWin ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref();
}

/** Alt sürecin çıktısını satır satır, etiketli olarak yazar. */
function pipe(stream, prefix) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      // Windows'ta Ctrl+C sonrası npm.cmd'nin sorduğu anlamsız soruyu gösterme
      if (!line.trim() || /Terminate batch job/i.test(line)) continue;
      console.log(`${prefix} ${line}`);
    }
  });
}

const children = [];
let shuttingDown = false;

function stopAll(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('Kapatılıyor...');
  for (const child of children) {
    if (child.exitCode !== null) continue;
    if (isWin) {
      // Windows'ta npm/vite bir cmd kabuğunun altında çalışır; tüm süreç ağacını kapat
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  }
  // Alt süreçlerin kapanış loglarını bekle (en fazla 5 sn), sonra çık
  const alive = children.filter((c) => c.exitCode === null);
  if (alive.length === 0) process.exit(code);
  let remaining = alive.length;
  for (const child of alive) {
    child.once('exit', () => {
      remaining -= 1;
      if (remaining === 0) {
        log('Kapandı.');
        process.exit(code);
      }
    });
  }
  setTimeout(() => process.exit(code), 5000).unref();
}

function start(name, command, args, options) {
  const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  pipe(child.stdout, tag[name]);
  pipe(child.stderr, tag[name]);
  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`${color('31', '[hata]')} ${name} beklenmedik şekilde kapandı (kod ${code}). Diğeri de kapatılıyor.`);
      stopAll(code || 1);
    }
  });
  children.push(child);
  return child;
}

// --- Ön kontroller ---
if (!existsSync(python)) fail('Python ortamı (venv) bulunamadı. Önce kurulum yapın:  npm run setup');
if (!existsSync(path.join(root, 'frontend', 'node_modules'))) fail('Frontend paketleri kurulu değil. Önce:  npm run setup');
if (!existsSync(path.join(root, 'backend', '.env'))) {
  log(color('33', "backend/.env yok; backend/.env.example'dan kopyalayıp GEMINI_API_KEY ekleyin (yapay zeka özellikleri için)."));
}

for (const [name, port] of [['API', API_PORT], ['Frontend', WEB_PORT]]) {
  if (!(await portFree(port))) {
    fail(
      `${name} için port ${port} dolu. Cebio zaten açık olabilir (http://localhost:${WEB_PORT}) ` +
        `ya da başka bir proje bu portu kullanıyor. Diğer portu denemek için:  ` +
        `${isWin ? `set CEBIO_${name === 'API' ? 'API' : 'WEB'}_PORT=...` : `CEBIO_${name === 'API' ? 'API' : 'WEB'}_PORT=...`}`
    );
  }
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

// --- Başlat ---
log(`Backend  → http://localhost:${API_PORT}  (API dokümanı: /docs)`);
start('api', python, ['-m', 'uvicorn', 'app.main:app', '--reload', '--port', String(API_PORT)], {
  cwd: path.join(root, 'backend'),
  env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
});

log(`Frontend → http://localhost:${WEB_PORT}`);
start('web', `npm run dev -- --port ${WEB_PORT} --strictPort`, [], {
  cwd: path.join(root, 'frontend'),
  shell: true,
  // Frontend hangi API'ye bağlanacağını buradan alır (.env dosyalarından önceliklidir)
  env: { ...process.env, VITE_API_BASE_URL: `http://localhost:${API_PORT}`, FORCE_COLOR: '1' },
});

const [apiUp, webUp] = await Promise.all([
  waitForHttp(`http://127.0.0.1:${API_PORT}/health`),
  waitForHttp(`http://localhost:${WEB_PORT}`),
]);
if (!shuttingDown) {
  if (apiUp && webUp) {
    log(color('32', `Hazır! Uygulama: http://localhost:${WEB_PORT}   (kapatmak için Ctrl+C)`));
    if (OPEN_BROWSER) openBrowser(`http://localhost:${WEB_PORT}`);
  } else {
    log(color('33', `Sunuculardan biri 60 saniyede açılmadı (api: ${apiUp ? 'açık' : 'kapalı'}, web: ${webUp ? 'açık' : 'kapalı'}). Yukarıdaki çıktıya bakın.`));
  }
}
