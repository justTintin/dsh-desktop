// jianying-preset-install 单元回归（2026-09-30：文字模板预设「服务端→本机剪映」安装器）
// 覆盖：导出机绝对路径重写（含 content 嵌套 JSON 字符串）/ 本机剪映目录前置检查 /
// bundle 落盘布局与幂等 / rid 过滤。下载段（GET /jianying_presets/text_v2 全量 zip）
// 由实机验收（端点 2026-09-30 已实测返回 zip）。
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  rebasePresetPaths,
  installPresetBundle,
  installedPresetIndex,
  localJianYingPresetsReady,
  jyPresetDirs,
} from '../packages/tintin-bundle/lib/jianying/jianying-preset-install.js'

describe('jianying-preset-install 纯逻辑', () => {
  it('rebasePresetPaths：普通字符串值与 content 嵌套 JSON 串中的导出机路径统一重写', () => {
    const env = { LOCALAPPDATA: 'C:/Users/Probe/AppData/Local' }
    const base = 'C:/Users/Probe/AppData/Local/JianyingPro'
    const input = {
      effect: { resource_id: '123' },
      resources: [
        { file_path: 'C:/Users/Administrator/AppData/Local/JianyingPro/User Data/Cache/artistEffect/123/textures/a.png' },
        { file_path: 'C:\\Users\\Administrator\\AppData\\Local\\JianyingPro\\User Data\\Presets\\Text_V2/b.textpreset' },
      ],
      // content 是嵌套序列化 JSON 串——内部路径同样要重写，且 JSON 结构不能被破坏
      content: '{"text":"超级推荐","styles":[{"font":{"path":"C:/Users/Administrator/AppData/Local/JianyingPro/User Data/Cache/effect/1/字由奇巧.ttf","id":"1"}}]}',
      keep: '普通字符串不动',
    }
    const out = rebasePresetPaths(input, env) as typeof input
    expect(out.resources[0]!.file_path).toBe(base + '/User Data/Cache/artistEffect/123/textures/a.png')
    expect(out.resources[1]!.file_path.replace(/\\/g, '/')).toContain('JianyingPro/User Data/Presets/Text_V2/b.textpreset')
    expect(out.resources[1]!.file_path.startsWith(base)).toBe(true)
    // content 内路径前缀被替换、其余 JSON 原样且可解析
    expect(out.content.startsWith('{"text":"超级推荐"')).toBe(true)
    expect(out.content).toContain(base + '/User Data/Cache/effect/1/字由奇巧.ttf')
    expect(out.content).not.toContain('Administrator')
    const inner = JSON.parse(out.content)
    expect(inner.styles[0].font.path.startsWith(base)).toBe(true)
    expect(out.keep).toBe('普通字符串不动')
    // 不含 JianyingPro 的字符串与原始值不受影响
    expect(rebasePresetPaths('C:/其它/路径.png', env)).toBe('C:/其它/路径.png')
    expect(rebasePresetPaths(42, env)).toBe(42)
  })

  it('installPresetBundle：前置检查 + 落盘布局 + 幂等 + rid 过滤', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'jytpl-install-test-'))
    const env = { LOCALAPPDATA: path.join(root, 'local') }
    const dirs = jyPresetDirs(env)
    // 前置检查：Presets 父目录不存在 → 显式报错（用户要求：不盲建）
    expect(localJianYingPresetsReady(dirs)).toBe(false)
    const bundle = path.join(root, 'bundle')
    await mkdir(bundle, { recursive: true })
    expect(() => installPresetBundle(bundle, null, dirs, env)).toThrow(/未检测到剪映/)

    // 造本机剪映目录 + 服务端 bundle（两预设一缩略图）
    await mkdir(path.join(root, 'local', 'JianyingPro', 'User Data', 'Presets'), { recursive: true })
    const mk = (name: string, rid: string) => writeFile(path.join(bundle, name), JSON.stringify({
      effect: { resource_id: rid },
      resources: [{ file_path: `C:/Users/Administrator/AppData/Local/JianyingPro/User Data/Cache/artistEffect/${rid}/tex/a.png` }],
    }))
    await mk('预设文本A.textpreset', '111')
    await mk('预设文本B.textpreset', '222')
    await writeFile(path.join(bundle, '预设文本A.jpeg'), Buffer.from([9, 9]))

    // 全量安装
    const r1 = installPresetBundle(bundle, null, dirs, env)
    expect(r1.installed).toBe(2)
    expect(r1.skipped).toBe(0)
    const presetA = JSON.parse(readFileSync(path.join(dirs.presetDir, '预设文本A.textpreset'), 'utf8'))
    expect(presetA.resources[0].file_path.replace(/\\/g, '/')).toContain((root + '/local').replace(/\\/g, '/'))
    expect(presetA.resources[0].file_path).not.toContain('Administrator')
    expect(existsSync(path.join(dirs.presetDir, '预设文本A.jpeg'))).toBe(true)
    expect(installedPresetIndex(dirs.presetDir).has('111')).toBe(true)

    // 幂等：重跑全为 skipped；jpeg 不覆盖（内容保持 9,9）
    const r2 = installPresetBundle(bundle, null, dirs, env)
    expect(r2.installed).toBe(0)
    expect(r2.skipped).toBe(2)

    // rid 过滤：新 rid 走集合命中才装
    await mk('预设文本C.textpreset', '333')
    const r3 = installPresetBundle(bundle, new Set(['333']), dirs, env)
    expect(r3.installed).toBe(1)
    expect(installedPresetIndex(dirs.presetDir).has('333')).toBe(true)
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }, 30_000)
})
