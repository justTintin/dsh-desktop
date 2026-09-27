// test/harness-tree-kill.test.ts — Harness 退出路径连树杀回归（2026-09-25）
// 根因：harness 子进程 detached（独立进程组）且自带子树（bundled-Node worker/
// 会话网关/pnpm），Windows 信号只达本 PID——退出用 pid-only kill 会把孙进程
// 过继成孤儿，继续持有 profile node_modules 句柄，下次 dshmarket 更新撞锁
// rename（EPERM 实证）。本测试钉住：Windows 退出必须走 killTree（默认
// taskkill /t /f），非 Windows 维持 SIGTERM；taskkill 形状与 unref 契约。
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HarnessRuntime,
  killWindowsProcessTree,
  prewarmShellEnvironment,
  type HarnessChildProcess,
} from '../src/main/runtime/harness-runtime'

const cleanup: string[] = []
afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// start() 在 launchProcess 之前会预热 shell 环境（spawn PowerShell，全量并行
// 负载下可能超过 waitFor 默认 1s）；prewarm 结果是模块级缓存的，这里先暖好。
const warmed = prewarmShellEnvironment().catch(() => {})

function stubPlatform(value: NodeJS.Platform): () => void {
  const original = process.platform
  Object.defineProperty(process, 'platform', { value, configurable: true })
  return () => Object.defineProperty(process, 'platform', { value: original, configurable: true })
}

interface FakeChildOptions {
  pid?: number | null
}

function makeFakeChild(options: FakeChildOptions = {}) {
  const signals: string[] = []
  // 测试桩：EventEmitter 实例 + 字面量成员叠加（原型方法 once/emit/on 保留）；
  // 断言到 HarnessChildProcess 需经 unknown 桥（readonly 契约 + 流类型）。
  const child = Object.assign(new EventEmitter(), {
    pid: options.pid !== undefined ? options.pid : 4242,
    stdout: new EventEmitter() as unknown as NodeJS.ReadableStream,
    stderr: new EventEmitter() as unknown as NodeJS.ReadableStream,
    exitCode: null as number | null,
    kill: (signal?: NodeJS.Signals) => {
      signals.push(String(signal ?? ''))
      return true
    },
  }) as unknown as HarnessChildProcess & { exitCode: number | null }
  const exit = () => {
    child.exitCode = 0
    child.emit('exit', 0, null)
  }
  return { child, signals, exit }
}

interface FixtureResult {
  runtime: HarnessRuntime
  treeKills: number[]
  signals: string[]
  child: HarnessChildProcess & { exitCode: number | null }
  exit: () => void
  dir: string
  /** launchProcess 已被调用（返回到 this.child 赋值之间是同步块，
   *  该标志置位后 stop() 必然能拿到 child） */
  launched: () => boolean
}

function makeRuntime(platform: NodeJS.Platform, childOptions: FakeChildOptions = {}): FixtureResult {
  const dir = mkdtempSync(join(tmpdir(), 'harness-tree-'))
  cleanup.push(dir)
  const entry = join(dir, 'dsh-entry.mjs')
  writeFileSync(entry, '')
  const patch = join(dir, 'patch')
  writeFileSync(patch, '')
  const fake = makeFakeChild(childOptions)
  const treeKills: number[] = []
  let launched = false
  const runtime = new HarnessRuntime({
    dshEntryPath: entry,
    nodeExecutablePath: process.execPath,
    nodeEntryPath: entry,
    dshPatchPath: patch,
    dshSafePatchPath: patch,
    dshHome: join(dir, 'home'),
    logPath: join(dir, 'logs', 'runtime.log'),
    startupTimeoutMs: 1_000,
    launchProcess: () => {
      launched = true
      return fake.child
    },
    killTree: (pid) => treeKills.push(pid),
    onChanged: () => {},
  })
  return { runtime, treeKills, signals: fake.signals, child: fake.child, exit: fake.exit, dir, launched: () => launched }
}

describe('Harness 退出路径的连树杀（Windows）', () => {
  let restore: () => void
  beforeEach(() => { restore = stubPlatform('win32') })
  afterEach(() => restore())

  it('stop() 走 killTree（注入缝记录 pid），不对子进程发 SIGTERM', async () => {
    const f = makeRuntime('win32')
    const starting = f.runtime.start(f.dir)
    await vi.waitFor(() => expect(f.launched()).toBe(true), { timeout: 10_000, interval: 50 })
    const stopping = f.runtime.stop()
    await vi.waitFor(() => expect(f.treeKills).toEqual([4242]), { timeout: 10_000, interval: 50 })
    f.exit()
    await Promise.all([starting, stopping])
    expect(f.signals).toEqual([])
  })

  it('pid 为 null（spawn 未成）回退 SIGTERM，不调 killTree', async () => {
    const f = makeRuntime('win32', { pid: null })
    const starting = f.runtime.start(f.dir)
    await vi.waitFor(() => expect(f.launched()).toBe(true), { timeout: 10_000, interval: 50 })
    const stopping = f.runtime.stop()
    f.exit()
    await Promise.all([starting, stopping])
    expect(f.treeKills).toEqual([])
    expect(f.signals).toEqual(['SIGTERM'])
  })

  it('killWindowsProcessTree：taskkill /pid <pid> /t /f + windowsHide + unref', () => {
    const calls: Array<{ args: unknown[]; unrefed: boolean }> = []
    const spawnStub = ((...args: unknown[]) => {
      const record = { args, unrefed: false }
      calls.push(record)
      return { unref: () => { record.unrefed = true } }
    }) as unknown as typeof import('node:child_process').spawn
    killWindowsProcessTree(spawnStub, 4242)
    expect(calls.length).toBe(1)
    expect(calls[0]?.args[0]).toBe('taskkill')
    expect(calls[0]?.args[1]).toEqual(['/pid', '4242', '/t', '/f'])
    expect(calls[0]?.args[2]).toMatchObject({ windowsHide: true, stdio: 'ignore' })
    expect(calls[0]?.unrefed).toBe(true)
  })
})

describe('Harness 退出路径（非 Windows 维持信号语义）', () => {
  let restore: () => void
  beforeEach(() => { restore = stubPlatform('linux') })
  afterEach(() => restore())

  it('stop() 发 SIGTERM，不调 killTree', async () => {
    const f = makeRuntime('linux')
    const starting = f.runtime.start(f.dir)
    await vi.waitFor(() => expect(f.launched()).toBe(true), { timeout: 10_000, interval: 50 })
    const stopping = f.runtime.stop()
    f.exit()
    await Promise.all([starting, stopping])
    expect(f.signals).toEqual(['SIGTERM'])
    expect(f.treeKills).toEqual([])
  })
})
