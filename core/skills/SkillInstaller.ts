/**
 * v1.1.0 Phase 8.3 -- `nexus skills install/remove` core logic.
 *
 * Heavy lifting that the CLI in `bin/nexus.mjs` wraps:
 *   - `install(spec, opts)` -- validate spec, validate URL against the
 *     allowlist, fetch the SKILL.md body with a 30 s timeout, run it
 *     through `PromptInjectionScanner`, write it to a path-clamped
 *     location under `<skillsRoot>/user/<ns>/<name>/SKILL.md`. Refuses
 *     to overwrite existing files unless `overwrite: true` is set.
 *   - `remove(spec, opts)` -- delete `<skillsRoot>/user/<ns>/<name>/`
 *     if (and only if) the resolved path stays under
 *     `<skillsRoot>/user/`. The DevAI-Hub baseline at
 *     `<skillsRoot>/devai-hub/` is read-only from this CLI.
 *
 * The `Fetcher` injection lets tests use a `file://` URL or a
 * synthetic in-memory blob. The default fetcher is a thin wrapper
 * around `node:fetch` with a 30 s overall timeout and a 10 s connect
 * timeout (the connect timeout is approximated by an AbortController
 * scheduled at 10 s; Node fetch does not currently expose a separate
 * connect-vs-read timeout).
 *
 * Closes v1.0.0 carryforward `10.P2.III`.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

import { PromptInjectionScanner, type ScanResult } from "./PromptInjectionScanner.js";
import { checkInstallUrl, type AllowlistOptions } from "./installAllowlist.js";
import { defaultSkillsRoot } from "./DevAIHubSyncer.js";

export interface SkillSpec {
  /** Namespace (e.g. `user`). The installer rejects non-`user` namespaces. */
  readonly namespace: string;
  /** Slug (e.g. `code-quality`). Validated against `^[a-z0-9][a-z0-9._\-]{0,63}$`. */
  readonly name: string;
}

export interface Fetcher {
  /**
   * Return the SKILL.md content as text. Implementations must respect
   * a 30 s overall timeout. The CLI wraps the response in `try/catch`
   * and reports an error code on failure.
   */
  fetch(url: string): Promise<string>;
}

export interface InstallOptions {
  /** Source URL. Must match the allowlist (`installAllowlist.ts`). */
  url: string;
  /** Override the install root (`~/.nexus/skills/`). */
  skillsRoot?: string;
  /** Allow overwrite of an existing skill at the target path. Defaults to false. */
  overwrite?: boolean;
  /** Inject a fetcher (tests). Defaults to `defaultFetcher()`. */
  fetcher?: Fetcher;
  /** Inject a scanner (tests). Defaults to a fresh `PromptInjectionScanner`. */
  scanner?: PromptInjectionScanner;
  /** Pass-through to `checkInstallUrl`. */
  allowlistOptions?: AllowlistOptions;
}

export interface InstallResult {
  readonly ok: boolean;
  /** Absolute path of the written SKILL.md when `ok === true`. */
  readonly writtenTo?: string;
  /**
   * SHA-256 (hex) over the fetched SKILL.md body -- "hash-on-import", per the
   * Nexus-Hub v3.6.0 `/skills import` hygiene gate. Present whenever the source
   * was fetched (on success and on a scanner block), so the operator can record
   * exactly what content was imported (or rejected). Absent on pre-fetch
   * failures (`wrong-namespace` / `invalid-url` / `path-traversal` / `exists` /
   * `fetch-failed`).
   */
  readonly contentHash?: string;
  /** Scanner verdict (recorded even on success so the CLI can render warnings). */
  readonly scan: ScanResult;
  /** Reason code when `ok === false`. */
  readonly reason?:
    | "invalid-spec"
    | "invalid-url"
    | "fetch-failed"
    | "scanner-blocked"
    | "path-traversal"
    | "exists"
    | "wrong-namespace";
  /** Operator-facing detail. */
  readonly message?: string;
}

export interface RemoveOptions {
  /** Override the install root (`~/.nexus/skills/`). */
  skillsRoot?: string;
}

export interface RemoveResult {
  readonly ok: boolean;
  /** Absolute path of the removed directory when `ok === true`. */
  readonly removed?: string;
  readonly reason?:
    | "invalid-spec"
    | "wrong-namespace"
    | "not-found"
    | "outside-user-root";
  readonly message?: string;
}

const SPEC_NAME = /^[a-z0-9][a-z0-9._\-]{0,63}$/i;

/**
 * Parse `<namespace>/<name>` into a structured spec. Returns `null`
 * when the input is malformed.
 */
export function parseSkillSpec(spec: string): SkillSpec | null {
  if (typeof spec !== "string") return null;
  const trimmed = spec.trim();
  const slash = trimmed.indexOf("/");
  if (slash < 1 || slash === trimmed.length - 1) return null;
  const namespace = trimmed.slice(0, slash);
  const name = trimmed.slice(slash + 1);
  if (!SPEC_NAME.test(namespace)) return null;
  if (!SPEC_NAME.test(name)) return null;
  return { namespace, name };
}

/**
 * Resolve the absolute directory a `user/<name>` skill must live in.
 * The path is clamped so a `name` containing `..` segments cannot
 * escape the user root.
 */
export function userSkillDir(skillsRoot: string, spec: SkillSpec): string {
  const userRoot = path.resolve(skillsRoot, "user");
  const candidate = path.resolve(userRoot, spec.name);
  return candidate;
}

/** Path-clamp check: `candidate` must be a descendant of `root`. */
export function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
}

/**
 * Default fetcher. Uses `globalThis.fetch` (Node 20+ ships it). A 30 s
 * overall timeout aborts the request via `AbortController`. The `file://`
 * scheme is handled separately so the test fixtures can install from
 * disk without spinning up a server.
 */
export function defaultFetcher(): Fetcher {
  return {
    async fetch(url: string): Promise<string> {
      if (url.startsWith("file://")) {
        const parsed = new URL(url);
        return fs.promises.readFile(parsed, "utf-8");
      }
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(), 30_000);
      try {
        const res = await fetch(url, {
          signal: ac.signal,
          headers: { "User-Agent": "nexus-skills-install" },
        });
        if (!res.ok) {
          throw new Error(`fetch returned HTTP ${res.status}`);
        }
        return await res.text();
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

/**
 * Install a single SKILL.md from the supplied URL. Pure async surface:
 * the caller (CLI) renders the result to stdout/stderr.
 */
export async function installSkill(
  spec: SkillSpec,
  opts: InstallOptions,
): Promise<InstallResult> {
  if (spec.namespace !== "user") {
    return {
      ok: false,
      scan: { decision: "pass", findings: [] },
      reason: "wrong-namespace",
      message: `install only writes under 'user/'; got namespace '${spec.namespace}'`,
    };
  }

  const allow = checkInstallUrl(opts.url, opts.allowlistOptions);
  if (!allow.ok) {
    return {
      ok: false,
      scan: { decision: "pass", findings: [] },
      reason: "invalid-url",
      message: allow.reason ?? "URL rejected by allowlist",
    };
  }

  const skillsRoot = opts.skillsRoot ?? defaultSkillsRoot();
  const dir = userSkillDir(skillsRoot, spec);
  const userRoot = path.resolve(skillsRoot, "user");
  if (!isPathInside(dir, userRoot)) {
    return {
      ok: false,
      scan: { decision: "pass", findings: [] },
      reason: "path-traversal",
      message: `target ${dir} escapes ${userRoot}`,
    };
  }

  const targetFile = path.join(dir, "SKILL.md");
  if (!opts.overwrite && fs.existsSync(targetFile)) {
    return {
      ok: false,
      scan: { decision: "pass", findings: [] },
      reason: "exists",
      message: `${targetFile} already exists; pass --overwrite to replace it`,
    };
  }

  const fetcher = opts.fetcher ?? defaultFetcher();
  let content: string;
  try {
    content = await fetcher.fetch(opts.url);
  } catch (err) {
    return {
      ok: false,
      scan: { decision: "pass", findings: [] },
      reason: "fetch-failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  // Hash-on-import: record the SHA-256 of exactly what was fetched, before the
  // scan/write decisions, so the value is available on both the block and the
  // success path.
  const contentHash = createHash("sha256").update(content, "utf-8").digest("hex");

  const scanner = opts.scanner ?? new PromptInjectionScanner();
  const scan = scanner.scanText(content, `${spec.namespace}/${spec.name}/SKILL.md`);
  if (scan.decision === "block") {
    return {
      ok: false,
      contentHash,
      scan,
      reason: "scanner-blocked",
      message: `injection scanner blocked the install (${scan.findings.length} finding(s))`,
    };
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(targetFile, content, { encoding: "utf-8" });

  return {
    ok: true,
    writtenTo: targetFile,
    contentHash,
    scan,
  };
}

/**
 * Remove a previously-installed user skill. Refuses to act on any
 * namespace other than `user/` -- the DevAI-Hub baseline rotates via
 * `nexus skills sync` and is read-only here. Idempotent in the
 * not-found case (`reason: "not-found"`, `ok: false`).
 */
export function removeSkill(
  spec: SkillSpec,
  opts: RemoveOptions = {},
): RemoveResult {
  if (spec.namespace !== "user") {
    return {
      ok: false,
      reason: "wrong-namespace",
      message: `remove only acts on 'user/'; the DevAI-Hub baseline is read-only from this CLI`,
    };
  }
  const skillsRoot = opts.skillsRoot ?? defaultSkillsRoot();
  const userRoot = path.resolve(skillsRoot, "user");
  const dir = userSkillDir(skillsRoot, spec);
  if (!isPathInside(dir, userRoot)) {
    return {
      ok: false,
      reason: "outside-user-root",
      message: `target ${dir} escapes ${userRoot}`,
    };
  }
  if (!fs.existsSync(dir)) {
    return {
      ok: false,
      reason: "not-found",
      message: `${dir} does not exist`,
    };
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return { ok: true, removed: dir };
}
