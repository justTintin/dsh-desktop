// test/tintin-agent-tools.test.ts — WP-5 agent 工具组回归（lib/agent-tools.js）
// 覆盖：纯函数（extractFirstJson/normalizePlanInputs/visionDataUrl）+ 四个工具
// 的参数校验、失败语义（{error}，不打断会话回路）、离线形态与返回形状契约。
import { describe, expect, it } from 'vitest'
import {
  createTintinAgentTools,
  extractFirstJson,
  normalizePlanInputs,
  visionDataUrl,
  PLAN_BUSINESS_SYSTEM_PROMPT,
} from '../packages/tintin-bundle/lib/agent-tools.js'

const noopLog = { log: () => {}, warn: () => {} }

describe('纯函数', () => {
  it('extractFirstJson：裸 JSON / markdown 包裹 / 非法 → null', () => {
    expect(extractFirstJson('{"steps":[]}')).toEqual({ steps: [] })
    expect(extractFirstJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractFirstJson('没有 JSON')).toBeNull()
    expect(extractFirstJson('[1,2]')).toBeNull()
    expect(extractFirstJson('')).toBeNull()
  })

  it('normalizePlanInputs：type trim / inputs 过滤 / prefer 缺省不产出', () => {
    expect(normalizePlanInputs({ type: ' 数字人口播 ', inputs: ['image', '', 3], prefer: 'auto' }))
      .toEqual({ type: '数字人口播', inputs: ['image', '3'], prefer: 'auto' })
    expect(normalizePlanInputs({ type: 'x' })).toEqual({ type: 'x', inputs: [] })
    expect(normalizePlanInputs(undefined)).toEqual({ type: '', inputs: [] })
  })

  it('visionDataUrl：按扩展名选 mime，未知回退 jpeg', () => {
    const buf = Buffer.from('x')
    expect(visionDataUrl(buf, 'a.png')).toBe(`data:image/png;base64,${buf.toString('base64')}`)
    expect(visionDataUrl(buf, 'b.JPG')).toBe(`data:image/jpeg;base64,${buf.toString('base64')}`)
    expect(visionDataUrl(buf, 'c.weird')).toBe(`data:image/jpeg;base64,${buf.toString('base64')}`)
  })
})

describe('createTintinAgentTools', () => {
  it('返回四个工具定义，name 契约固定', () => {
    const tools = createTintinAgentTools({ httpRequest: async () => ({ data: {} }) })
    expect(tools.map((t) => (t as { name: string }).name)).toEqual([
      'plan_media_workflow', 'plan_business_task', 'vision_analyze', 'montage_split_clips',
    ])
  })

  it('缺少 httpRequest 工厂即抛错（接线错误显性化）', () => {
    expect(() => createTintinAgentTools({})).toThrow(/httpRequest/)
  })

  it('plan_media_workflow：type 缺失返 {error}；正常透传服务端载荷', async () => {
    const calls: Array<{ path: string; body: unknown }> = []
    const tools = createTintinAgentTools({
      httpRequest: async (_m, path, opts) => { calls.push({ path, body: opts?.body }); return { data: { ready: true, workflow_id: 'wf1' } } },
      ...noopLog,
    })
    const plan = tools[0] as { execute: (a?: unknown) => Promise<unknown> }
    expect(await plan.execute({})).toEqual({ error: 'workflow_type 必填：媒体工作流类型' })
    const ok = await plan.execute({ workflow_type: '数字人口播', inputs: ['image'] }) as { ready: boolean; plan: { workflow_id: string } }
    expect(ok.ready).toBe(true)
    expect(ok.plan.workflow_id).toBe('wf1')
    expect(calls[0]?.path).toBe('/workflow/plan')
    expect(calls[0]?.body).toEqual({ type: '数字人口播', inputs: ['image'] })
  })

  it('plan_business_task：steps JSON 解析成功路径与 raw 回退路径', async () => {
    let reply = '好的：{"steps":[{"title":"一","detail":"做"}]}'
    const tools = createTintinAgentTools({
      httpRequest: async (_m, _p, opts) => {
        const body = (opts?.body ?? {}) as { messages?: Array<{ role: string; content: string }>; stream?: boolean }
        expect(body.messages?.[0]?.content).toBe(PLAN_BUSINESS_SYSTEM_PROMPT)
        expect(body.stream).toBe(false)
        return { data: { choices: [{ message: { content: reply } }] } }
      },
      ...noopLog,
    })
    const biz = tools[1] as { execute: (a?: unknown) => Promise<unknown> }
    expect(await biz.execute({ goal: '' })).toEqual({ error: 'goal 必填：要拆解的业务目标' })
    expect(await biz.execute({ goal: '做一条混剪' })).toEqual({ steps: [{ title: '一', detail: '做' }] })
    reply = '模型没输出 JSON'
    expect(await biz.execute({ goal: '做一条混剪' })).toEqual({ raw: '模型没输出 JSON' })
  })

  it('vision_analyze：读文件 → data URL → 多模态消息；超大图拦截', async () => {
    const small = Buffer.from('fake-image')
    let seen: { url: string; question: string } | null = null
    const tools = createTintinAgentTools({
      httpRequest: async (_m, _p, opts) => {
        const body = opts?.body as { messages?: Array<{ content?: Array<{ type: string; text?: string; image_url?: { url: string } }> }> }
        const parts = body.messages?.[0]?.content ?? []
        seen = { url: parts.find((x) => x.type === 'image_url')?.image_url?.url ?? '', question: parts.find((x) => x.type === 'text')?.text ?? '' }
        return { data: { choices: [{ message: { content: '画面OK' } }] } }
      },
      readFile: async () => small,
      ...noopLog,
    })
    const vision = tools[2] as { execute: (a?: unknown) => Promise<unknown> }
    expect(await vision.execute({})).toEqual({ error: 'image_path 必填：本地图片绝对路径' })
    expect((await vision.execute({ image_path: 'C:/a.png' }))).toEqual({ answer: '画面OK' })
    expect(seen!.url).toBe(`data:image/png;base64,${small.toString('base64')}`)
    expect(seen!.question).toContain('评估其作为电商素材的质量')

    const big = Buffer.alloc(10 * 1024 * 1024 + 1)
    const toolsBig = createTintinAgentTools({ httpRequest: async () => ({ data: {} }), readFile: async () => big, ...noopLog })
    const visionBig = toolsBig[2] as { execute: (a?: unknown) => Promise<unknown> }
    expect(await visionBig.execute({ image_path: 'C:/big.png' })).toMatchObject({ error: /10MB/ })
  })

  it('montage_split_clips：复用 callNative(montage:split)，通道 error/离线如实上抛', async () => {
    const seen: Array<[string, unknown]> = []
    const tools = createTintinAgentTools({
      httpRequest: async () => ({ data: {} }),
      callNative: async (channel, args) => {
        seen.push([channel, args])
        return { shots: [{ start_sec: 0 }] }
      },
      ...noopLog,
    })
    const split = tools[3] as { execute: (a?: unknown) => Promise<unknown> }
    expect(await split.execute({})).toEqual({ error: 'video_path 必填：本地视频绝对路径' })
    const ok = await split.execute({ video_path: 'C:/v.mp4', threshold: 30 }) as { result: { shots: unknown[] } }
    expect(ok.result.shots.length).toBe(1)
    expect(seen[0]?.[0]).toBe('montage:split')
    expect(seen[0]?.[1]).toEqual([{ file: { path: 'C:/v.mp4' }, threshold: 30 }])
  })

  it('httpRequest 抛错（含离线）→ {error} 形态，不 reject', async () => {
    const tools = createTintinAgentTools({
      httpRequest: async () => { throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) },
      ...noopLog,
    })
    const plan = tools[0] as { execute: (a?: unknown) => Promise<unknown> }
    expect(await plan.execute({ workflow_type: 'x' })).toEqual({ error: 'TinTin 服务端离线' })
  })
})
