/**
 * v2.2.4 Phase 5 -- Settings > Models.
 *
 * Installer-parity catalog: Chat / Agentic / Image / Video / Audio / Document
 * tabs, compact rows (name, badges, chips, size, VRAM), Download vs a
 * highlighted Downloaded state, hardware gating, and one Favorite star per
 * tab. Search stays as a secondary filter. Unknown tasks land in Other so a
 * row is never dropped. Long description copy lives behind a closed details
 * disclosure, matching installer density. The installer Qt wizard is not
 * iframed.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { modelAvailabilityBucket } from "../../../../core/registry/modelDisplayPolicy";
import { Button, SearchInput } from "../../components/ui";
import { SidecarDownBanner } from "../../components/SidecarDownBanner";
import { isBackendDownMessage, useSidecarStatus } from "../../lib/sidecarStatus";

import {
  CATALOG_TAB_DEFS,
  catalogTabsFor,
  catalogSortGpuVendor,
  installedOutsideCatalogModels,
  isCatalogOverBudget,
  recommendationKind,
  visibleModelsOnTab,
  type CatalogTab,
} from "../../shared/models/catalogTabs";
import { filterCatalog } from "../../shared/models/modelLibrary";
import { buildModelPills } from "../../shared/models/modelPills";
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
  catalogHash?: string | null;
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
  gpuVendor?: string | null;
}

const TASK_TABS: readonly TaskKey[] = ["chat", "agentic", "image", "video", "audio", "document"];

function isTaskKey(tab: CatalogTab): tab is TaskKey {
  return (TASK_TABS as readonly string[]).includes(tab);
}

export function ModelsSettings({ client, hostVramGB = null, gpuVendor = null }: ModelsSettingsProps): JSX.Element {
  const [items, setItems] = useState<readonly ListedModelDto[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<CatalogTab>("chat");
  const [query, setQuery] = useState<string>("");
  const [progress, setProgress] = useState<Record<string, InstallProgressDto>>({});
  const [active, setActive] = useState<Record<string, InstallHandle>>({});
  const [disk, setDisk] = useState<DiskUsageDto | null>(null);
  const diskRequest = useRef(0);
  const [favorites, setFavorites] = useState<Partial<Record<string, string | null>>>(() => {
    const next: Partial<Record<string, string | null>> = {};
    for (const t of TASK_TABS) next[t] = readFavorite(t);
    for (const extra of ["embeddings", "other"] as const) {
      try {
        next[extra] = window.localStorage.getItem(`${FAVORITE_STORAGE_PREFIX}${extra}`);
      } catch {
        next[extra] = null;
      }
    }
    return next;
  });
  const sidecar = useSidecarStatus();
  const backendDown = sidecar.isDown || isBackendDownMessage(error);

  const refreshDisk = useCallback(async (): Promise<void> => {
    const request = ++diskRequest.current;
    try {
      const next = await client.diskUsage();
      if (request === diskRequest.current) setDisk(next);
    } catch {
      if (request === diskRequest.current) setDisk(null);
    }
  }, [client]);

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
    void refreshDisk();
    return () => {
      cancelled = true;
    };
  }, [client, refreshDisk]);

  useEffect(() => {
    const refreshWhenVisible = (): void => {
      if (document.visibilityState === "visible") void refreshDisk();
    };
    const interval = window.setInterval(refreshWhenVisible, 30_000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshDisk]);

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

  const external = installedOutsideCatalogModels(searched);
  const tabDefs = external.length > 0
    ? [...CATALOG_TAB_DEFS, { id: "other" as const, label: "Installed outside catalog" }]
    : CATALOG_TAB_DEFS;
  const visible = tab === "other"
    ? external
    : visibleModelsOnTab(searched, tab, {
        hostVramGB,
        gpuVendor: gpuVendor ?? catalogSortGpuVendor(hostVramGB),
      });
  const availabilityOptions = {
    hostVramGB,
    gpuVendor: gpuVendor ?? catalogSortGpuVendor(hostVramGB),
  };
  const availabilityBuckets = new Set(
    visible.map((model) => modelAvailabilityBucket(model, availabilityOptions)),
  );
  const showAvailabilityHeadings = tab !== "other" && availabilityBuckets.size > 1;

  async function refresh(): Promise<void> {
    const list = await client.list();
    setItems(list);
    await refreshDisk();
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
    if (!isTaskKey(tab)) {
      // Embeddings and Other are not TaskKey selection-policy tabs; the
      // favorite is a plain per-tab preference key.
      try {
        const key = `${FAVORITE_STORAGE_PREFIX}${tab}`;
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
        <div><h1 style={{ margin: 0 }}>Models</h1>{client.catalogHash ? <small style={{ color: "var(--fg-muted)" }}>Catalog {client.catalogHash.slice(0, 12)}</small> : null}</div>
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
          <Button
            key={def.id}
            type="button"
            role="tab"
            aria-selected={tab === def.id}
            testId={`models-tab-${def.id}`}
            onClick={() => setTab(def.id)}
            variant="ghost"
            style={tabButtonStyle(tab === def.id)}
          >
            {def.label}
          </Button>
        ))}
      </div>

      <label>
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
            <ul data-testid="models-list" style={listStyle}>
              {visible.map((m, index) => {
                const bucket = modelAvailabilityBucket(m, availabilityOptions);
                const previous = index > 0 ? modelAvailabilityBucket(visible[index - 1]!, availabilityOptions) : null;
                return (
                  <Fragment key={m.id}>
                    {showAvailabilityHeadings && bucket !== previous ? (
                      <li data-testid={`models-group-${bucket}`} style={groupHeadingStyle}>
                        {bucket === 0 ? "Downloaded" : bucket === 1 ? "Available to download" : "Incompatible"}
                      </li>
                    ) : null}
                    <ModelCard
                      item={m}
                      components={componentsFor(m, items)}
                      hostVramGB={hostVramGB}
                      gpuVendor={gpuVendor}
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
                  </Fragment>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </section>
  );
}

interface ModelCardProps {
  item: ListedModelDto;
  components: readonly ListedModelDto[];
  hostVramGB?: number | null;
  gpuVendor?: string | null;
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
  components,
  hostVramGB,
  gpuVendor,
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
  const tier = recommendationKind(item);
  const kindLabel = tier === "compatible" ? "" : tier === "required" ? "Required" : "Recommended";
  const overBudget = isCatalogOverBudget(
    item,
    hostVramGB,
    gpuVendor ?? catalogSortGpuVendor(hostVramGB),
  );
  const downloaded = item.installed && item.source !== "catalog-only";
  const selectedMissing = Boolean(item.selectedAtInstall) && !downloaded;
  // v2.2.9 Phase 5 (T010): the locked name-row pill set (shared card grammar).
  const pills = buildModelPills(item);
  const description = item.description?.trim() || "Catalog metadata is unavailable for this installed model.";
  const compatibilityLabel = typeof item.vramGB === "number"
    ? overBudget
      ? `Incompatible - needs ${item.vramGB} GB VRAM`
      : typeof hostVramGB === "number"
        ? `Compatible - ${item.vramGB} GB VRAM`
        : `${item.vramGB} GB VRAM required`
    : null;
  const card: CSSProperties = {
    ...cardStyle,
    ...(downloaded
      ? {
          boxShadow: "inset 3px 0 color-mix(in srgb, var(--accent-primary, #6366f1) 35%, transparent)",
        }
      : null),
    ...(overBudget
      ? {
          opacity: 0.55,
          color: "var(--fg-muted)",
        }
      : null),
  };
  return (
    <li
      data-testid={`models-row-${item.id}`}
      data-compact="true"
      data-downloaded={downloaded ? "true" : "false"}
      data-over-budget={overBudget ? "true" : "false"}
      style={card}
    >
      <div style={{ display: "flex", gap: "var(--space-3, 12px)", alignItems: "flex-start" }}>
        <ModelIcon type={item.type} />
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* v2.2.9 Phase 5 (T010): one header row -- display name first, then
              the locked fact pills (wrapping is fine); never under the
              description. Badge and Also-agentic remain install affordances. */}
          <div
            data-testid={`models-header-${item.id}`}
            style={{ display: "flex", alignItems: "center", gap: "var(--space-2, 8px)", flexWrap: "wrap" }}
          >
            <span style={{ fontWeight: 600 }}>{item.displayName}</span>
            {pills.length > 0 ? (
              <span data-testid={`models-pills-${item.id}`} style={pillRowStyle}>
                {pills.map((pill) => (
                  <span key={pill} style={chipStyle}>
                    {pill}
                  </span>
                ))}
              </span>
            ) : null}
            {typeof item.sizeBytes === "number" ? <span style={chipStyle}>{formatBytes(item.sizeBytes)}</span> : null}
            {compatibilityLabel ? (
              <span data-testid={`models-compatibility-${item.id}`} style={badgeStyle(overBudget ? "Incompatible" : "Compatible")}>
                {compatibilityLabel}
              </span>
            ) : null}
            {kindLabel ? (
              <span data-testid={`models-badge-${item.id}`} style={badgeStyle(kindLabel)}>
                {kindLabel}
              </span>
            ) : null}
            {catalogTabsFor(item).includes("agentic") && item.task === "chat" ? (
              <span style={{ fontSize: "0.75em", color: "var(--fg-muted)" }}>Also agentic</span>
            ) : null}
          </div>
          <p data-testid={`models-row-${item.id}-description`} style={copyStyle}>{description}</p>
          {item.task || item.strengths?.length || item.whyRecommended || item.license || item.family || item.tag || components.length > 0 ? (
            <details data-testid={`models-row-${item.id}-details`} style={{ marginTop: 4 }}>
              <summary style={{ cursor: "pointer", fontSize: "0.8em", color: "var(--fg-muted)" }}>Details</summary>
              <p style={copyStyle}>ID: {item.id}{item.task ? `; task: ${item.task}` : ""}</p>
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
              {item.license ? <p style={copyStyle}>License: {item.license}</p> : null}
              {item.family || item.tag ? <p style={copyStyle}>Backend model: {item.family ?? item.id}{item.tag ? `:${item.tag}` : ""}</p> : null}
              {components.length > 0 ? (
                <div data-testid={`models-row-${item.id}-components`} style={copyStyle}>
                  Components:
                  <ul style={{ margin: "4px 0 0", paddingInlineStart: 20 }}>
                    {components.map((component) => (
                      <li key={component.id}>
                        {component.displayName}
                        {typeof component.sizeBytes === "number" ? ` (${formatBytes(component.sizeBytes)})` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </details>
          ) : null}
          {selectedMissing ? (
            <p data-testid={`models-row-${item.id}-selected-missing`} style={copyStyle}>
              Selected during setup but not found in Ollama. Retry the download, or ignore if the installer skipped this sibling.
            </p>
          ) : null}
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
          <Button
            type="button"
            testId={`models-favorite-${item.id}`}
            aria-pressed={favorite}
            aria-label={favorite ? "Unfavorite" : "Favorite"}
            onClick={onFavorite}
            variant="ghost"
            style={starStyle(favorite)}
          >
            {favorite ? "★" : "☆"}
          </Button>
          <RowActions
            item={item}
            progress={progress}
            installing={installing}
            downloaded={downloaded}
            overBudget={overBudget}
            selectedMissing={selectedMissing}
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
  selectedMissing,
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
  selectedMissing: boolean;
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
        <span
          data-testid={`models-downloaded-${item.id}`}
          style={{
            fontSize: "0.8em",
            fontWeight: 600,
            padding: "2px 8px",
            borderRadius: "999px",
            background: "color-mix(in srgb, var(--fg-muted) 12%, transparent)",
            color: "var(--fg-muted)",
          }}
        >
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
      {selectedMissing ? "Retry" : "Download"}
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
  if (!disk || disk.freeBytes === null) {
    return (
      <div data-testid="models-disk-summary" role="status" style={{ margin: 0, color: "var(--fg-muted)" }}>
        Model storage unavailable.
      </div>
    );
  }
  const modelBytes = disk.modelBytes ?? disk.usedBytes;
  const totalAvailableWithoutModels = modelBytes + disk.freeBytes;
  const percent = totalAvailableWithoutModels > 0
    ? Math.min(100, (modelBytes / totalAvailableWithoutModels) * 100)
    : 0;
  const label = `${formatBytes(modelBytes)} used by models, ${formatBytes(disk.freeBytes)} free, ${percent.toFixed(1)}% used`;
  return (
    <div
      data-testid="models-disk-summary"
      title={disk.measurementPath && disk.measuredAt ? `Measured at ${disk.measurementPath} on ${new Date(disk.measuredAt).toLocaleString()}` : undefined}
      style={{ minWidth: 320, color: "var(--fg-muted)" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: "0.82em" }}>
        <span>{formatBytes(modelBytes)} used by models</span>
        <span>{formatBytes(disk.freeBytes)} free ({percent.toFixed(1)}%)</span>
      </div>
      <progress
        aria-label="Model storage usage"
        aria-valuetext={label}
        value={modelBytes}
        max={totalAvailableWithoutModels || 1}
        style={{ width: "100%", accentColor: "var(--accent-primary, #6366f1)" }}
      />
    </div>
  );
}

function componentsFor(
  model: ListedModelDto,
  rows: readonly ListedModelDto[],
): ListedModelDto[] {
  if (!model.family) return [];
  return rows
    .filter(
      (row) =>
        !row.task &&
        (row.type === "vae" || row.type === "controlnet") &&
        row.family === model.family,
    )
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
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

function badgeStyle(kind: string): CSSProperties {
  const over = kind.startsWith("Needs ") || kind === "Incompatible";
  return {
    fontSize: "0.75em",
    padding: "2px 8px",
    borderRadius: "var(--radius-1, 4px)",
    background: over
      ? "var(--status-warn-bg, #422006)"
      : kind === "Required"
        ? "var(--accent-primary, #6366f1)"
        : kind === "Recommended"
          ? "var(--bg-2, #1f1f1f)"
          : "var(--bg-2, #1f1f1f)",
    color: over ? "var(--status-warn, #fbbf24)" : "var(--fg-0)",
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
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-4, 16px)",
  padding: "var(--space-6, 24px)",
  color: "var(--fg-0)",
  overflow: "hidden",
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
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
};

const listStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2, 8px)",
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
};

const groupHeadingStyle: CSSProperties = {
  margin: "var(--space-2, 8px) 0 0",
  color: "var(--fg-muted)",
  fontSize: "var(--text-xs, 12px)",
  fontWeight: 600,
  letterSpacing: "0.02em",
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

const pillRowStyle: CSSProperties = {
  display: "inline-flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "6px",
};

const chipStyle: CSSProperties = {
  fontSize: "0.75em",
  color: "var(--fg-muted)",
  border: "1px solid var(--border-1, #2a2a2a)",
  borderRadius: 9,
  padding: "1px 8px",
};
