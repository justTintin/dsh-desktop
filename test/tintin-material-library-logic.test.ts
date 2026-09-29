// test/tintin-material-library-logic.test.ts — 素材库卡纯函数回归（2026-09-29）
// 素材库（原「音频生成」卡升级）：图视域条目字段容错与「选择素材」弹窗
// （WbPickMaterialDialog midOf/usageOf/mainText/subText/metaId/metaHash/
// previewKind/hasPager）同口径；下载文件名/落盘路径拼接为本页新增语义
// （选择=下载到本地）。
import { describe, expect, it } from 'vitest'
import {
  downloadFileNameOf,
  joinDownloadPath,
  materialGridKey,
  materialMainText,
  materialMetaHash,
  materialMetaId,
  materialSubText,
  pagerVisible,
  previewKindOf,
  totalPagesOf,
  usageCountOf,
} from '../packages/tintin-media-bundle/src/composables/materialLibraryLogic'

describe('条目字段容错（弹窗同口径）', () => {
  it('materialGridKey：material_id 优先回落 id，trim 后返回', () => {
    expect(materialGridKey({ material_id: 'm1', id: 7 })).toBe('m1')
    expect(materialGridKey({ id: 7 })).toBe('7')
    expect(materialGridKey({ material_id: '  m9 ' })).toBe('m9')
    expect(materialGridKey({})).toBe('')
    expect(materialGridKey(null)).toBe('')
  })

  it('materialMetaId：id 优先回落 material_id（与键相反序，/material/list 实测字段 id）', () => {
    expect(materialMetaId({ material_id: 'm1', id: 7 })).toBe('7')
    expect(materialMetaId({ material_id: 'm1' })).toBe('m1')
    expect(materialMetaId({})).toBe('')
  })

  it('materialMetaHash：file_hash 缺失回空串', () => {
    expect(materialMetaHash({ file_hash: 'abc' })).toBe('abc')
    expect(materialMetaHash({})).toBe('')
  })

  it('usageCountOf：usage_count_total 优先（源热度），回落 usage_count，缺失/非正 → 0', () => {
    expect(usageCountOf({ usage_count_total: 5, usage_count: 2 })).toBe(5)
    expect(usageCountOf({ usage_count: 2 })).toBe(2)
    expect(usageCountOf({ usage_count_total: 0, usage_count: 0 })).toBe(0)
    expect(usageCountOf({})).toBe(0)
  })

  it('materialMainText：filename || name || 键 || 未命名素材', () => {
    expect(materialMainText({ filename: 'a.mp4', name: 'b', material_id: 'm1' })).toBe('a.mp4')
    expect(materialMainText({ name: 'b', material_id: 'm1' })).toBe('b')
    expect(materialMainText({ material_id: 'm1' })).toBe('m1')
    expect(materialMainText({})).toBe('未命名素材')
  })

  it('materialSubText：brand/model/category(回落 share_name) 以 " / " 连接，空段跳过', () => {
    expect(materialSubText({ brand: 'B', model: 'M', category: 'C' })).toBe('B / M / C')
    expect(materialSubText({ brand: 'B', share_name: '鼠标键盘' })).toBe('B / 鼠标键盘')
    expect(materialSubText({ model: 'M' })).toBe('M')
    expect(materialSubText({})).toBe('')
  })

  it('previewKindOf：media_type=image → image，其余（含缺失）一律 video', () => {
    expect(previewKindOf({ media_type: 'image' })).toBe('image')
    expect(previewKindOf({ media_type: 'IMAGE' })).toBe('image')
    expect(previewKindOf({ media_type: 'video' })).toBe('video')
    expect(previewKindOf({})).toBe('video')
  })
})

describe('分页（/material/list page/size）', () => {
  it('totalPagesOf：total 缺失(-1) 单页；否则向上取整，最小 1', () => {
    expect(totalPagesOf(-1, 60)).toBe(1)
    expect(totalPagesOf(0, 60)).toBe(1)
    expect(totalPagesOf(61, 60)).toBe(2)
    expect(totalPagesOf(120, 60)).toBe(2)
  })

  it('pagerVisible：不超一页不显示分页器（弹窗 hasPager 同口径）', () => {
    expect(pagerVisible(60, 60)).toBe(false)
    expect(pagerVisible(61, 60)).toBe(true)
    expect(pagerVisible(-1, 60)).toBe(false)
  })
})

describe('下载语义（本页新增：选择=下载到本地）', () => {
  it('downloadFileNameOf：filename 优先；缺失回退 素材{键}.{类型扩展名}', () => {
    expect(downloadFileNameOf({ filename: 'demo.mp4', media_type: 'video' })).toBe('demo.mp4')
    expect(downloadFileNameOf({ material_id: 'm1', media_type: 'image' })).toBe('素材m1.jpg')
    expect(downloadFileNameOf({ material_id: 'm2', media_type: 'video' })).toBe('素材m2.mp4')
    expect(downloadFileNameOf({})).toBe('未命名素材.mp4') // media_type 缺失按 video 兜底（previewKindOf 同口径）
  })

  it('downloadFileNameOf：无扩展名自动补；非法文件名字符替换下划线', () => {
    expect(downloadFileNameOf({ filename: 'noext', media_type: 'video' })).toBe('noext.mp4')
    expect(downloadFileNameOf({ filename: 'a:b*c?.mp4' })).toBe('a_b_c_.mp4')
  })

  it('joinDownloadPath：按目录主分隔符拼接并去重尾部分隔符', () => {
    expect(joinDownloadPath('D:\\downloads', 'a.mp4')).toBe('D:\\downloads\\a.mp4')
    expect(joinDownloadPath('D:\\downloads\\', 'a.mp4')).toBe('D:\\downloads\\a.mp4')
    expect(joinDownloadPath('/tmp/dl/', 'a.mp4')).toBe('/tmp/dl/a.mp4')
    expect(joinDownloadPath('', 'a.mp4')).toBe('a.mp4')
  })
})
