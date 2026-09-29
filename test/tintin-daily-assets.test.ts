// test/tintin-daily-assets.test.ts — 每日素材纯逻辑层回归（SRC daily-assets.js 1:1）
// 覆盖：目录扫描/日期分组降序/类型分类/多目录去重/临时文件排除/四维筛选/目录集解析。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  classifyDailyAssetType,
  filterDailyAssets,
  formatBytes,
  resolveDailyAssetDirs,
  scanDailyAssets,
} from '../src/main/tintin/browser/daily-assets-logic'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function makeDownloads(withFiles: Record<string, Array<[string, number]>>): string {
  const base = mkdtempSync(join(tmpdir(), 'tintin-daily-'))
  dirs.push(base)
  for (const [date, files] of Object.entries(withFiles)) {
    mkdirSync(join(base, date), { recursive: true })
    for (const [name, size] of files) writeFileSync(join(base, date, name), Buffer.alloc(size || 1))
  }
  return base
}

describe('daily-assets logic (SRC daily-assets 1:1)', () => {
  it('classifies file types by extension', () => {
    expect(classifyDailyAssetType('a.mp4')).toBe('video')
    expect(classifyDailyAssetType('b.MOV')).toBe('video')
    expect(classifyDailyAssetType('c.png')).toBe('image')
    expect(classifyDailyAssetType('d.txt')).toBe('text')
    expect(classifyDailyAssetType('e.unknown')).toBe('file')
    expect(classifyDailyAssetType('noext')).toBe('file')
  })

  it('scans date-named subdirectories and groups by date descending', () => {
    const base = makeDownloads({
      '2026-09-29': [['a.mp4', 10]],
      '2026-09-28': [['b.jpg', 20], ['c.txt', 30]],
      'not-a-date': [['x.mp4', 1]],
    })
    const groups = scanDailyAssets([base])
    expect(groups.map((g) => g.date)).toEqual(['2026-09-29', '2026-09-28'])
    expect(groups[1]?.files.map((f) => f.name)).toEqual(['b.jpg', 'c.txt'])
    expect(groups[1]?.files[0]?.type).toBe('image')
  })

  it('ignores temp/cookies files and non-file entries across merged dirs with dedupe', () => {
    const a = makeDownloads({ '2026-09-29': [['v.mp4', 5], ['v.mp4.tmp', 5], ['v.mp4.cookies.txt', 5]] })
    const groups = scanDailyAssets([a])
    expect(groups[0]?.files.map((f) => f.name)).toEqual(['v.mp4'])
    // 同一路径在两个目录集里只收一次
    const again = scanDailyAssets([a, a])
    expect(again[0]?.files.length).toBe(1)
  })

  it('resolves the download dir set with dedupe (configured > media > system)', () => {
    expect(resolveDailyAssetDirs({ configured: 'C:\\a', downloadDir: 'C:\\a', systemDownloads: 'C:\\b' })).toEqual(['C:\\a', 'C:\\b'])
    expect(resolveDailyAssetDirs({ systemDownloads: null })).toEqual([])
  })

  it('filters by date/type/query and sorts (size/name)', () => {
    const base = makeDownloads({
      '2026-09-29': [['b.mp4', 100], ['a.mp4', 200], ['img.png', 1]],
      '2026-09-28': [['old.mp4', 3]],
    })
    const groups = scanDailyAssets([base])
    const today = filterDailyAssets(groups, { date: '2026-09-29', type: 'video', query: '', sort: 'size' })
    expect(today).toHaveLength(1)
    expect(today[0]?.files.map((f) => f.name)).toEqual(['a.mp4', 'b.mp4'])
    const byName = filterDailyAssets(groups, { date: '2026-09-29', type: '', query: '', sort: 'name' })
    expect(byName[0]?.files.map((f) => f.name)).toEqual(['a.mp4', 'b.mp4', 'img.png'])
    const hit = filterDailyAssets(groups, { date: '', type: '', query: 'IMG', sort: '' })
    expect(hit).toHaveLength(1)
    expect(hit[0]?.files[0]?.name).toBe('img.png')
  })

  it('formats bytes readably', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})
