/**
 * v1.12.0 Phase 2 (adoption-ecosystem-2026-07 EM.P2.A) -- the desktop approval
 * surface for the skill optimizer.
 *
 * Two-call flow over the one-shot sidecar transport: "Preview" runs the
 * optimizer with a capturing deny gate (nothing is written) and lists the
 * proposed edits; each proposal is written ONLY when the user clicks "Approve &
 * write", which applies the EXACT previewed bytes. The human approves the same
 * edit that is written -- the load-bearing guardrail. Presentational: the client
 * (the sidecar bridge) is injected so this renders + tests without Tauri.
 */

import { useCallback, useState } from "react";

export interface OptimizerProposalDto {
  readonly id: string;
  readonly skillId: string;
  readonly skillPath: string;
  readonly diff: string;
}

export interface SkillOptimizerClient {
  preview(
    skillId: string,
    opts?: { model?: string; maxRounds?: number },
  ): Promise<{ token: string; proposals: readonly OptimizerProposalDto[] }>;
  apply(token: string, proposalId: string): Promise<{ applied: boolean; skillPath: string }>;
}

type Status =
  | { readonly kind: "idle" }
  | { readonly kind: "previewing" }
  | { readonly kind: "ready" }
  | { readonly kind: "error"; readonly message: string };

export function SkillOptimizerSettings({ client }: { client: SkillOptimizerClient }): JSX.Element {
  const [skillId, setSkillId] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [proposals, setProposals] = useState<readonly OptimizerProposalDto[]>([]);
  const [applied, setApplied] = useState<ReadonlySet<string>>(new Set());
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const runPreview = useCallback(async () => {
    const id = skillId.trim();
    if (!id) return;
    setStatus({ kind: "previewing" });
    setProposals([]);
    setToken(null);
    setApplied(new Set());
    try {
      const res = await client.preview(id);
      setToken(res.token);
      setProposals(res.proposals);
      setStatus({ kind: "ready" });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, [client, skillId]);

  const approve = useCallback(
    async (proposalId: string) => {
      if (!token) return;
      try {
        await client.apply(token, proposalId);
        setApplied((prev) => new Set(prev).add(proposalId));
      } catch (err) {
        setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      }
    },
    [client, token],
  );

  return (
    <div data-testid="skill-optimizer-panel" style={{ padding: "var(--space-6, 24px)" }}>
      <h2>Skill Optimizer</h2>
      <p style={{ color: "var(--fg-muted)" }}>
        Preview proposed improvements to a skill against the golden task suite. Nothing is written
        until you approve an individual edit.
      </p>
      <div style={{ display: "flex", gap: "var(--space-2, 8px)", alignItems: "center" }}>
        <input
          data-testid="skill-optimizer-skill-id"
          aria-label="Skill id"
          placeholder="e.g. nexus-hub/code-quality"
          value={skillId}
          onChange={(e) => setSkillId(e.target.value)}
          style={{ flex: 1 }}
        />
        <button
          type="button"
          data-testid="skill-optimizer-preview"
          onClick={() => void runPreview()}
          disabled={status.kind === "previewing" || skillId.trim().length === 0}
        >
          {status.kind === "previewing" ? "Previewing..." : "Preview"}
        </button>
      </div>

      {status.kind === "error" ? (
        <p data-testid="skill-optimizer-error" role="alert" style={{ color: "var(--danger, #ef4444)" }}>
          {status.message}
        </p>
      ) : null}

      {status.kind === "ready" && proposals.length === 0 ? (
        <p data-testid="skill-optimizer-empty">No proposed edits (the skill already passes the suite).</p>
      ) : null}

      <ul data-testid="skill-optimizer-proposals" style={{ listStyle: "none", padding: 0 }}>
        {proposals.map((p) => {
          const isApplied = applied.has(p.id);
          return (
            <li key={p.id} data-testid={`skill-optimizer-proposal-${p.id}`} style={proposalStyle}>
              <div style={{ fontFamily: "monospace", fontSize: "0.85em", color: "var(--fg-muted)" }}>
                {p.skillPath}
              </div>
              <pre style={diffStyle}>{p.diff}</pre>
              <button
                type="button"
                data-testid={`skill-optimizer-approve-${p.id}`}
                onClick={() => void approve(p.id)}
                disabled={isApplied}
              >
                {isApplied ? "Written" : "Approve & write"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const proposalStyle: React.CSSProperties = {
  border: "1px solid var(--border-1, #2a2a2a)",
  borderRadius: 6,
  padding: "var(--space-3, 12px)",
  marginTop: "var(--space-3, 12px)",
};

const diffStyle: React.CSSProperties = {
  whiteSpace: "pre-wrap",
  overflowX: "auto",
  background: "var(--bg-1, #111)",
  padding: "var(--space-2, 8px)",
  borderRadius: 4,
};
