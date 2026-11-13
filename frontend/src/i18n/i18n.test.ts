/** Her Türkçe arayüz metninin İngilizce karşılığı olmalı; eksik çeviri bu testte yakalanır. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EN } from './en';
import { STATIC_KEYS } from './keys';

const SRC = join(__dirname, '..');
const CALL = /\bt\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.|en\.ts$|keys\.ts$/.test(name) ? [path] : [];
  });
}

function usedKeys(): Set<string> {
  const keys = new Set<string>(STATIC_KEYS);
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(CALL)) {
      const literal = match[1];
      const body = literal.slice(1, -1);
      keys.add(literal.startsWith('"') ? JSON.parse(literal) : body.replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
    }
  }
  return keys;
}

describe('i18n', () => {
  it('her metnin İngilizcesi var', () => {
    const missing = [...usedKeys()].filter((k) => !(k in EN) && /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(k));
    expect(missing).toEqual([]);
  });

  it('çevirilerdeki değişkenler aynı', () => {
    for (const [tr, en] of Object.entries(EN)) {
      const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
      expect(vars(en), tr).toBe(vars(tr));
    }
  });
});
