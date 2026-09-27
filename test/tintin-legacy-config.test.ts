import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  findLegacyConfigDir,
  planImportedSettingsRecovery,
  planLegacyMigration,
  readImportedTintinSection,
  readLegacyConfig,
} from '../packages/tintin-bundle/lib/legacy-config.js'

describe('tintin legacy-config migration', () => {
  let dir: string
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

  function seedLegacy(appData: string, serverUrl: string, dirName = 'tintin-client-electron'): string {
    const configDir = join(appData, dirName, 'config')
    mkdirSync(configDir, { recursive: true })
    // Flat dot-key shape observed on the real fleet machine.
    writeFileSync(join(configDir, 'server.json'), JSON.stringify({ 'server.url': serverUrl }), 'utf8')
    return configDir
  }

  it('finds the legacy config dir under the old client userData (both names)', () => {
    dir = join(tmpdir(), `tintin-mig-${Date.now()}`)
    const configDir = seedLegacy(dir, 'http://192.168.111.31:8000')
    expect(findLegacyConfigDir(dir)).toBe(configDir)
    expect(findLegacyConfigDir(join(dir, 'nonexistent'))).toBeNull()
  })

  it('reads the flat server.url dot-key from the legacy server.json', () => {
    dir = join(tmpdir(), `tintin-mig-${Date.now()}`)
    const configDir = seedLegacy(dir, 'http://192.168.111.31:8000')
    expect(readLegacyConfig(configDir)).toEqual([{ path: ['server', 'url'], value: 'http://192.168.111.31:8000' }])
  })

  it('also reads the productName-named dir and nested shape', () => {
    dir = join(tmpdir(), `tintin-mig-${Date.now()}`)
    const configDir = join(dir, '螺丝钉-电商智能体矩阵', 'config')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, 'server.json'), JSON.stringify({ server: { url: 'http://10.0.0.9:9000' } }), 'utf8')
    expect(readLegacyConfig(configDir)).toEqual([{ path: ['server', 'url'], value: 'http://10.0.0.9:9000' }])
  })

  it('plans only values that differ from current settings (idempotent)', () => {
    dir = join(tmpdir(), `tintin-mig-${Date.now()}`)
    const configDir = seedLegacy(dir, 'http://192.168.111.31:8000')
    // Not yet configured → migrate.
    expect(planLegacyMigration(configDir, {})).toHaveLength(1)
    // Already at the same value → no-op.
    expect(planLegacyMigration(configDir, { server: { url: 'http://192.168.111.31:8000' } })).toHaveLength(0)
  })

  it('skips a malformed legacy file instead of failing', () => {
    dir = join(tmpdir(), `tintin-mig-${Date.now()}`)
    const configDir = join(dir, '螺丝钉-电商智能体矩阵', 'config')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, 'server.json'), '{not json', 'utf8')
    expect(readLegacyConfig(configDir)).toEqual([])
  })
})

describe('tintin settings.yaml.imported recovery (0.1.7 migration gap)', () => {
  let dir: string
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

  // Shape captured on the real fleet machine after the 0.1.7 upgrader renamed
  // the store: upstream sections alongside our stranded tintin-bundle one.
  const IMPORTED_YAML = `ui-onboarding:
  welcomeNoticeVersion: 2026-08-13.1
tintin-bundle:
  server:
    url: http://192.168.111.31:8000
    provisioned: true
  local:
    cacheDir: D:\\Media\\cache
llm-pi-ai:
  providers:
    tintin-server:
      baseURL: http://192.168.111.31:8000/llm
`

  function seedImported(yaml = IMPORTED_YAML): string {
    dir = join(tmpdir(), `tintin-rec-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'settings.yaml.imported')
    writeFileSync(file, yaml, 'utf8')
    return file
  }

  it('reads only the tintin-bundle section from the renamed store', () => {
    const section = readImportedTintinSection(seedImported())
    expect(section).toEqual({
      server: { url: 'http://192.168.111.31:8000', provisioned: true },
      local: { cacheDir: 'D:\\Media\\cache' },
    })
  })

  it('returns null when the file or section is absent or malformed', () => {
    expect(readImportedTintinSection(join(tmpdir(), 'no-such-file.yml'))).toBeNull()
    expect(readImportedTintinSection(seedImported('llm-pi-ai:\n  providers: {}\n'))).toBeNull()
    expect(readImportedTintinSection(seedImported('{not: [yaml'))).toBeNull()
  })

  it('plans recovery only for leaves still empty in the new config', () => {
    const section = readImportedTintinSection(seedImported())
    // Nothing configured after the upgrade → recover every leaf.
    expect(planImportedSettingsRecovery(section, {})).toEqual([
      { path: ['server', 'url'], value: 'http://192.168.111.31:8000' },
      { path: ['server', 'provisioned'], value: true },
      { path: ['local', 'cacheDir'], value: 'D:\\Media\\cache' },
    ])
    // server.url re-set by the user post-upgrade → keep it, fill the rest.
    expect(planImportedSettingsRecovery(section, { server: { url: 'http://10.0.0.2:1' } })).toEqual([
      { path: ['server', 'provisioned'], value: true },
      { path: ['local', 'cacheDir'], value: 'D:\\Media\\cache' },
    ])
    // Fully recovered → no-op on the next boot (idempotent).
    expect(planImportedSettingsRecovery(section, {
      server: { url: 'http://192.168.111.31:8000', provisioned: true },
      local: { cacheDir: 'D:\\Media\\cache' },
    })).toEqual([])
  })

  it('plans nothing for a null section', () => {
    expect(planImportedSettingsRecovery(null, {})).toEqual([])
  })
})
