// test/tintin-ytdlp.test.ts — 参考视频下载纯逻辑层 + 宿主门回归
// ytdlp-logic.js（SRC ytdlp-logic.js 1:1）：URL 白名单/平台判定/参数构造/进度解析/
// 档位生成/错误分类；ytdlp.js（SRC ytdlp-gate.js 移植）：cookies 前置/status/通道表。
// 需要真实 yt-dlp/网络的端到端走真实启动验收，不在单测范围。
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildProbeArgs,
  buildVideoDownloadArgs,
  classifyDownloadError,
  createDownloadOptions,
  downloadErrorText,
  isSupportedUrl,
  parseProgressLine,
  parseProbeJson,
  platformFromUrl,
} from '../packages/tintin-bundle/lib/ytdlp-logic.js'
import { createYtdlpApi } from '../packages/tintin-bundle/lib/ytdlp.js'

const tmpDirs: string[] = []
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

type Entry = (args: unknown[]) => Promise<unknown> | unknown

describe('ytdlp logic (SRC ytdlp-logic 1:1)', () => {
  it('whitelists https YouTube/Bilibili urls only', () => {
    expect(isSupportedUrl('https://www.youtube.com/watch?v=x')).toBe(true)
    expect(isSupportedUrl('https://youtu.be/x')).toBe(true)
    expect(isSupportedUrl('https://www.bilibili.com/video/BV1x')).toBe(true)
    expect(isSupportedUrl('https://b23.tv/x')).toBe(true)
    expect(isSupportedUrl('http://www.youtube.com/watch?v=x')).toBe(false)
    expect(isSupportedUrl('https://www.douyin.com/video/1')).toBe(false)
    expect(isSupportedUrl('')).toBe(false)
  })

  it('maps urls to the cookie platform (bilibili/youtube, else empty)', () => {
    expect(platformFromUrl('https://www.bilibili.com/video/BV1x')).toBe('bilibili')
    expect(platformFromUrl('https://youtu.be/x')).toBe('youtube')
    expect(platformFromUrl('https://www.douyin.com/video/1')).toBe('')
  })

  it('builds probe/download args with the source flag order', () => {
    expect(buildProbeArgs('URL', '')).toEqual(['--dump-single-json', '--no-playlist', 'URL'])
    expect(buildProbeArgs('URL', 'http://p:1')).toEqual(['--dump-single-json', '--no-playlist', '--proxy', 'http://p:1', 'URL'])
    const args = buildVideoDownloadArgs({
      url: 'URL', formatId: '137', audioFormatId: '140', outTemplate: 'OUT', ffmpegDir: 'FF', proxy: '',
    })
    expect(args).toContain('-f')
    expect(args.join(' ')).toContain('137+140')
    expect(args).toContain('--merge-output-format')
  })

  it('parses progress lines into phases (download/merge/extract, else null)', () => {
    expect(parseProgressLine('[download]  42.3% of 1.5MiB')).toEqual({ phase: 'download', pct: 42.3 })
    expect(parseProgressLine('[Merger] Merging formats')).toEqual({ phase: 'merge', pct: 96 })
    expect(parseProgressLine('[ExtractAudio] Destination')).toEqual({ phase: 'extract', pct: 96 })
    expect(parseProgressLine('random text')).toBeNull()
  })

  it('normalizes a probe json and generates deduped video tiers plus fixed mp3 tiers', () => {
    const probe = parseProbeJson({
      id: 'x', title: 'T', uploader: 'U', duration: 60, thumbnail: 'th',
      extractor_key: 'Bilibili', webpage_url: 'https://www.bilibili.com/video/BV1x',
      formats: [
        { format_id: '137', ext: 'mp4', vcodec: 'avc1', acodec: 'none', width: 1920, height: 1080, fps: 30, filesize: 100, tbr: 4000, abr: 0 },
        { format_id: '136', ext: 'mp4', vcodec: 'avc1', acodec: 'none', width: 1280, height: 720, fps: 30, filesize: 0, tbr: 2000, abr: 0 },
        { format_id: '140', ext: 'm4a', vcodec: 'none', acodec: 'mp4a', width: 0, height: 0, fps: 0, filesize: 0, tbr: 128, abr: 128 },
      ],
    })
    expect(probe.platform).toBe('bilibili')
    expect(probe.resolution).toBe('1920x1080')
    const options = createDownloadOptions(probe)
    const video = options.filter((o) => o.mediaType === 'video')
    const audio = options.filter((o) => o.mediaType === 'audio')
    expect(video.map((o) => o.label)).toEqual(['原始画质', '720p'])
    expect(video[0]?.audioFormatId).toBe('140')
    expect(audio.map((o) => o.id)).toEqual(['audio-mp3-320', 'audio-mp3-192', 'audio-mp3-128'])
  })

  it('classifies errors and renders the source chinese texts', () => {
    expect(classifyDownloadError('Sign in to confirm you are not a bot').code).toBe('login_required')
    expect(classifyDownloadError('connection refused').code).toBe('network_unavailable')
    // login_required 文案为有意偏离 SRC（2026-09-28 用户裁决）：换成可操作指引
    expect(downloadErrorText('login_required')).toBe('该视频需要登录后访问：请先在 TinTin 浏览器登录对应平台，再重新解析（登录态自动同步，无需手动导出）')
    expect(downloadErrorText('unsupported_source')).toBe('当前仅支持 YouTube 和 Bilibili 公公开视频')
  })
})

describe('ytdlp host gate (SRC ytdlp-gate port)', () => {
  function makeApi(cookiePlatform: string | null, loopback?: (path: string, body?: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>) {
    const dir = mkdtempSync(join(tmpdir(), 'tintin-ytdlp-'))
    tmpDirs.push(dir)
    if (cookiePlatform) {
      writeFileSync(join(dir, `cookies_${cookiePlatform}.txt`), '# Netscape HTTP Cookie File\n')
    }
    const api = createYtdlpApi({
      ytdlpPath: 'yt-dlp',
      ffmpegPath: 'ffmpeg',
      ffprobePath: 'ffprobe',
      ffmpegDir: '',
      cookiesDir: () => dir,
      cacheDir: () => dir,
      ...(loopback ? { loopback } : {}),
    })
    return { api, dir }
  }

  it('registers exactly the status/probe/download/saveAs/openLoginBrowser channels', () => {
    const { api } = makeApi(null)
    expect(Object.keys(api).sort()).toEqual(['ytdlp:download', 'ytdlp:openLoginBrowser', 'ytdlp:probe', 'ytdlp:saveAs', 'ytdlp:status'])
  })

  it('openLoginBrowser forwards the platform over the loopback open route', async () => {
    const calls: Array<{ path: string; body: Record<string, unknown>; timeoutMs?: number }> = []
    const { api } = makeApi(null, async (path, body = {}, timeoutMs) => {
      calls.push({ path, body, timeoutMs })
      return { ok: true }
    })
    const out = await (api['ytdlp:openLoginBrowser'] as Entry)([{ platform: 'youtube' }]) as { ok?: boolean }
    expect(out.ok).toBe(true)
    expect(calls).toEqual([{ path: '/tintin-browser/open', body: { platform: 'youtube' }, timeoutMs: 5000 }])
  })

  it('openLoginBrowser defaults to youtube and surfaces loopback NO_SERVICE shape', async () => {
    const { api } = makeApi(null, async () => ({ ok: false, error: { type: 'NO_SERVICE', message: 'x' } }))
    const out = await (api['ytdlp:openLoginBrowser'] as Entry)([{}]) as { ok?: boolean; error?: { type?: string } }
    expect(out.ok).toBe(false)
    expect(out.error?.type).toBe('NO_SERVICE')
  })

  it('status reports unavailable for a bare PATH binary', () => {
    const { api } = makeApi(null)
    expect(api['ytdlp:status']()).toEqual({ available: false, path: 'yt-dlp', external: false })
  })

  it('probe rejects non-whitelisted urls before spawning (and without touching the loopback)', async () => {
    const calls: string[] = []
    const { api } = makeApi(null, async (path) => { calls.push(path); return {} })
    const out = await (api['ytdlp:probe'] as Entry)([{ url: 'https://www.douyin.com/video/1' }]) as { error?: string }
    expect(out.error).toBe('当前仅支持 YouTube 和 Bilibili 公公开视频')
    expect(calls).toEqual([])
  })

  it('saveAs copies to the destination and reports failures as {error}', async () => {
    const { api, dir } = makeApi(null)
    const src = join(dir, 'src.mp4')
    writeFileSync(src, 'data')
    const dst = join(dir, 'out', 'saved.mp4')
    // saveAs 是同步通道：await 断言返回值而非 Promise
    expect((api['ytdlp:saveAs'] as Entry)([{ src, dst }])).toEqual({ ok: true })
    const bad = (api['ytdlp:saveAs'] as Entry)([{ src: '', dst: '' }]) as { error?: string }
    expect(bad.error).toBe('参数缺失')
  })
})
