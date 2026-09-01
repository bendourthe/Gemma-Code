/**
 * v1.16.0 Phase 5 (adoption item A4) -- compact model switcher for chat and
 * studio surfaces. Lists only installed-and-ready models for the active task
 * type (the v1.15 `installedModelsForType` rule) plus a "Get more models"
 * entry that deep-links to Settings > Models, so switching does not require a
 * full Settings round-trip.
 */

import { useEffect, useMemo } from "react";

import { ModelSelector } from "../chat/ModelSelector";
import type { ListedModelDto, ModelType } from "../../pages/settings/modelsTypes";
import { GET_MORE_MODELS_ID, installedModelsForType } from "./installedFeed";
import {
  catalogSortGpuVendor,
  visibleModelsOnTab,
  type CatalogTab,
} from "./catalogTabs";

export interface QuickModelSwitcherProps {
  readonly models: readonly ListedModelDto[];
  readonly taskType: ModelType;
  readonly value: string;
  readonly onChange: (modelId: string) => void;
  readonly onGetMoreModels?: () => void;
  /** v2.2.4 Phase 2 -- this-install ownership set; omit to keep probe-only filtering. */
  ownedIds?: ReadonlySet<string> | null;
  disabled?: boolean;
  label?: string;
  testId?: string;
  /** v1.18.0 Phase 2 -- forwarded to ModelSelector as a small harness badge. */
  harnessLabel?: string;
  harnessSelectorEnabled?: boolean;
  /** v2.2.8 Phase 4 -- host VRAM so picker order matches Settings / installer. */
  hostVramGB?: number | null;
  /** Override tab (Agents uses agentic; default follows taskType). */
  catalogTab?: CatalogTab;
  /** Installer recommend order (required/recommended id first). */
  recommendOrder?: readonly string[];
}

function catalogTabForTask(type: ModelType): CatalogTab {
  if (type === "image") return "image";
  if (type === "video") return "video";
  if (type === "audio") return "audio";
  if (type === "document") return "document";
  return "chat";
}

export function QuickModelSwitcher({
  models,
  taskType,
  value,
  onChange,
  onGetMoreModels,
  ownedIds,
  disabled,
  label = "Model",
  testId = "quick-model-switcher",
  harnessLabel,
  harnessSelectorEnabled,
  hostVramGB = null,
  catalogTab,
  recommendOrder,
}: QuickModelSwitcherProps): JSX.Element {
  const ready = useMemo(() => {
    const installed = new Set(
      installedModelsForType(models, taskType, ownedIds).map((m) => m.id),
    );
    const tab = catalogTab ?? catalogTabForTask(taskType);
    return visibleModelsOnTab(models, tab, {
      hostVramGB,
      gpuVendor: catalogSortGpuVendor(hostVramGB),
      recommendOrder,
      defaults: new Set(recommendOrder?.slice(0, 1) ?? []),
    }).filter((m) => installed.has(m.id));
  }, [models, taskType, ownedIds, hostVramGB, catalogTab, recommendOrder]);

  const options = useMemo(
    () => [
      ...ready.map((m) => ({
        id: m.id,
        displayName: m.displayName,
      })),
      { id: GET_MORE_MODELS_ID, displayName: "+ Get more models..." },
    ],
    [ready],
  );

  function handleChange(id: string): void {
    if (id === GET_MORE_MODELS_ID) {
      onGetMoreModels?.();
      return;
    }
    onChange(id);
  }

  const selectValue = ready.some((m) => m.id === value) ? value : (ready[0]?.id ?? GET_MORE_MODELS_ID);

  // v2.2.4 Phase 2: never display ready[0] while parent state stays on a
  // missing id. Sync once so send uses the same id the <select> shows.
  useEffect(() => {
    const first = ready[0];
    if (!first) return;
    if (!ready.some((m) => m.id === value)) {
      onChange(first.id);
    }
  }, [ready, value, onChange]);

  return (
    <ModelSelector
      models={options}
      value={selectValue}
      onChange={handleChange}
      disabled={disabled}
      label={label}
      testId={testId}
      harnessLabel={harnessLabel}
      harnessSelectorEnabled={harnessSelectorEnabled}
    />
  );
}
