/**
 * v1.16.0 Phase 5 (adoption item A4) -- compact model switcher for chat and
 * studio surfaces. Lists only installed-and-ready models for the active task
 * type (the v1.15 `installedModelsForType` rule) plus a "Get more models"
 * entry that deep-links to Settings > Models, so switching does not require a
 * full Settings round-trip.
 */

import { useEffect, useMemo } from "react";

import { ModelSelector } from "../chat/ModelSelector";
import type {
  ListedModelDto,
  ModelType,
} from "../../pages/settings/modelsTypes";
import {
  readDefaultModel,
  readModelOrder,
} from "./modelPreferences";
import { GET_MORE_MODELS_ID, installedModelsForType } from "./installedFeed";
import { catalogTabsFor, pickerOrder, type CatalogTab } from "./catalogTabs";

const EMPTY_OWNED = new Set<string>();

export interface QuickModelSwitcherProps {
  readonly models: readonly ListedModelDto[];
  readonly taskType: ModelType;
  readonly value: string;
  readonly onChange: (modelId: string) => void;
  readonly onGetMoreModels?: () => void;
  /** v2.4.6 Phase 7 -- this-install ownership set. Omit or null means empty, not every disk model. */
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
    const owned = ownedIds ?? EMPTY_OWNED;
    const tab = catalogTab ?? catalogTabForTask(taskType);
    const onTab = installedModelsForType(models, taskType, owned).filter((m) =>
      catalogTabsFor(m).includes(tab),
    );
    // v2.4.8 Phase 5 (T020): installer picker order. Catalog tier first, the
    // snapshot's recommend order as the tie-break, so a stale snapshot that
    // names an untagged model cannot push the catalog recommendation down.
    // v2.4.8 follow-up: the user's own order from Settings > Preferences
    // comes first; everything they have not placed keeps the installer order.
    return pickerOrder(onTab, {
      hostVramGB,
      ...(recommendOrder ? { recommendOrder } : {}),
      userOrder: readModelOrder(tab),
    });
  }, [models, taskType, ownedIds, catalogTab, recommendOrder, hostVramGB]);

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

  // The user's default for this category wins over the first listed row when
  // the parent is holding an id that is not installed.
  const preferred = useMemo(() => {
    const tab = catalogTab ?? catalogTabForTask(taskType);
    const chosen = readDefaultModel(tab);
    return chosen && ready.some((m) => m.id === chosen) ? chosen : ready[0]?.id;
  }, [catalogTab, taskType, ready]);

  const selectValue = ready.some((m) => m.id === value)
    ? value
    : (preferred ?? GET_MORE_MODELS_ID);

  // v2.2.4 Phase 2: never display ready[0] while parent state stays on a
  // missing id. Sync once so send uses the same id the <select> shows.
  useEffect(() => {
    if (ready.length === 0 || !preferred) return;
    if (!ready.some((m) => m.id === value)) {
      onChange(preferred);
    }
  }, [ready, value, onChange, preferred]);

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
