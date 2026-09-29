// media-sniffer-logic.ts — 媒体嗅探纯判定层（SRC browser-webview.js isMediaUrl /
// getMediaTypeFromUrl 1:1 移植；铁律 8：无 Electron 依赖，单测下沉）。

/** 媒体 URL 判定（SRC L49-64 规则照搬：扩展名 + 平台特征路径段） */
export function isMediaUrl(url: unknown): boolean {
  if (!url || typeof url !== 'string') return false
  if (url.startsWith('data:')) return false
  const lower = url.toLowerCase()
  if (lower.includes('.mp4') || lower.includes('.m3u8') || lower.includes('.mp3') ||
    lower.includes('.flv') || lower.includes('.webm') || lower.includes('.ogg') ||
    lower.includes('.m4s') || lower.includes('.ts')) return true
  if (lower.includes('video/tos') || lower.includes('sns-video') ||
    lower.includes('sns-img') || lower.includes('sns-webpic') ||
    lower.includes('v-code') || lower.includes('upos-sz-mirrstar') ||
    lower.includes('videoplayback') || lower.includes('.douyinvod.com')) return true
  return false
}

/** 媒体类型判定（SRC L66-73：音频特征 → audio，其余 video） */
export function mediaTypeFromUrl(url: unknown): 'video' | 'audio' {
  const lower = String(url || '').toLowerCase()
  if (lower.includes('.mp3') || lower.includes('mime=audio') || lower.includes('media-audio') ||
    lower.includes('-30216') || lower.includes('-30232') || lower.includes('-30280') ||
    lower.includes('-30250') || lower.includes('audio')) return 'audio'
  return 'video'
}

/** 页面展示用的短名（URL 尾段去参数，超长截断；尾段为空回落主机名） */
export function mediaDisplayName(url: unknown, max = 60): string {
  const raw = String(url || '')
  let host = ''
  try { host = new URL(raw).hostname } catch { /* 非 URL 原样走尾段 */ }
  const tail = raw.split('?')[0] || raw
  const seg = tail.slice(tail.lastIndexOf('/') + 1) || host || tail
  return seg.length > max ? seg.slice(0, max - 1) + '…' : seg
}
