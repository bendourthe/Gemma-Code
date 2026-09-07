/**
 * v2.2.4 Phase 5 -- Settings > Models.
 *
 * Installer-parity catalog: Chat / Agentic / Image / Video / Audio / Document
 * tabs, compact rows (name, requirements, capabilities, one description),
 * Download vs a highlighted Downloaded state, hardware gating, and one
 * Favorite star per tab. Search stays as a secondary filter. Unknown tasks
 * land in Other so a row is never dropped. v2.4.6 Phase 6 drops the Details
 * accordion: star, downloaded, and delete sit on one centered row. The
 * installer Qt wizard is not iframed. v2.4.2 Phase 5 drops the catalog
 * fingerprint from the header and tightens page and card spacing so more
 * rows fit.
 */

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties } from "react";
import { CircleCheck, Download, Trash2 } from "lucide-react";
import { modelAvailabilityBucket } from "../../../../core/registry/modelDisplayPolicy";
import { Button, SearchInput } from "../../components/ui";
import { SidecarDownBanner } from "../../components/SidecarDownBanner";
import {
  isBackendDownMessage,
  useSidecarStatus,
} from "../../lib/sidecarStatus";

import {
  CATALOG_TAB_DEFS,
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
  BADGE_DOWNLOADED,
  BADGE_RECOMMENDED,
  providerColor,
  providerTint,
} from "../../shared/models/providerColors";
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

const TASK_TABS: readonly TaskKey[] = [
  "chat",
  "agentic",
  "image",
  "video",
  "audio",
  "document",
];

function isTaskKey(tab: CatalogTab): tab is TaskKey {
  return (TASK_TABS as readonly string[]).includes(tab);
}

export function ModelsSettings({
  client,
  hostVramGB = null,
  gpuVendor = null,
}: ModelsSettingsProps): JSX.Element {
  const [items, setItems] = useState<readonly ListedModelDto[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<CatalogTab>("chat");
  const [query, setQuery] = useState<string>("");
  const [progress, setProgress] = useState<Record<string, InstallProgressDto>>(
    {},
  );
  const [active, setActive] = useState<Record<string, InstallHandle>>({});
  const [disk, setDisk] = useState<DiskUsageDto | null>(null);
  const diskRequest = useRef(0);
  const [favorites, setFavorites] = useState<
    Partial<Record<string, string | null>>
  >(() => {
    const next: Partial<Record<string, string | null>> = {};
    for (const t of TASK_TABS) next[t] = readFavorite(t);
    for (const extra of ["embeddings", "other"] as const) {
      try {
        next[extra] = window.localStorage.getItem(
          `${FAVORITE_STORAGE_PREFIX}${extra}`,
        );
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
  const tabDefs =
    external.length > 0
      ? [
          ...CATALOG_TAB_DEFS,
          { id: "other" as const, label: "Installed outside catalog" },
        ]
      : CATALOG_TAB_DEFS;
  const visible =
    tab === "other"
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
  const showAvailabilityHeadings =
    tab !== "other" && availabilityBuckets.size > 1;

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
      <div data-testid="models-chrome" style={chromeStyle}>
        <header style={headerStyle}>
          <div>
            <h1 style={{ margin: 0 }}>Models</h1>
          </div>
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
        ) : error ? (
          <div
            role="alert"
            aria-live="polite"
            style={{ color: "var(--accent-warning, #d97706)" }}
          >
            {error}
          </div>
        ) : (
          <div
            role="status"
            aria-live="polite"
            data-testid="models-status"
            style={visuallyHiddenStyle}
          />
        )}

        {/*
        v2.4.4 Phase 6.1 (T023): tabs and search share one row. Search used to
        be a sibling below the chrome, which spent a whole row on a single
        field and pushed the first card off the fold.
      */}
        <div style={tabRowStyle}>
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
          <label style={searchLabelStyle}>
            {/* Hidden, not removed: the field keeps its accessible name. */}
            <span style={visuallyHiddenStyle}>Search</span>
            <SearchInput
              testId="models-search"
              value={query}
              onChange={setQuery}
              placeholder="Search by name, type, or id"
              label="Search models"
            />
          </label>
        </div>
      </div>

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
                const previous =
                  index > 0
                    ? modelAvailabilityBucket(
                        visible[index - 1]!,
                        availabilityOptions,
                      )
                    : null;
                return (
                  <Fragment key={m.id}>
                    {showAvailabilityHeadings && bucket !== previous ? (
                      <li
                        data-testid={`models-group-${bucket}`}
                        style={groupHeadingStyle}
                      >
                        {bucket === 0
                          ? "Downloaded"
                          : bucket === 1
                            ? "Available to download"
                            : "Incompatible"}
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
                      onRemove={
                        m.source === "registry"
                          ? () => void handleRemove(m.id)
                          : undefined
                      }
                      onReveal={
                        m.absPath && client.reveal
                          ? () => client.reveal?.(m.absPath as string)
                          : undefined
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

/**
 * v2.4.8 Phase 4 (T016) -- the installer card grammar, drawn in Settings.
 *
 * Operator screenshot 4 (2026-09-06): Settings cards were neutral boxes with a
 * `Requirements:` row while the installer picker tints each card with its
 * publisher's color, sets the name in that color, puts every fact pill on the
 * name row with a steelblue Recommended pill, hangs a size pill plus round
 * compatibility and downloaded badges on the right, then prints description,
 * `Best for:`, the license note, and `Why this one:`. This mirrors
 * `nexus_installer.pages.typed_catalog.ModelCard` one element at a time. The
 * action row (star, download / delete) stays because this card can act and the
 * installer card cannot. It reverses the v2.4.6 Phase 6 decision to drop
 * `Best for` and `Why this one` from Settings: parity with the installer is
 * the operator's stated requirement.
 */
function Pill({
  text,
  color = "var(--fg-muted)",
  border = "var(--border-strong, #272a30)",
  testId,
}: {
  text: string;
  color?: string;
  border?: string;
  testId?: string;
}): JSX.Element {
  return (
    <span
      data-testid={testId}
      style={{ ...chipStyle, color, borderColor: border }}
    >
      {text}
    </span>
  );
}

/** A round filled icon badge whose meaning lives on the tooltip (installer `_icon_badge`). */
function IconBadge({
  glyph,
  color,
  tooltip,
  testId,
}: {
  glyph: string;
  color: string;
  tooltip: string;
  testId: string;
}): JSX.Element {
  return (
    <span
      data-testid={testId}
      role="img"
      aria-label={tooltip}
      title={tooltip}
      style={{
        display: "inline-flex",
        width: ICON_BADGE_PX,
        height: ICON_BADGE_PX,
        borderRadius: ICON_BADGE_PX / 2,
        alignItems: "center",
        justifyContent: "center",
        color,
        background: providerTint(color, 0.18),
        border: `1px solid ${color}`,
        fontSize: "var(--text-xs, 12px)",
        fontWeight: 700,
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      {glyph}
    </span>
  );
}

const ICON_BADGE_PX = 22;

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
  const overBudget = isCatalogOverBudget(
    item,
    hostVramGB,
    gpuVendor ?? catalogSortGpuVendor(hostVramGB),
  );
  const fits = !overBudget;
  const accent = providerColor(item.family);
  const downloaded = item.installed && item.source !== "catalog-only";
  const selectedMissing = Boolean(item.selectedAtInstall) && !downloaded;
  const description =
    item.description?.trim() ||
    "Catalog metadata is unavailable for this installed model.";
  // Installer `compatibility_badge` wording; the text lives on the tooltip.
  const compatibility =
    typeof item.vramGB === "number" && item.vramGB > 0
      ? overBudget
        ? `Incompatible - needs ${item.vramGB} GB VRAM`
        : `Compatible - ${item.vramGB} GB VRAM`
      : "Compatible - CPU";
  const sizeLabel =
    typeof item.sizeBytes === "number" ? formatBytes(item.sizeBytes) : null;
  const titleColor = fits ? accent : "var(--fg-muted)";
  const mutedBorder = "var(--border-strong, #272a30)";
  const card: CSSProperties = {
    ...cardStyle,
    background: providerTint(accent, fits ? 0.09 : 0.04),
    border: fits
      ? `1px solid ${providerTint(accent, 0.3)}`
      : `1px dashed ${mutedBorder}`,
    ...(overBudget ? { color: "var(--fg-muted)" } : null),
  };
  return (
    <li
      data-testid={`models-row-${item.id}`}
      data-compact="true"
      data-downloaded={downloaded ? "true" : "false"}
      data-over-budget={overBudget ? "true" : "false"}
      data-provider-color={accent}
      style={card}
    >
      {/* --- Title row: name + fact pills (flow) | size, compatibility, downloaded --- */}
      <div
        data-testid={`models-title-row-${item.id}`}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "var(--space-2, 8px)",
          minWidth: 0,
        }}
      >
        <div
          data-testid={`models-header-${item.id}`}
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span style={{ fontWeight: 700, color: titleColor }}>
            {item.displayName}
          </span>
          <span data-testid={`models-pills-${item.id}`} style={pillRowStyle}>
            {buildModelPills(item).map((pill) => (
              <Pill key={pill} text={pill} />
            ))}
          </span>
          {tier === "required" ? (
            <Pill
              testId={`models-badge-${item.id}`}
              text="Required"
              color={accent}
              border={accent}
            />
          ) : tier === "recommended" ? (
            <Pill
              testId={`models-badge-${item.id}`}
              text="Recommended"
              color={BADGE_RECOMMENDED}
              border={BADGE_RECOMMENDED}
            />
          ) : null}
          {item.toolCallingVerified ? (
            <Pill
              testId={`models-tool-calling-${item.id}`}
              text="Tool calling verified"
              color={accent}
              border={accent}
            />
          ) : null}
        </div>
        <div
          data-testid={`models-badges-${item.id}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2, 8px)",
            flexShrink: 0,
          }}
        >
          {sizeLabel ? (
            <Pill
              testId={`models-size-${item.id}`}
              text={sizeLabel}
              color={fits ? accent : "var(--fg-muted)"}
              border={fits ? accent : mutedBorder}
            />
          ) : null}
          <IconBadge
            testId={`models-compat-badge-${item.id}`}
            glyph={fits ? "✓" : "!"}
            color={fits ? STATUS_OK : STATUS_WARN}
            tooltip={compatibility}
          />
          {downloaded ? (
            <IconBadge
              testId={`models-downloaded-badge-${item.id}`}
              glyph={"⤓"}
              color={BADGE_DOWNLOADED}
              tooltip="Downloaded"
            />
          ) : null}
        </div>
      </div>
      {/* --- Incompatibility note (only when the model does not fit) --- */}
      {!fits ? (
        <p
          data-testid={`models-row-${item.id}-incompatible`}
          style={{ ...captionStyle, color: STATUS_WARN }}
        >
          {compatibility}
        </p>
      ) : null}
      {/* --- Plain-language description leads the body --- */}
      <p
        data-testid={`models-row-${item.id}-description`}
        style={{
          ...copyStyle,
          minWidth: 0,
          color: fits ? "var(--fg-1, var(--fg-0))" : "var(--fg-muted)",
        }}
      >
        {description}
      </p>
      {item.strengths && item.strengths.length > 0 ? (
        <p data-testid={`models-row-${item.id}-best-for`} style={captionStyle}>
          <span style={{ color: accent, fontWeight: 600 }}>Best for:</span>{" "}
          {item.strengths.join(", ")}
        </p>
      ) : null}
      {item.licenseNote ? (
        <p
          data-testid={`models-row-${item.id}-license-note`}
          style={captionStyle}
        >
          <span style={{ color: accent, fontWeight: 600 }}>
            Use restriction:
          </span>{" "}
          {item.licenseNote}
          {item.licenseUrl ? (
            <>
              {" "}
              <a
                href={item.licenseUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: accent }}
              >
                License text
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      {tier === "recommended" && item.whyRecommended ? (
        <p
          data-testid={`models-row-${item.id}-why`}
          style={{ ...captionStyle, color: accent }}
        >
          Why this one: {item.whyRecommended}
        </p>
      ) : null}
      {/*
        v2.4.6 Phase 6: star, downloaded, and delete share one centered
        row under the body. The installer card has no actions; this one does.
      */}
      <div
        data-testid={`models-actions-${item.id}`}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--space-2, 8px)",
        }}
      >
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
      {components.length > 0 ? (
        <p data-testid={`models-row-${item.id}-components`} style={copyStyle}>
          Components:{" "}
          {components
            .map((component) =>
              typeof component.sizeBytes === "number"
                ? `${component.displayName} (${formatBytes(component.sizeBytes)})`
                : component.displayName,
            )
            .join("; ")}
        </p>
      ) : null}
      {selectedMissing ? (
        <p
          data-testid={`models-row-${item.id}-selected-missing`}
          style={copyStyle}
        >
          Selected during setup but not found in Ollama. Retry the download, or
          ignore if the installer skipped this sibling.
        </p>
      ) : null}
      {rowError ? (
        <p
          data-testid={`models-row-error-${item.id}`}
          role="alert"
          style={{
            color: "var(--status-err, #dc2626)",
            fontSize: "var(--text-xs, 12px)",
          }}
        >
          {rowError}
        </p>
      ) : null}
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2, 8px)",
        }}
      >
        <progress
          data-testid={`models-progress-${item.id}`}
          value={progress.bytes}
          max={total || undefined}
        />
        <span
          data-testid={`models-progress-text-${item.id}`}
          style={{ fontSize: "0.85em", color: "var(--fg-muted)" }}
        >
          {formatBytes(progress.bytes)}
          {total > 0 ? ` / ${formatBytes(total)} (${pct.toFixed(0)}%)` : ""}
        </span>
        <Button
          type="button"
          testId={`models-cancel-${item.id}`}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    );
  }
  if (onReveal && item.source === "external") {
    return (
      <Button
        type="button"
        testId={`models-reveal-${item.id}`}
        onClick={onReveal}
      >
        Reveal
      </Button>
    );
  }
  if (downloaded) {
    return (
      <div
        style={{
          display: "flex",
          gap: "var(--space-2, 8px)",
          alignItems: "center",
        }}
      >
        <span
          data-testid={`models-downloaded-${item.id}`}
          aria-label="Downloaded"
          style={{
            display: "inline-flex",
            color: MODELS_DOWNLOADED_COLOR,
          }}
        >
          <CircleCheck size={16} aria-hidden="true" />
          <span style={visuallyHiddenStyle}>Downloaded</span>
        </span>
        {onRemove ? (
          <Button
            type="button"
            testId={`models-remove-${item.id}`}
            aria-label="Remove"
            variant="ghost"
            onClick={onRemove}
            style={{
              color: MODELS_REMOVE_COLOR,
              padding: 4,
              minWidth: 0,
            }}
          >
            <Trash2 size={16} aria-hidden="true" />
            <span style={visuallyHiddenStyle}>Remove</span>
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
  const installLabel = selectedMissing ? "Retry" : "Download";
  return (
    <Button
      type="button"
      testId={`models-install-${item.id}`}
      aria-label={installLabel}
      onClick={onInstall}
      variant="ghost"
      style={{
        color: MODELS_DOWNLOAD_COLOR,
        padding: 4,
        minWidth: 0,
      }}
    >
      <Download size={16} aria-hidden="true" />
      <span style={visuallyHiddenStyle}>{installLabel}</span>
    </Button>
  );
}

function DiskSummary({ disk }: { disk: DiskUsageDto | null }): JSX.Element {
  if (!disk || disk.freeBytes === null) {
    return (
      <div
        data-testid="models-disk-summary"
        role="status"
        style={{ margin: 0, color: "var(--fg-muted)" }}
      >
        Model storage unavailable.
      </div>
    );
  }
  const modelBytes = disk.modelBytes ?? disk.usedBytes;
  const totalAvailableWithoutModels = modelBytes + disk.freeBytes;
  const percent =
    totalAvailableWithoutModels > 0
      ? Math.min(100, (modelBytes / totalAvailableWithoutModels) * 100)
      : 0;
  const label = `${formatBytes(modelBytes)} used by models, ${formatBytes(disk.freeBytes)} free, ${percent.toFixed(1)}% used`;
  return (
    <div
      data-testid="models-disk-summary"
      title={
        disk.measurementPath && disk.measuredAt
          ? `Measured at ${disk.measurementPath} on ${new Date(disk.measuredAt).toLocaleString()}`
          : undefined
      }
      style={{ minWidth: 320, color: "var(--fg-muted)" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          fontSize: "0.82em",
        }}
      >
        <span>{formatBytes(modelBytes)} used by models</span>
        <span>
          {formatBytes(disk.freeBytes)} free ({percent.toFixed(1)}%)
        </span>
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

export const MODELS_PAGE_GAP = "var(--space-3, 12px)";
export const MODELS_HEADER_TO_TABS_GAP = "var(--space-1, 4px)";
/** v2.4.8 Phase 4: installer card margins (14 px sides, 10 px top and bottom). */
export const MODELS_CARD_PADDING = "10px 14px";
export const MODELS_CARD_INNER_GAP = "var(--space-2, 8px)";
export const MODELS_DOWNLOADED_COLOR = "rgb(74, 222, 128)";
export const MODELS_REMOVE_COLOR = "rgb(248, 113, 113)";
export const MODELS_DOWNLOAD_COLOR = "rgb(96, 165, 250)";

const pageStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  gap: MODELS_PAGE_GAP,
  padding: "var(--space-4, 16px)",
  color: "var(--fg-0)",
  overflow: "hidden",
  position: "relative",
};

const chromeStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: MODELS_HEADER_TO_TABS_GAP,
};

const visuallyHiddenStyle: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: "var(--space-3, 12px)",
};

const tabListStyle: CSSProperties = {
  display: "flex",
  gap: "var(--space-1, 4px)",
  flexWrap: "wrap",
};

/**
 * v2.4.4 Phase 6.1 (T023): tabs left, search right, on one line. Wrapping is
 * allowed so a narrow Settings pane drops search below the tabs rather than
 * forcing the page to scroll sideways.
 */
const tabRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-2, 8px)",
};

const searchLabelStyle: CSSProperties = {
  display: "block",
  flex: "1 1 14rem",
  minWidth: "10rem",
  maxWidth: "22rem",
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
  padding: MODELS_CARD_PADDING,
  borderRadius: 8,
  display: "flex",
  flexDirection: "column",
  gap: 6,
  minWidth: 0,
};

/** Installer `TEXT_BODY` at `FS_BODY`: the description line. */
const copyStyle: CSSProperties = {
  margin: 0,
  fontSize: "var(--text-sm, 14px)",
  lineHeight: 1.35,
  color: "var(--fg-1, var(--fg-0))",
};

/** Installer `FS_CAPTION`: Best for, license note, Why this one, notes. */
const captionStyle: CSSProperties = {
  margin: 0,
  fontSize: "var(--text-xs, 12px)",
  lineHeight: 1.35,
  color: "var(--fg-1, var(--fg-0))",
};

const pillRowStyle: CSSProperties = {
  display: "inline-flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 6,
  minWidth: 0,
};

/** Installer `_pill`: one-color chip, 9 px radius, 1 px 8 px padding. */
const chipStyle: CSSProperties = {
  fontSize: "var(--text-xs, 12px)",
  lineHeight: 1.4,
  color: "var(--fg-muted)",
  background: "transparent",
  border: "1px solid var(--border-strong, #272a30)",
  borderRadius: 9,
  padding: "1px 8px",
  whiteSpace: "nowrap",
};

/** Installer `SUCCESS` / `WARNING` for the compatibility badge. */
const STATUS_OK = "var(--status-ok, #22c55e)";
const STATUS_WARN = "var(--status-warn, #f59e0b)";
