#!/usr/bin/env node
import { chmodSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { assertDigestField, canonicalJson, sha256Canonical } from '../../tools/oracle-lab/phase3b-evidence-sufficiency/core.js'
import { signEphemeralRecord } from '../../tools/oracle-lab/phase3b-evidence-sufficiency/ephemeral-signer.js'
import { stableRead } from '../../tools/oracle-lab/phase3b-evidence-sufficiency/sealed-fs.js'
import { controllerExecutableSha256, controllerSourceSetSha256 } from '../../tools/oracle-lab/phase3b-evidence-sufficiency/source-identity.js'

function canonicalRecord(file: string): Record<string, unknown> {
  const record = stableRead(file, { mode: 0o600, maximumBytes: 16_777_216 })
  if (record.bytes.at(-1) !== 0x0a) throw new Error('noncanonical fixture record')
  const value = JSON.parse(record.bytes.subarray(0, -1).toString('utf8')) as Record<string, unknown>
  return value
}

function writeCanonical(file: string, value: unknown): void {
  writeFileSync(file, `${canonicalJson(value)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
}

function main(): void {
  if (process.argv.length !== 5) throw new Error('usage: security-reviewer MATERIALIZED REQUIREMENTS_PUBLIC OUTPUT_ROOT')
  const materializedPath = realpathSync(process.argv[2])
  const requirementsPath = realpathSync(process.argv[3])
  const outputRoot = realpathSync(process.argv[4])
  chmodSync(outputRoot, 0o700)
  const materialized = canonicalRecord(materializedPath)
  const requirements = canonicalRecord(requirementsPath)
  assertDigestField(materialized, 'materialized_authority_sha256', 'test_review_invalid')
  const now = Date.now()
  const signed = signEphemeralRecord({
    role: 'security_quality',
    identity: 'phase3b-test-security-reviewer',
    digest_field: 'review_sha256',
    payload: {
      schema_id: 'oracle-lab-p3b-test-implementation-review.v1',
      review_kind: 'phase3b-real-controller-test',
      reviewed_candidate_commit: materialized.reviewed_candidate_commit,
      reviewed_candidate_tree: materialized.reviewed_candidate_tree,
      requirements_public_entry_sha256: sha256Canonical(requirements),
      materialized_authority_sha256: stableRead(materializedPath, { mode: 0o600, maximumBytes: 16_777_216 }).identity.sha256,
      controller_source_sha256: controllerSourceSetSha256(),
      controller_executable_sha256: controllerExecutableSha256(),
      critical: 0,
      important: 0,
      verdict: 'PASS',
      created_at_ms: now,
      expires_at_ms: now + 3_600_000,
    },
  })
  writeCanonical(path.join(outputRoot, 'phase3b-test-security-public-entry.json'), signed.public_entry)
  writeCanonical(path.join(outputRoot, 'phase3b-test-implementation-review.json'), signed.signed_record)
}

main()
