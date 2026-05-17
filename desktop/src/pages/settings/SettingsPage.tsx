/**
 * v1.0.0 Phase 5.5 -- Settings shell.
 *
 * For Phase 5 the only tab is "Models" (the ModelRegistry browser). Future
 * phases will add Hardware, Skills, and About tabs alongside.
 */

import { useMemo } from "react";

import { ModelsSettings, type ModelsClient } from "./ModelsSettings";
import { createMockModelsClient } from "./mockModelsClient";

export interface SettingsPageProps {
  modelsClient?: ModelsClient;
}

export function SettingsPage({ modelsClient }: SettingsPageProps = {}): JSX.Element {
  const client = useMemo<ModelsClient>(() => modelsClient ?? createMockModelsClient(), [modelsClient]);
  return <ModelsSettings client={client} />;
}
