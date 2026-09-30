// test/jianying-export-tracks.test.ts — exportMultiToDraft 轨道时间轴行为回归。
// 背景（2026-09-29）：727a6eb 去掉了视频轨的半秒片段间隙（剪映转场要求相邻
// 片段），但字幕/关键词/音效轨的游标仍在推进 VIDEO_GAP_US——副轨自第 2 片起
// 逐边界漂移 0.5s；且显式镜级音效（sfxClips）被模板命中 guard 挡住，无模板
// 命中的镜不落音效轨。本文件锁死：副轨窗口与视频段窗口逐段相等、片段相邻、
// 显式音效无条件落轨、转场素材挂前一段。
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as exporter from '../packages/tintin-bundle/lib/jianying/jianying-exporter.js'

let home = ''
let savedLocalAppData = ''

const US = (sec: number): number => Math.round(sec * 1e6)

function makeFakeVideo(name: string): string {
  const p = join(home, name)
  writeFileSync(p, 'fake')
  return p
}

function makeFakeSrt(name: string): string {
  const p = join(home, name)
  writeFileSync(p, '1\n00:00:00,000 --> 00:00:01,000\nA\n')
  return p
}

function makeFakeWav(name: string): string {
  const p = join(home, name)
  writeFileSync(p, 'fake')
  return p
}

/** 导出并把草稿 content 解析回来；LOCALAPPDATA 重定向保证不落真实剪映目录 */
function exportAndRead(options: {
  durationsSec: number[]
  sfxClips?: Array<Array<{ path: string; startUs: number; durUs: number }>>
  tplClips?: Array<Array<{ phrase: string; startUs: number; durUs: number; resourceId: string }>>
  transitions?: string[]
}): Record<string, any> {
  const videos = options.durationsSec.map((_, i) => makeFakeVideo(`v${i}.mp4`))
  const srts = options.durationsSec.map((_, i) => makeFakeSrt(`v${i}.srt`))
  const draftRoot = join(home, 'JianyingPro', 'User Data', 'Projects', 'com.lveditor.draft')
  mkdirSync(draftRoot, { recursive: true })
  const res = exporter.exportMultiToDraft({
    videoPaths: videos,
    videoDurations: options.durationsSec.map(US),
    muteVideoAudio: true,
    srtPaths: srts,
    srtLimitUs: null,
    transitions: options.transitions ?? ['fade'],
    textTemplateClips: options.tplClips ?? options.durationsSec.map(() => []),
    sfxClips: options.sfxClips,
    draftName: 'TRACK_ALIGN_PROBE',
    deps: { probeMedia: () => ({ durationSec: 0.6 }) }
  })
  expect(res.success).toBe(true)
  return JSON.parse(readFileSync(join(String(res.message), 'draft_content.json'), 'utf8'))
}

describe('exportMultiToDraft track alignment (2026-09-29 regression)', () => {
  afterEach(() => {
    if (savedLocalAppData) process.env.LOCALAPPDATA = savedLocalAppData
    if (home) rmSync(home, { recursive: true, force: true })
    home = ''
    savedLocalAppData = ''
  })

  it('keeps subtitle windows equal to their video windows with adjacent video segments (no per-boundary drift)', () => {
    savedLocalAppData = process.env.LOCALAPPDATA || ''
    home = mkdtempSync(join(tmpdir(), 'jy-track-align-'))
    process.env.LOCALAPPDATA = home

    const durations = [1.1, 2.3, 0.9, 3.7]
    const content = exportAndRead({ durationsSec: durations })

    const videoTrack = content.tracks.find((t: any) => t.type === 'video')
    expect(videoTrack.segments).toHaveLength(4)
    // 相邻：下一段起点=前一段终点（727a6eb 契约）
    let cursor = 0
    const expectedWindows = durations.map((sec) => {
      const window = { start: cursor, duration: US(sec) }
      cursor += US(sec)
      return window
    })
    expectedWindows.forEach((w, i) => {
      expect(videoTrack.segments[i].target_timerange.start).toBe(w.start)
      expect(videoTrack.segments[i].target_timerange.duration).toBe(w.duration)
    })
    // 副轨对齐：每个字幕 cue 落在对应视频段窗口内且起点=段起点
    // （2026-09-29 前副轨游标自第 2 片起逐边界漂移 +0.5s，起点会大于段起点）
    const subtitleTrack = content.tracks.find((t: any) => t.type === 'text' && t.flag === 1)
    expect(subtitleTrack).toBeTruthy()
    expect(subtitleTrack.segments).toHaveLength(4)
    for (let i = 0; i < 4; i++) {
      const sub = subtitleTrack.segments[i].target_timerange
      const vid = videoTrack.segments[i].target_timerange
      expect(sub.start).toBe(vid.start)
      expect(sub.start + sub.duration).toBeLessThanOrEqual(vid.start + vid.duration)
    }
    // 全片时长=各片段之和（无间隙）
    expect(content.duration).toBe(durations.reduce((a: number, b: number) => a + US(b), 0))
  })

  it('lands explicit per-shot sfx even when no text-template hits exist (guard removed)', () => {
    savedLocalAppData = process.env.LOCALAPPDATA || ''
    home = mkdtempSync(join(tmpdir(), 'jy-sfx-guard-'))
    process.env.LOCALAPPDATA = home

    const wav0 = makeFakeWav('shot0.wav')
    const wav2 = makeFakeWav('shot2.wav')
    const content = exportAndRead({
      durationsSec: [1.0, 1.0, 1.0],
      sfxClips: [
        [{ path: wav0, startUs: 0, durUs: US(0.6) }],
        [],
        [{ path: wav2, startUs: 0, durUs: US(0.6) }],
      ],
    })

    // 音效轨独立成轨（audio；probeMedia 桩返回 0.6s → 段长=min(0.6s, 0.6s)）
    const sfxTracks = content.tracks.filter((t: any) => t.type === 'audio')
    expect(sfxTracks).toHaveLength(1)
    const segs = sfxTracks[0].segments
    expect(segs).toHaveLength(2)
    expect(segs[0].target_timerange.start).toBe(0)
    expect(segs[1].target_timerange.start).toBe(US(2.0))
    for (const s of segs) expect(s.target_timerange.duration).toBe(US(0.6))
    // 音效素材进库
    const sfxPaths = content.materials.audios.map((m: any) => m.path)
    expect(sfxPaths).toContain(wav0)
    expect(sfxPaths).toContain(wav2)
  })

  // 2026-09-30 用户裁决：文字模板段显示时长默认 1.5s（不再跟随服务端命中窗口全程）
  it('text-template segments display 1.5s regardless of hit window width', () => {
    savedLocalAppData = process.env.LOCALAPPDATA || ''
    home = mkdtempSync(join(tmpdir(), 'jy-tpl-dur-'))
    process.env.LOCALAPPDATA = home
    // 最小 .textpreset（effect.resource_id 命中即可；无 resources → 无动画/花字附加）
    const presetDir = join(home, 'JianyingPro', 'User Data', 'Presets', 'Text_V2')
    mkdirSync(presetDir, { recursive: true })
    writeFileSync(join(presetDir, 'tpl-001.textpreset'), JSON.stringify({
      effect: { resource_id: 'tpl001' },
      paragraphs: [{ content: JSON.stringify({ text: '', styles: [] }), text_name: 'slot1' }],
      resources: [],
    }))

    // 命中窗口 5s（远大于 1.5s）——段时长必须钳到 1.5s，起点仍=命中起点
    const content = exportAndRead({
      durationsSec: [3.0],
      tplClips: [[{ phrase: '降噪', startUs: 0, durUs: US(5), resourceId: 'tpl001' }]],
    })
    const tplTextTracks = content.tracks.filter((t: any) => t.type === 'text')
    const tplSegs = tplTextTracks.flatMap((t: any) => t.segments).filter((s: any) => s.target_timerange.duration === US(1.5))
    expect(tplSegs.length).toBe(1)
    expect(tplSegs[0].target_timerange.start).toBe(0)
    expect(content.materials.text_templates).toHaveLength(1)
    // 不允许任何文本段仍带着 5s 旧口径
    const allTextSegs = tplTextTracks.flatMap((t: any) => t.segments)
    expect(allTextSegs.some((s: any) => s.target_timerange.duration === US(5))).toBe(false)
  })

  it('keyword fallback segments (preset missing) also display 1.5s', () => {
    savedLocalAppData = process.env.LOCALAPPDATA || ''
    home = mkdtempSync(join(tmpdir(), 'jy-tpl-fallback-'))
    process.env.LOCALAPPDATA = home
    // 不写预设 → 命中走纯文本关键词兜底（同窗口同口径）
    const content = exportAndRead({
      durationsSec: [3.0],
      tplClips: [[{ phrase: '降噪', startUs: 0, durUs: US(5), resourceId: 'tpl001' }]],
    })
    expect(content.materials.text_templates ?? []).toHaveLength(0)
    const textTracks = content.tracks.filter((t: any) => t.type === 'text')
    const kwSegs = textTracks.flatMap((t: any) => t.segments).filter((s: any) => s.target_timerange.duration === US(1.5))
    expect(kwSegs.length).toBe(1)
    expect(kwSegs[0].target_timerange.start).toBe(0)
  })

  it('attaches boundary transition materials to the preceding segment of adjacent video segments', () => {
    savedLocalAppData = process.env.LOCALAPPDATA || ''
    home = mkdtempSync(join(tmpdir(), 'jy-transition-attach-'))
    process.env.LOCALAPPDATA = home

    const content = exportAndRead({
      durationsSec: [1.0, 1.0, 1.0],
      transitions: ['fade', 'dissolve', 'slideleft'],
    })

    const transitionIds = content.materials.transitions.map((t: any) => t.id)
    // 3 段=2 个边界：normalizeTransitions 数组口径按 clips.length-1 取用
    expect(transitionIds).toHaveLength(2)
    const names = content.materials.transitions.map((t: any) => t.name).sort()
    expect(names).toEqual(['叠化', '模糊'])
    const videoTrack = content.tracks.find((t: any) => t.type === 'video')
    for (let i = 0; i < 2; i++) {
      const refs = videoTrack.segments[i].extra_material_refs
      expect(refs.filter((id: string) => transitionIds.includes(id))).toHaveLength(1)
    }
    // 末段不挂转场
    const lastRefs = videoTrack.segments[2].extra_material_refs
    expect(lastRefs.filter((id: string) => transitionIds.includes(id))).toHaveLength(0)
  })
})
