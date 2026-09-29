// jianying-exporter.d.ts — 剪映专业版草稿（DRT）导出器。
// CJS→ESM 纯搬迁：签名按源实现合理推断，跨进程/上游 JSON 结构以 unknown 透传，
// 不瞎编具体字段；源导出集合共 32 名（源列表 buildSubtitleSegment 重复两次等价一份）。
export interface TransitionSpec {
  name: string
  resourceId: string
  effectId: string
  isOverlap: boolean
  duration: number
}
export const TRANSITION_MAP: Readonly<Record<string, TransitionSpec>>
export interface DraftSchemaInfo {
  source: string
  new_version: string
  version: number
  generator_app_version: string
}
export const DRAFT_SCHEMA: Readonly<DraftSchemaInfo>
export interface ExportResult {
  success: boolean
  message: string
  [key: string]: unknown
}
export function getDefaultDraftRoot(): string
export function exportToDraft(options: Record<string, unknown>): ExportResult
export function exportMultiToDraft(options: Record<string, unknown>): ExportResult
export function registerInRootMeta(options: {
  draftFolder: string
  draftName: string
  durationUs?: number
  coverPath?: string
}): { ok: boolean; backupPath: string; entry: Record<string, unknown> }
export function verifyDraftFolder(options: {
  draftFolder: string
  expectedAssetCount?: number
}): {
  ok: boolean
  trackCounts: Record<string, number>
  pathRefs: number
  missing: number
  dangling: number
  assetFiles: number
  problems: string[]
  /** 非致命缺失（2026-09-30：Cache/artistEffect 云端特效缓存本机缺失——剪映按
   *  resource_id 云端解析，不判导出失败，仅提示） */
  warnings: string[]
}
export function validateDraftPackage(pkgDir: string): {
  ok: boolean
  problems: string[]
  warnings: string[]
  trackCounts: Record<string, number>
  pathRefs: number
}
export function auditDraftStandardConformance(content: unknown): { checkedSegs: number; warnings: string[] }
export function normalizeTransitions(transitions: unknown, count: number): Array<Record<string, unknown> | null>
export function normalizeOneTransition(spec: unknown): Record<string, unknown> | null
export function parseSrt(srtPath: string): Array<[number, number, string]>
export function timestampToSec(ts: string): number
export function appendKeywordTrack(
  tracks: unknown[],
  materials: Record<string, unknown>,
  srtPath: string,
  words: string[],
  kind: string,
  offsetUs?: number | null,
  limitEndUs?: number | null,
  cache?: Record<string, unknown>,
  opts?: Record<string, unknown>
): void
export const KEYWORD_TRACK_STYLES: Readonly<Record<string, { color: string }>>
export function findJianyingExe(appsDir?: string): string
export function launchJianying(appsDir?: string): {
  ok: boolean
  running?: boolean
  launched?: boolean
  exe?: string
  error?: string
}
export function findTextPreset(presetDir: string, rid: string): Record<string, unknown> | null
export function presetAttachToDraft(a: unknown, canvasW?: number, canvasH?: number, expandW?: number, expandH?: number): Record<string, unknown>
export function buildTemplateClipTrio(p: unknown, phrase: string, canvasW?: number, canvasH?: number): {
  templateMaterial: Record<string, unknown>
  textEntry: Record<string, unknown>
  animMaterials: Record<string, unknown>[]
  flowerEffects: Record<string, unknown>[]
  extraRefs: string[]
} | null
export function normalizeTextTemplateClips(textTemplateClips: unknown, videoCount: number): Array<Array<{ phrase: string; startUs: number; durUs: number; resourceId: string }>> | null
export function appendTextTemplateSegments(
  track: unknown,
  materials: Record<string, unknown>,
  clips: Array<{ phrase: string; startUs: number; durUs: number; resourceId: string }>,
  presetDir: string,
  offsetUs: number,
  limitEndUs: number | null,
  tplCache: Map<string, unknown>,
  canvasW?: number,
  canvasH?: number,
  fallback?: unknown
): { appended: number; fallbackSegs: number }
export function appendSfxTrackFromEvents(
  tracks: unknown[],
  materials: Record<string, unknown>,
  events: unknown[],
  offsetUs: number,
  limitEndUs: number | null,
  opts?: Record<string, unknown>
): void
export function jianyingSubtitleStyleFromServer(style: unknown, boxOpacityPct: unknown): {
  colorHex: string
  strokeColorHex: string
  strokeWidth: number
  bgColorHex: string
  bgAlpha: number
}
export function buildSubtitleSegment(textContent: string, startUs: number, durUs: number, materials: Record<string, unknown>, opts?: Record<string, unknown>): Record<string, unknown>
export function draft_content_tracks_render_index(tracks: unknown[]): void
export function normalizeVoiceClips(voiceClips: unknown, videoCount: number): Array<Array<{ path: string; startUs: number; durUs: number }>>
export const SUBTITLE_TRANSFORM_Y: number
export const SUBTITLE_ALIGNMENT: number
export const SUBTITLE_FONT_SIZE_DEFAULT: number
export const TEXT_TEMPLATE_TRANSFORM_Y: number
export const VIDEO_GAP_US: number
