#!/usr/bin/env node
/**
 * İlk kurulum (yeni bilgisayarda veya paketler değişince):  npm run setup
 * - venv yoksa oluşturur, backend paketlerini kurar
 * - frontend paketlerini kurar
 * - backend/.env yoksa .env.example'dan kopyalar
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const venvPython = path.join(root, 'venv', isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python');

function run(label, command, args, options = {}) {
  console.log(`\x1b[32m[setup]\x1b[0m ${label}`);
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: root, ...options });
  if (result.status !== 0) {
    console.error(`\x1b[31m[hata]\x1b[0m "${label}" başarısız oldu.`);
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(venvPython)) {
  // Windows'ta 'py' başlatıcısı, diğerlerinde python3
  const pythonCmd = isWin ? 'py' : 'python3';
  run('Python ortamı (venv) oluşturuluyor', pythonCmd, ['-m', 'venv', 'venv']);
}
run('Backend paketleri kuruluyor', venvPython, ['-m', 'pip', 'install', '-q', '-r', 'backend/requirements-dev.txt']);
run('Frontend paketleri kuruluyor', 'npm install --prefix frontend --no-fund --no-audit', [], { shell: true });

const envFile = path.join(root, 'backend', '.env');
if (!existsSync(envFile)) {
  copyFileSync(path.join(root, 'backend', '.env.example'), envFile);
  console.log('\x1b[33m[setup]\x1b[0m backend/.env oluşturuldu; içine GEMINI_API_KEY yazmayı unutmayın.');
}

console.log('\x1b[32m[setup]\x1b[0m Kurulum tamam. Başlatmak için:  npm run dev   (veya dev.bat)');
