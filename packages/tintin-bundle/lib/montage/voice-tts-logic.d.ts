// voice-tts-logic.d.ts — 口播配音纯函数层（CJS→ESM 纯搬迁，源
// desktop/main/voice-tts-logic.js，51 个导出名守恒）。签名按源用途宽松标注：
// 复杂 dict（模板/样式/时间轴行）以 Record 表达，不发明源外字段。
export type Dict = Record<string, unknown>
export interface TimingRow {
  text: string
  start: number
  end: number
  chars?: Array<{ c: string; start: number | null; end: number | null }>
}
// ── TTS 文本预处理 / 切句 ──
export function preprocessTtsText(text: unknown): string
export function preprocessTtsKeepingPause(text: unknown): string
export function intToCn(n: number): string
export function splitSentences(text: unknown): string[]
// ── 变速 / WAV 字节层 ──
export function computeSpeedAdjust(vidDur: number, audDur: number, speedMin: number, speedMax: number): { should: boolean; ratio: number }
export function repairWavBytes(buf: Uint8Array): Buffer
export function parseWav(buf: Uint8Array): { audioFormat: number; nchannels: number; framerate: number; bits: number; dataStart: number; dataLen: number } | null
export function wavBytesDuration(buf: Uint8Array): number
export function concatWavBuffers(wavList: Uint8Array[], gapSec?: number): Buffer
export function buildWavHeader(dataLen: number, audioFormat: number, nchannels: number, framerate: number, byteRate: number, blockAlign: number, bits: number): Buffer
export function deriveHealthUrl(apiUrl: string): string
// ── 时间轴估算 ──
export function buildFallbackTiming(segs: string[], totalDur: number): TimingRow[]
export function buildPauseAwareTiming(segs: string[], totalDur: number, pauseMs: number): TimingRow[]
// ── AI 改写 ──
export function rewriteTemperature(pct: unknown): number
export function buildAiRewriteSystemPrompt(temperature: number): string
export function cleanRewriteContent(content: unknown): string
export function parseFancyWords(raw: unknown): string[]
// ── 样式表 / 常量 ──
export const FANCY_STYLES: Dict
export const SUBTITLE_STYLES: Dict
export function serverStyleToDrawtext(style: Dict): string
export function escapeDrawText(s: unknown): string
export function stripPronAnnotation(text: unknown): string
export const SAFE_X: number
export const SAFE_TOP: number
export const SAFE_BOTTOM: number
export const SUB_FONT_SCALE: number
export const SUB_BOTTOM_GAP: number
export const SUB_MAX_LINE_WEIGHT: number
export const SUB_ASCII_WEIGHT: number
export const FANCY_POSITIONS: Dict
export const FANCY_LEAD_SEC: number
export const FANCY_MAX_LEN: number
export const FANCY_MIN_GAP_SEC: number
export const FANCY_MIN_DISPLAY_SEC: number
export const FANCY_MAX_PER_VIDEO: number
// ── 花字词提取 / 字幕折行 ──
export function extractFancyWordsInLine(lineText: unknown, limit?: number): string[]
export function extractFancyWordsFromText(text: unknown, maxWords?: number): string[]
export function resolveFancyOverlaps(events: Array<Dict & { start?: number; end?: number }>, minGap?: number, minDisplay?: number): Array<Dict & { start: number; end: number }>
export function subLineWeight(text: unknown): number
export function badSubBoundary(chars: string[], i: number): boolean
export function wrapSubtitleLine(lineText: unknown): string
// ── 动画 / 事件 / 目录 ──
export function getFancyAnim(template: Dict): string
export function buildFancyEvents(...args: unknown[]): Array<Dict & { start: number; end: number }>
export function resolveOutMontageDir(dirPath: unknown): string
export function buildAtempoChain(...args: unknown[]): string
export function resolveSubtitleFontPath(family: unknown, resolvers: { familyPath?: string; path?: (cand: string) => boolean }): string
export function buildSubtitleLines(...args: unknown[]): Array<Dict>
// ── ffmpeg 参数构建器 ──
export function buildDubFFmpegArgs(opts: Dict): string[]
export function buildEffectBurnArgs(opts: Dict): string[] | null
export function buildTextFxDrawtextList(...args: unknown[]): Array<Dict>
export function planTextFxHits(...args: unknown[]): Array<Dict>
export function buildTextTemplateDecorations(presetDir: string, rid: string, videoW: number, videoH: number): Dict
