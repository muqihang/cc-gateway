import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { cli, digestFile, isObject, parseArgs, readJson, requireValid, writeJson } from './harness-core.js'
import { validateCommandResultsBindings, validateCommandResultsValue, type CommandResultSet } from './merge-command-results.js'
import { validateCommandCatalogValue, type CommandCatalogEntry } from './validate-command-catalog.js'
import { validateContextPackValue, type ContextPack } from './validate-context-pack.js'
import { validateRunInputs } from './validate-run-manifest.js'

function sourceLine(file: string, needle: string): number | undefined {
  try { const line = readFileSync(file, 'utf8').split('\n').findIndex((entry) => entry.includes(needle)); return line < 0 ? undefined : line + 1 } catch { return undefined }
}

export function buildContextPack(options: { registry: string; claims: string; manifest: string; commandResults: string; requirementIds: string[]; catalog?: string; generatedAt?: string }): ContextPack {
  const catalogPath = options.catalog ?? 'docs/superpowers/registry/oracle-lab-command-catalog.json'
  requireValid(validateRunInputs(options.registry, options.claims, options.manifest, catalogPath))
  const records = readJson(options.registry)
  if (!Array.isArray(records)) throw Object.assign(new Error('registry is invalid'), { code: 'invalid_registry' })
  const requirements = new Map(records.filter(isObject).map((record) => [record.requirement_id, record]))
  if (options.requirementIds.length === 0 || new Set(options.requirementIds).size !== options.requirementIds.length) throw Object.assign(new Error('requirements must be non-empty and unique'), { code: 'invalid_requirements' })
  for (const id of options.requirementIds) if (!requirements.has(id)) throw Object.assign(new Error(`${id} is unknown`), { code: 'unknown_requirement' })
  const resultValue = readJson(options.commandResults); const resultValidation = validateCommandResultsValue(resultValue)
  if (!resultValidation.ok) throw Object.assign(new Error(JSON.stringify(resultValidation.errors)), { code: resultValidation.errors[0].code })
  const results = resultValue as CommandResultSet
  const catalogValue = readJson(catalogPath); requireValid(validateCommandCatalogValue(catalogValue, new Set(requirements.keys() as Iterable<string>)))
  const catalog = catalogValue as CommandCatalogEntry[]; const selected = new Set(options.requirementIds)
  const selectedCommands = catalog.filter((entry) => entry.requirement_ids.some((id) => selected.has(id)))
  for (const id of options.requirementIds) if (!selectedCommands.some((entry) => entry.requirement_ids.includes(id))) throw Object.assign(new Error(`${id} has no catalog command evidence`), { code: 'missing_requirement_evidence' })
  const commandIds = new Set(selectedCommands.map((entry) => entry.id))
  const manifest = readJson(options.manifest)
  if (!isObject(manifest) || !isObject(manifest.repositories)) throw Object.assign(new Error('manifest repositories are missing'), { code: 'missing_repository_digests' })
  const repositories = Object.entries(manifest.repositories).map(([name, value]) => {
    if (!isObject(value) || typeof value.head !== 'string' || typeof value.dirty_digest !== 'string') throw Object.assign(new Error(`${name} repository provenance is missing`), { code: 'missing_repository_digests' })
    return { name, commit: value.head, dirty_digest: `sha256:${value.dirty_digest}` }
  }).sort((a, b) => a.name.localeCompare(b.name))
  requireValid(validateCommandResultsBindings(results, catalog, manifest, { catalogDigest: digestFile(catalogPath), manifestDigest: digestFile(options.manifest) }))
  const evidence = new Map(results.records.map((record) => [record.command_id, record]))
  for (const entry of selectedCommands) {
    const record = evidence.get(entry.id)
    if (!record || (record.status !== 'pass' && record.status !== 'expected_fail')) throw Object.assign(new Error(`${entry.id} has no matching accepted result`), { code: 'missing_requirement_evidence' })
  }
  const sources = new Map<string, { path: string; symbol?: string; line?: number; digest: string }>()
  const missingSources: string[] = []
  for (const id of options.requirementIds) {
    const requirement = requirements.get(id)!
    const registryLine = sourceLine(options.registry, `"requirement_id": "${id}"`)
    sources.set(`${options.registry}\0${id}`, { path: options.registry, symbol: id, ...(registryLine ? { line: registryLine } : {}), digest: digestFile(options.registry) })
    const files = [...(Array.isArray(requirement.implementation_files) ? requirement.implementation_files : []), ...(Array.isArray(requirement.test_files) ? requirement.test_files : [])]
    const sourceDocument = typeof requirement.source_document === 'string' ? path.join('docs/superpowers/specs', requirement.source_document) : ''
    if (sourceDocument) files.push(sourceDocument)
    for (const file of files.filter((entry): entry is string => typeof entry === 'string')) {
      try {
        const line = file === sourceDocument && typeof requirement.source_section === 'string' ? sourceLine(file, requirement.source_section) : undefined
        sources.set(file, { path: file, ...(line ? { line } : {}), digest: digestFile(file) })
      } catch { missingSources.push(`missing_source:${file}`) }
    }
  }
  const generated = new Date(options.generatedAt ?? new Date().toISOString())
  const pack: ContextPack = {
    schema_version: 1, generated_at: generated.toISOString(), expires_at: new Date(generated.getTime() + 86_400_000).toISOString(),
    registry_digest: digestFile(options.registry), claims_digest: digestFile(options.claims), manifest_digest: digestFile(options.manifest),
    requirement_ids: [...options.requirementIds].sort(), repositories, sources: [...sources.values()].sort((a, b) => `${a.path}\0${a.symbol ?? ''}`.localeCompare(`${b.path}\0${b.symbol ?? ''}`)),
    tests: results.records.filter((record) => commandIds.has(record.command_id)).map((record) => ({ command_id: record.command_id, status: record.status, result_digest: record.result_digest })).sort((a, b) => a.command_id.localeCompare(b.command_id)),
    known_unknowns: [...new Set([...missingSources, ...options.requirementIds.flatMap((id) => { const gaps = requirements.get(id)?.known_gaps; return Array.isArray(gaps) ? gaps.filter((gap): gap is string => typeof gap === 'string') : [] })])].sort(),
  }
  requireValid(validateContextPackValue(pack)); return pack
}

if (realpathSync(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) cli(() => {
  const args = parseArgs(process.argv.slice(2)); const registry = args.values.registry?.[0]; const claims = args.values.claims?.[0]; const manifest = args.values.manifest?.[0]; const commandResults = args.values['command-results']?.[0]; const out = args.values.out?.[0]
  if (!registry || !claims || !manifest || !commandResults || !out) throw Object.assign(new Error('registry, claims, manifest, command-results, requirements, and out are required'), { code: 'invalid_arguments' })
  writeJson(out, buildContextPack({ registry, claims, manifest, commandResults, requirementIds: args.values.requirement ?? [], catalog: args.values.catalog?.[0] }))
})
