/**
 * v1.0.0 Phase 5.5 -- Settings > Models page.
 *
 * Three sections: Installed (registry entries), Available (catalog entries
 * that have not been installed), External (sourced from
 * `~/.nexus/extra_model_paths.yaml`). Filters by type, family, install
 * status, and (when host VRAM is known) tier-fit; free-text search by name
 * or capability; disk-usage summary at the top. v1.16.0 Phase 5 (A4) added
 * the status / tier-fit filters and the over-budget install state.
 *
 * The page is provider-driven: callers inject a `ModelsClient` so tests
 * (and the eventual IPC wiring) can swap the real disk-backed
 * `NexusModelRegistry` for an in-memory fake.
 */

import { useEffect, useMemo, useState } from "react";
import { Select } from "../../components/ui/Select";
import { SidecarDownBanner } from "../../components/SidecarDownBanner";
import { isBackendDownMessage, useSidecarStatus } from "../../lib/sidecarStatus";

import {
  filterCatalog,
  modelFitsHost,
  sourceLabel,
  type SourceFilter,
  type TierFitFilter,
} from "../../shared/models/modelLibrary";
import type {
  DiskUsageDto,
  InstallProgressDto,
  ListedModelDto,
  ModelType,
} from "./modelsTypes";

export type InstallHandle = { cancel(): void };

export interface ModelsClient {
  list(): Promise<readonly ListedModelDto[]>;
  install(
    id: string,
    onProgress: (p: InstallProgressDto) => void,
  ): InstallHandle & { done: Promise<void> };
  remove(id: string): Promise<void>;
  reveal?(absPath: string): void;
  diskUsage(): Promise<DiskUsageDto>;
  pin?(id: string, pinned: boolean): Promise<void>;
  isPinned?(id: string): Promise<boolean>;
}

export interface ModelsSettingsProps {
  client: ModelsClient;
  /**
   * v1.16.0 Phase 5 (A4) -- host VRAM in GB, used by the tier-fit filter and
   * to disable Install on over-budget catalog entries. Omit or pass `null`
   * when telemetry has not reported a total yet; the filter then hides.
   */
  hostVramGB?: number | null;
}

const TYPE_FILTERS: ReadonlyArray<{ value: "all" | ModelType; label: string }> = [
  { value: "all", label: "All" },
  { value: "llm", label: "LLM" },
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
  { value: "audio", label: "Audio" },
  { value: "embed", label: "Embed" },
  // v1.16.0 Phase 3 (adoption item A5) -- document OCR / parsing models.
  { value: "document", label: "Document" },
];

export function ModelsSettings({ client, hostVramGB = null }: ModelsSettingsProps): JSX.Element {
  const [items, setItems] = useState<readonly ListedModelDto[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<"all" | ModelType>("all");
  const [familyFilter, setFamilyFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [tierFitFilter, setTierFitFilter] = useState<TierFitFilter>("all");
  const [query, setQuery] = useState<string>("");
  const [progress, setProgress] = useState<Record<string, InstallProgressDto>>({});
  const [active, setActive] = useState<Record<string, InstallHandle>>({});
  const [disk, setDisk] = useState<DiskUsageDto | null>(null);
  // v2.2.0 Phase 2 (2.2): a backend that cannot start rendered the raw
  // "sidecar-not-running" token next to three zero counts. Branch it.
  const sidecar = useSidecarStatus();
  const backendDown = sidecar.isDown || isBackendDownMessage(error);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    client
      .list()
      .then((list) => {
        if (!cancelled) {
          setItems(list);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(messageFor(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    client
      .diskUsage()
      .then((d) => {
        if (!cancelled) setDisk(d);
      })
      .catch(() => {
        // disk usage is informational; ignore failures
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const families = useMemo(() => {
    const set = new Set<string>();
    for (const m of items) if (m.family) set.add(m.family);
    return ["all", ...Array.from(set).sort()];
  }, [items]);

  const filtered = useMemo(
    () =>
      filterCatalog(items, {
        query,
        type: typeFilter,
        family: familyFilter,
        source: sourceFilter,
        tierFit: tierFitFilter,
        hostVramGB,
      }),
    [items, query, typeFilter, familyFilter, sourceFilter, tierFitFilter, hostVramGB],
  );

  const installed = filtered.filter((m) => m.source === "registry");
  const available = filtered.filter((m) => m.source === "catalog-only");
  const external = filtered.filter((m) => m.source === "external");

  async function refresh(): Promise<void> {
    const list = await client.list();
    setItems(list);
    const d = await client.diskUsage();
    setDisk(d);
  }

  function startInstall(id: string): void {
    const handle = client.install(id, (p) => {
      setProgress((prev) => ({ ...prev, [id]: p }));
    });
    setActive((prev) => ({ ...prev, [id]: handle }));
    handle.done
      .then(() => {
        setProgress((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setActive((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        void refresh();
      })
      .catch((e: unknown) => {
        setError(messageFor(e));
        setActive((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      });
  }

  function cancelInstall(id: string): void {
    const handle = active[id];
    if (handle) handle.cancel();
  }

  async function handleRemove(id: string): Promise<void> {
    try {
      await client.remove(id);
      await refresh();
    } catch (e) {
      setError(messageFor(e));
    }
  }

  return (
    <section data-testid="settings-models" style={pageStyle}>
      <header style={headerStyle}>
        <h1 style={{ margin: 0 }}>Models</h1>
        <DiskSummary disk={disk} />
      </header>

      {backendDown ? (
        <SidecarDownBanner
          status={sidecar.status}
          restarting={sidecar.restarting}
          restartError={sidecar.restartError}
          onRestart={() => void sidecar.restart()}
          context="Installed models cannot be listed."
          testId="models-sidecar-down"
        />
      ) : (
        <div role="alert" aria-live="polite" style={{ minHeight: "1.5em", color: "var(--accent-warning, #d97706)" }}>
          {error ?? ""}
        </div>
      )}

      <div style={filterRowStyle}>
        <label>
          <span style={labelStyle}>Type</span>
          <Select
            data-testid="models-filter-type"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as "all" | ModelType)}
          >
            {TYPE_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
        </label>
        <label>
          <span style={labelStyle}>Family</span>
          <Select
            data-testid="models-filter-family"
            value={familyFilter}
            onChange={(e) => setFamilyFilter(e.target.value)}
          >
            {families.map((f) => (
              <option key={f} value={f}>
                {f === "all" ? "All" : f}
              </option>
            ))}
          </Select>
        </label>
        <label>
          <span style={labelStyle}>Status</span>
          <Select
            data-testid="models-filter-source"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
          >
            <option value="all">All</option>
            <option value="installed">Installed</option>
            <option value="available">Available</option>
            <option value="external">External</option>
          </Select>
        </label>
        {typeof hostVramGB === "number" && (
          <label>
            <span style={labelStyle}>Tier fit</span>
            <Select
              data-testid="models-filter-tier"
              value={tierFitFilter}
              onChange={(e) => setTierFitFilter(e.target.value as TierFitFilter)}
            >
              <option value="all">All</option>
              <option value="fits">Fits this host</option>
              <option value="over-budget">Over budget</option>
            </Select>
          </label>
        )}
        <label style={{ flex: 1 }}>
          <span style={labelStyle}>Search</span>
          <input
            data-testid="models-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, type, or id"
            style={{ width: "100%" }}
          />
        </label>
      </div>

      {loading ? (
        <p data-testid="models-loading">Loading installed models...</p>
      ) : (
        <>
          {(sourceFilter === "all" || sourceFilter === "installed") && (
            <Section
              title="Installed"
              testId="section-installed"
              items={installed}
              hostVramGB={hostVramGB}
              renderAction={(m) => (
                <RowActions
                  item={m}
                  progress={progress[m.id]}
                  hostVramGB={hostVramGB}
                  onRemove={() => handleRemove(m.id)}
                  onPin={
                    client.pin
                      ? () => client.pin?.(m.id, true).catch((e) => setError(messageFor(e)))
                      : undefined
                  }
                />
              )}
            />
          )}
          {(sourceFilter === "all" || sourceFilter === "available") && (
            <Section
              title="Available"
              testId="section-available"
              items={available}
              hostVramGB={hostVramGB}
              renderAction={(m) => (
                <RowActions
                  item={m}
                  progress={progress[m.id]}
                  hostVramGB={hostVramGB}
                  onInstall={() => startInstall(m.id)}
                  onCancel={() => cancelInstall(m.id)}
                  installing={Boolean(active[m.id])}
                />
              )}
            />
          )}
          {(sourceFilter === "all" || sourceFilter === "external") && (
            <Section
              title="External"
              testId="section-external"
              items={external}
              hostVramGB={hostVramGB}
              renderAction={(m) => (
                <RowActions
                  item={m}
                  progress={progress[m.id]}
                  hostVramGB={hostVramGB}
                  onReveal={
                    m.absPath && client.reveal
                      ? () => client.reveal?.(m.absPath as string)
                      : undefined
                  }
                />
              )}
            />
          )}
        </>
      )}
    </section>
  );
}

interface SectionProps {
  title: string;
  testId: string;
  items: readonly ListedModelDto[];
  hostVramGB?: number | null;
  renderAction: (m: ListedModelDto) => JSX.Element;
}

function Section({ title, testId, items, hostVramGB, renderAction }: SectionProps): JSX.Element {
  return (
    <section data-testid={testId} style={sectionStyle}>
      <h2 style={{ margin: "0 0 var(--space-2, 8px)" }}>
        {title} <span data-testid={`${testId}-count`} style={{ color: "var(--fg-muted)" }}>({items.length})</span>
      </h2>
      {items.length === 0 ? (
        <p style={{ color: "var(--fg-muted)" }}>No matching entries.</p>
      ) : (
        <ul style={listStyle}>
          {items.map((m) => (
            <li key={m.id} data-testid={`models-row-${m.id}`} style={rowStyle}>
              <ModelIcon type={m.type} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: "var(--space-2, 8px)" }}>
                  <span>{m.displayName}</span>
                  <StatusBadge item={m} hostVramGB={hostVramGB} />
                </div>
                <div style={{ fontSize: "0.85em", color: "var(--fg-muted)" }}>
                  {m.family ?? "?"}
                  {m.tag ? `:${m.tag}` : ""}
                  {m.task ? ` - ${m.task}` : ""} - {formatBytes(m.sizeBytes)} - {m.license ?? "license: ?"}
                </div>
                {m.licenseNote ? (
                  <div
                    data-testid={`models-row-${m.id}-license-note`}
                    style={{ fontSize: "0.8em", color: "var(--fg-muted)", marginTop: 2 }}
                  >
                    Use restriction: {m.licenseNote}
                    {m.licenseUrl ? (
                      <>
                        {" "}
                        <a href={m.licenseUrl} target="_blank" rel="noreferrer">
                          License text
                        </a>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {renderAction(m)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface RowActionsProps {
  item: ListedModelDto;
  progress?: InstallProgressDto;
  hostVramGB?: number | null;
  onInstall?: () => void;
  onCancel?: () => void;
  onRemove?: () => void;
  onReveal?: () => void;
  onPin?: () => void;
  installing?: boolean;
}

function RowActions({
  item,
  progress,
  hostVramGB,
  onInstall,
  onCancel,
  onRemove,
  onReveal,
  onPin,
  installing,
}: RowActionsProps): JSX.Element {
  if (installing && progress) {
    const total = progress.total ?? 0;
    const pct = total > 0 ? Math.min(100, (progress.bytes / total) * 100) : 0;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2, 8px)" }}>
        <progress
          data-testid={`models-progress-${item.id}`}
          value={progress.bytes}
          max={total || undefined}
        />
        <span data-testid={`models-progress-text-${item.id}`} style={{ fontSize: "0.85em", color: "var(--fg-muted)" }}>
          {formatBytes(progress.bytes)}
          {total > 0 ? ` / ${formatBytes(total)} (${pct.toFixed(0)}%)` : ""}
        </span>
        <button
          type="button"
          data-testid={`models-cancel-${item.id}`}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    );
  }
  if (onInstall) {
    const overBudget = modelFitsHost(item, hostVramGB) === false;
    if (overBudget) {
      return (
        <span
          data-testid={`models-over-budget-${item.id}`}
          style={{ fontSize: "0.85em", color: "var(--fg-muted)" }}
          title={`Needs ${item.vramGB} GB VRAM; this host has ${hostVramGB} GB.`}
        >
          Needs {item.vramGB} GB VRAM
        </span>
      );
    }
    return (
      <button
        type="button"
        data-testid={`models-install-${item.id}`}
        onClick={onInstall}
      >
        Install
      </button>
    );
  }
  if (onReveal) {
    return (
      <button
        type="button"
        data-testid={`models-reveal-${item.id}`}
        onClick={onReveal}
      >
        Reveal
      </button>
    );
  }
  if (onRemove) {
    return (
      <div style={{ display: "flex", gap: "var(--space-2, 8px)" }}>
        {onPin && (
          <button type="button" data-testid={`models-pin-${item.id}`} onClick={onPin}>
            Pin
          </button>
        )}
        <button type="button" data-testid={`models-remove-${item.id}`} onClick={onRemove}>
          Remove
        </button>
      </div>
    );
  }
  return <span />;
}

function StatusBadge({
  item,
  hostVramGB,
}: {
  item: ListedModelDto;
  hostVramGB?: number | null;
}): JSX.Element {
  const overBudget = modelFitsHost(item, hostVramGB) === false;
  const label = overBudget ? "Over budget" : sourceLabel(item.source);
  return (
    <span
      data-testid={`models-status-${item.id}`}
      style={{
        fontSize: "0.7em",
        fontWeight: 600,
        letterSpacing: "0.02em",
        textTransform: "uppercase",
        color: overBudget ? "var(--accent-warning, #d97706)" : "var(--fg-muted)",
        border: "1px solid var(--border-1, #2a2a2a)",
        borderRadius: "var(--radius-1, 4px)",
        padding: "0 0.45em",
      }}
    >
      {label}
    </span>
  );
}

function ModelIcon({ type }: { type?: ModelType }): JSX.Element {
  const label =
    type === "image"
      ? "I"
      : type === "video"
        ? "V"
        : type === "audio"
          ? "S"
          : type === "embed"
            ? "E"
            : type === "controlnet"
              ? "C"
              : type === "vae"
                ? "A"
                : type === "document"
                  ? "D"
                  : "L";
  const color =
    type === "image"
      ? "var(--accent-image, #ec4899)"
      : type === "video"
        ? "var(--accent-video, #6366f1)"
        : type === "audio"
          ? "var(--accent-audio, #d946ef)"
          : type === "embed"
            ? "var(--accent-embed, #14b8a6)"
            : type === "controlnet"
              ? "var(--accent-controlnet, #f59e0b)"
              : type === "vae"
                ? "var(--accent-vae, #8b5cf6)"
                : type === "document"
                  ? "var(--accent-document, #0ea5e9)"
                  : "var(--accent-llm, #10b981)";
  return (
    <span
      aria-hidden
      data-testid={`models-icon-${type ?? "?"}`}
      style={{
        display: "inline-flex",
        width: "1.5em",
        height: "1.5em",
        borderRadius: "0.25em",
        background: color,
        color: "#fff",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        marginRight: "var(--space-2, 8px)",
      }}
    >
      {label}
    </span>
  );
}

function DiskSummary({ disk }: { disk: DiskUsageDto | null }): JSX.Element {
  if (!disk) {
    return (
      <p data-testid="models-disk-summary" style={{ margin: 0, color: "var(--fg-muted)" }}>
        Disk usage: ...
      </p>
    );
  }
  const free = disk.freeBytes !== null ? formatBytes(disk.freeBytes) : "unknown";
  return (
    <p data-testid="models-disk-summary" style={{ margin: 0, color: "var(--fg-muted)" }}>
      Models occupy {formatBytes(disk.usedBytes)}. {free} free.
    </p>
  );
}

function formatBytes(n: number | undefined): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "?";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function messageFor(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

const pageStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-4, 16px)",
  padding: "var(--space-6, 24px)",
  color: "var(--fg-0)",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: "var(--space-4, 16px)",
};

const filterRowStyle: React.CSSProperties = {
  display: "flex",
  gap: "var(--space-3, 12px)",
  alignItems: "flex-end",
  flexWrap: "wrap",
};

const sectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2, 8px)",
};

const listStyle: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2, 8px)",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-3, 12px)",
  padding: "var(--space-2, 8px) var(--space-3, 12px)",
  border: "1px solid var(--border-1, #2a2a2a)",
  borderRadius: "var(--radius-2, 6px)",
  background: "var(--bg-1, transparent)",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.8em",
  color: "var(--fg-muted)",
  marginBottom: "2px",
};
