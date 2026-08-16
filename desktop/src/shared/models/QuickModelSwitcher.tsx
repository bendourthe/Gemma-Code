/**
 * v1.16.0 Phase 5 (adoption item A4) -- compact model switcher for chat and
 * studio surfaces. Lists only installed-and-ready models for the active task
 * type (the v1.15 `installedModelsForType` rule) plus a "Get more models"
 * entry that deep-links to Settings > Models, so switching does not require a
 * full Settings round-trip.
 */

import { useMemo } from "react";

import { ModelSelector } from "../chat/ModelSelector";
import type { ListedModelDto, ModelType } from "../../pages/settings/modelsTypes";
import { GET_MORE_MODELS_ID, installedModelsForType } from "./installedFeed";

export interface QuickModelSwitcherProps {
  readonly models: readonly ListedModelDto[];
  readonly taskType: ModelType;
  readonly value: string;
  readonly onChange: (modelId: string) => void;
  readonly onGetMoreModels?: () => void;
  disabled?: boolean;
  label?: string;
  testId?: string;
}

export function QuickModelSwitcher({
  models,
  taskType,
  value,
  onChange,
  onGetMoreModels,
  disabled,
  label = "Model",
  testId = "quick-model-switcher",
}: QuickModelSwitcherProps): JSX.Element {
  const ready = useMemo(
    () => installedModelsForType(models, taskType),
    [models, taskType],
  );

  const options = useMemo(
    () => [
      ...ready.map((m) => ({ id: m.id, displayName: m.displayName })),
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

  return (
    <ModelSelector
      models={options}
      value={selectValue}
      onChange={handleChange}
      disabled={disabled}
      label={label}
      testId={testId}
    />
  );
}
