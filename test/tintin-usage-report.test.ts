// test/tintin-usage-report.test.ts — 素材使用量上报·纯逻辑回归（服务端
// POST /material/usage/report 对接，2026-09-27 服务端交付规格）：
//   · 命名：task_id 每次导出唯一（幂等键），重试复用同 id 不双计
//   · 载荷：kind=jianying_draft、clips 去重保序、剔除空值
//   · 重试：传输失败最多补重 2 次（共 3 次尝试），重试复用同载荷；
//     传输成功但业务 ok:false 不重试（重试不改变结果）
//   · 容错：全程不抛出（上报失败绝不阻断导出主流程）
import { describe, expect, it, vi } from 'vitest'
import {
  buildUsageReportPayload,
  createMaterialUsageReporter,
  nextUsageTaskId,
} from '../packages/tintin-media-bundle/src/composables/copywritingMontage/usageReportLogic'

type PostResult = { ok?: boolean; counted?: number; duplicate?: boolean; error?: string } | null | undefined
type Post = (payload: { kind: string; task_id: string; clips: Array<string | number> }) => Promise<PostResult>

describe('nextUsageTaskId', () => {
  it('draft- 前缀 + 唯一性', () => {
    const a = nextUsageTaskId()
    const b = nextUsageTaskId()
    expect(a).toMatch(/^draft-/)
    expect(a).not.toBe(b)
  })
})

describe('buildUsageReportPayload', () => {
  it('kind 固定 jianying_draft、task_id 透传、clips 去重保序', () => {
    const p = buildUsageReportPayload('draft-x', [101, '/a.mp4', 101, '/a.mp4', 102])
    expect(p).toEqual({ kind: 'jianying_draft', task_id: 'draft-x', clips: [101, '/a.mp4', 102] })
  })

  it('剔除空串与非有限数值', () => {
    const p = buildUsageReportPayload('draft-x', ['', '  ', Number.NaN, '/keep.mp4'])
    expect(p.clips).toEqual(['/keep.mp4'])
  })
})

describe('createMaterialUsageReporter', () => {
  const clips = ['/srv/seg_01.mp4', '/srv/seg_02.mp4']

  it('成功：仅上报一次，透传 counted/duplicate，载荷含 kind/task_id/clips', async () => {
    const calls: Array<{ task_id: string; clips: Array<string | number> }> = []
    const post: Post = async (payload) => {
      calls.push({ task_id: payload.task_id, clips: payload.clips })
      return { ok: true, counted: 2, duplicate: false }
    }
    const reporter = createMaterialUsageReporter({ post, delayMs: 0 })
    const out = await reporter.reportUsage(clips, 'draft-t1')
    expect(out).toEqual({ ok: true, counted: 2, duplicate: false })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.task_id).toBe('draft-t1')
    expect(calls[0]?.clips).toEqual(clips)
  })

  it('首次传输失败 → 重试复用同一 task_id（幂等键不变）', async () => {
    let n = 0
    const taskIds: string[] = []
    const post: Post = async (payload) => {
      n += 1
      taskIds.push(payload.task_id)
      if (n === 1) throw new Error('connect ECONNREFUSED')
      return { ok: true, counted: 1 }
    }
    const reporter = createMaterialUsageReporter({ post, delayMs: 0 })
    const out = await reporter.reportUsage(clips, 'draft-t2')
    expect(out.ok).toBe(true)
    expect(n).toBe(2)
    expect(taskIds[0]).toBe(taskIds[1])
  })

  it('持续失败 → 1 + maxRetries 次尝试后静默返回 {ok:false}，不抛出', async () => {
    let n = 0
    const post: Post = async () => { n += 1; throw new Error('HTTP 404') }
    const reporter = createMaterialUsageReporter({ post, maxRetries: 2, delayMs: 0 })
    const out = await reporter.reportUsage(clips, 'draft-t3')
    expect(out.ok).toBe(false)
    expect(n).toBe(3)
    expect(String(out.error)).toContain('404')
  })

  it('传输成功但业务 ok:false（如 DB 异常）→ 不重试，原样透传', async () => {
    let n = 0
    const post: Post = async () => { n += 1; return { ok: false, error: 'db down' } }
    const reporter = createMaterialUsageReporter({ post, delayMs: 0 })
    const out = await reporter.reportUsage(clips, 'draft-t4')
    expect(out).toEqual({ ok: false, error: 'db down' })
    expect(n).toBe(1)
  })

  it('响应为 null（离线）→ 视为失败进入重试', async () => {
    let n = 0
    const post: Post = async () => { n += 1; return null }
    const reporter = createMaterialUsageReporter({ post, maxRetries: 1, delayMs: 0 })
    const out = await reporter.reportUsage(clips, 'draft-t5')
    expect(out.ok).toBe(false)
    expect(n).toBe(2)
  })

  it('空 clips → 不发请求', async () => {
    let n = 0
    const post: Post = async () => { n += 1; return { ok: true } }
    const reporter = createMaterialUsageReporter({ post })
    await reporter.reportUsage([])
    expect(n).toBe(0)
  })
})
