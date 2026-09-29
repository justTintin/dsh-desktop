// daily-assets-logic.ts — 每日素材纯逻辑层（SRC desktop/main/daily-assets.js 1:1
// 移植，基线 SRC 9ca9050；铁律 8：纯函数无 Electron 依赖，单测下沉）。
// 数据源契约：扫描各下载目录下 `YYYY-MM-DD` 命名子目录 → 排除临时文件 →
// 按 video/image/text/file 分类 → 日期分组降序返回 [{date, files:[{name,path,size,type}]}]。
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const VIDEO_EXT = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v'])
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'])
const TEXT_EXT = new Set(['.txt', '.html', '.md', '.json'])
/** 每日素材目录名（对照原版 /^\d{4}-\d{2}-\d{2}$/） */
const DATE_DIR_RE = /^\d{4}-\d{2}-\d{2}$/
/** 扫描时忽略的临时/辅助文件（对照原版 L795：.tmp + .cookies.txt） */
const IGNORE_SUFFIX = ['.tmp', '.cookies.txt']

export type DailyAssetType = 'video' | 'image' | 'text' | 'file'

export interface DailyAssetFile {
  name: string
  path: string
  size: number
  type: DailyAssetType
}

export interface DailyAssetGroup {
  date: string
  files: DailyAssetFile[]
}

/** 文件类型分类（对照原版 _classifyFileType L656-665） */
export function classifyDailyAssetType(name: string): DailyAssetType {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  const dot = ext.startsWith('.') ? ext : ''
  if (VIDEO_EXT.has(dot)) return 'video'
  if (IMAGE_EXT.has(dot)) return 'image'
  if (TEXT_EXT.has(dot)) return 'text'
  return 'file'
}

/** 按日期扫描下载目录（对照原版 get-daily-assets L766-818）。
 *  合并多目录去重（同路径只收一次）；日期降序。 */
export function scanDailyAssets(dirs: string[]): DailyAssetGroup[] {
  const dateGroups: Record<string, { files: DailyAssetFile[]; seen: Set<string> }> = {}
  for (const baseDir of Array.isArray(dirs) ? dirs : []) {
    if (!baseDir) continue
    let entries: string[]
    try {
      entries = readdirSync(baseDir)
    } catch {
      continue
    }
    for (const name of entries) {
      if (!DATE_DIR_RE.test(name)) continue
      const datePath = join(baseDir, name)
      let isDir = false
      try { isDir = statSync(datePath).isDirectory() } catch { /* stat 失败跳过 */ }
      if (!isDir) continue

      if (!dateGroups[name]) dateGroups[name] = { files: [], seen: new Set() }
      const group = dateGroups[name]
      let files: string[]
      try {
        files = readdirSync(datePath)
      } catch {
        continue
      }
      for (const f of files) {
        if (IGNORE_SUFFIX.some((s) => f.endsWith(s))) continue
        const fp = join(datePath, f)
        let isFile = false
        try { isFile = statSync(fp).isFile() } catch { /* stat 失败跳过 */ }
        if (!isFile) continue
        const key = fp.toLowerCase()
        if (group.seen.has(key)) continue
        group.seen.add(key)
        let size = 0
        try { size = statSync(fp).size } catch { size = 0 }
        group.files.push({ name: f, path: fp, size, type: classifyDailyAssetType(f) })
      }
    }
  }
  return Object.keys(dateGroups)
    .sort()
    .reverse()
    .map((date) => ({ date, files: dateGroups[date]?.files ?? [] }))
}

/** 下载目录集合（对照原版 _resolveDownloadDirs：用户配置 > media 设置 > 系统下载） */
export function resolveDailyAssetDirs(parts: { configured?: string | null; downloadDir?: string | null; systemDownloads?: string | null }): string[] {
  const dirs = new Set<string>()
  for (const v of [parts.configured, parts.downloadDir, parts.systemDownloads]) {
    if (v && typeof v === 'string') dirs.add(v)
  }
  return Array.from(dirs)
}

/** 四维筛选（SRC renderer logic/dailyAssets.ts filterDailyAssets 同口径：date/type/text/sort） */
export function filterDailyAssets(
  groups: DailyAssetGroup[],
  f: { date: string; type: string; query: string; sort: string },
): DailyAssetGroup[] {
  const q = String(f.query || '').trim().toLowerCase()
  let out = groups
    .filter((g) => !f.date || g.date === f.date)
    .map((g) => {
      let files = g.files
      if (f.type) files = files.filter((x) => x.type === f.type)
      if (q) files = files.filter((x) => x.name.toLowerCase().includes(q))
      return { date: g.date, files }
    })
    .filter((g) => g.files.length > 0)
  if (f.sort === 'size') {
    for (const g of out) g.files = g.files.slice().sort((a, b) => b.size - a.size)
  } else if (f.sort === 'name') {
    for (const g of out) g.files = g.files.slice().sort((a, b) => a.name.localeCompare(b.name))
  }
  return out
}

/** 可读字节（SRC formatBytes 同口径） */
export function formatBytes(n: number): string {
  const v = Number(n) || 0
  if (v < 1024) return v + ' B'
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB'
  if (v < 1024 * 1024 * 1024) return (v / (1024 * 1024)).toFixed(1) + ' MB'
  return (v / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}
