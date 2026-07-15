export const P0_1_TEST_FILES = [
  // Top-level assertion scripts must finish before node:test modules register asynchronous tests.
  'oracle-lab-hermetic-dependencies.test.ts',
  'oracle-lab-governance-amendment-entry.test.ts',
  'oracle-lab-ignored-path-inventory.test.ts',
  'oracle-lab-governance-amendment-evidence.test.ts',
  'oracle-lab-review-overlay.test.ts',
  'oracle-lab-traceability.test.ts',
  'oracle-lab-claim-matrix.test.ts',
  'oracle-lab-current-observations.test.ts',
  'oracle-lab-harness.test.ts',
  'oracle-lab-reviewed-snapshot-binding.test.ts',
] as const
