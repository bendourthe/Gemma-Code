/**
 * v1.0.0 Phase 10.3 -- Prompt-injection scanner.
 *
 * Pattern-based scanner that runs on every SKILL.md (and every bundled
 * script) before the skill is activated. The scanner is intentionally
 * conservative and offline: a small handcrafted ruleset is enough to
 * catch the obvious "jailbreak / exfil / authoring tool calls in
 * SKILL.md" patterns without pulling in an LLM at activation time.
 *
 * Findings are categorized `high` / `medium` / `low`:
 *   - `high`   blocks activation. The catalog marks the skill as
 *              quarantined and the SkillsSettings UI surfaces a manual
 *              "Review and approve" override.
 *   - `medium` logs to the trace dashboard but allows activation.
 *   - `low`    logs only.
 *
 * The scanner exposes:
 *   - `scanText(content, source)` for a single text blob.
 *   - `scanBundle(files)` for a directory's worth of files.
 *
 * Both return `ScanResult` with the highest-severity finding bubbled up
 * via `decision` (`block` | `warn` | `pass`). Callers do not need to
 * re-implement severity collation.
 */

export type Severity = "high" | "medium" | "low";

export type ScanDecision = "block" | "warn" | "pass";

export interface InjectionFinding {
  readonly ruleId: string;
  readonly severity: Severity;
  readonly message: string;
  readonly source: string;
  /** 1-based line number of the first match. */
  readonly line: number;
  /** Excerpt of the offending line, truncated to 200 chars. */
  readonly excerpt: string;
}

export interface ScanResult {
  readonly decision: ScanDecision;
  readonly findings: readonly InjectionFinding[];
}

export interface ScannedFile {
  readonly path: string;
  readonly content: string;
}

interface Rule {
  readonly id: string;
  readonly severity: Severity;
  readonly pattern: RegExp;
  readonly message: string;
}

/**
 * Built-in pattern set. Each rule is a single case-insensitive regex; the
 * scanner walks the content line-by-line so the line number is precise.
 *
 * The patterns split into four buckets:
 *   (a) jailbreak prompt templates -- `ignore previous instructions`,
 *       `disregard your training`, `you are now`, role-injection markers.
 *   (b) safety / guardrail disablement.
 *   (c) credential-exfil patterns: paths under `.aws/`, `.ssh/`, and the
 *       common "POST /env" / "dump .env" idioms.
 *   (d) outbound exfil targets known to be used by injection payloads.
 *
 * A fifth rule flags `<|tool_call>` / `<|im_start|>` style chat tags that
 * appear *in the body* of a SKILL.md (a clean SKILL.md never authors
 * tool-call tokens directly).
 */
const RULES: readonly Rule[] = [
  // (a) Jailbreak templates
  {
    id: "injection.jailbreak.ignore-previous",
    severity: "high",
    pattern: /ignore\s+(?:all\s+|the\s+)?previous\s+instructions/i,
    message: "Skill text attempts to override prior instructions",
  },
  {
    id: "injection.jailbreak.disregard-training",
    severity: "high",
    pattern: /disregard\s+your\s+training/i,
    message: "Skill text attempts to bypass model training",
  },
  {
    id: "injection.jailbreak.you-are-now",
    severity: "medium",
    pattern: /\byou\s+are\s+now\s+(?:a\s+)?[a-z]/i,
    message: "Skill text attempts to redefine the assistant's persona",
  },
  {
    id: "injection.jailbreak.system-role-prefix",
    severity: "medium",
    pattern: /^\s*system\s*:\s*/im,
    message: "Skill body contains a fake 'system:' role prefix",
  },
  {
    id: "injection.jailbreak.chat-tag",
    severity: "high",
    pattern: /<\|im_start\|>|<\|im_end\|>/,
    message: "Skill body embeds raw chat-template control tokens",
  },

  // (b) Safety/guardrail disablement
  {
    id: "injection.safety.disable",
    severity: "high",
    pattern: /\bdisable\s+(?:safety|guardrails?|filters?)\b/i,
    message: "Skill text instructs the assistant to disable safety mechanisms",
  },
  {
    id: "injection.safety.bypass",
    severity: "high",
    pattern: /\bbypass\s+(?:safety|guardrails?|filters?)\b/i,
    message: "Skill text instructs the assistant to bypass guardrails",
  },

  // (c) Credential-exfil
  {
    id: "injection.exfil.dotenv",
    severity: "high",
    pattern: /\bdump\s+\.env\b|\bcat\s+\.env\b|\bPOST\s+\/env\b/i,
    message: "Skill text references .env exfiltration",
  },
  {
    id: "injection.exfil.aws-creds",
    severity: "high",
    pattern: /(?:~\/\.aws\/credentials|\.aws[\\\/]credentials)/i,
    message: "Skill text references AWS credentials path",
  },
  {
    id: "injection.exfil.ssh-keys",
    severity: "high",
    pattern: /(?:~\/\.ssh\/id_[a-z0-9_]+|\.ssh[\\\/]id_[a-z0-9_]+)/i,
    message: "Skill text references SSH private-key path",
  },

  // (d) Exfil URL targets
  {
    id: "injection.exfil.url-target",
    severity: "high",
    pattern: /https?:\/\/(?:[A-Za-z0-9.\-]+\.)?(?:beeceptor\.com|webhook\.site|requestbin\.io|burpcollaborator\.net)/i,
    message: "Skill text references a known data-exfiltration endpoint",
  },

  // (e) Authoring tool-call tags in skill body
  {
    id: "injection.toolcall.tag",
    severity: "high",
    pattern: /<\|tool_call\|>|<tool_call>/i,
    message: "Skill body authors tool-call tokens directly",
  },
];

export class PromptInjectionScanner {
  private readonly _rules: readonly Rule[];

  /** Optional custom rule set for tests; defaults to the built-in `RULES`. */
  constructor(rules: readonly Rule[] = RULES) {
    this._rules = rules;
  }

  scanText(content: string, source: string): ScanResult {
    const findings: InjectionFinding[] = [];
    const lines = content.split(/\r?\n/);
    for (const rule of this._rules) {
      // First-match-per-rule keeps findings list manageable. A single
      // jailbreak phrase appearing twice in one SKILL.md is still one
      // finding for the purposes of the activation decision.
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (rule.pattern.test(line)) {
          findings.push({
            ruleId: rule.id,
            severity: rule.severity,
            message: rule.message,
            source,
            line: i + 1,
            excerpt: truncate(line.trim(), 200),
          });
          break;
        }
      }
    }
    return { decision: decisionFor(findings), findings };
  }

  scanBundle(files: readonly ScannedFile[]): ScanResult {
    const all: InjectionFinding[] = [];
    for (const file of files) {
      const result = this.scanText(file.content, file.path);
      all.push(...result.findings);
    }
    return { decision: decisionFor(all), findings: all };
  }
}

function decisionFor(findings: readonly InjectionFinding[]): ScanDecision {
  if (findings.some((f) => f.severity === "high")) return "block";
  if (findings.some((f) => f.severity === "medium")) return "warn";
  return "pass";
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}...`;
}

/** Exported for tests. */
export const BUILTIN_INJECTION_RULES = RULES;
