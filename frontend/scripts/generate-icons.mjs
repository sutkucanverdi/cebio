/**
 * public/icon.svg logosundan mağaza ve PWA için tüm PNG'leri üretir.
 *
 *   node scripts/generate-icons.mjs        -> assets/ ve public/ altındaki PNG'ler
 *   npm run icons:native                    -> Android/iOS ikon ve açılış ekranları (assets/ kullanır)
 *
 * Not: capacitor-assets'i --pwa ile ÇALIŞTIRMAYIN; public/icon.svg'yi siler ve manifest.json'ı bozar.
 *
 * Logo değişirse yalnızca public/icon.svg'yi güncelleyip bu iki komutu tekrar çalıştırın.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'assets');
const pub = join(root, 'public');
mkdirSync(assets, { recursive: true });

const BG = '#0f172a';
const fullIcon = readFileSync(join(pub, 'icon.svg'));

// Cüzdan simgesi (icon.svg ile aynı geometri), şeffaf zemin üzerinde
const glyph = (scale = 1) => `
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <path d="M144 176C144 158.327 158.327 144 176 144H352C369.673 144 384 158.327 384 176V208H176C158.327 208 144 193.673 144 176Z" fill="white" fill-opacity="0.85"/>
    <rect x="128" y="192" width="256" height="176" rx="28" fill="white"/>
    <circle cx="328" cy="280" r="20" fill="#10b981"/>
  </g>`;

const gradient = `
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop stop-color="#10b981"/><stop offset="1" stop-color="#0d9488"/>
    </linearGradient>
  </defs>`;

// Android adaptive icon: ön plan simgesi güvenli alanın (ortadaki %66) içinde kalmalı
const foregroundSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${glyph(1)}</svg>`;
const backgroundSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${gradient}<rect width="512" height="512" fill="url(#g)"/></svg>`;
// Kenarları tam dolu, köşesiz ikon (iOS kendi köşe yuvarlamasını uygular; maskable PWA için de uygun)
const fullBleedSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${gradient}<rect width="512" height="512" fill="url(#g)"/>${glyph(1)}</svg>`;
// Açılış ekranı: koyu zemin, ortada logo
const splashSvg = (bg) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2732 2732"><rect width="2732" height="2732" fill="${bg}"/>
   <g transform="translate(1066 1066) scale(1.171875)">${gradient}<rect x="0" y="0" width="512" height="512" rx="112" fill="url(#g)"/>${glyph(1)}</g></svg>`;

const png = (svg, size, file) =>
  sharp(Buffer.isBuffer(svg) ? svg : Buffer.from(svg), { density: 384 }).resize(size, size).png().toFile(file);

await Promise.all([
  // @capacitor/assets girdileri
  png(fullBleedSvg, 1024, join(assets, 'icon-only.png')),
  png(foregroundSvg, 1024, join(assets, 'icon-foreground.png')),
  png(backgroundSvg, 1024, join(assets, 'icon-background.png')),
  png(splashSvg(BG), 2732, join(assets, 'splash.png')),
  png(splashSvg('#020617'), 2732, join(assets, 'splash-dark.png')),
  // PWA / web
  png(fullIcon, 192, join(pub, 'icon-192.png')),
  png(fullIcon, 512, join(pub, 'icon-512.png')),
  png(fullBleedSvg, 512, join(pub, 'icon-maskable-512.png')),
  png(fullBleedSvg, 180, join(pub, 'apple-touch-icon.png')),
  // Google Play mağaza ikonu (512x512, 32-bit PNG)
  png(fullBleedSvg, 512, join(assets, 'play-store-icon-512.png')),
]);

console.log('İkonlar üretildi: assets/ ve public/');
