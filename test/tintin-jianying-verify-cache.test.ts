// verifyDraftFolder 行为回归（2026-09-30 用户报障：装上服务端 Text_V2 预设后，
// 文字模板引用的 Cache/artistEffect 云端特效缓存本机缺失 → 自检判致命 → 导出整卡死）。
// 契约：artistEffect 缓存缺失 = warning（剪映按 resource_id 云端解析），真本地媒体
// 缺失仍为致命 problem。
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { verifyDraftFolder } from '../packages/tintin-bundle/lib/jianying/jianying-exporter.js'

describe('verifyDraftFolder：artistEffect 云端缓存降级', () => {
  it('Cache/artistEffect 缺失 → warning 不致命；真本地媒体缺失 → 仍致命', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'jy-verify-cache-'))
    const missingEffect = path.join(dir, 'Cache', 'artistEffect', '7539102229186235710', 'd52cae96e7ae22')
    const missingReal = path.join(dir, 'videos', 'not-there.mp4')
    const content = {
      tracks: [{ type: 'video', segments: [{ id: 's1', material_id: 'm1' }] }],
      materials: {
        video_effects: [{ id: 'm1', path: missingEffect }],
        videos: [{ id: 'm2', path: missingReal }],
      },
    }
    await mkdir(path.join(dir, 'Cache', 'artistEffect', '7539102229186235710'), { recursive: true })
    await writeFile(path.join(dir, 'draft_content.json'), JSON.stringify(content))
    await writeFile(path.join(dir, 'draft_meta_info.json'), '{}')
    const v = verifyDraftFolder({ draftFolder: dir })
    expect(v.ok).toBe(false) // 真媒体缺失仍致命
    expect(v.problems.join('\n')).toContain(missingReal)
    expect(v.problems.join('\n')).not.toContain('artistEffect')
    expect(v.warnings.join('\n')).toContain('artistEffect')
    // 反证：仅缺 artistEffect 时整体通过
    content.materials.videos = []
    await writeFile(path.join(dir, 'draft_content.json'), JSON.stringify(content))
    const v2 = verifyDraftFolder({ draftFolder: dir })
    expect(v2.ok).toBe(true)
    expect(v2.warnings.join('\n')).toContain(missingEffect)
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }, 30_000)
})
