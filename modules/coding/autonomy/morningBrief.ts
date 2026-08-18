/**
 * v1.18.0 Phase 4 (OW-A2) -- morning-brief *content* stays on the Hub
 * `agent-presets` morning-briefing preset (Phase 1.1). This module only
 * supplies the fallback prompt the local scheduler uses when Hub files are
 * not on disk. Do not vendor a second skill.
 */

export const MORNING_BRIEF_PROMPT_SOURCE = "hub:agent-presets/morning-briefing";

export const MORNING_BRIEF_FALLBACK_PROMPT = [
  "Follow the Nexus-Hub agent-presets morning-briefing preset.",
  "Resume the last coding session, read the progress tracker, scan recent commits and session logs,",
  "and emit a short brief with prioritized next actions.",
  "Do not write or delete files unless the user later approves a parked ask.",
  "Consequential tools park in the ask inbox; never auto-approve.",
].join(" ");
