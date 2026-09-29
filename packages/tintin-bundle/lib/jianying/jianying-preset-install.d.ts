// jianying-preset-install.d.ts — 文字模板预设「服务端→本机剪映」安装器类型声明
// （实现见同目录 jianying-preset-install.js，2026-09-30）
export interface JyPresetDirs {
  userData: string
  presetDir: string
}
export function jyPresetDirs(env?: Record<string, string | undefined>): JyPresetDirs
export function localJianYingPresetsReady(dirs?: JyPresetDirs): boolean
export function rebasePresetPaths<T>(value: T, env?: Record<string, string | undefined>): T
export function presetRid(file: string): string
export function installedPresetIndex(presetDir: string): Map<string, string>
export function installPresetBundle(
  extractDir: string,
  wantRids: Set<string> | null,
  dirs?: JyPresetDirs,
  env?: Record<string, string | undefined>,
): { installed: number; skipped: number; installedNames: Map<string, string> }
export function createJytplInstallChannel(
  httpRequest: (method: string, fullPath: string, opts?: { body?: unknown; headers?: Record<string, string>; timeout?: number }) => Promise<{ data: unknown; status: number; headers: Record<string, string>; raw: Buffer }>,
): (payload: { ids?: string[] }) => Promise<{ ok: boolean; installed: number; skipped: number; note: string } | { error: string }>
