// tintin-config-store — TinTin 自有配置存储（0.1.7 起）。
// 背景：桌面宿主插件经 CLI overlay（desktop-host-sources.patch.yml）插入组合，
// 0.1.7 的 SettingsForms/configEditor 拒绝对这类条目写配置
// （"overridden by a home patch or command-line overlay"）——上游
// dsh-image-generation 的答案是自带 lib/settings.js，本模块是 TinTin 的对应物。
// TinTin 自有配置（server.url、provisioned、local.cacheDir…）的读写都落在这里：
// <DSH_HOME>/tintin/config.json。上游重构永远够不着这个文件，这是
// 「合并上游后不再人工捡回定制」的结构性保证。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function tintinConfigPath(dshHome) {
  return dshHome ? join(dshHome, 'tintin', 'config.json') : null
}

/** Read the TinTin store; null when absent/malformed/unreadable. Pure read. */
export function readTintinConfigStore(dshHome) {
  const file = tintinConfigPath(dshHome)
  if (!file || !existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch { /* a malformed store is skipped, not fatal */ }
  return null
}

/** Deep-merge plain objects (arrays and scalars replace). Exported for callers
 * that need the effective view across layered config documents. */
export function mergeConfigDocs(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    const base = target[key]
    target[key] =
      value && typeof value === 'object' && !Array.isArray(value) && base && typeof base === 'object' && !Array.isArray(base)
        ? mergeConfigDocs({ ...base }, value)
        : value
  }
  return target
}

/** Schemastery compiles uncommitted volatile fields into empty-object
 * placeholders — semantically "no value". Letting them through a merge
 * clobbers real values (0.1.7 live bug: placeholder overwrote the store's
 * URL and the wizard prefill showed "[object Object]"). Recursively drops
 * keys whose value is an empty plain object, bottom-up. */
export function stripEmptyObjectLeaves(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const out = {}
  for (const [key, v] of Object.entries(value)) {
    const cleaned = v && typeof v === 'object' && !Array.isArray(v) ? stripEmptyObjectLeaves(v) : v
    const isJunk = cleaned !== undefined && typeof cleaned === 'object' && !Array.isArray(cleaned) && Object.keys(cleaned).length === 0
    if (cleaned !== undefined && !isJunk) out[key] = cleaned
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Merge a nested patch into the TinTin store and persist atomically
 * (tmp + rename, so a crash mid-write never leaves a truncated store).
 * Returns the merged document. Creates the directory on first write.
 */
export function mergeTintinConfigStore(dshHome, patch) {
  const file = tintinConfigPath(dshHome)
  if (!file) throw new Error('tintin-config-store: DSH_HOME is required')
  const merged = mergeConfigDocs(readTintinConfigStore(dshHome) ?? {}, patch)
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(merged, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
  return merged
}
