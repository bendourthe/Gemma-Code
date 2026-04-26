#!/usr/bin/env node
// commit-msg hook: rejects non-ASCII bytes per AGENTS.md "ASCII-only commit messages".
// Reason: non-ASCII (em-dashes, curly quotes, ellipsis) cause encoding corruption
// on Windows. Use hyphens, straight quotes, and "..." instead.
//
// Usage: node scripts/hooks/check-commit-msg.mjs <path-to-commit-msg-file>
// Exit codes: 0 = allow, 1 = reject (husky surfaces stderr).

import { readFileSync } from 'node:fs';
import { argv, exit, stderr } from 'node:process';

const path = argv[2];
if (!path) {
  stderr.write('check-commit-msg: missing commit-msg file argument\n');
  exit(1);
}

let raw;
try {
  raw = readFileSync(path);
} catch (err) {
  stderr.write(`check-commit-msg: cannot read ${path}: ${err.message}\n`);
  exit(1);
}

// Strip comment lines (git commit templates start them with '#') before scanning.
const text = raw.toString('utf8');
const scannable = text
  .split(/\r?\n/)
  .filter((line) => !line.startsWith('#'))
  .join('\n');

const offenders = [];
for (let i = 0; i < scannable.length; i += 1) {
  const code = scannable.charCodeAt(i);
  if (code > 0x7f) {
    offenders.push({ index: i, code, char: scannable[i] });
    if (offenders.length >= 5) break;
  }
}

if (offenders.length === 0) exit(0);

stderr.write('BLOCKED: commit message contains non-ASCII characters.\n');
stderr.write('AGENTS.md requires ASCII-only commit messages (no em-dashes, en-dashes, curly quotes, ellipsis).\n');
stderr.write('Use hyphens, straight quotes, and "..." instead.\n');
stderr.write('Offenders:\n');
for (const o of offenders) {
  const hex = o.code.toString(16).padStart(4, '0');
  stderr.write(`  index ${o.index}: U+${hex} (${JSON.stringify(o.char)})\n`);
}
exit(1);
