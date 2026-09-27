// Hand-maintained declarations for the plugin entry (lib/*.d.ts convention).
// apply's ctx is the cordis Context — kept unknown here because the plugin
// consumes it structurally (logger/effect/inject/settings) and cordis ships no
// standalone package types for plugin authors.
export function getBinDir(): string | undefined
export function resolveBinary(bin: string): Promise<{ ok: boolean; bin: string; version?: string; error?: string }>
export const Config: unknown
export const name: 'tintin-bundle'
export const inject: ['settings']
export function isTrustedRequest(req: unknown, mutation?: boolean): boolean
export function apply(ctx: unknown, config: unknown): Promise<void>
