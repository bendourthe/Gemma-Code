// dependency-cruiser configuration for Gemma Code v0.5.0
//
// Module-boundary rules codified from ARCHITECTURE.md. Run via:
//   npm run deps:check   (validates rules)
//   npm run deps:graph   (renders SVG dependency graph)
//
// Forbidden edges are mirrored in the mermaid module-dependency diagram in
// ARCHITECTURE.md so the rules and the diagram stay in sync.
//
// BASELINE EXCEPTIONS (introduced 2026-04-25; ratchet target v0.6.0):
// Several pre-existing edges violate the long-term boundary rules. They are
// grandfathered here so the rule is enforced for *new* code while existing
// regressions are tracked for fix-up. Each exception names the specific
// source files; do not broaden the patterns. The list shrinks over time.

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-llm-outside-llm-folder',
      severity: 'error',
      comment:
        'Only files under src/llm/ may import the concrete Ollama clients. ' +
        'Other modules must consume the port in src/llm/types.ts. The ' +
        'composition root (`src/runtime/GemmaRuntime.ts`) constructs the ' +
        'concrete client via `createOllamaClient` and threads the port to ' +
        'every consumer.',
      from: {
        pathNot: [
          '^src/llm/',
          '^src/runtime/GemmaRuntime\\.ts$',
        ],
      },
      to: { path: '^src/llm/(?:OllamaClient|OllamaHttp)\\.ts$' },
    },
    {
      name: 'no-panels-from-tools',
      severity: 'error',
      comment:
        'Tool handlers must not depend on the webview/panel layer. ' +
        'Panels consume tool results via the runtime, not vice-versa.',
      from: { path: '^src/tools/' },
      to: { path: '^src/panels/' },
    },
    {
      name: 'no-tools-from-storage',
      severity: 'error',
      comment:
        'Storage modules must not depend on tool handlers. Storage is a ' +
        'foundation layer; tools sit on top of it.',
      from: { path: '^src/storage/' },
      to: { path: '^src/tools/' },
    },
    {
      name: 'no-storage-from-panels',
      severity: 'error',
      comment:
        'Panels must not import storage directly; route through ' +
        'src/panels/messages.ts so the webview sandbox cannot bypass guardrails. ' +
        'After Phase 6 of the v0.6.0 cycle (panel decomposition), the chat ' +
        'panel was split into GemmaCodePanel (lifecycle), ChatController (chat ' +
        'flow + memory injection), ChatCommandHandlers (slash dispatch), and ' +
        'ChatWebviewHost (postMessage routing). The first three still hold ' +
        'storage references because they own session/memory state; they are ' +
        'whitelisted here. SessionListPanel and TraceDashboardPanel run ' +
        'real-time reads against ChatHistoryStore and ToolOutputCache ' +
        'respectively. The long-term port redesign (storage behind messages.ts ' +
        'only) is tracked as v0.7.0 follow-up work.',
      from: {
        path: '^src/panels/',
        pathNot: [
          '^src/panels/messages\\.ts$',
          '^src/panels/GemmaCodePanel\\.ts$',
          '^src/panels/ChatController\\.ts$',
          '^src/panels/ChatCommandHandlers\\.ts$',
          '^src/panels/SessionListPanel\\.ts$',
          '^src/panels/TraceDashboardPanel\\.ts$',
        ],
      },
      to: { path: '^src/storage/' },
    },
    {
      name: 'no-circular',
      severity: 'warn',
      comment:
        'Circular dependencies make the dependency graph unstable and slow ' +
        'incremental compilation. Two pre-existing cycles are downgraded to ' +
        'warnings (BASELINE-2026-04-25) until they can be untangled in v0.6.0: ' +
        '(1) MemoryLayers.types <-> MemoryStore.types (legitimate type co-recursion); ' +
        '(2) SubAgentManager <-> AgentLoop (sub-agent spawning needs the loop ' +
        'and the loop reports to the manager).',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment:
        'Orphans (modules nothing else depends on) are usually dead code. ' +
        'Allow tests, declarations, generated files, and config files.',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)\\.[^/]+\\.(?:js|cjs|mjs|ts|json)$',
          '\\.d\\.ts$',
          '(^|/)tsconfig\\.json$',
          '(^|/)(?:babel|webpack)\\.config\\.(?:js|cjs|mjs|ts|json)$',
          'src/extension\\.ts$',
          '\\.gitkeep$',
          '\\.generated\\.ts$',
        ],
      },
      to: {},
    },
    {
      name: 'no-deprecated-core',
      severity: 'warn',
      comment:
        'Several Node core modules have a less-deprecated counterpart; use that.',
      from: {},
      to: {
        dependencyTypes: ['core'],
        path: ['^(punycode|domain|constants|sys|_linklist|_stream_wrap)$'],
      },
    },
    {
      name: 'not-to-deprecated',
      severity: 'warn',
      comment:
        'This module depends on an npm package version flagged "Deprecated".',
      from: {},
      to: { dependencyTypes: ['deprecated'] },
    },
    {
      name: 'no-non-package-json',
      severity: 'error',
      comment:
        'npm packages must be declared in package.json (likely a typo or ' +
        'forgotten dependency).',
      from: {},
      to: {
        dependencyTypes: [
          'npm-no-pkg',
          'npm-unknown',
        ],
      },
    },
  ],

  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    exclude: {
      path: [
        '\\.test\\.(?:ts|js|mjs|cjs)$',
        '\\.bench\\.(?:ts|js|mjs|cjs)$',
        '^tests/',
        '^out/',
        '^node_modules/',
        '^scripts/hooks/',
        '^configs/',
        '^docs/',
      ],
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
    reporterOptions: {
      dot: {
        collapsePattern: '^src/[^/]+/',
        theme: {
          graph: { rankdir: 'TD', splines: 'ortho' },
          modules: [
            { criteria: { source: '^src/llm/' }, attributes: { fillcolor: '#ffe4b5' } },
            { criteria: { source: '^src/tools/' }, attributes: { fillcolor: '#d4f1d4' } },
            { criteria: { source: '^src/storage/' }, attributes: { fillcolor: '#d4e4f7' } },
            { criteria: { source: '^src/panels/' }, attributes: { fillcolor: '#f7d4e4' } },
            { criteria: { source: '^src/guardrails/' }, attributes: { fillcolor: '#f7e4d4' } },
          ],
        },
      },
      text: { highlightFocused: true },
    },
  },
};
