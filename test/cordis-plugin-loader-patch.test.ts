import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = path.resolve(import.meta.dirname, '..')

describe('cordis-plugin-loader resolution patch', () => {
  it('falls back to resolving bare plugins relative to ctx.baseUrl', async () => {
    const patch = await readFile(
      path.join(
        projectRoot,
        'patches',
        '@deepseek-ai+cordis-plugin-loader+1.0.3.patch'
      ),
      'utf8'
    )

    expect(patch).toContain('const req = createRequire(new URL("package.json", this.ctx.baseUrl).href)')
    expect(patch).toContain('const resolved = req.resolve(name)')
    expect(patch).toContain('return await import(pathToFileURL(resolved).href)')
  })

  it('includes configurable timeout and logs stuck plugin entries', async () => {
    const patch = await readFile(
      path.join(
        projectRoot,
        'patches',
        '@deepseek-ai+cordis-plugin-loader+1.0.3.patch'
      ),
      'utf8'
    )

    expect(patch).toContain('DSH_LOADER_TIMEOUT_MS')
    expect(patch).toContain('plugin tree initialization timed out after')
    expect(patch).toContain('stuck entries:')
  })

  it('EntryTree.prototype.await times out and throws with culprit plugin info', async () => {
    const { EntryTree } = await import('@deepseek-ai/cordis-plugin-loader')
    const hangingPromise = new Promise(() => {})
    const mockTree = Object.create(EntryTree.prototype)
    const mockEntry = {
      options: { id: 'entry-99', name: 'slow-stuck-plugin' },
      _initTask: hangingPromise,
      _failure: (stage: string, err: Error) => {
        const error = new Error(`failed to ${stage} loader entry entry-99 (slow-stuck-plugin): ${err.message}`)
        ;(error as any).dshPluginFailure = { stage, packageName: 'slow-stuck-plugin' }
        return error
      }
    }
    mockTree.entries = function*() {
      yield mockEntry
    }
    mockTree.getTasks = () => [hangingPromise]

    // 桩掉 console：loader 的超时告警属预期输出，打包门禁的控制台必须保持
    // "只有真失败才出现错误行"（2026-09-27 用户裁决）——捕获后改为断言内容。
    const warnings: string[] = []
    const originalError = console.error
    const originalWarn = console.warn
    console.error = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')) }
    console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')) }
    try {
      await expect(mockTree.await({ timeout: 50 })).rejects.toThrow(
        /failed to apply loader entry entry-99 \(slow-stuck-plugin\): plugin initialization timed out/
      )
    } finally {
      console.error = originalError
      console.warn = originalWarn
    }
  })
})
