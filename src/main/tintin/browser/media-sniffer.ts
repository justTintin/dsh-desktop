// media-sniffer.ts — 浏览器媒体嗅探引擎（SRC browser-webview.js 注入方案的壳侧等价）。
// SRC 形态=webview 注入 hook fetch/XHR/MSE；本仓浏览器为原生 WebContentsView（无
// 渲染层注入面），改为 session.webRequest 监听资源请求，URL 规则 1:1 照搬 SRC。
// 纯判定逻辑在 media-sniffer-logic.ts（单测下沉）；本文件只做会话挂接与去重广播。
import type { Session } from 'electron'
import { isMediaUrl, mediaTypeFromUrl } from './media-sniffer-logic'

export interface SniffedMedia {
  url: string
  type: 'video' | 'audio'
  platform: string
  /** 首次捕获时间（ms；页面用于相对展示与排序） */
  at: number
}

export interface MediaSniffer {
  /** 挂到分区 session（幂等：每 session 只挂一次） */
  attach: (session: Session, platform: string) => void
  /** 订阅嗅探结果（返回退订函数） */
  onMedia: (cb: (m: SniffedMedia) => void) => () => void
  /** 当前缓冲（按 platform 过滤；调用方负责条数上限） */
  items: (platform: string) => SniffedMedia[]
  /** 清空指定平台缓冲 */
  clear: (platform?: string) => void
}

export function createMediaSniffer(opts: { maxPerPlatform?: number } = {}): MediaSniffer {
  const max = opts.maxPerPlatform ?? 50
  const buffer = new Map<string, SniffedMedia[]>()
  const listeners = new Set<(m: SniffedMedia) => void>()
  const attached = new WeakSet<Session>()

  const emit = (m: SniffedMedia): void => {
    for (const cb of listeners) {
      try { cb(m) } catch { /* 订阅方异常不阻断嗅探 */ }
    }
  }

  return {
    attach(session, platform) {
      if (!session || attached.has(session)) return
      attached.add(session)
      // will-attach 只看资源加载；webRequest 对主文档与子资源统一触发，
      // 资源类型过滤交给 URL 规则（照搬 SRC isMediaUrl）
      session.webRequest.onBeforeRequest((details, callback) => {
        try {
          if (!details || details.resourceType === 'mainFrame') {
            callback({})
            return
          }
          const url = String(details.url || '')
          if (isMediaUrl(url)) {
            const list = buffer.get(platform) ?? []
            if (!list.some((x) => x.url === url)) {
              const m: SniffedMedia = { url, type: mediaTypeFromUrl(url), platform, at: Date.now() }
              list.unshift(m)
              if (list.length > max) list.length = max
              buffer.set(platform, list)
              emit(m)
            }
          }
        } catch { /* 嗅探异常不影响页面加载 */ }
        callback({})
      })
    },
    onMedia(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    items(platform) {
      return buffer.get(platform) ?? []
    },
    clear(platform) {
      if (platform) buffer.delete(platform)
      else buffer.clear()
    },
  }
}
