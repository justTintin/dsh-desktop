// test/tintin-config-store.test.ts — TinTin 自有配置存储（0.1.7 起）纯逻辑回归。
// 背景：SettingsForms/configEditor 拒写 overlay 插入的宿主插件条目，TinTin 自有
// 配置改落 <DSH_HOME>/tintin/config.json（lib/tintin-config-store.js）。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  mergeConfigDocs,
  mergeTintinConfigStore,
  readTintinConfigStore,
  stripEmptyObjectLeaves,
  tintinConfigPath,
} from '../packages/tintin-bundle/lib/tintin-config-store.js'

describe('tintin-config-store', () => {
  let home: string
  afterEach(() => { if (home) rmSync(home, { recursive: true, force: true }) })

  it('resolves the canonical path and reads back what was written', () => {
    home = mkdtempSync(join(tmpdir(), 'tintin-store-'))
    expect(tintinConfigPath(home)).toBe(join(home, 'tintin', 'config.json'))
    expect(tintinConfigPath(undefined)).toBeNull()
    expect(readTintinConfigStore(home)).toBeNull()

    const merged = mergeTintinConfigStore(home, { server: { url: 'http://192.168.111.31:8000', provisioned: true } })
    expect(merged).toEqual({ server: { url: 'http://192.168.111.31:8000', provisioned: true } })
    expect(readTintinConfigStore(home)).toEqual(merged)
    // 原子写不留下临时文件
    expect(existsSync(join(home, 'tintin', `config.json.${process.pid}.tmp`))).toBe(false)
  })

  it('merges nested patches without dropping sibling keys', () => {
    home = mkdtempSync(join(tmpdir(), 'tintin-store-'))
    mergeTintinConfigStore(home, { server: { url: 'http://a:1' }, local: { cacheDir: 'D:\\cache' } })
    const merged = mergeTintinConfigStore(home, { server: { provisioned: true } })
    expect(merged).toEqual({ server: { url: 'http://a:1', provisioned: true }, local: { cacheDir: 'D:\\cache' } })
  })

  it('treats a malformed store as absent and self-heals on next write', () => {
    home = mkdtempSync(join(tmpdir(), 'tintin-store-'))
    mkdirSync(join(home, 'tintin'), { recursive: true })
    writeFileSync(tintinConfigPath(home)!, '{bad json', 'utf8')
    expect(readTintinConfigStore(home)).toBeNull()
    mergeTintinConfigStore(home, { server: { url: 'http://a:1' } })
    expect(JSON.parse(readFileSync(tintinConfigPath(home)!, 'utf8'))).toEqual({ server: { url: 'http://a:1' } })
  })

  it('mergeConfigDocs layers documents with the later patch winning', () => {
    expect(mergeConfigDocs(
      { server: { url: 'http://store:1', provisioned: true }, local: { cacheDir: 'x' } },
      { server: { url: 'http://config:2' } },
    )).toEqual({ server: { url: 'http://config:2', provisioned: true }, local: { cacheDir: 'x' } })
  })

  it('stripEmptyObjectLeaves drops schemastery volatile placeholders so they cannot clobber real values', () => {
    // 2026-09-28 实机事故：未提交的 volatile 字段被 schemastery 编译成空对象
    // 占位，合并时覆盖 store 里的真实 URL，向导预填成 "[object Object]"。
    const placeholderConfig = { server: { url: {}, provisioned: {} }, local: {} }
    expect(stripEmptyObjectLeaves(placeholderConfig)).toBeUndefined()
    const merged = mergeConfigDocs(
      { server: { url: 'http://192.168.111.31:8000', provisioned: true } },
      stripEmptyObjectLeaves(placeholderConfig) ?? {},
    ) as { server: { url?: string } }
    expect(merged.server.url).toBe('http://192.168.111.31:8000')
    // 部分占位：真实值与占位符混排时只剥占位、保留真实
    expect(stripEmptyObjectLeaves({ server: { url: 'http://a:1', provisioned: {} }, local: { cacheDir: '' } }))
      .toEqual({ server: { url: 'http://a:1' }, local: { cacheDir: '' } })
  })
})
