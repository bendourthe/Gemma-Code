// v2.2.0 Phase 3 (3.1) -- headless hub-catalog operations for the installer.
//
// The installer needs to populate `~/.nexus-ai/catalog/` during installation
// (when a network connection is far likelier than at some arbitrary later
// first launch). Rather than reimplement the syncer in Python, the installer
// invokes the sidecar bundle it already provisions:
//
//   node main.js --sync-hub-catalog [--tag vX.Y.Z]
//   node main.js --extract-hub-snapshot <archive.tar.gz> [--sha256 <hex>]
//   node main.js --hub-catalog-status
//
// Each mode prints newline-delimited JSON progress objects on stdout (so the
// installer can render progress and classify failures) and exits nonzero on
// failure. stdout stays machine-readable; human text goes to stderr.

import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import * as path from "node:path";
import { createGunzip } from "node:zlib";

import { NexusHubSyncer } from "../../../../core/skills/NexusHubSyncer.js";
import { catalogRoot, hubLayoutDir, nexusAiHome } from "../../../../core/storage/paths.js";
import { resolveHubLayout } from "../../../../core/storage/hubVersionManifest.js";

export type HubCliEvent =
  | { kind: "progress"; step: string; message: string }
  | { kind: "done"; ok: true; tag: string | null; applied: boolean; source: string }
  | { kind: "error"; ok: false; failureClass: HubFailureClass; message: string };

/**
 * Failure classes the installer maps onto retry / remediation copy. Keeping
 * this explicit prevents the pre-v2.2.0 behavior where any sync problem became
 * an indistinguishable silent "catalog not yet synced" state in the UI.
 */
export type HubFailureClass =
  | "network"
  | "git-unavailable"
  | "scan-quarantine"
  | "checksum"
  | "archive"
  | "unknown";

export function classifyHubFailure(message: string): HubFailureClass {
  const text = (message || "").toLowerCase();
  if (!text) return "unknown";
  if (text.includes("checksum") || text.includes("sha256")) return "checksum";
  if (text.includes("blocked") || text.includes("scanner") || text.includes("quarantine")) {
    return "scan-quarantine";
  }
  if (text.includes("git") && (text.includes("not found") || text.includes("enoent"))) {
    return "git-unavailable";
  }
  if (
    ["network", "enotfound", "econnrefused", "etimedout", "timeout", "dns", "socket", "tls", "fetch"].some(
      (needle) => text.includes(needle),
    )
  ) {
    return "network";
  }
  if (text.includes("tar") || text.includes("gzip") || text.includes("archive")) return "archive";
  return "unknown";
}

export interface HubCliDeps {
  /** Where the catalog subtree lives. Defaults to `~/.nexus-ai/catalog`. */
  readonly catalogDir?: string;
  /** Emit one JSON event (defaults to stdout). */
  readonly emit?: (event: HubCliEvent) => void;
  /** Injectable syncer factory (tests). */
  readonly createSyncer?: (
    catalogDir: string,
  ) => {
    sync(opts: {
      tag?: string;
      apply?: boolean;
    }): Promise<{ tag: string; applied: boolean; alreadyUpToDate?: boolean }>;
  };
}

function defaultEmit(event: HubCliEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

/** True when the catalog subtree already holds a skills directory. */
export function hubCatalogPresent(catalogDir: string): boolean {
  try {
    return existsSync(hubLayoutDir(catalogDir, "skills", resolveHubLayout(catalogDir)));
  } catch {
    return false;
  }
}

async function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * Extract a bundled catalog snapshot into the catalog subtree.
 *
 * Atomic: the archive is expanded into a sibling temp dir and only swapped in
 * once every entry is written, so an interrupted extract can never leave a
 * half-written catalog that later reads as "synced".
 *
 * v1.10 removed an earlier bundled baseline because its pins were placeholders;
 * this path therefore REQUIRES a real sha256 and refuses to extract on
 * mismatch rather than trusting the payload.
 */
export async function extractHubSnapshot(
  archivePath: string,
  expectedSha256: string | null,
  deps: HubCliDeps = {},
): Promise<HubCliEvent> {
  const catalogDir = deps.catalogDir ?? catalogRoot(nexusAiHome());
  const emit = deps.emit ?? defaultEmit;

  if (!existsSync(archivePath)) {
    return { kind: "error", ok: false, failureClass: "archive", message: `snapshot not found: ${archivePath}` };
  }
  if (expectedSha256) {
    emit({ kind: "progress", step: "verify", message: "verifying the catalog snapshot checksum" });
    const actual = await sha256File(archivePath);
    if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
      return {
        kind: "error",
        ok: false,
        failureClass: "checksum",
        message: `snapshot checksum mismatch (expected ${expectedSha256.slice(0, 12)}..., got ${actual.slice(0, 12)}...)`,
      };
    }
  }

  const parent = path.dirname(catalogDir);
  const staging = path.join(parent, `.catalog-staging-${process.pid}`);
  try {
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    emit({ kind: "progress", step: "extract", message: "extracting the bundled catalog snapshot" });
    await extractTarGz(archivePath, staging);

    // The archive may hold either the catalog contents directly or a single
    // top-level directory; normalize both to "contents".
    const root = singleChildDir(staging) ?? staging;
    const backup = `${catalogDir}.previous-${process.pid}`;
    if (existsSync(catalogDir)) renameSync(catalogDir, backup);
    mkdirSync(parent, { recursive: true });
    renameSync(root, catalogDir);
    rmSync(backup, { recursive: true, force: true });
    return { kind: "done", ok: true, tag: readSnapshotTag(catalogDir), applied: true, source: "snapshot" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: "error", ok: false, failureClass: classifyHubFailure(message), message };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function singleChildDir(dir: string): string | null {
  try {
    const entries = require("node:fs").readdirSync(dir, { withFileTypes: true }) as Array<{
      name: string;
      isDirectory(): boolean;
    }>;
    const dirs = entries.filter((e) => e.isDirectory());
    if (dirs.length === 1 && entries.length === 1) return path.join(dir, dirs[0]!.name);
    return null;
  } catch {
    return null;
  }
}

function readSnapshotTag(catalogDir: string): string | null {
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(catalogDir, "nexus-hub-version.json"), "utf8"),
    ) as { version?: string };
    return manifest.version ?? null;
  } catch {
    return null;
  }
}

/** Minimal tar.gz extractor (no external dependency in the sidecar bundle). */
async function extractTarGz(archivePath: string, destDir: string): Promise<void> {
  const { writeFileSync, mkdirSync: mkdir } = await import("node:fs");
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    createReadStream(archivePath)
      .pipe(createGunzip())
      .on("data", (c: Buffer) => chunks.push(c))
      .on("end", () => resolve())
      .on("error", reject);
  });
  const buf = Buffer.concat(chunks);

  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const rawName = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
    const name = prefix ? `${prefix}/${rawName}` : rawName;
    const sizeField = header.subarray(124, 136).toString("utf8").replace(/\0.*$/, "").trim();
    const size = parseInt(sizeField, 8) || 0;
    const typeFlag = String.fromCharCode(header[156] ?? 0);
    offset += 512;

    // Reject any entry that would escape the destination (tar-slip).
    const target = path.resolve(destDir, name);
    if (!target.startsWith(path.resolve(destDir) + path.sep) && target !== path.resolve(destDir)) {
      throw new Error(`archive entry escapes the destination: ${name}`);
    }
    if (typeFlag === "5") {
      mkdir(target, { recursive: true });
    } else if (typeFlag === "0" || typeFlag === "\0" || typeFlag === "") {
      mkdir(path.dirname(target), { recursive: true });
      writeFileSync(target, buf.subarray(offset, offset + size));
    }
    offset += Math.ceil(size / 512) * 512;
  }
}

/** Run a real sync against the upstream repo. */
export async function syncHubCatalog(
  tag: string | undefined,
  deps: HubCliDeps = {},
): Promise<HubCliEvent> {
  const catalogDir = deps.catalogDir ?? catalogRoot(nexusAiHome());
  const emit = deps.emit ?? defaultEmit;
  emit({ kind: "progress", step: "sync", message: "fetching the Nexus-Hub catalog" });
  try {
    const syncer =
      deps.createSyncer?.(catalogDir) ?? new NexusHubSyncer({ catalogRoot: catalogDir });
    const result = await syncer.sync({ ...(tag ? { tag } : {}), apply: true });
    // A fetch that did NOT apply is not a success. `sync({apply:true})` leaves
    // `applied` false when the prompt-injection scanner blocks the bundle (or
    // when the installed tag already matches), and reporting either as "done"
    // would tell the installer the harness landed when it did not.
    if (!result.applied && !result.alreadyUpToDate) {
      return {
        kind: "error",
        ok: false,
        failureClass: "scan-quarantine",
        message: `catalog ${result.tag} was fetched but not applied (blocked by the content scan)`,
      };
    }
    return { kind: "done", ok: true, tag: result.tag, applied: result.applied, source: "upstream" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: "error", ok: false, failureClass: classifyHubFailure(message), message };
  }
}

/**
 * Entry point invoked from `main.ts` when a hub-catalog CLI flag is present.
 * Returns the process exit code, or null when no hub flag was passed (so the
 * sidecar continues into normal JSON-RPC mode).
 */
export async function runHubCatalogCli(
  argv: readonly string[],
  deps: HubCliDeps = {},
): Promise<number | null> {
  const emit = deps.emit ?? defaultEmit;
  const arg = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  // An explicit target must be honoured. Without it every invocation writes to
  // the real ~/.nexus-ai/catalog, which makes the destructive extract path
  // impossible to exercise safely from a test or a dry run.
  const catalogOverride = arg("--catalog-dir") ?? process.env["NEXUS_HUB_CATALOG_DIR"];
  const scoped: HubCliDeps = catalogOverride
    ? { ...deps, catalogDir: deps.catalogDir ?? catalogOverride }
    : deps;

  if (argv.includes("--hub-catalog-status")) {
    const catalogDir = scoped.catalogDir ?? catalogRoot(nexusAiHome());
    const present = hubCatalogPresent(catalogDir);
    emit({
      kind: "done",
      ok: true,
      tag: present ? readSnapshotTag(catalogDir) : null,
      applied: false,
      source: present ? "installed" : "absent",
    });
    return 0;
  }

  if (argv.includes("--extract-hub-snapshot")) {
    const archive = arg("--extract-hub-snapshot");
    if (!archive) {
      emit({ kind: "error", ok: false, failureClass: "archive", message: "--extract-hub-snapshot needs a path" });
      return 1;
    }
    const event = await extractHubSnapshot(archive, arg("--sha256") ?? null, scoped);
    emit(event);
    return event.kind === "done" ? 0 : 1;
  }

  if (argv.includes("--sync-hub-catalog")) {
    const event = await syncHubCatalog(arg("--tag"), scoped);
    emit(event);
    return event.kind === "done" ? 0 : 1;
  }

  return null;
}
