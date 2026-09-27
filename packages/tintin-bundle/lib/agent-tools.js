// agent-tools — TinTin 业务能力 defineTool 工具组（WP-5，2026-09-25 用户裁决：
// 任务拆解路由服务端 + 合理使用服务端能力 + 聚焦业务；dsh 底层零改动——工具经
// 上游插件 API defineTool 注册，执行经注入的 httpRequest/callNative/readFile
// 落到服务端算力端点或已移植的本地通道）。
//
// 失败语义：工具内 catch → 返回 {error}（agent 可读并自纠，不打断会话回路）；
// 返回形状与 output.schema 声明严格一致（多余字段收拢进 plan/result/raw）。
// 纯函数（extractFirstJson/normalizePlanInputs/visionDataUrl）单测下沉于
// test/tintin-agent-tools.test.ts。
import { isExpectedOfflineError } from './server-proxy.js'

const errText = (e) => (e instanceof Error ? e.message : String(e))
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

/** 从模型输出提取首个 JSON 对象（parseAiCopyJson 同口径；失败返 null） */
export function extractFirstJson(text) {
  const src = String(text || '')
  if (!src) return null
  const m = src.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const d = JSON.parse(m[0])
    return isObj(d) ? d : null
  } catch {
    return null
  }
}

/** /workflow/plan 入参归一化：type 必填 trim，inputs 字符串数组，prefer 白外透传 */
export function normalizePlanInputs(args) {
  const type = String(args?.type || '').trim()
  const inputs = Array.isArray(args?.inputs) ? args.inputs.map((x) => String(x)).filter(Boolean) : []
  const prefer = String(args?.prefer || '').trim()
  return { type, inputs, ...(prefer ? { prefer } : {}) }
}

/** 识图图片 → data URL（mime 按扩展名，缺省 jpeg；超大图由调用方拦截） */
export function visionDataUrl(buffer, filePath) {
  const ext = String(filePath || '').toLowerCase().replace(/.*\./, '')
  const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' }[ext] || 'image/jpeg'
  return `data:${mime};base64,${buffer.toString('base64')}`
}

/** 通用业务拆解 system prompt（服务端 LLM 一次性规划，本地回路执行） */
export const PLAN_BUSINESS_SYSTEM_PROMPT =
  '你是任务规划器。把用户目标拆解为可由工具执行的步骤清单，只输出 JSON：' +
  '{"steps":[{"title":"步骤名","detail":"怎么做（引用可用能力/工具/文件）"}]}，' +
  '不要输出多余内容。步骤数量控制在 8 步以内，每步 detail 必须可独立执行与验证。'

export function createTintinAgentTools({ httpRequest, callNative, readFile, log = () => {}, warn = () => {} } = {}) {
  if (typeof httpRequest !== 'function') throw new Error('createTintinAgentTools requires httpRequest')

  const offline = (e) => (isExpectedOfflineError(e) ? 'TinTin 服务端离线' : errText(e))
  const chatJson = async (messages, timeout) => {
    const result = await httpRequest('POST', '/llm/chat/completions', {
      body: {
        model: '',
        messages,
        temperature: 0.3,
        stream: false,
      },
      timeout,
    })
    return result?.data
  }
  const chatContent = (data) => String(data?.choices?.[0]?.message?.content || '')

  // 1. plan_media_workflow — 媒体工作流拆解（POST /workflow/plan，2026-09-25
  //    活服务端实测在：需求 → 执行计划（不执行）+ 执行端路由选型）。
  const planMediaWorkflow = {
    name: 'plan_media_workflow',
    description:
      'Ask the TinTin server to turn a media workflow requirement into an execution plan ' +
      '(input contract check + backend routing + model selection, no execution). ' +
      'When ready=true the plan carries workflow_id/backend/selection. ' +
      'Use before heavy media work to pick the right backend.',
    parameters: {
      // 参数名不可用 `type`——defineTool 的 schema 编译器把 parameters.type
      // 当作类型槽（保留键），同名参数会让整个插件注册段崩溃（2026-09-27 实测）。
      workflow_type: { type: 'string', required: true, description: '工作流类型（服务端节点工作流引擎域，如 数字人口播）' },
      inputs: { type: 'array', items: { type: 'string' }, description: '可用输入清单（image/audio/video/prompt 等）' },
      prefer: { type: 'string', description: '执行端偏好：auto/local/runninghub' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        ready: { type: 'boolean' }, plan: { type: 'object' }, error: { type: 'string' },
      } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    timeoutMs: 60_000,
    isConcurrencySafe: () => true,
    presentCall: (args) => ({ card: 'generic', kind: 'execute', title: 'Plan media workflow (server)', rawInput: args }),
    async execute(args) {
      const body = normalizePlanInputs({ type: args?.workflow_type, inputs: args?.inputs, prefer: args?.prefer })
      if (!body.type) return { error: 'workflow_type 必填：媒体工作流类型' }
      try {
        log('agent-tools', 'plan_media_workflow', body.type)
        const res = await httpRequest('POST', '/workflow/plan', { body, timeout: 55_000 })
        return { ready: true, plan: res?.data ?? res }
      } catch (e) {
        warn('agent-tools', 'plan_media_workflow failed:', errText(e))
        return { error: offline(e) }
      }
    },
  }

  // 2. plan_business_task — 通用业务任务拆解（服务端 LLM 一次性规划；
  //    本地 harness 回路按步骤执行。不复活 /agent/* 编排）。
  const planBusinessTask = {
    name: 'plan_business_task',
    description:
      'Break a business goal into an executable step list using the TinTin server LLM ' +
      '(one-shot planning; you execute the steps yourself with available tools). ' +
      'Returns {steps:[{title,detail}]}; falls back to {raw} when the model output is not JSON.',
    parameters: {
      goal: { type: 'string', required: true, description: '要拆解的业务目标（一句话）' },
      context: { type: 'string', description: '补充上下文（产品/素材/脚本要点，可选）' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        steps: { type: 'array', items: { type: 'object' } }, raw: { type: 'string' }, error: { type: 'string' },
      } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    timeoutMs: 120_000,
    isConcurrencySafe: () => true,
    presentCall: (args) => ({ card: 'generic', kind: 'execute', title: 'Plan business task (server LLM)', rawInput: args }),
    async execute(args) {
      const goal = String(args?.goal || '').trim()
      if (!goal) return { error: 'goal 必填：要拆解的业务目标' }
      const userText = args?.context ? `目标：${goal}\n\n上下文：\n${String(args.context).slice(0, 4000)}` : `目标：${goal}`
      try {
        log('agent-tools', 'plan_business_task', goal.slice(0, 80))
        const data = await chatJson([
          { role: 'system', content: PLAN_BUSINESS_SYSTEM_PROMPT },
          { role: 'user', content: userText },
        ], 115_000)
        const parsed = extractFirstJson(chatContent(data))
        if (parsed && Array.isArray(parsed.steps)) return { steps: parsed.steps.filter(isObj) }
        return { raw: chatContent(data) || JSON.stringify(data).slice(0, 2000) }
      } catch (e) {
        warn('agent-tools', 'plan_business_task failed:', errText(e))
        return { error: offline(e) }
      }
    },
  }

  // 3. vision_analyze — 识图（/llm/chat/completions 多模态 image_url，
  //    服务端选视觉模型；不经对话主回路的 LLM）。图片从本地路径读取。
  const VISION_MAX_BYTES = 10 * 1024 * 1024
  const visionAnalyze = {
    name: 'vision_analyze',
    description:
      'Analyze a local image with the TinTin server vision model (multimodal chat; ' +
      'the server picks the vision model). Use for 封面/成片/素材画面质量检查、' +
      '内容描述与一致性核对. Returns {answer}.',
    parameters: {
      image_path: { type: 'string', required: true, description: '本地图片绝对路径（png/jpg/jpeg/webp/gif/bmp，≤10MB）' },
      question: { type: 'string', description: '要回答的问题；缺省为整体描述与质量评估' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        answer: { type: 'string' }, error: { type: 'string' },
      } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    timeoutMs: 120_000,
    isConcurrencySafe: () => true,
    presentCall: (args) => ({ card: 'generic', kind: 'execute', title: 'Analyze image (server vision)', rawInput: args }),
    async execute(args) {
      const imagePath = String(args?.image_path || '').trim()
      if (!imagePath) return { error: 'image_path 必填：本地图片绝对路径' }
      if (typeof readFile !== 'function') return { error: '宿主未注入文件读取能力' }
      try {
        const buf = await readFile(imagePath)
        if (!buf || !buf.length) return { error: '图片为空或不可读' }
        if (buf.length > VISION_MAX_BYTES) return { error: `图片超过 10MB（${Math.round(buf.length / 1024 / 1024)}MB），请压缩后再试` }
        const question = String(args?.question || '').trim() || '请描述这张图片的内容，并评估其作为电商素材的质量与改进点。'
        const data = await chatJson([
          { role: 'user', content: [
            { type: 'text', text: question },
            { type: 'image_url', image_url: { url: visionDataUrl(buf, imagePath) } },
          ] },
        ], 115_000)
        const answer = chatContent(data)
        if (!answer) return { error: '视觉模型未返回内容' }
        return { answer }
      } catch (e) {
        warn('agent-tools', 'vision_analyze failed:', errText(e))
        return { error: offline(e) }
      }
    },
  }

  // 4. montage_split_clips — 智能镜头分割（复用已移植 montage:split 本地通道，
  //    POST /montage/split 服务端算力）。长任务：禁并发，超时 10 分钟。
  const montageSplitClips = {
    name: 'montage_split_clips',
    description:
      'Split a local video into shots via the TinTin server (montage/split, scene detection ' +
      '+ optional per-shot analysis). Returns {shots:[{start_sec,end_sec,filename,...]}}. ' +
      'Long-running (minutes); do not call in parallel with other media jobs.',
    parameters: {
      video_path: { type: 'string', required: true, description: '本地视频绝对路径' },
      threshold: { type: 'number', description: '切分敏感度 1-100（越小越敏感，默认 27）' },
      min_scene_len: { type: 'number', description: '最小镜头秒数（默认 0.5）' },
      product_mode: { type: 'boolean', description: '产品视频模式' },
      analyze: { type: 'boolean', description: '逐镜分析（美学评分/景别/产品识别），默认 true' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        result: { type: 'object' }, error: { type: 'string' },
      } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    timeoutMs: 600_000,
    isConcurrencySafe: () => false,
    presentCall: (args) => ({ card: 'generic', kind: 'execute', title: 'Split video into shots', rawInput: args }),
    async execute(args) {
      const videoPath = String(args?.video_path || '').trim()
      if (!videoPath) return { error: 'video_path 必填：本地视频绝对路径' }
      if (typeof callNative !== 'function') return { error: '宿主未注入本地通道' }
      try {
        const payload = { file: { path: videoPath } }
        for (const k of ['threshold', 'min_scene_len', 'analyze', 'product_mode']) {
          if (args?.[k] !== undefined) payload[k] = args[k]
        }
        const result = await callNative('montage:split', [payload])
        if (result && typeof result === 'object' && 'error' in result && result.error) return { error: String(result.error) }
        if (result === null || result === undefined) return { error: 'TinTin 服务端离线' }
        return { result }
      } catch (e) {
        warn('agent-tools', 'montage_split_clips failed:', errText(e))
        return { error: offline(e) }
      }
    },
  }

  return [planMediaWorkflow, planBusinessTask, visionAnalyze, montageSplitClips]
}
