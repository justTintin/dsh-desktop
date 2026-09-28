// TinTin first-boot provisioning — make a fresh install usable without manual
// RPC. Two halves:
//
//  seedTintinDefaults(dshHome) runs BEFORE the harness starts, only when the
//  respective file is absent (never races a live harness):
//    · settings.yaml — tintin-bundle server.url (legacy-client config if the
//      old install exists, else the built-in default), the tintin-server
//      model provider pinned at <server>/llm, and the agent default model.
//    · .credentials.yaml — the provider's placeholder API key ref (the
//      inference server currently runs unauthenticated; A3 auth lands later).
//
//  ensureDefaultWorkspace(snapshot) runs ONCE after the harness reports ready
//  (2026-09-23 ruling: default workspace = Documents/tintin-workspace): it
//  creates the directory and registers it through the public workspace RPC
//  (idempotent — created:false when it already exists). This also unblocks
//  the conversation UI, which needs a workspace before sessions can exist.
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RuntimeSnapshot } from '../shared/contracts'

const DEFAULT_SERVER_URL = 'http://127.0.0.1:8766'
const WORKSPACE_DIR_NAME = 'tintin-workspace'
// The TinTin inference server runs unauthenticated in this build (A3 auth
// lands later), so the stored key is a placeholder by design; it only has to
// be non-empty for llm-pi-ai to send a bearer header the server ignores.
export const TINTIN_SERVER_API_KEY_REF = 'TINTIN_SERVER_API_KEY'
const TINTIN_PLACEHOLDER_API_KEY = 'sk-tintin-local'

// The old client's userData used the package name; earlier packaged builds
// used the productName. Read both (newest mtime wins when both exist).
const LEGACY_APP_DIRS = ['tintin-client-electron', '螺丝钉-电商智能体矩阵']

/** Resolve the seed server URL: legacy client config when present, else default. */
function resolveSeedServerUrl(appDataDir: string | undefined): string {
  if (appDataDir) {
    for (const dir of LEGACY_APP_DIRS) {
      const legacy = join(appDataDir, dir, 'config', 'server.json')
      try {
        // Observed shapes: {"server.url": "..."} (flat dot-key), plus the
        // nested/server_url variants older builds wrote.
        const raw = JSON.parse(readFileSync(legacy, 'utf8')) as Record<string, unknown>
        const nested = raw.server as { url?: unknown } | undefined
        const url = raw['server.url'] ?? nested?.url ?? raw.server_url
        if (typeof url === 'string' && url.length > 0) return url.replace(/\/$/u, '')
      } catch { /* absent or malformed — try the next dir */ }
    }
  }
  return DEFAULT_SERVER_URL
}

function seedSettings(dshHome: string, serverUrl: string): void {
  const settingsPath = join(dshHome, 'settings.yaml')
  if (existsSync(settingsPath)) return
  writeFileSync(settingsPath, [
    '# Seeded by TinTin first-boot provisioning; user settings live above this.',
    'tintin-bundle:',
    '  server:',
    `    url: ${serverUrl}`,
    '    provisioned: false',
    'llm-pi-ai:',
    '  providers:',
    '    tintin-server:',
    '      displayName: TinTin',
    '      apiKeyEnv: TINTIN_SERVER_API_KEY',
    '      api: openai-completions',
    `      baseURL: ${serverUrl}/llm`,
    '      models:',
    '        - id: deepseek-v4-flash',
    '          name: DeepSeek V4 Flash',
    'agent-default-model:',
    '  provider: tintin-server',
    '  model: deepseek-v4-flash',
    'ui-onboarding:',
    '  welcomeNoticeVersion: 2026-08-13.1',
    '',
  ].join('\n'), 'utf8')
}

function seedCredentials(dshHome: string): void {
  const credPath = join(dshHome, '.credentials.yaml')
  if (existsSync(credPath)) return
  writeFileSync(credPath, [
    'version: 1',
    'records: {}',
    'refs:',
    `  ${TINTIN_SERVER_API_KEY_REF}: ${TINTIN_PLACEHOLDER_API_KEY}`,
    '',
  ].join('\n'), 'utf8')
}

/** Idempotent first-boot seed; call before starting the harness runtime. */
export function seedTintinDefaults(dshHome: string, appDataDir: string | undefined): void {
  try {
    mkdirSync(dshHome, { recursive: true })
    const serverUrl = resolveSeedServerUrl(appDataDir)
    seedSettings(dshHome, serverUrl)
    seedCredentials(dshHome)
    // 0.1.7 起 settings.yaml 会在启动时被改名 .imported，且其中的
    // tintin-bundle 段因宿主插件 overlay 拒写而无法迁入 profile —— server.url
    // 种子必须同时落 TinTin 自有存储（config.json），桥接解析链第二档启动即有值。
    const storePath = join(dshHome, 'tintin', 'config.json')
    if (!existsSync(storePath)) {
      mkdirSync(join(dshHome, 'tintin'), { recursive: true })
      writeFileSync(storePath, JSON.stringify({ server: { url: serverUrl } }, null, 2) + '\n', 'utf8')
    }
  } catch (error) {
    // Provisioning must never block startup; a blank home still boots, the
    // user just configures through the settings card instead.
    console.warn('[tintin-first-boot] seed failed:', error instanceof Error ? error.message : String(error))
  }
}

let workspaceEnsured = false
let providerEnsured = false

/** Register the default workspace through the public RPC once harness is ready. */
export async function ensureDefaultWorkspace(snapshot: RuntimeSnapshot): Promise<void> {
  if (workspaceEnsured) return
  const base = snapshot.url
  const token = snapshot.authToken
  if (snapshot.phase !== 'ready' || typeof base !== 'string' || typeof token !== 'string') return
  workspaceEnsured = true
  try {
    const documentsDir = process.env.TINTIN_WORKSPACE_DIR
      ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '.', 'Documents')
    const dir = join(documentsDir, WORKSPACE_DIR_NAME)
    mkdirSync(dir, { recursive: true })

    const origin = new URL(base).origin
    // Token → session cookie (the same chain verify-harness-auth.mjs proves).
    const exchange = new URL('/', origin)
    exchange.searchParams.set('token', token)
    const res = await fetch(exchange, { redirect: 'manual' })
    const setCookie = res.headers.getSetCookie?.() ?? []
    const cookie = setCookie.map((h: string) => h.split(';')[0]?.trim() ?? '').find((p: string) => p.includes('='))
    if (!cookie) throw new Error('no Set-Cookie on token exchange')

    const rpc = await fetch(new URL('/api/workspace/create', origin), {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'tintin-first-boot',
        method: 'workspace/create',
        payload: { args: { request: { path: dir } } },
      }),
    })
    const body = await rpc.json().catch(() => null)
    if (!rpc.ok) throw new Error(`workspace/create ${String(rpc.status)}`)
    const created = (body as { result?: { value?: { created?: boolean } } })?.result?.value?.created
    console.info(`[tintin-first-boot] default workspace ${created === false ? 'already registered' : 'created'}: ${dir}`)
  } catch (error) {
    // One-shot guard already set; a failure surfaces in the UI as "no
    // workspace", recoverable by picking one manually.
    console.warn('[tintin-first-boot] workspace ensure failed:', error instanceof Error ? error.message : String(error))
  }
}

/**
 * Keep the TinTin provider permanent (2026-09-24 user ruling): the settings
 * UI hides its delete button, and this backstop restores the provider even if
 * it was removed through any other path — next boot brings it back from the
 * configured server address. It also restores the provider's stored
 * credential: without it every session fails with MISSING_CREDENTIAL, the
 * Models page shows the provider as unconfigured, and the client onboarding
 * treats the install as provider-less and nags for an API key. Both halves
 * run through the same public RPCs the Models page uses, so a value the user
 * stored later is detected first and never overwritten. Runs once after the
 * harness is ready.
 */
/** Read server.url from the TinTin-owned store (<DSH_HOME>/tintin/config.json),
 * the only persistence the 0.1.7 settings service cannot refuse. Empty string
 * when absent/malformed. */
export function readStoreServerUrl(dshHome: string | undefined): string {
  if (!dshHome) return ''
  try {
    const raw = JSON.parse(readFileSync(join(dshHome, 'tintin', 'config.json'), 'utf8')) as Record<string, unknown>
    const url = (raw.server as { url?: unknown } | undefined)?.url
    return typeof url === 'string' ? url.replace(/\/$/u, '') : ''
  } catch { return '' }
}

/** Overridable in tests; production resolves the harness home from userData. */
export let readDshHome: () => string | undefined = () => {
  const home = process.env.DSH_HOME
  if (home && home.length > 0) return home
  return join(getAppUserData(), 'harness')
}

/** Test seam so the default resolver stays lazy (app may be unset in unit tests). */
export function setDshHomeResolver(resolver: () => string | undefined): void {
  readDshHome = resolver
}

function getAppUserData(): string {
  // Lazy require keeps this module importable in unit tests (top-level
  // `import { app } from 'electron'` breaks under vitest — the electron npm
  // package has no named exports there) and before the app module is ready.
  try {
    // require (not import): the electron package only resolves in the built
    // main bundle; in tests this throws and we return ''.
    const electron = require('electron') as { app?: { getPath: (name: string) => string } }
    return electron?.app?.getPath('userData') ?? ''
  } catch {
    return ''
  }
}

export async function ensureTinTinProvider(snapshot: RuntimeSnapshot): Promise<void> {
  if (providerEnsured) return
  const base = snapshot.url
  const token = snapshot.authToken
  if (snapshot.phase !== 'ready' || typeof base !== 'string' || typeof token !== 'string') return
  providerEnsured = true
  try {
    const origin = new URL(base).origin
    const exchange = new URL('/', origin)
    exchange.searchParams.set('token', token)
    const res = await fetch(exchange, { redirect: 'manual' })
    const setCookie = res.headers.getSetCookie?.() ?? []
    const cookie = setCookie.map((h: string) => h.split(';')[0]?.trim() ?? '').find((p: string) => p.includes('='))
    if (!cookie) throw new Error('no Set-Cookie on token exchange')
    // method is the full public RPC name ('settings/describe' | 'settings/mutate')
    // and maps 1:1 onto the /api/<method> HTTP route.
    const rpc = async (method: string, args: unknown): Promise<unknown> => {
      const r = await fetch(new URL(`/api/${method}`, origin), {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ type: 'client-request', rpcId: `tintin-ensure-${Date.now()}`, method, payload: { args } }),
      })
      const j = await r.json().catch(() => null)
      const result = (j as { result?: { ok?: boolean, error?: { message?: string }, value?: unknown } })?.result
      if (!result) throw new Error(`${method} returned no result (HTTP ${String(r.status)})`)
      if (result.ok === false) throw new Error(`${method}: ${result.error?.message ?? 'unknown error'}`)
      return result.value
    }
    const all = await rpc('settings/describe', {}) as {
      namespaces?: Array<{ ns: string, value?: Record<string, unknown> }>
    } | undefined
    const namespaces = all?.namespaces ?? []
    // serverUrl 优先取 settings 命名空间；0.1.7 起宿主插件条目被设置服务
    // 拒写、迁移也滞留，describe 侧常为空 —— 兜底读 TinTin 自有存储
    // <DSH_HOME>/tintin/config.json（tintin-bundle config:store 的落盘文件）。
    // dshHome 由调用方通过 snapshot 启动参数之外的模块状态注入（readDshHome）。
    const describedUrl = String(
      (namespaces.find((n) => n.ns === 'tintin-bundle')?.value as { server?: { url?: unknown } })?.server?.url ?? '')
    const serverUrl = describedUrl.length > 0 ? describedUrl : readStoreServerUrl(readDshHome())
    const provider = (namespaces.find((n) => n.ns === 'llm-pi-ai')?.value as {
      providers?: Record<string, unknown>
    } | undefined)?.providers?.['tintin-server']
    if (provider === undefined && serverUrl.length > 0) {
      await rpc('settings/mutate', {
        ns: 'llm-pi-ai',
        ops: [{
          op: 'set', path: ['providers', 'tintin-server'], value: {
            displayName: 'TinTin', apiKeyEnv: TINTIN_SERVER_API_KEY_REF, api: 'openai-completions',
            baseURL: `${serverUrl}/llm`, models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }],
          },
        }],
      })
      console.info(`[tintin-first-boot] tintin-server provider restored from ${serverUrl}`)
    }

    // Credential half. Profiles created before first-boot seeding shipped can
    // hold a credentials.yaml the harness itself wrote (browser-session grant
    // only) — the ref must be (re)stored, but a real key the user entered
    // through the Models page wins and is left alone.
    const described = await rpc('credentials/describe', { refs: [TINTIN_SERVER_API_KEY_REF] }) as
      Record<string, { configured?: boolean }> | undefined
    if (described?.[TINTIN_SERVER_API_KEY_REF]?.configured !== true) {
      await rpc('credentials/set', { ref: TINTIN_SERVER_API_KEY_REF, value: TINTIN_PLACEHOLDER_API_KEY })
      console.info('[tintin-first-boot] tintin-server credential restored (placeholder key)')
    }
  } catch (error) {
    console.warn('[tintin-first-boot] provider ensure failed:', error instanceof Error ? error.message : String(error))
  }
}
