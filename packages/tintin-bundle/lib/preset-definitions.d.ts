// preset-definitions.d.ts — 角色预设直注册类型（实现见同目录 preset-definitions.js）
/** agentPresets.register() 的定义形态（dsh-agent-preset-registry AgentPreset Config） */
export interface AgentPresetDefinition {
  id: string
  name: string
  description?: string
  order?: number
  /** 宿主 entryListSchema 解析出的插件清单（含 !!js 条件求值结果） */
  plugins: Array<Record<string, unknown>>
}

/** 解析单个预设目录为注册定义；任何缺陷抛带预设 id 的错误 */
export function loadPresetDefinition(dir: string): AgentPresetDefinition

/** 按 id 排序加载 srcRoot 下全部预设目录；包内文件缺陷整体抛错，不半注册 */
export function loadPresetDefinitions(srcRoot: string): AgentPresetDefinition[]
