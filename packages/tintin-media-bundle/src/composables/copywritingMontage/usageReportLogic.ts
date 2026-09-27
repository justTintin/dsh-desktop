// ═══════════════════════════════════════════════════════════════
// usageReportLogic.ts — 素材使用量上报·纯逻辑（2026-09-27 服务端交付对接）
// 对接服务端 POST /material/usage/report（kind + task_id + clips）：
//   · task_id = 幂等键（每次导出唯一，重试复用同 id 不双计）；
//   · clips = 素材 id（优先）或服务端可解析路径（兜底）；
//   · 传输失败最多补重 2 次（共 3 次尝试）；传输成功但业务 ok:false 不重试
//     （重试不改变结果，如服务端 DB 异常）；
//   · 全程不抛出——上报失败绝不阻断导出主流程（服务端规格原文）。
// ═══════════════════════════════════════════════════════════════

/** 剪映草稿导出场景的固定 kind（其他本地工具上报时用别的 kind） */
export const USAGE_REPORT_KIND_JIANYING_DRAFT = 'jianying_draft'
/** 传输失败后的额外重试次数（总尝试 = 1 + maxRetries） */
export const USAGE_REPORT_MAX_RETRIES = 2
/** 重试间隔（毫秒） */
export const USAGE_REPORT_RETRY_DELAY_MS = 2000

export interface UsageReportPayload {
  kind: string
  task_id: string
  clips: Array<string | number>
}

export interface UsageReportOutcome {
  ok: boolean
  counted?: number
  duplicate?: boolean
  skipped?: boolean
  error?: string
}

/** task_id 生成：draft-<36 进制时间戳>-<3 位随机>（每次导出唯一，幂等键） */
export function nextUsageTaskId(now: number = Date.now(), rand: () => number = Math.random): string {
  const r = Math.floor(rand() * 46656).toString(36).padStart(3, '0')
  return `draft-${now.toString(36)}-${r}`
}

/** 组装上报载荷：去重保序（数值按值、字符串按去除首尾空白后的全文），剔除空值 */
export function buildUsageReportPayload(
  taskId: string,
  clips: Array<string | number>,
): UsageReportPayload {
  const seen = new Set<string>()
  const out: Array<string | number> = []
  for (const c of clips || []) {
    if (typeof c === 'number') {
      if (!Number.isFinite(c)) continue
      const k = `n${c}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push(c)
      continue
    }
    const s = String(c || '').trim()
    if (!s) continue
    if (seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return { kind: USAGE_REPORT_KIND_JIANYING_DRAFT, task_id: String(taskId || ''), clips: out }
}

export interface MaterialUsageReporterDeps {
  /** 传输函数：成功返回服务端响应体；任何失败请抛出（会进入重试） */
  post: (payload: UsageReportPayload) => Promise<
    { ok?: boolean; counted?: number; duplicate?: boolean; error?: string } | null | undefined
  >
  /** 失败后的额外重试次数（默认 2，总尝试 = 1 + maxRetries） */
  maxRetries?: number
  /** 重试间隔毫秒（默认 2000；测试传 0） */
  delayMs?: number
  /** 静默降级时的日志出口（不抛出） */
  log?: (...args: unknown[]) => void
}

/**
 * 创建素材使用量上报器。用法：剪映草稿导出**成功后** fire-and-forget 调用
 * reportUsage(clips)——传输失败最多补重 maxRetries 次（复用同一 task_id，
 * 幂等不双计）；传输成功但业务 ok:false 不重试（重试不改变结果）。
 */
export function createMaterialUsageReporter(deps: MaterialUsageReporterDeps) {
  const maxRetries = deps.maxRetries ?? USAGE_REPORT_MAX_RETRIES
  const delayMs = deps.delayMs ?? USAGE_REPORT_RETRY_DELAY_MS
  const log = deps.log ?? (() => {})
  return {
    /** 上报一批素材的使用量；返回结果不抛出（失败以 ok:false 表达） */
    async reportUsage(
      clips: Array<string | number>,
      taskId = nextUsageTaskId(),
    ): Promise<UsageReportOutcome> {
      const payload = buildUsageReportPayload(taskId, clips)
      if (!payload.clips.length) {
        log('usage report skipped: no clips')
        return { ok: false, skipped: true, error: '没有可上报的素材' }
      }
      let last: UsageReportOutcome = { ok: false, error: '未尝试' }
      for (let i = 0; i <= maxRetries; i++) {
        let res: { ok?: boolean; counted?: number; duplicate?: boolean; error?: string } | null | undefined
        try {
          res = await deps.post(payload)
        } catch (e) {
          // 传输层失败（网络/HTTP 错误码）→ 可重试
          last = { ok: false, error: e instanceof Error ? e.message : String(e) }
          if (i < maxRetries && delayMs > 0) {
            await new Promise((r) => setTimeout(r, delayMs))
          }
          continue
        }
        if (!res || typeof res !== 'object') {
          // 非 JSON 响应（如网关裸错误页）→ 视为传输失败
          last = { ok: false, error: '上报通道不可用' }
          if (i < maxRetries && delayMs > 0) {
            await new Promise((r) => setTimeout(r, delayMs))
          }
          continue
        }
        // 传输成功：业务结果不重试（如服务端 DB 异常 ok:false，重试不改变结果）
        last = {
          ok: res.ok === true,
          counted: res.counted,
          duplicate: res.duplicate,
          error: typeof res.error === 'string' ? res.error : undefined,
        }
        break
      }
      if (!last.ok) {
        log('usage report failed:', last.error)
      }
      return last
    },
  }
}
