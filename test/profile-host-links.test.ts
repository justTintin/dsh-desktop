// test/profile-host-links.test.ts — 宿主模块回退链接启动自愈回归。
// 背景（2026-09-29 转场丢失/[object Object] 同根因）：共享 profiles/node_modules
// 的链接由 Profile 安装时的 pnpm 对 file: 依赖建立，指向「当时的安装目录」；
// 升级换包不重排，旧 release 又会被清理——于是新程序经旧链接加载旧代码。
// 本模块在每次启动维护时把链接重排到当前运行安装（reanchorStaleHostLinks）。
// 规则：当前安装带同名包→重排；当前不带且旧目标已死→移除；.generations/
// 活的外部目标/实体目录→不碰；指向当前安装→不碰。
import { mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { reanchorStaleHostLinks } from '../src/main/state/profile-host-links'

let cleanupPaths: string[] = []

function makePkg(root: string, name: string): string {
  const dir = join(root, ...name.split('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0' }))
  return dir
}

function makeTree(): string {
  const home = mkdtempSync(join(tmpdir(), 'jy-host-links-'))
  cleanupPaths.push(home)
  return home
}

afterEach(() => {
  for (const p of cleanupPaths) rmSync(p, { recursive: true, force: true })
  cleanupPaths = []
})

describe('reanchorStaleHostLinks', () => {
  it('re-points links naming a package the running installation carries; removes dead links it cannot replace', async () => {
    const home = makeTree()
    const staleAnchor = join(home, 'old-release', 'resources', 'app.asar.unpacked', 'node_modules')
    const currentAnchor = join(home, 'current-install', 'resources', 'app.asar.unpacked', 'node_modules')
    const profileModules = join(home, 'profiles', 'node_modules')
    makePkg(staleAnchor, 'stale-pkg')
    makePkg(staleAnchor, 'deleted-everywhere')
    makePkg(currentAnchor, 'stale-pkg')
    makePkg(currentAnchor, 'carried-pkg')

    mkdirSync(profileModules, { recursive: true })
    const link = (name: string, target: string): void =>
      symlinkSync(target, join(profileModules, name), 'junction')
    link('stale-pkg', join(staleAnchor, 'stale-pkg'))
    link('carried-pkg', join(currentAnchor, 'carried-pkg'))
    link('deleted-everywhere', join(staleAnchor, 'deleted-everywhere'))
    rmSync(join(staleAnchor, 'deleted-everywhere'), { recursive: true })

    const result = await reanchorStaleHostLinks({
      profileNodeModules: profileModules,
      currentHostNodeModules: currentAnchor
    })

    expect(result.reanchored).toEqual(['stale-pkg'])
    expect(result.removed).toEqual(['deleted-everywhere'])
    expect(readlinkSync(join(profileModules, 'stale-pkg')).toLowerCase()).toBe(
      join(currentAnchor, 'stale-pkg').toLowerCase()
    )
    expect(readlinkSync(join(profileModules, 'carried-pkg')).toLowerCase()).toBe(
      join(currentAnchor, 'carried-pkg').toLowerCase()
    )
    expect(existsSync(join(profileModules, 'deleted-everywhere'))).toBe(false)
  })

  it('leaves generation links, foreign live targets, real directories and current-install targets untouched', async () => {
    const home = makeTree()
    const staleAnchor = join(home, 'old-release', 'resources', 'app.asar.unpacked', 'node_modules')
    const currentAnchor = join(home, 'current-install', 'resources', 'app.asar.unpacked', 'node_modules')
    const profileModules = join(home, 'profiles', 'node_modules')
    makePkg(currentAnchor, 'hosted-pkg')

    const generations = join(home, 'profiles', '.generations', 'gen-1')
    const foreignLive = makePkg(join(home, 'dev-repo', 'node_modules'), 'foreign-pkg')

    mkdirSync(profileModules, { recursive: true })
    mkdirSync(generations, { recursive: true })
    const link = (name: string, target: string): void =>
      symlinkSync(target, join(profileModules, name), 'junction')
    link('market-plugin', join(generations, 'market-plugin'))
    link('foreign-pkg', foreignLive)
    link('hosted-pkg', join(currentAnchor, 'hosted-pkg'))
    mkdirSync(join(profileModules, 'real-dir'), { recursive: true })

    const result = await reanchorStaleHostLinks({
      profileNodeModules: profileModules,
      currentHostNodeModules: currentAnchor
    })

    expect(result.reanchored).toEqual([])
    expect(result.removed).toEqual([])
    expect(result.kept).toBe(4)
    expect(readlinkSync(join(profileModules, 'market-plugin'))).toContain('.generations')
    expect(readlinkSync(join(profileModules, 'foreign-pkg'))).toBe(foreignLive)
    expect(() => readlinkSync(join(profileModules, 'real-dir'))).toThrow()
  })

  it('re-anchors scoped packages and is idempotent on a second run', async () => {
    const home = makeTree()
    const staleAnchor = join(home, 'old-release', 'resources', 'app.asar.unpacked', 'node_modules')
    const currentAnchor = join(home, 'current-install', 'resources', 'app.asar.unpacked', 'node_modules')
    const profileModules = join(home, 'profiles', 'node_modules')
    makePkg(staleAnchor, '@scope/thing')
    makePkg(currentAnchor, '@scope/thing')

    mkdirSync(join(profileModules, '@scope'), { recursive: true })
    symlinkSync(join(staleAnchor, '@scope', 'thing'), join(profileModules, '@scope', 'thing'), 'junction')

    const first = await reanchorStaleHostLinks({
      profileNodeModules: profileModules,
      currentHostNodeModules: currentAnchor
    })
    expect(first.reanchored).toEqual(['@scope/thing'])
    expect(readlinkSync(join(profileModules, '@scope', 'thing')).toLowerCase()).toBe(
      join(currentAnchor, '@scope', 'thing').toLowerCase()
    )

    const second = await reanchorStaleHostLinks({
      profileNodeModules: profileModules,
      currentHostNodeModules: currentAnchor
    })
    expect(second.reanchored).toEqual([])
    expect(second.removed).toEqual([])
    expect(second.kept).toBe(1)
  })

  it('is a no-op when the profile fallback is missing or already the current installation', async () => {
    const home = makeTree()
    const currentAnchor = join(home, 'current-install', 'node_modules')
    makePkg(currentAnchor, 'pkg')

    const missing = await reanchorStaleHostLinks({
      profileNodeModules: join(home, 'profiles', 'node_modules'),
      currentHostNodeModules: currentAnchor
    })
    expect(missing.reanchored).toEqual([])

    const selfModules = makeTree()
    const self = await reanchorStaleHostLinks({
      profileNodeModules: selfModules,
      currentHostNodeModules: selfModules
    })
    expect(self.reanchored).toEqual([])
    expect(self.removed).toEqual([])
  })
})
