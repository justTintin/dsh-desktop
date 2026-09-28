// 直注册（2026-09-28）的可加载性行为锚点：五个角色预设必须能用宿主自己的
// entryListSchema 解析成 register() 定义——!!js 条件表达式与 patch 声明路径
// 同源同语义。旧的"查文件存在"锚点查不出 duplicated mapping key（五源同损
// 事故），只有真实解析能查出来。
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { loadPresetDefinition, loadPresetDefinitions } from '../packages/tintin-bundle/lib/preset-definitions.js'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

it('loads all five role presets as registerable definitions', () => {
  const definitions = loadPresetDefinitions(join(import.meta.dirname, '../packages/tintin-bundle/presets'))
  expect(definitions.map((definition) => definition.id)).toEqual([
    'tintin-assistant',
    'tintin-director',
    'tintin-librarian',
    'tintin-producer',
    'tintin-qc',
  ])
  for (const definition of definitions) {
    expect(definition.plugins.length).toBe(18)
    expect(typeof definition.name).toBe('string')
    expect(definition.name.length).toBeGreaterThan(0)
    expect(typeof definition.order).toBe('number')
    const delegation = definition.plugins.find((entry: { id?: string }) => entry.id === 'delegation') as
      | { config?: Array<Record<string, unknown>> }
      | undefined
    // workflow 族已剥除：delegation 只剩 subagent 家族 6 行，不再有等不到
    // workflowEngine 的行（0.1.7 闭包无 worker，五卡"加载失败"事故锚点）。
    expect(delegation?.config?.length).toBe(6)
    // !!js 条件行解析成功 = 与 patch 声明路径同语义（tool-bash/tool-pwsh）。
    expect(definition.plugins.filter((entry: { disabled?: unknown }) => 'disabled' in entry).length).toBe(2)
  }
})

it('names the defective preset id and rejects non-list compositions', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-preset-defs-'))
  dirs.push(home)
  const broken = join(home, 'tintin-broken')
  await mkdir(broken, { recursive: true })
  await writeFile(join(broken, 'agent.cordis.yml'), 'not a plugin list\n')
  expect(() => loadPresetDefinition(broken)).toThrow(/tintin-broken/)
  // 包内文件缺陷按整体失败处理：响亮抛错而不是静默半注册。
  expect(() => loadPresetDefinitions(home)).toThrow(/tintin-broken/)
  const empty = await mkdtemp(join(tmpdir(), 'dsh-preset-empty-'))
  dirs.push(empty)
  expect(loadPresetDefinitions(empty)).toEqual([])
})
