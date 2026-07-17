/**
 * v1.12.0 EM.P2.A -- mock Skill Optimizer client (the Settings default when no
 * sidecar client is injected). Reports no proposals so the panel renders safely
 * without a live sidecar.
 */

import type { SkillOptimizerClient } from "./SkillOptimizerSettings";

export function createMockSkillOptimizerClient(): SkillOptimizerClient {
  return {
    async preview() {
      return { token: "mock", proposals: [] };
    },
    async apply() {
      return { applied: false, skillPath: "" };
    },
  };
}
