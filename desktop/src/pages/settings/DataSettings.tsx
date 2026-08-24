/**
 * v2.2.0 Phase 7 (7.4) -- Settings > Data.
 *
 * The user asked to be able to move their local data to another machine. This
 * is the surface for that: pick categories, write one archive, and read one
 * back on the other side.
 *
 * Credentials are unchecked by default and carry a visible warning, because
 * an export file gets emailed, synced, and forgotten.
 */

import { useState } from "react";

import { Button, SearchInput, Switch } from "../../components/ui";
import { createDataTransferClient, defaultExportPath } from "./dataTransferClient";

export interface TransferCategoryDto {
  id: string;
  label: string;
  description: string;
  sensitive?: boolean;
}

export interface DataSettingsClient {
  categories(): Promise<readonly TransferCategoryDto[]>;
  export(input: {
    categories: readonly string[];
    includeCredentials: boolean;
    outPath?: string;
  }): Promise<{ path: string; bytes: number; empty: readonly string[] }>;
  importDryRun(path: string): Promise<{ applied: readonly string[]; skipped: readonly string[] }>;
  importApply(path: string): Promise<{ applied: readonly string[]; backupPath: string | null }>;
}

export interface DataSettingsProps {
  client?: DataSettingsClient;
  /** Test seam / fallback list when the sidecar cannot be reached. */
  categories?: readonly TransferCategoryDto[];
}

const DEFAULT_CATEGORIES: readonly TransferCategoryDto[] = [
  { id: "preferences", label: "Preferences", description: "Settings and profile." },
  { id: "chats", label: "Chats and projects", description: "Conversations and folders." },
  { id: "harness", label: "Skills and commands", description: "Catalog and your overlays." },
  { id: "generations", label: "Images and videos", description: "Generated media." },
  { id: "agentic", label: "Agentic sessions", description: "Coding sessions and traces." },
  {
    id: "credentials",
    label: "Credentials",
    description: "API tokens. Only include these if the destination is trusted.",
    sensitive: true,
  },
];

export function DataSettings({ client, categories }: DataSettingsProps): JSX.Element {
  const list = categories ?? DEFAULT_CATEGORIES;
  // v2.2.0 Phase 8 (DF-16): self-wire to the sidecar when one is present.
  // Tests and the browser dev server pass (or get) null and see the honest
  // "not reachable" message rather than a button that does nothing.
  const [resolvedClient] = useState<DataSettingsClient | null>(
    () => client ?? createDataTransferClient(),
  );
  const [outPath, setOutPath] = useState<string>(() => defaultExportPath());
  const [importPath, setImportPath] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(
    // Everything except the sensitive bucket starts on.
    () => new Set(list.filter((c) => !c.sensitive).map((c) => c.id)),
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const includeCredentials = selected.has("credentials");

  const toggle = (id: string, on: boolean): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const runExport = async (): Promise<void> => {
    if (!resolvedClient) {
      setError("Data transfer needs the Nexus backend, which is not reachable.");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const result = await resolvedClient.export({
        categories: [...selected],
        includeCredentials,
        outPath,
      });
      const mb = (result.bytes / 1024 / 1024).toFixed(1);
      const emptyNote =
        result.empty.length > 0 ? ` (nothing to export for: ${result.empty.join(", ")})` : "";
      setStatus(`Exported ${mb} MB to ${result.path}${emptyNote}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runImport = async (apply: boolean): Promise<void> => {
    if (!resolvedClient) {
      setError("Data transfer needs the Nexus backend, which is not reachable.");
      return;
    }
    if (!importPath.trim()) {
      setError("Enter the path of the archive to import.");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      if (apply) {
        const result = await resolvedClient.importApply(importPath.trim());
        const backup =
          result.backupPath === null
            ? ""
            : ` A backup of what was replaced is at ${result.backupPath}.`;
        setStatus(`Imported: ${result.applied.join(", ") || "nothing"}.${backup}`);
      } else {
        // Always offer the preview first. An import replaces local data, and
        // the user should see what an archive claims to hold before it does.
        const result = await resolvedClient.importDryRun(importPath.trim());
        const skipped =
          result.skipped.length > 0 ? ` Not in this archive: ${result.skipped.join(", ")}.` : "";
        setStatus(`This archive would restore: ${result.applied.join(", ") || "nothing"}.${skipped}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      data-testid="settings-data"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
        padding: "var(--space-6, 24px)",
      }}
    >
      <header>
        <h1 style={{ margin: 0 }}>Data</h1>
        <p style={{ color: "var(--fg-muted)", fontSize: "var(--text-sm)" }}>
          Move your Nexus data to another machine. Everything stays on disk: nothing is
          uploaded anywhere.
        </p>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {list.map((category) => (
          <div key={category.id} style={{ display: "flex", flexDirection: "column" }}>
            <Switch
              testId={`data-category-${category.id}`}
              checked={selected.has(category.id)}
              onChange={(on) => toggle(category.id, on)}
              label={category.label}
            />
            <span
              style={{
                color: category.sensitive ? "var(--status-warn)" : "var(--fg-muted)",
                fontSize: "var(--text-xs)",
                marginLeft: "2.6rem",
              }}
            >
              {category.description}
            </span>
          </div>
        ))}
      </div>

      {includeCredentials ? (
        <div
          data-testid="data-credentials-warning"
          role="alert"
          style={{
            border: "1px solid var(--status-warn)",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-3)",
            color: "var(--fg-1)",
            fontSize: "var(--text-sm)",
          }}
        >
          This export will contain API tokens in readable form. Only do this if you control
          the destination machine and the file.
        </div>
      ) : null}

      <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
        <span style={{ fontSize: "var(--text-sm)", color: "var(--fg-muted)" }}>
          Export to
        </span>
        <SearchInput
          testId="data-export-path"
          value={outPath}
          onChange={setOutPath}
          label="Export file path"
        />
      </label>

      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <Button
          type="button"
          testId="data-export"
          disabled={busy || selected.size === 0}
          onClick={() => void runExport()}
          busy={busy}
        >
          {busy ? "Exporting..." : "Export selected"}
        </Button>
      </div>

      <hr style={{ border: 0, borderTop: "1px solid var(--border-subtle)", width: "100%" }} />

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <h2 style={{ margin: 0, fontSize: "var(--text-md)" }}>Import</h2>
        <p style={{ margin: 0, color: "var(--fg-muted)", fontSize: "var(--text-sm)" }}>
          Restore an export made on another machine. Preview first: an import replaces the
          local copy of whatever the archive holds.
        </p>
        <SearchInput
          testId="data-import-path"
          value={importPath}
          onChange={setImportPath}
          label="Archive to import"
          placeholder="Path to a nexus-export archive"
        />
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <Button
            type="button"
            testId="data-import-preview"
            disabled={busy}
            onClick={() => void runImport(false)}
          >
            Preview
          </Button>
          <Button
            type="button"
            testId="data-import-apply"
            disabled={busy}
            onClick={() => void runImport(true)}
          >
            Import
          </Button>
        </div>
      </div>

      {status ? (
        <span data-testid="data-status" style={{ color: "var(--status-ok)" }}>
          {status}
        </span>
      ) : null}
      {error ? (
        <span data-testid="data-error" style={{ color: "var(--status-err)" }}>
          {error}
        </span>
      ) : null}
    </section>
  );
}
