// ═══════════════════════════════════════════════════════════════
// copywritingMontageVoiceRefLogic.ts — 文案混剪口播音频跨机同步·纯逻辑
// （2026-09-30 用户裁决 B：克隆产物 wav 上传服务端音频库，脚本载荷携带
//  audio id 引用，换机应用脚本后按 id 下载回填——机制对齐 09-29 A′ 素材绑定
//  clip_groups 的「保存附加字段 / 恢复按标识重建」双端模式。）
// 契约依据：
//   · 上传 POST /audio/library/upload（multipart file+category+tags），
//     category='口播' → 服务端归一「配音」池（四值枚举 配乐/音效/配音/其它，
//     别名表大小写不敏感、去括号容错——2026-09-30 服务端口径）
//   · 下载 GET /audio/library/{id}/file（audio/x-wav，404=不存在，已实测）
//   · 脚本根字段透传：detail.product 根字段回学同证（选择脚本带回产品上下文）
// 本文件不做任何 IPC / DOM 操作（铁律 6/7 分层）。
// ═══════════════════════════════════════════════════════════════

/** 保存侧：脚本载荷根附加口播音频库引用。
 *  id 为空（未上传/上传失败）不附加任何字段——旧脚本形态保持逐字节不变；
 *  时长钳 0 并保留 3 位小数（服务端存数值，恢复侧据此回填 voiceDurSec）。 */
export function attachVoiceRef(
  payload: Record<string, unknown>,
  tab: { voiceAudioId?: unknown; voiceDurSec?: unknown },
): void {
  const id = String(tab?.voiceAudioId ?? '').trim()
  if (!id) return
  payload.voice_audio_id = id
  payload.voice_dur_sec = Math.max(0, Math.round((Number(tab?.voiceDurSec) || 0) * 1000) / 1000)
}

/** 恢复侧：脚本详情根提取口播引用。
 *  解包口径与 parseScriptDetail 同源：兼容 {script:{...}} 包裹 / 裸 dict；
 *  字段宽容取值（缺失/非法 → 空 id + 0 时长，调用方据此跳过恢复）。 */
export function voiceRefFromScriptDetail(data: unknown): { audioId: string; durSec: number } {
  if (!data || typeof data !== 'object') return { audioId: '', durSec: 0 }
  const raw = data as Record<string, unknown>
  const s = (raw.script && typeof raw.script === 'object' ? raw.script : raw) as Record<string, unknown>
  return {
    audioId: String(s.voice_audio_id ?? '').trim(),
    durSec: Math.max(0, Number(s.voice_dur_sec) || 0),
  }
}
