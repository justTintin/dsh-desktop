// test/tintin-settings-recovery.test.ts — 2026-09-28 8766 回落事故的接线回归。
// 事故:0.1.7 设置重构把旧库改名为 settings.yaml.imported,上游迁移只搬了
// 上游命名空间,tintin-bundle 段(server.url/provisioned, local.cacheDir)滞留,
// 桥接静默回落内置默认 127.0.0.1:8766,业务路由全线 ECONNREFUSED。
// 纯逻辑(planImportedSettingsRecovery / tintin-config-store)由各自单测覆盖;
// 本文件用 mock cordis ctx 驱动真实 apply(),钉住「effect 读文件→计划→写入
// 自有存储」这条接线,以及「存储或 profile 里已重设的值不被覆盖」。
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../packages/tintin-bundle/index.js'
import { readTintinConfigStore } from '../packages/tintin-bundle/lib/tintin-config-store.js'

const IMPORTED_YAML = `tintin-bundle:
  server:
    url: http://192.168.111.31:8000
    provisioned: true
  local:
    cacheDir: D:\\Media\\cache
llm-pi-ai:
  providers:
    tintin-server:
      baseURL: http://192.168.111.31:8000/llm
`

interface MockCtx {
  logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> }
  inject: ReturnType<typeof vi.fn>
  emit: ReturnType<typeof vi.fn>
  provide: ReturnType<typeof vi.fn>
  effect: (fn: () => unknown, _label?: string) => void
  settings: { update: ReturnType<typeof vi.fn> }
  disposers: Array<unknown>
}

function makeCtx(): MockCtx {
  const disposers: Array<unknown> = []
  const ctx: MockCtx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    // tools/webServer 缺席的组合(与本插件降级注释一致):scoped inject 直接落空,
    // 不注册工具与路由,避免测试绑端口。
    inject: vi.fn(() => undefined),
    emit: vi.fn(),
    provide: vi.fn(),
    effect(fn) {
      const d = fn()
      if (typeof d === 'function') disposers.push(d)
    },
    settings: { update: vi.fn(() => Promise.resolve()) },
    disposers,
  }
  return ctx
}

describe('tintin-bundle settings.yaml.imported recovery wiring', () => {
  let home: string
  let savedEnv: Record<string, string | undefined>
  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    if (home) rmSync(home, { recursive: true, force: true })
  })

  function seedEnv(yaml?: string, configCurrent?: Record<string, unknown>): { ctx: MockCtx; config: Record<string, unknown> } {
    home = mkdtempSync(join(tmpdir(), 'tintin-rec-wire-'))
    mkdirSync(join(home, 'empty-bin'), { recursive: true })
    if (yaml !== undefined) writeFileSync(join(home, 'settings.yaml.imported'), yaml, 'utf8')
    savedEnv = {
      DSH_HOME: process.env.DSH_HOME,
      APPDATA: process.env.APPDATA,
      TINTIN_BIN_DIR: process.env.TINTIN_BIN_DIR,
      TINTIN_AI_CONFIG: process.env.TINTIN_AI_CONFIG,
    }
    process.env.DSH_HOME = home
    process.env.APPDATA = join(home, 'no-legacy-here')
    process.env.TINTIN_BIN_DIR = join(home, 'empty-bin')
    delete process.env.TINTIN_AI_CONFIG
    return { ctx: makeCtx(), config: configCurrent ?? {} }
  }

  it('recovers the stranded section into the TinTin-owned store on boot', async () => {
    const { ctx, config } = seedEnv(IMPORTED_YAML)
    await apply(ctx as never, config)
    expect(readTintinConfigStore(home)).toEqual({
      server: { url: 'http://192.168.111.31:8000', provisioned: true },
      local: { cacheDir: 'D:\\Media\\cache' },
    })
    expect(ctx.logger.info).toHaveBeenCalledWith(
      'tintin-bundle: recovering settings from settings.yaml.imported (%d keys)',
      3,
    )
    for (const d of ctx.disposers) (d as () => void)()
  })

  it('never overwrites a server.url the user re-set (profile config layer)', async () => {
    const { ctx, config } = seedEnv(IMPORTED_YAML, { server: { url: 'http://10.0.0.9:9000' } })
    await apply(ctx as never, config)
    expect(readTintinConfigStore(home)).toEqual({
      server: { provisioned: true },
      local: { cacheDir: 'D:\\Media\\cache' },
    })
    for (const d of ctx.disposers) (d as () => void)()
  })

  it('never overwrites a server.url already in the TinTin store layer', async () => {
    const { ctx, config } = seedEnv(IMPORTED_YAML)
    // 存储层已有用户重设的值 → 恢复必须停手(第二启动起幂等)。
    const { mergeTintinConfigStore } = await import('../packages/tintin-bundle/lib/tintin-config-store.js')
    mergeTintinConfigStore(home, { server: { url: 'http://10.0.0.8:8000', provisioned: true }, local: { cacheDir: 'E:\\mine' } })
    await apply(ctx as never, config)
    expect(readTintinConfigStore(home)).toEqual({
      server: { url: 'http://10.0.0.8:8000', provisioned: true },
      local: { cacheDir: 'E:\\mine' },
    })
    for (const d of ctx.disposers) (d as () => void)()
  })

  it('is a no-op when the imported store is absent or fully recovered', async () => {
    const { ctx, config } = seedEnv(undefined, {
      server: { url: 'http://192.168.111.31:8000', provisioned: true },
      local: { cacheDir: 'D:\\Media\\cache' },
    })
    await apply(ctx as never, config)
    expect(readTintinConfigStore(home)).toBeNull()
    for (const d of ctx.disposers) (d as () => void)()
  })
})
