import { lstat, readdir, readlink, realpath, rm, symlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, sep } from 'node:path'

/**
 * Re-anchor the shared profile module fallback to the running installation.
 *
 * The shared `profiles/node_modules` closure resolves host packages through
 * links that a profile install once aimed at the *then-current* installation
 * directory. Installing a new build never rewrites those links, and the old
 * release directory is a verification artifact that may be deleted at any
 * time — so after an upgrade the closure keeps importing a prior build's code
 * (observed in the field as Jianying transitions silently not rendering and
 * as `[object Object]` cache paths). Launch-time re-anchoring makes the
 * running installation the only legal code source: links naming a package
 * this installation carries are re-pointed here, links whose target is gone
 * and that this installation cannot replace are removed, and everything the
 * current installation does not own is left untouched.
 */

export interface ReanchorHostLinksOptions {
  /** The shared profile fallback directory (`<dshHome>/profiles/node_modules`). */
  profileNodeModules: string
  /** The running installation's module root (`app.asar.unpacked/node_modules`, or the repo's in dev). */
  currentHostNodeModules: string
  note?: (line: string) => void
}

export interface ReanchorHostLinksResult {
  /** Package names whose link now points at the running installation. */
  reanchored: string[]
  /** Package names whose dead link was removed (the current installation does not carry them). */
  removed: string[]
  /** Links left untouched: current-install targets, generations, foreign live targets, real directories. */
  kept: number
  /** Per-entry operations that failed (Windows link held by a live process); launch continues regardless. */
  failed: Array<{ name: string; detail: string }>
}

/** Market generation links are projection-owned; the re-anchor never touches them. */
function isGenerationTarget(target: string): boolean {
  return target.split(sep).join('/').includes('.generations')
}

function sameInstallation(linkTarget: string, currentRoot: string): boolean {
  const normalize = (value: string): string => value.split(sep).join('/').replace(/\/+$/, '').toLowerCase()
  const target = normalize(linkTarget)
  const root = normalize(currentRoot)
  return target === root || target.startsWith(`${root}/`)
}

/** Windows junctions want `junction`; POSIX directory links want `dir`. */
function linkKind(): 'junction' | 'dir' {
  return process.platform === 'win32' ? 'junction' : 'dir'
}

async function replaceLink(linkPath: string, target: string): Promise<void> {
  // Unlink-then-create is not atomic, but the only concurrent readers are
  // stopped Harness processes — startup maintenance owns the mutation window.
  await rm(linkPath, { force: false })
  await symlink(target, linkPath, linkKind())
}

/**
 * Walk the shared fallback one level deep (plus `@scope/` second level) and
 * re-point stale installation links at the running installation. Fail-open by
 * design: a link that cannot be rewritten (EPERM from antivirus or a live
 * process) is reported, never fatal — the boot must proceed on the old state
 * rather than cost the user their normal Profile.
 */
export async function reanchorStaleHostLinks(
  options: ReanchorHostLinksOptions
): Promise<ReanchorHostLinksResult> {
  const { profileNodeModules, currentHostNodeModules } = options
  const note = options.note ?? (() => {})
  const result: ReanchorHostLinksResult = { reanchored: [], removed: [], kept: 0, failed: [] }

  if (!existsSync(profileNodeModules)) return result
  // A fallback that *is* the current installation's tree (or links into it)
  // has nothing stale to re-anchor; walking it would only re-create links.
  if (sameInstallation(profileNodeModules, currentHostNodeModules)) return result

  const topLevel = await readdirEntryNames(profileNodeModules)
  for (const entry of topLevel) {
    const entryPath = join(profileNodeModules, entry)
    if (entry.startsWith('@')) {
      for (const nested of await readdirEntryNames(entryPath)) {
        // Report scoped names in package form (`@scope/name`) regardless of
        // the platform separator `join` would produce.
        await consider(`${entry}/${nested}`, join(entryPath, nested))
      }
      continue
    }
    await consider(entry, entryPath)
  }

  if (result.reanchored.length > 0 || result.removed.length > 0) {
    note(
      `[desktop] host module fallback re-anchored to this installation: ` +
      `${result.reanchored.length} link(s) re-pointed, ${result.removed.length} dead link(s) removed, ` +
      `${result.kept} untouched` +
      (result.failed.length ? `, ${result.failed.length} failed (held by another process)` : '')
    )
  }
  return result

  async function consider(name: string, linkPath: string): Promise<void> {
    let info
    try {
      info = await lstat(linkPath)
    } catch {
      return
    }
    if (!info.isSymbolicLink()) {
      result.kept += 1
      return
    }
    let target: string
    try {
      target = await readlink(linkPath)
    } catch (error) {
      result.failed.push({ name, detail: error instanceof Error ? error.message : String(error) })
      return
    }
    if (isGenerationTarget(target) || isGenerationTarget(linkPath)) {
      result.kept += 1
      return
    }
    if (sameInstallation(target, currentHostNodeModules)) {
      result.kept += 1
      return
    }
    const replacement = join(currentHostNodeModules, ...name.split('/'))
    if (existsSync(join(replacement, 'package.json'))) {
      try {
        await replaceLink(linkPath, replacement)
        result.reanchored.push(name)
      } catch (error) {
        result.failed.push({ name, detail: error instanceof Error ? error.message : String(error) })
      }
      return
    }
    // The current installation does not carry the package. Remove only when
    // the old target is gone anyway: a live foreign target may be dev
    // topology or a manual link this installation cannot judge.
    const targetAlive = existsSync(await safeRealpath(target))
    if (!targetAlive) {
      try {
        await rm(linkPath, { force: false })
        result.removed.push(name)
      } catch (error) {
        result.failed.push({ name, detail: error instanceof Error ? error.message : String(error) })
      }
      return
    }
    result.kept += 1
    note(`[desktop] host module link ${name} points at a live foreign target outside this installation; left untouched`)
  }
}

async function readdirEntryNames(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => e.name)
  } catch {
    return []
  }
}

async function safeRealpath(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}
