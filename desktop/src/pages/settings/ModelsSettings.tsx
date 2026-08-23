/**
 * v2.2.4 Phase 5 -- Settings > Models.
 *
 * Installer-parity catalog: Chat / Agentic / Image / Video / Audio / Document
 * tabs, card copy (description, Best for, license, size, Recommended /
 * Required / Compatible), Download vs Downloaded, hardware gating, and one
 * Favorite star per tab. Search stays as a secondary filter. Unknown tasks
 * land in Other so a row is never dropped. The installer Qt wizard is not
 * iframed.
 */

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Button, SearchInput } from "../../components/ui";
import { SidecarDownBanner } from "../../components/SidecarDownBanner";
import { isBackendDownMessage, useSidecarStatus } from "../../lib/sidecarStatus";

import {
  CATALOG_TAB_DEFS,
  catalogTabsFor,
  modelsOnTab,
  recommendationKind,
  type CatalogTab,
} from "../../shared/models/catalogTabs";
import { filterCatalog, modelFitsHost } from "../../shared/models/modelLibrary";
import {
  FAVORITE_STORAGE_PREFIX,
  readFavorite,
  writeFavorite,
  type TaskKey,
} from "../../shared/models/selectionPolicy";
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
   * Host VRAM in GB. Download disables when modelFitsHost is false.
   * Omit or pass null when telemetry has not reported a total yet.
   */
  hostVramGB?: number | null;
}

const TASK_TABS: readonly TaskKey[] = ["chat", "agentic", "image", "video", "audio", "document"];

export function ModelsSettings({ client, hostVramGB = null }: ModelsSettingsProps): JSX.Element {
  const [items, setItems] = useState<readonly ListedModelDto[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<CatalogTab>("chat");
  const [query, setQuery] = useState<string>("");
  const [progress, setProgress] = useState<Record<string, InstallProgressDto>>({});
  const [active, setActive] = useState<Record<string, InstallHandle>>({});
  const [disk, setDisk] = useState<DiskUsageDto | null>(null);
  const [favorites, setFavorites] = useState<Partial<Record<string, string | null>>>(() => {
    const next: Partial<Record<string, string | null>> = {};
    for (const t of TASK_TABS) next[t] = readFavorite(t);
    try {
      next.other = window.localStorage.getItem(`${FAVORITE_STORAGE_PREFIX}other`);
    } catch {
      next.other = null;
    }
    return next;
  });
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
        /* disk usage is informational */
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const searched = useMemo(
    () =>
      filterCatalog(items, {
        query,
        type: "all",
        family: "all",
        source: "all",
        tierFit: "all",
        hostVramGB,
      }),
    [items, query, hostVramGB],
  );

  const otherCount = modelsOnTab(searched, "other").length;
  const tabDefs = otherCount > 0 ? [...CATALOG_TAB_DEFS, { id: "other" as const, label: "Other" }] : CATALOG_TAB_DEFS;
  const visible = modelsOnTab(searched, tab);

  async function refresh(): Promise<void> {
    const list = await client.list();
    setItems(list);
    const d = await client.diskUsage();
    setDisk(d);
  }

  function startInstall(id: string): void {
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
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
        setRowErrors((prev) => ({ ...prev, [id]: messageFor(e) }));
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
      setRowErrors((prev) => ({ ...prev, [id]: messageFor(e) }));
    }
  }

  function toggleFavorite(id: string): void {
    const current = favorites[tab] ?? null;
    const next = current === id ? null : id;
    setFavorites((prev) => ({ ...prev, [tab]: next }));
    if (tab === "other") {
      try {
        const key = `${FAVORITE_STORAGE_PREFIX}other`;
        if (!next) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, next);
      } catch {
        /* preference is optional */
      }
      return;
    }
    writeFavorite(tab, next);
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

      <div role="tablist" aria-label="Model catalog" style={tabListStyle}>
        {tabDefs.map((def) => (
          <button
            key={def.id}
            type="button"
            role="tab"
            aria-selected={tab === def.id}
            data-testid={`models-tab-${def.id}`}
            onClick={() => setTab(def.id)}
            style={tabButtonStyle(tab === def.id)}
          >
            {def.label}
          </button>
        ))}
      </div>

      <label style={{ flex: 1 }}>
        <span style={labelStyle}>Search</span>
        <SearchInput
          testId="models-search"
          value={query}
          onChange={setQuery}
          placeholder="Search by name, type, or id"
          label="Search models"
        />
      </label>

      {loading ? (
        <p data-testid="models-loading">Loading installed models...</p>
      ) : (
        <section data-testid={`models-panel-${tab}`} style={sectionStyle}>
          {visible.length === 0 ? (
            <p style={{ color: "var(--fg-muted)" }}>No matching entries.</p>
          ) : (
            <ul style={listStyle}>
              {visible.map((m) => (
                <ModelCard
                  key={m.id}
                  item={m}
                  hostVramGB={hostVramGB}
                  progress={progress[m.id]}
                  installing={Boolean(active[m.id])}
                  favorite={favorites[tab] === m.id}
                  rowError={rowErrors[m.id]}
                  onFavorite={() => toggleFavorite(m.id)}
                  onInstall={() => startInstall(m.id)}
                  onCancel={() => cancelInstall(m.id)}
                  onRemove={m.source === "registry" ? () => void handleRemove(m.id) : undefined}
                  onReveal={
                    m.absPath && client.reveal ? () => client.reveal?.(m.absPath as string) : undefined
                  }
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </section>
  );
}

interface ModelCardProps {
  item: ListedModelDto;
  hostVramGB?: number | null;
  progress?: InstallProgressDto;
  installing?: boolean;
  favorite: boolean;
  rowError?: string;
  onFavorite: () => void;
  onInstall: () => void;
  onCancel: () => void;
  onRemove?: () => void;
  onReveal?: () => void;
}

function ModelCard({
  item,
  hostVramGB,
  progress,
  installing,
  favorite,
  rowError,
  onFavorite,
  onInstall,
  onCancel,
  onRemove,
  onReveal,
}: ModelCardProps): JSX.Element {
  const kind = recommendationKind(item);
  const overBudget = modelFitsHost(item, hostVramGB) === false;
  const downloaded = item.installed && item.source !== "catalog-only";
  return (
    <li data-testid={`models-row-${item.id}`} style={cardStyle}>
      <div style={{ display: "flex", gap: "var(--space-3, 12px)", alignItems: "flex-start" }}>
        <ModelIcon type={item.type} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2, 8px)", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600 }}>{item.displayName}</span>
            <span data-testid={`models-badge-${item.id}`} style={badgeStyle(kind)}>
              {kind === "required" ? "Required" : kind === "recommended" ? "Recommended" : "Compatible"}
            </span>
            {catalogTabsFor(item).includes("agentic") && item.task === "chat" ? (
              <span style={{ fontSize: "0.75em", color: "var(--fg-muted)" }}>Also agentic</span>
            ) : null}
          </div>
          {item.description ? (
            <p data-testid={`models-row-${item.id}-description`} style={copyStyle}>
              {item.description}
            </p>
          ) : null}
          {item.strengths && item.strengths.length > 0 ? (
            <p data-testid={`models-row-${item.id}-best-for`} style={copyStyle}>
              Best for: {item.strengths.join(", ")}
            </p>
          ) : null}
          {item.whyRecommended ? (
            <p data-testid={`models-row-${item.id}-why`} style={copyStyle}>
              Why this one: {item.whyRecommended}
            </p>
          ) : null}
          <div style={{ fontSize: "0.85em", color: "var(--fg-muted)" }}>
            {item.family ?? "?"}
            {item.tag ? `:${item.tag}` : ""}
            {item.task ? ` - ${item.task}` : ""} - {formatBytes(item.sizeBytes)} - {item.license ?? "license: ?"}
            {typeof item.vramGB === "number" ? ` - ${item.vramGB} GB VRAM` : ""}
          </div>
          {item.licenseNote ? (
            <div data-testid={`models-row-${item.id}-license-note`} style={{ fontSize: "0.8em", color: "var(--fg-muted)", marginTop: 2 }}>
              Use restriction: {item.licenseNote}
              {item.licenseUrl ? (
                <>
                  {" "}
                  <a href={item.licenseUrl} target="_blank" rel="noreferrer">
                    License text
                  </a>
                </>
              ) : null}
            </div>
          ) : null}
          {rowError ? (
            <p data-testid={`models-row-error-${item.id}`} role="alert" style={{ color: "var(--status-err, #dc2626)", fontSize: "0.85em" }}>
              {rowError}
            </p>
          ) : null}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "var(--space-2, 8px)" }}>
          <button
            type="button"
            data-testid={`models-favorite-${item.id}`}
            aria-pressed={favorite}
            aria-label={favorite ? "Unfavorite" : "Favorite"}
            onClick={onFavorite}
            style={starStyle(favorite)}
          >
            {favorite ? "★" : "☆"}
          </button>
          <RowActions
            item={item}
            progress={progress}
            installing={installing}
            downloaded={downloaded}
            overBudget={overBudget}
            hostVramGB={hostVramGB}
            onInstall={onInstall}
            onCancel={onCancel}
            onRemove={onRemove}
            onReveal={onReveal}
          />
        </div>
      </div>
    </li>
  );
}

function RowActions({
  item,
  progress,
  installing,
  downloaded,
  overBudget,
  hostVramGB,
  onInstall,
  onCancel,
  onRemove,
  onReveal,
}: {
  item: ListedModelDto;
  progress?: InstallProgressDto;
  installing?: boolean;
  downloaded: boolean;
  overBudget: boolean;
  hostVramGB?: number | null;
  onInstall: () => void;
  onCancel: () => void;
  onRemove?: () => void;
  onReveal?: () => void;
}): JSX.Element {
  if (installing && progress) {
    const total = progress.total ?? 0;
    const pct = total > 0 ? Math.min(100, (progress.bytes / total) * 100) : 0;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2, 8px)" }}>
        <progress data-testid={`models-progress-${item.id}`} value={progress.bytes} max={total || undefined} />
        <span data-testid={`models-progress-text-${item.id}`} style={{ fontSize: "0.85em", color: "var(--fg-muted)" }}>
          {formatBytes(progress.bytes)}
          {total > 0 ? ` / ${formatBytes(total)} (${pct.toFixed(0)}%)` : ""}
        </span>
        <Button type="button" testId={`models-cancel-${item.id}`} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    );
  }
  if (onReveal && item.source === "external") {
    return (
      <Button type="button" testId={`models-reveal-${item.id}`} onClick={onReveal}>
        Reveal
      </Button>
    );
  }
  if (downloaded) {
    return (
      <div style={{ display: "flex", gap: "var(--space-2, 8px)", alignItems: "center" }}>
        <span data-testid={`models-downloaded-${item.id}`} style={{ fontSize: "0.85em", color: "var(--fg-muted)" }}>
          Downloaded
        </span>
        {onRemove ? (
          <Button type="button" testId={`models-remove-${item.id}`} onClick={onRemove}>
            Remove
          </Button>
        ) : null}
      </div>
    );
  }
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
    <Button type="button" testId={`models-install-${item.id}`} onClick={onInstall}>
      Download
    </Button>
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
        flexShrink: 0,
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

function badgeStyle(kind: "required" | "recommended" | "compatible"): CSSProperties {
  const color =
    kind === "required"
      ? "var(--accent-warning, #d97706)"
      : kind === "recommended"
        ? "var(--accent-llm, #10b981)"
        : "var(--fg-muted)";
  return {
    fontSize: "0.7em",
    fontWeight: 600,
    letterSpacing: "0.02em",
    textTransform: "uppercase",
    color,
    border: `1px solid ${color}`,
    borderRadius: "var(--radius-1, 4px)",
    padding: "0 0.45em",
  };
}

function tabButtonStyle(active: boolean): CSSProperties {
  return {
    appearance: "none",
    background: active ? "var(--bg-elevated, #1b1b1b)" : "transparent",
    color: "var(--fg-0)",
    border: "1px solid var(--border-1, #2a2a2a)",
    borderRadius: "var(--radius-2, 6px)",
    padding: "6px 12px",
    cursor: "pointer",
    fontWeight: active ? 600 : 400,
  };
}

function starStyle(on: boolean): CSSProperties {
  return {
    appearance: "none",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontSize: "1.25em",
    lineHeight: 1,
    color: on ? "var(--accent-warning, #fbbf24)" : "var(--fg-muted)",
  };
}

const pageStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-4, 16px)",
  padding: "var(--space-6, 24px)",
  color: "var(--fg-0)",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: "var(--space-4, 16px)",
};

const tabListStyle: CSSProperties = {
  display: "flex",
  gap: "var(--space-2, 8px)",
  flexWrap: "wrap",
};

const sectionStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2, 8px)",
};

const listStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2, 8px)",
};

const cardStyle: CSSProperties = {
  padding: "var(--space-3, 12px)",
  border: "1px solid var(--border-1, #2a2a2a)",
  borderRadius: "var(--radius-2, 6px)",
  background: "var(--bg-1, transparent)",
};

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: "0.8em",
  color: "var(--fg-muted)",
  marginBottom: "2px",
};

const copyStyle: CSSProperties = {
  margin: "4px 0 0",
  fontSize: "0.85em",
  color: "var(--fg-1, var(--fg-0))",
};
