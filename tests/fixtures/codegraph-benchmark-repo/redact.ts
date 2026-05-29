// Phase 3.6 benchmark fixture: a small multi-file repo where the reference
// task `Find all callers of redactSecrets and assess whether changing its
// signature would break call sites` exercises both the codegraph and the
// grep-shaped paths.

export function redactSecrets(input: string): string {
  return input.replace(/secret/gi, "***");
}
