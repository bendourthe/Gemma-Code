/**
 * v1.12.0 Phase 2 (adoption-ecosystem-2026-07 EM.P2.A) -- production Skill
 * Optimizer client over the sidecar `skills.optimize.preview` / `.apply` IPC.
 */

import { ipcCall } from "../../lib/ipc";
import type {
  SkillsOptimizePreviewResponseT,
  SkillsOptimizeApplyResponseT,
} from "../../../sidecar/src/protocol";
import type { SkillOptimizerClient } from "./SkillOptimizerSettings";

export function createIpcSkillOptimizerClient(): SkillOptimizerClient {
  return {
    async preview(skillId, opts) {
      const params: Record<string, unknown> = { skillId };
      if (opts?.model) params.model = opts.model;
      if (opts?.maxRounds) params.maxRounds = opts.maxRounds;
      const reply = await ipcCall<SkillsOptimizePreviewResponseT>("skills.optimize.preview", params);
      if (!reply.ok) throw new Error(reply.message);
      return { token: reply.value.token, proposals: reply.value.proposals };
    },
    async apply(token, proposalId) {
      const reply = await ipcCall<SkillsOptimizeApplyResponseT>("skills.optimize.apply", {
        token,
        proposalId,
      });
      if (!reply.ok) throw new Error(reply.message);
      return { applied: reply.value.applied, skillPath: reply.value.skillPath };
    },
  };
}
