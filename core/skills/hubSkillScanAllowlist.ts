/**
 * v1.7.0 (Hub v3.10.0 adoption, gap HUB310.SCAN) -- reviewed injection-scan
 * allowlist for the trusted Nexus-Hub sync source.
 *
 * The `PromptInjectionScanner` is (correctly) fail-closed and conservative, so
 * it flags security-education / config-example content in the Hub's own curated
 * skills -- a "prompt-injection-defense" skill naturally contains the string
 * "ignore previous instructions", a PowerShell skill shows an `~/.ssh/id_rsa`
 * remoting example, a Backstage descriptor has a `system:` field, etc. The Hub's
 * own `skill-security-scan` skill documents exactly this: a producer catalog
 * whose job is to teach security has a high benign-match rate.
 *
 * This allowlist waives those specific, reviewed (skill, rule) matches so a live
 * `nexus skills sync` of the pinned+released Hub is not permanently blocked. It
 * is DELIBERATELY NARROW:
 *   - each entry waives exactly ONE rule for ONE skill (a new / different
 *     injection pattern in an allowlisted skill still blocks),
 *   - it is applied ONLY to the trusted `nexus-hub` sync source
 *     (`NexusHubSyncer`); untrusted third-party `nexus skills install` imports
 *     keep the fully-strict scanner (`SkillInstaller` passes no suppressions).
 *
 * Every entry was reviewed against the Hub v3.10.0 checkout by reading the
 * flagged line in context; the `reason` records that adjudication. Re-review
 * when bumping the pinned Hub release.
 */

import type { ScanSuppression } from "./PromptInjectionScanner.js";

export const HUB_SKILL_SCAN_ALLOWLIST: readonly ScanSuppression[] = Object.freeze([
  {
    source: "ai-development/claude-agent-sdk/SKILL.md",
    ruleId: "injection.jailbreak.system-role-prefix",
    reason: "TypeScript API-call example -- an object property `system: this.config.systemPrompt`, not a chat role prefix.",
  },
  {
    source: "compliance/ai-agent-governance/SKILL.md",
    ruleId: "injection.jailbreak.ignore-previous",
    reason: "Python injection-DETECTION pattern list (`r\"ignore previous instructions\"`) -- teaches how to detect the attack.",
  },
  {
    source: "infrastructure/platform-engineer/SKILL.md",
    ruleId: "injection.jailbreak.system-role-prefix",
    reason: "Backstage catalog YAML field `system: billing-platform`, not a chat role prefix.",
  },
  {
    source: "language-specialists/powershell-expert/SKILL.md",
    ruleId: "injection.exfil.ssh-keys",
    reason: "Legitimate SSH remoting example -- `New-PSSession -KeyFilePath \"~/.ssh/id_rsa\"`, not credential exfiltration.",
  },
  {
    source: "security/ai-attack-patterns/SKILL.md",
    ruleId: "injection.jailbreak.ignore-previous",
    reason: "Fenced EXAMPLE attack payload in a security skill that teaches recognition of prompt injection.",
  },
  {
    source: "security/ai-attack-patterns/SKILL.md",
    ruleId: "injection.jailbreak.you-are-now",
    reason: "Fenced EXAMPLE attack payload (\"You are now in maintenance mode ...\") in the same security skill.",
  },
  {
    source: "security/prompt-injection-defense/SKILL.md",
    ruleId: "injection.jailbreak.ignore-previous",
    reason: "Describes the `\"Ignore previous instructions\"` pattern as the thing to defend against (security education).",
  },
  {
    source: "security/skill-security-scan/SKILL.md",
    ruleId: "injection.jailbreak.ignore-previous",
    reason: "Meta-documentation on scanning that names the string as a benign producer-catalog example.",
  },
  {
    source: "workflow/skill-eval-loop/SKILL.md",
    ruleId: "injection.jailbreak.you-are-now",
    reason: "Workflow prose illustrating an imperative-shift example, not an instruction to the assistant.",
  },
]);
