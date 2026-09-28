import { constants } from 'node:fs'
import { cp, copyFile, mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { isSeq, parse, parseDocument } from 'yaml'
import { writeTextAtomically } from './persona-prefix-migration'

const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/
const START = '# dsh-desktop legacy presets begin'
const END = '# dsh-desktop legacy presets end'
const BUILT_IN_PRESETS = new Set(['standard', 'ptc', 'minimal', 'cordis'])

function yamlString(value: string): string {
  return JSON.stringify(value)
}

/** Preserve the original composition text, including Cordis !!js expressions. */
function presetPatch(id: string, composition: string, metadata: unknown): string {
  const data = typeof metadata === 'object' && metadata !== null ? metadata as Record<string, unknown> : {}
  const fields = [`        id: ${id}`]
  for (const key of ['name', 'description'] as const) {
    if (typeof data[key] === 'string') fields.push(`        ${key}: ${yamlString(data[key])}`)
  }
  if (typeof data.order === 'number' && Number.isFinite(data.order)) fields.push(`        order: ${data.order}`)
  const rows = composition.trimEnd().split(/\r?\n/u).map((line) => line.length ? `          ${line}` : '').join('\n')
  const header = BUILT_IN_PRESETS.has(id)
    ? `- id: preset-${id}\n  config:`
    : `- insert:\n    - id: preset-${id}\n      name: '@deepseek-ai/dsh-agent-preset'\n      config:`
  const indent = BUILT_IN_PRESETS.has(id) ? '' : '  '
  return `${header}\n${fields.map((line) => indent + line).join('\n')}\n${indent}        plugins:\n${rows.split('\n').map((line) => indent + line).join('\n')}\n`
}

const WORKFLOW_TOOL_ROW = /^(\s*)- id: (?:tool-workflow|tool-ralph|workflow-worker-thread)\s*$/u
const ISOLATE_KEY = /^(\s*)isolate:\s*$/u
const WORKFLOW_ENGINE_CHILD = /^(\s*)workflowEngine:/u

function leadingSpaces(line: string): number {
  return line.length - line.trimStart().length
}

/**
 * 0.1.7-rc.2 ships the workflow tools without their engine worker: the
 * `dsh-workflow-worker-thread` package is not published, so the worker row,
 * tool-workflow and tool-ralph all sit behind a `workflowEngine` service that
 * can never activate and every converted preset naming them stays "waiting" —
 * the roster shows the whole preset as failed. Profiles converted before this
 * closure gap was known keep those rows forever because the conversion only
 * appends never-before-seen ids; repair them in place. The surgery stays
 * textual because converted rows carry !!js expressions a YAML round-trip
 * would drop.
 */
export function stripUnshippableWorkflowRows(section: string): string {
  const trailingNewline = section.endsWith('\n') ? '\n' : ''
  const lines = (trailingNewline ? section.slice(0, -1) : section).split('\n')
  const drop = new Set<number>()
  for (let i = 0; i < lines.length; i += 1) {
    if (drop.has(i)) continue
    const toolRow = WORKFLOW_TOOL_ROW.exec(lines[i]!)
    if (toolRow) {
      const indent = toolRow[1]!.length
      drop.add(i)
      for (let j = i + 1; j < lines.length && (lines[j]!.trim() === '' || leadingSpaces(lines[j]!) > indent); j += 1) drop.add(j)
      continue
    }
    const isolate = ISOLATE_KEY.exec(lines[i]!)
    if (isolate) {
      const indent = isolate[1]!.length
      const children: number[] = []
      for (let j = i + 1; j < lines.length && lines[j]!.trim() !== '' && leadingSpaces(lines[j]!) > indent; j += 1) children.push(j)
      const engine = children.filter((k) => WORKFLOW_ENGINE_CHILD.test(lines[k]!))
      if (engine.length === 0) continue
      for (const k of engine) {
        drop.add(k)
        for (let m = k + 1; m < lines.length && (lines[m]!.trim() === '' || leadingSpaces(lines[m]!) > leadingSpaces(lines[k]!)); m += 1) drop.add(m)
      }
      // The isolate flag exists to give the workflow tools their own engine
      // realm; with the tools gone an emptied isolate would only recreate the
      // same waiting dependency, so drop the key when nothing else remains.
      const keptChildren = children.filter((k) => !drop.has(k) && !engine.includes(k))
      if (keptChildren.length === 0) drop.add(i)
    }
  }
  if (drop.size === 0) return section
  return lines.filter((_, index) => !drop.has(index)).join('\n') + trailingNewline
}

/** Keep one pre-change copy of the Profile patch for both the conversion and the in-place repair. */
async function backupProfilePatch(profilePatch: string, previous: string): Promise<void> {
  if (!previous) return
  try {
    await copyFile(profilePatch, `${profilePatch}.pre-0.1.7-backup`, constants.COPYFILE_EXCL)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/** Publish old directory presets into the 0.1.7 profile without touching their source. */
export async function migrateLegacyAgentPresets(dshHome: string, note: (line: string) => void): Promise<void> {
  const profilePatch = join(dshHome, 'profiles', 'web', 'cordis.patch.yml')
  await mkdir(join(dshHome, 'profiles', 'web'), { recursive: true })
  const previous = await readFile(profilePatch, 'utf8').catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  })
  // A fresh Profile may contain comments followed by `[]`. Appending block
  // entries after that flow sequence creates a second YAML root document.
  const previousDocument = parseDocument(previous)
  const emptyFlowList = previousDocument.errors.length === 0 && isSeq(previousDocument.contents) &&
    previousDocument.contents.items.length === 0 && previousDocument.contents.flow
  const emptyListRange = emptyFlowList ? previousDocument.contents?.range : undefined
  let base = emptyListRange && previous.slice(emptyListRange[0], emptyListRange[1]).trim() === '[]'
    ? previous.slice(0, emptyListRange[0]) + previous.slice(emptyListRange[1])
    : previous
  const start = base.indexOf(START)
  const end = base.indexOf(END)
  if ((start === -1) !== (end === -1) || (start !== -1 && end < start)) {
    throw new Error('legacy preset section in the web Profile patch is incomplete')
  }
  // Repair already-converted profiles even when the source directories are
  // gone: the workflow rows live in the generated section, not in the sources.
  if (start !== -1) {
    const section = base.slice(start + START.length, end)
    const stripped = stripUnshippableWorkflowRows(section)
    if (stripped !== section) {
      const repaired = base.slice(0, start + START.length) + stripped + base.slice(end)
      const repairedDocument = parseDocument(repaired)
      if (repairedDocument.errors.length || !isSeq(repairedDocument.contents)) {
        note('[desktop] converted presets need the workflow-row repair but the surrounding Profile patch does not parse; leaving it for manual recovery')
      } else {
        await backupProfilePatch(profilePatch, previous)
        await writeTextAtomically(profilePatch, repaired)
        base = repaired
        note('[desktop] removed the workflow tool rows that cannot activate in this Host closure from converted presets')
      }
    }
  }

  const sourceRoot = join(dshHome, '.agent-presets')
  let entries
  try {
    entries = await readdir(sourceRoot, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  const sections: Array<{ id: string; patch: string }> = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !PRESET_ID.test(entry.name)) continue
    try {
      const composition = await readFile(join(sourceRoot, entry.name, 'agent.cordis.yml'), 'utf8')
      const document = parseDocument(composition.replace(/^\uFEFF/u, ''))
      if (document.errors.length || !isSeq(document.contents)) throw new Error('agent.cordis.yml must contain a YAML plugin list')
      const metadata = await readFile(join(sourceRoot, entry.name, 'preset.yml'), 'utf8')
        .then((text) => parse(text) as unknown)
        .catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
          throw error
        })
      sections.push({ id: entry.name, patch: presetPatch(entry.name, composition, metadata) })
    } catch (error) {
      note(`[desktop] legacy preset ${entry.name} could not be converted: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (sections.length === 0) return

  // A converted row belongs to the new Profile from now on. Preserve edits
  // made through the new editor; only append legacy IDs not yet present.
  const existingIds = new Set(
    [...base.matchAll(/^(?:- id:|    - id:) preset-([a-z0-9-]+)\s*$/gmu)].map((match) => match[1])
  )
  const pending = sections.filter(({ id }) => !existingIds.has(id))
  if (pending.length === 0) return
  const generated = start === -1 ? '' : base.slice(start + START.length, end).trim()
  const withoutGenerated = start === -1 ? base : base.slice(0, start) + base.slice(end + END.length).replace(/^\r?\n/u, '')
  const generatedRows = [generated, ...pending.map(({ patch }) => patch.trimEnd())].filter(Boolean).join('\n\n')
  const next = `${withoutGenerated.trimEnd()}\n\n${START}\n${generatedRows}\n${END}\n`
  if (next === previous) return

  const backupRoot = join(dshHome, '.agent-presets.pre-0.1.7-backup')
  const backupExists = await stat(backupRoot).then(() => true).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  })
  if (!backupExists) {
    const staging = `${backupRoot}.${process.pid}.${Date.now()}.tmp`
    try {
      await cp(sourceRoot, staging, { recursive: true, errorOnExist: true, force: false, dereference: false })
      await rename(staging, backupRoot)
    } catch (error) {
      await rm(staging, { recursive: true, force: true })
      throw error
    }
  }
  await backupProfilePatch(profilePatch, previous)
  const document = parseDocument(next)
  if (document.errors.length || !isSeq(document.contents)) throw new Error('converted preset patch is not a YAML patch list')
  await writeTextAtomically(profilePatch, next)
  note(`[desktop] converted ${pending.length} legacy agent presets for the web Profile; originals and backup retained`)
}
