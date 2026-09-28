// 2026-09-28 直注册改造：五个角色预设在插件激活时直接进入宿主 agentPresets
// 注册表。旧链路（复制到 $DSH_HOME/.agent-presets → 迁移转换进 Profile
// patch）留下的是会过期、会被写坏的运行时状态副本——existingIds 规则使转换
// 结果永不更新，一次残损曾把整个客户端逼进安全模式。直注册后预设永远等于
// 包内文件，随包升级即更新。解析必须走宿主自己的 entryListSchema：!!js 条件
// 表达式与 patch 声明路径同源同语义，这是等价性的根据。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import jsYaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

/** Parse one preset directory into an agentPresets.register() definition. */
export function loadPresetDefinition(dir) {
  const id = basename(dir)
  const composition = readFileSync(join(dir, 'agent.cordis.yml'), 'utf8').replace(/^\uFEFF/u, '')
  const plugins = jsYaml.load(composition, { schema: entryListSchema })
  if (!Array.isArray(plugins) || plugins.length === 0) throw new Error(`${id}: agent.cordis.yml must contain a plugin list`)
  const meta = existsSync(join(dir, 'preset.yml'))
    ? jsYaml.load(readFileSync(join(dir, 'preset.yml'), 'utf8')) ?? {}
    : {}
  const definition = { id, name: typeof meta.name === 'string' && meta.name ? meta.name : id, plugins }
  if (typeof meta.description === 'string' && meta.description) definition.description = meta.description
  if (typeof meta.order === 'number' && Number.isFinite(meta.order)) definition.order = meta.order
  return definition
}

/** Load every preset directory under srcRoot, sorted by id. Throws on the first defect. */
export function loadPresetDefinitions(srcRoot) {
  const definitions = []
  for (const entry of readdirSync(srcRoot).sort()) {
    const dir = join(srcRoot, entry)
    if (!statSync(dir).isDirectory()) continue
    definitions.push(loadPresetDefinition(dir))
  }
  return definitions
}
