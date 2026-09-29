// test/tintin-media-sniffer.test.ts — 媒体嗅探纯判定 + 引擎去重缓冲回归
// SRC browser-webview.js isMediaUrl/getMediaTypeFromUrl 1:1；引擎壳侧等价（webRequest）。
import { describe, expect, it } from 'vitest'
import { isMediaUrl, mediaDisplayName, mediaTypeFromUrl } from '../src/main/tintin/browser/media-sniffer-logic'
import { createMediaSniffer } from '../src/main/tintin/browser/media-sniffer'

describe('media sniffer logic (SRC browser-webview 1:1)', () => {
  it('accepts media urls by extension and platform patterns', () => {
    expect(isMediaUrl('https://x.com/v/a.mp4')).toBe(true)
    expect(isMediaUrl('https://x.com/v/index.m3u8')).toBe(true)
    expect(isMediaUrl('https://x.com/a.mp3?token=1')).toBe(true)
    expect(isMediaUrl('https://v.douyin.com/video/tos/cn/x')).toBe(true)
    expect(isMediaUrl('https://www.douyin.com/aweme/v1/play/.douyinvod.com/x')).toBe(true)
    expect(isMediaUrl('https://x.com/watch?v=y')).toBe(false)
    expect(isMediaUrl('https://x.com/page.html')).toBe(false)
    expect(isMediaUrl('data:video/mp4;base64,xx')).toBe(false)
    expect(isMediaUrl('')).toBe(false)
    expect(isMediaUrl(null)).toBe(false)
  })

  it('classifies audio by url features else video', () => {
    expect(mediaTypeFromUrl('https://x.com/a.mp3')).toBe('audio')
    expect(mediaTypeFromUrl('https://x.com/v?mime=audio/mp4')).toBe('audio')
    expect(mediaTypeFromUrl('https://x.com/f.m4s?rate=-30216')).toBe('audio')
    expect(mediaTypeFromUrl('https://x.com/v/a.mp4')).toBe('video')
  })

  it('builds short display names', () => {
    expect(mediaDisplayName('https://x.com/v/abc.mp4?sig=1')).toBe('abc.mp4')
    expect(mediaDisplayName('https://x.com/')).toBe('x.com')
    expect(mediaDisplayName('https://x.com/' + 'a'.repeat(80) + '.mp4')).toHaveLength(60)
  })
})

describe('media sniffer engine (webRequest equivalent)', () => {
  function fakeSession() {
    const handlers: Array<(d: { url: string; resourceType: string }, cb: (r: object) => void) => void> = []
    return {
      session: {
        webRequest: { onBeforeRequest: (h: unknown) => { handlers.push(h as never) } },
      } as never,
      handlers,
    }
  }

  it('captures media urls once (dedupe), honors platform buffer, caps size', async () => {
    const { session, handlers } = fakeSession()
    const sniffer = createMediaSniffer({ maxPerPlatform: 3 })
    const seen: string[] = []
    sniffer.onMedia((m) => seen.push(m.url))
    sniffer.attach(session, 'douyin')
    expect(handlers.length).toBe(1)
    const h = handlers[0]!
    const cb = () => {}
    // 幂等 attach
    sniffer.attach(session, 'douyin')
    expect(handlers.length).toBe(1)
    // 非媒体与主框架不收
    h({ url: 'https://x.com/page.html', resourceType: 'xhr' }, cb)
    h({ url: 'https://x.com/v/a.mp4', resourceType: 'mainFrame' }, cb)
    // 媒体收
    h({ url: 'https://x.com/v/clip.mp4', resourceType: 'media' }, cb)
    h({ url: 'https://x.com/v/clip.mp4', resourceType: 'media' }, cb)
    expect(seen).toEqual(['https://x.com/v/clip.mp4'])
    expect(sniffer.items('douyin')).toHaveLength(1)
    // 上限裁剪：3 容量，塞 4 条
    for (const u of ['a.mp4', 'b.mp4', 'c.mp4']) h({ url: `https://x.com/${u}`, resourceType: 'media' }, cb)
    const items = sniffer.items('douyin')
    expect(items.length).toBe(3)
    expect(items[0]?.url).toBe('https://x.com/c.mp4')
    // 平台隔离 + 清除
    expect(sniffer.items('bilibili')).toEqual([])
    sniffer.clear('douyin')
    expect(sniffer.items('douyin')).toEqual([])
  })
})
