# Phase 9 -- Opt-in memory consolidation (contradiction resolver + file compressor)

**Goal**: Add two opt-in memory consolidation surfaces that route LLM calls through local Ollama only.
**Prerequisites**: Phase 5 (retrieval), Phase 6 (CLI infra).
**Stability Gate**: With `nexus.memory.consolidation.enabled=true`, a synthetic test that writes two contradicting semantic-tier rows triggers a `ContradictionResolver` adjudication via Ollama and one row is marked superseded; with the setting at its default `false`, no LLM call is made; `nexus memory compress --file <path>` calls the local Ollama model with the file content and stores a compressed semantic-tier observation referencing the file; `/memory-compress <path>` is wired.

**Adopts**: agentmemory A4 + A9 (see [comparison-agentmemory.md](../comparison-agentmemory.md) Section 11.3 P2). Both surfaces are **off by default** and route LLM calls through local Ollama only -- never cloud.

---

## Sub-tasks

### 9.1 -- `ContradictionResolver` (opt-in)

**Objective**: Detect and adjudicate contradicting semantic-tier entries.

**Prompt**:
> Add [core/memory/ContradictionResolver.ts](../../../../../core/memory/ContradictionResolver.ts) with `class ContradictionResolver { async detect(entry: MemoryEntry): Promise<ContradictionGroup[]> ; async resolve(group: ContradictionGroup): Promise<void> }`. The detector: for every new semantic-tier write, run `HybridRetriever.retrieve(entry.text, {tier: "semantic", limit: 10})` and find any retrieved entry whose semantic similarity to the new entry is high but whose textual content disagrees (use a small canned heuristic: dense-similarity > 0.85 AND BM25-overlap < 0.4 AND `text.length > 20`). The resolver: send both rows to a small local Ollama prompt (e.g. `gemma4:e4b` -- whatever is the lightest installed model with chat capability) asking which to keep + a justification; mark the loser as `superseded_by`. Register `core/memory/ContradictionResolver.ts` as an `IdleTimeScheduler` worker `memory.contradiction-sweep` on a 1-hour cadence; only runs when `nexus.memory.consolidation.enabled=true`. The Settings UI gains a "Memory consolidation (advanced)" toggle on the Memory tab. Acceptance: an integration test writes "Python uses tabs" and "Python uses 4 spaces" 30 minutes apart, enables the setting, runs the sweep, asserts one row is marked superseded with an attached `resolution_log` entry.

---

### 9.2 -- `nexus memory compress --file <path>` + `/memory-compress`

**Objective**: Summarize a long file into a structured semantic-tier observation.

**Prompt**:
> Add `nexus memory compress --file <path>` to [bin/nexus.mjs](../../../../../bin/nexus.mjs). Implementation in `core/memory/FileCompressor.ts`: read the file, chunk to ~2,000-token chunks, embed each, run a local Ollama prompt that extracts {summary, key_facts[], code_patterns[]}, store the result as a semantic-tier entry with `provenance.toolName = "memory.compress"`, the file path embedded in `metadata.sourcePath`, and a back-reference link in the graph layer to the original file. Add `/memory-compress <path>` slash command that wraps the same code. Gated by `nexus.memory.compression.enabled=true` (default off). Acceptance: an integration test compresses a 1,000-line fixture file and asserts a single semantic-tier row appears with the expected provenance.

---

### 9.3 -- Phase 9 lint, build, test gate

**Objective**: Verify the consolidation surfaces are CI-green and off-by-default.

**Prompt**:
> Re-run the four-step gate. Acceptance: 0 failures; both Settings keys default to `false`; with both off, no LLM call is made (verified by mock Ollama client recording zero invocations).
