/**
 * v1.0.0 Phase 5.5 -- Settings > Models page.
 *
 * Three sections: Installed (registry entries), Available (catalog entries
 * that have not been installed), External (sourced from
 * `~/.nexus/extra_model_paths.yaml`). Filters by type and family, free-text
 * search by name, and a disk-usage summary at the top.
 *
 * The page is provider-driven: callers inject a `ModelsClient` so tests
 * (and the eventual IPC wiring) can swap the real disk-backed
 * `NexusModelRegistry` for an in-memory fake.
 */

import { useEffect, useMemo, useState } from "react";

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
}

const TYPE_FILTERS: ReadonlyArray<{ value: "all" | ModelType; label: string }> = [
  { value: "all", label: "All" },
  { value: "llm", label: "LLM" },
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
  { value: "embed", label: "Embed" },
];

export function ModelsSettings({ client }: ModelsSettingsProps): JSX.Element {
  const [items, setItems] = useState<readonly ListedModelDto[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<"all" | ModelType>("all");
  const [familyFilter, setFamilyFilter] = useState<string>("all");
  const [query, setQuery] = useState<string>("");
  const [progress, setProgress] = useState<Record<string, InstallProgressDto>>({});
  const [active, setActive] = useState<Record<string, InstallHandle>>({});
  const [disk, setDisk] = useState<DiskUsageDto | null>(null);

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

  const filtered = useMemo(() => {
    return items.filter((m) => {
      if (typeFilter !== "all" && m.type !== typeFilter) return false;
      if (familyFilter !== "all" && m.family !== familyFilter) return false;
      if (query) {
        const q = query.toLowerCase();
        const hay = `${m.id} ${m.displayName} ${m.family ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, typeFilter, familyFilter, query]);

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

      <div role="alert" aria-live="polite" style={{ minHeight: "1.5em", color: "var(--accent-warning, #d97706)" }}>
        {error ?? ""}
      </div>

      <div style={filterRowStyle}>
        <label>
          <span style={labelStyle}>Type</span>
          <select
            data-testid="models-filter-type"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as "all" | ModelType)}
          >
            {TYPE_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span style={labelStyle}>Family</span>
          <select
            data-testid="models-filter-family"
            value={familyFilter}
            onChange={(e) => setFamilyFilter(e.target.value)}
          >
            {families.map((f) => (
              <option key={f} value={f}>
                {f === "all" ? "All" : f}
              </option>
            ))}
          </select>
        </label>
        <label style={{ flex: 1 }}>
          <span style={labelStyle}>Search</span>
          <input
            data-testid="models-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or id"
            style={{ width: "100%" }}
          />
        </label>
      </div>

      {loading ? (
        <p data-testid="models-loading">Loading installed models...</p>
      ) : (
        <>
          <Section
            title="Installed"
            testId="section-installed"
            items={installed}
            renderAction={(m) => (
              <RowActions
                item={m}
                progress={progress[m.id]}
                onRemove={() => handleRemove(m.id)}
                onPin={
                  client.pin
                    ? () => client.pin?.(m.id, true).catch((e) => setError(messageFor(e)))
                    : undefined
                }
              />
            )}
          />
          <Section
            title="Available"
            testId="section-available"
            items={available}
            renderAction={(m) => (
              <RowActions
                item={m}
                progress={progress[m.id]}
                onInstall={() => startInstall(m.id)}
                onCancel={() => cancelInstall(m.id)}
                installing={Boolean(active[m.id])}
              />
            )}
          />
          <Section
            title="External"
            testId="section-external"
            items={external}
            renderAction={(m) => (
              <RowActions
                item={m}
                progress={progress[m.id]}
                onReveal={
                  m.absPath && client.reveal
                    ? () => client.reveal?.(m.absPath as string)
                    : undefined
                }
              />
            )}
          />
        </>
      )}
    </section>
  );
}

interface SectionProps {
  title: string;
  testId: string;
  items: readonly ListedModelDto[];
  renderAction: (m: ListedModelDto) => JSX.Element;
}

function Section({ title, testId, items, renderAction }: SectionProps): JSX.Element {
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
                <div style={{ fontWeight: 600 }}>{m.displayName}</div>
                <div style={{ fontSize: "0.85em", color: "var(--fg-muted)" }}>
                  {m.family ?? "?"}
                  {m.tag ? `:${m.tag}` : ""} - {formatBytes(m.sizeBytes)} - {m.license ?? "license: ?"}
                </div>
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

function ModelIcon({ type }: { type?: ModelType }): JSX.Element {
  const label = type === "image" ? "I" : type === "video" ? "V" : type === "embed" ? "E" : "L";
  const color =
    type === "image"
      ? "var(--accent-image, #ec4899)"
      : type === "video"
        ? "var(--accent-video, #6366f1)"
        : type === "embed"
          ? "var(--accent-embed, #14b8a6)"
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
