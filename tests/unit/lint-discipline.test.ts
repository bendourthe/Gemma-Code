import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('eslint.config.mjs ban-ts-comment configuration', () => {
  const config = readFileSync(join(process.cwd(), 'eslint.config.mjs'), 'utf8');

  it('configures @typescript-eslint/ban-ts-comment as an error', () => {
    expect(config).toMatch(/"@typescript-eslint\/ban-ts-comment"/);
    const block = config.match(/"@typescript-eslint\/ban-ts-comment"\s*:\s*\[\s*"error"/);
    expect(block, 'ban-ts-comment must be configured at "error" severity').not.toBeNull();
  });

  it('uses allow-with-description for ts-expect-error, ts-ignore, ts-nocheck', () => {
    expect(config).toMatch(/"ts-expect-error":\s*"allow-with-description"/);
    expect(config).toMatch(/"ts-ignore":\s*"allow-with-description"/);
    expect(config).toMatch(/"ts-nocheck":\s*"allow-with-description"/);
  });

  it('enforces minimumDescriptionLength of at least 20 characters', () => {
    const m = config.match(/"minimumDescriptionLength":\s*(\d+)/);
    expect(m, 'minimumDescriptionLength must be set').not.toBeNull();
    const n = Number.parseInt(m![1], 10);
    expect(n).toBeGreaterThanOrEqual(20);
  });
});

describe('src/ has no un-justified TS suppression comments', () => {
  it('contains no @ts-ignore / @ts-expect-error / @ts-nocheck without a description', async () => {
    const { globby } = await import('globby').catch(() => ({ globby: null as unknown as Function }));
    const files = await collectTsFiles();
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const m = line.match(/@ts-(ignore|expect-error|nocheck)\b(.*)$/);
        if (!m) continue;
        const description = m[2].trim().replace(/^[:\-\s]+/, '');
        if (description.length < 20) {
          offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
    void globby;
  });
});

async function collectTsFiles(): Promise<string[]> {
  const { readdirSync, statSync } = await import('node:fs');
  const out: string[] = [];
  const stack: string[] = ['src'];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else if (st.isFile() && full.endsWith('.ts')) {
        out.push(full);
      }
    }
  }
  return out;
}
