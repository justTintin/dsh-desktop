export interface MigrationOp {
  path: string[]
  value: unknown
}
export function findLegacyConfigDir(appDataDir: string | undefined): string | null
export function readLegacyConfig(configDir: string): MigrationOp[]
export function planLegacyMigration(configDir: string, current: unknown): MigrationOp[]
export function readImportedTintinSection(importedPath: string | undefined): Record<string, unknown> | null
export function planImportedSettingsRecovery(section: unknown, current: unknown): MigrationOp[]
