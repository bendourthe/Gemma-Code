import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const WORKFLOWS_DIR = join(process.cwd(), '.github', 'workflows');

function listWorkflows(): string[] {
  return readdirSync(WORKFLOWS_DIR)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => join(WORKFLOWS_DIR, name))
    .filter((path) => statSync(path).isFile());
}

const SHA_RE = /^[0-9a-f]{40}$/;
const USES_LINE_RE = /^\s*[-]?\s*uses:\s*([^\s#]+)/;

describe('GitHub Actions are SHA-pinned', () => {
  const workflows = listWorkflows();

  it('finds at least the 5 expected workflow files', () => {
    const names = workflows.map((p) => p.split(/[\\/]/).pop());
    expect(names).toEqual(
      expect.arrayContaining([
        'ci.yml',
        'nightly.yml',
        'golden-tasks.yml',
        'release.yml',
        'installer-smoke.yml',
      ]),
    );
  });

  it('every uses: reference pins to a 40-character commit SHA', () => {
    const offenders: string[] = [];
    for (const workflow of workflows) {
      const lines = readFileSync(workflow, 'utf8').split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const m = lines[i].match(USES_LINE_RE);
        if (!m) continue;
        const ref = m[1];
        const at = ref.lastIndexOf('@');
        if (at < 0) {
          offenders.push(`${workflow}:${i + 1}: missing @ref in ${ref}`);
          continue;
        }
        const version = ref.slice(at + 1);
        if (!SHA_RE.test(version)) {
          offenders.push(`${workflow}:${i + 1}: ${ref} is not SHA-pinned`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});

describe('Long-running workflows cancel superseded runs', () => {
  const expectedConcurrent = ['ci.yml', 'nightly.yml', 'golden-tasks.yml', 'shell-build.yml'];

  for (const name of expectedConcurrent) {
    it(`${name} declares concurrency: cancel-in-progress: true`, () => {
      const text = readFileSync(join(WORKFLOWS_DIR, name), 'utf8');
      expect(text).toMatch(/^concurrency:/m);
      expect(text).toMatch(/cancel-in-progress:\s*true/);
    });
  }
});

describe('Shell build protects the integration branch without multiplying runner cost', () => {
  const text = readFileSync(join(WORKFLOWS_DIR, 'shell-build.yml'), 'utf8');

  it('runs for main and develop pushes plus pull requests to either', () => {
    expect(text).toMatch(/push:\s*\n\s+branches:\s*\[main, develop\]/);
    // v2.4.4 Phase 7 (QG-5): `develop` joined the pull_request filter because
    // the integration pull request targets it. While this was main-only, a
    // develop-targeted PR ran only commitlint, so the push trigger tested the
    // branch head but the MERGE RESULT -- what actually ships -- never was.
    expect(text).toMatch(/pull_request:\s*\n(?:\s*#.*\n)*\s+branches:\s*\[main, develop\]/);
  });

  it('reserves the full OS matrix for main pushes and manual dispatch', () => {
    expect(text).toContain("github.event_name == 'workflow_dispatch'");
    expect(text).toContain("github.ref == 'refs/heads/main'");
    expect(text).toContain("fromJSON('[\"ubuntu-latest\"]')");
  });
});
