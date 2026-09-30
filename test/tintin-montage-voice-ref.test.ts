// test/tintin-montage-voice-ref.test.ts — 口播音频随脚本跨机同步·纯函数回归
// （2026-09-30 用户裁决 B：克隆 wav 上传音频库 category=口播→「配音」池，脚本根字段
//  voice_audio_id/voice_dur_sec 附加与恢复；本测试锁定附加条件与解包容错口径）
import { describe, expect, it } from 'vitest'
import {
  attachVoiceRef,
  voiceRefFromScriptDetail,
} from '../packages/tintin-media-bundle/src/composables/copywritingMontageVoiceRefLogic'
// 编排壳（上传/下载 IPC 桥接）随本测试进入 typecheck 覆盖（6bc1c32 同模式）；
// 其行为依赖 window.tintin 运行时，不在此单测，由克隆→上传→应用脚本链路实测覆盖。
import '../packages/tintin-media-bundle/src/composables/copywritingMontage/useCopywritingMontageVoiceSync'

describe('attachVoiceRef（保存侧：payload 根附加口播引用）', () => {
  it('id 非空附加 voice_audio_id/voice_dur_sec，时长钳 0 保留 3 位小数', () => {
    const p1: Record<string, unknown> = { topic: 't' }
    attachVoiceRef(p1, { voiceAudioId: '42', voiceDurSec: 12.34567 })
    expect(p1).toEqual({ topic: 't', voice_audio_id: '42', voice_dur_sec: 12.346 })

    const p2: Record<string, unknown> = {}
    attachVoiceRef(p2, { voiceAudioId: 7, voiceDurSec: -3 })
    expect(p2).toEqual({ voice_audio_id: '7', voice_dur_sec: 0 })
  })

  it('id 空/空白/缺失 → 不附加任何字段（旧脚本形态不变）', () => {
    for (const tab of [{ voiceAudioId: '', voiceDurSec: 9 }, { voiceAudioId: '  ' }, {}, undefined]) {
      const p: Record<string, unknown> = { topic: 't' }
      attachVoiceRef(p, tab as { voiceAudioId?: unknown })
      expect(p).toEqual({ topic: 't' })
    }
  })
})

describe('voiceRefFromScriptDetail（恢复侧：详情根提取，兼容 script 包裹）', () => {
  it('裸 dict 与 {script:{...}} 包裹同解；数值/字符串字段宽容取值', () => {
    const bare = { topic: 't', voice_audio_id: '42', voice_dur_sec: 8.5 }
    const wrapped = { script: { voice_audio_id: 42, voice_dur_sec: '7.25' } }
    expect(voiceRefFromScriptDetail(bare)).toEqual({ audioId: '42', durSec: 8.5 })
    expect(voiceRefFromScriptDetail(wrapped)).toEqual({ audioId: '42', durSec: 7.25 })
  })

  it('缺失/非法/非对象输入 → 空 id + 0 时长（调用方跳过恢复）', () => {
    expect(voiceRefFromScriptDetail({ topic: 't' })).toEqual({ audioId: '', durSec: 0 })
    expect(voiceRefFromScriptDetail({ voice_audio_id: '  ', voice_dur_sec: 'x' })).toEqual({ audioId: '', durSec: 0 })
    expect(voiceRefFromScriptDetail(null)).toEqual({ audioId: '', durSec: 0 })
    expect(voiceRefFromScriptDetail('str')).toEqual({ audioId: '', durSec: 0 })
  })
})
