import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const HOOK = join(process.cwd(), 'scripts', 'hooks', 'check-commit-msg.mjs');

let workdir: string;

beforeAll(() => {
  workdir = mkdtempSync(join(tmpdir(), 'commit-msg-test-'));
});

afterAll(() => {
  rmSync(workdir, { recursive: true, force: true });
});

function runHookOnMessage(message: string): { code: number | null; stderr: string } {
  const file = join(workdir, `msg-${Math.random().toString(36).slice(2)}.txt`);
  writeFileSync(file, message, 'utf8');
  const result = spawnSync('node', [HOOK, file], { encoding: 'utf8' });
  return { code: result.status, stderr: result.stderr ?? '' };
}

describe('check-commit-msg ASCII-only enforcement', () => {
  it('allows a plain ASCII commit message', () => {
    const { code, stderr } = runHookOnMessage('feat: add ASCII-only commit hook\n');
    expect(code).toBe(0);
    expect(stderr).toBe('');
  });

  it('allows multi-line ASCII commit messages with comments', () => {
    const msg = [
      'feat(v0.5.0): phase 10 hygiene',
      '',
      'Adds husky and dependency-cruiser.',
      '',
      '# This is a git template comment with em-dash --- ignored',
      '',
    ].join('\n');
    const { code } = runHookOnMessage(msg);
    expect(code).toBe(0);
  });

  it('rejects an em-dash (U+2014)', () => {
    const { code, stderr } = runHookOnMessage('feat: test em — dash\n');
    expect(code).toBe(1);
    expect(stderr).toMatch(/BLOCKED/);
    expect(stderr).toMatch(/U\+2014/);
  });

  it('rejects an en-dash (U+2013)', () => {
    const { code, stderr } = runHookOnMessage('feat: test en – dash\n');
    expect(code).toBe(1);
    expect(stderr).toMatch(/U\+2013/);
  });

  it('rejects curly quotes', () => {
    const { code, stderr } = runHookOnMessage('feat: “test” quoted\n');
    expect(code).toBe(1);
    expect(stderr).toMatch(/BLOCKED/);
  });

  it('rejects ellipsis (U+2026)', () => {
    const { code, stderr } = runHookOnMessage('feat: trailing…\n');
    expect(code).toBe(1);
    expect(stderr).toMatch(/U\+2026/);
  });

  it('rejects CJK characters', () => {
    const { code, stderr } = runHookOnMessage('feat: 中文 commit\n');
    expect(code).toBe(1);
    expect(stderr).toMatch(/BLOCKED/);
  });

  it('allows an empty commit message', () => {
    const { code } = runHookOnMessage('');
    expect(code).toBe(0);
  });

  it('does not flag em-dash in a comment-only line', () => {
    const { code } = runHookOnMessage('# template note: — em-dash\nfeat: ascii subject\n');
    expect(code).toBe(0);
  });
});
