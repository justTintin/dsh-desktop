export function tintinConfigPath(dshHome: string | undefined): string | null
export function readTintinConfigStore(dshHome: string | undefined): Record<string, unknown> | null
export function mergeTintinConfigStore(dshHome: string | undefined, patch: Record<string, unknown>): Record<string, unknown>
export function mergeConfigDocs(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown>
