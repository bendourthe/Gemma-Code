// Fixture for v0.8.0 Phase 0.11 (closes v0.7.0 10.O.12) background-workers
// E2E integration test. Contains a known seeded secret pattern that triggers
// the gemma-check `no-secret-patterns` rule. tests/** is excluded from
// ESLint and the TS compiler, so this file does not break CI.
const fakeAwsKey = "AKIAIOSFODNN7EXAMPLE";
const _useIt = fakeAwsKey.length > 0;
