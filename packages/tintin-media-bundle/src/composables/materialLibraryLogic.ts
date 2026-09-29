// ═══════════════════════════════════════════════════════════════
// materialLibraryLogic.ts — 素材库（媒体工具卡）纯函数逻辑层
// （无 vue 依赖，可单测；铁律 8：纯逻辑下沉，编排壳可替换）
// 2026-09-29 用户裁决：原「音频生成」卡升级为「素材库」（三 tab 视频/图片/音频）。
// 图视域条目字段容错与「选择素材」弹窗（WbPickMaterialDialog）同口径——
// 两处消费同一 /material/list 自由格式响应；弹窗保持不动（选择语义=入会话池），
// 本模块先服务素材库页（选择语义=下载到本地），弹窗后续可就近收编。
// ═══════════════════════════════════════════════════════════════

/** /material/list 条目（自由格式响应经 pickListItems 容错后的对象） */
export type MaterialGridItem = Record<string, unknown>

/** 素材键（material_id 优先、回落 id；弹窗 midOf 同口径；缩略图/预览/下载共用） */
export function materialGridKey(it: MaterialGridItem | null | undefined): string {
  return String(it?.material_id ?? it?.id ?? '').trim()
}

/** 使用次数：usage_count_total（原素材=源热度=自身+分割片段聚合）优先，
 *  回落 usage_count（分割片段=自身）；缺失/非正数 → 0（徽标不显示） */
export function usageCountOf(it: MaterialGridItem | null | undefined): number {
  const total = Number(it?.usage_count_total)
  if (Number.isFinite(total) && total > 0) return total
  return Number(it?.usage_count) || 0
}

/** 卡片主文案：filename || name || 键 || 「未命名素材」（弹窗 mainText 同口径） */
export function materialMainText(it: MaterialGridItem | null | undefined): string {
  return String(it?.filename || it?.name || materialGridKey(it) || '未命名素材')
}

/** 卡片副文案：品牌 / 型号 / 分类。素材条目无 category 字段（实测），
 *  分类语义回落 share_name（弹窗 subText 同口径） */
export function materialSubText(it: MaterialGridItem | null | undefined): string {
  const seg = [
    String(it?.brand || ''),
    String(it?.model || ''),
    String(it?.category || it?.share_name || ''),
  ]
    .filter(Boolean)
    .join(' / ')
  return seg
}

/** 预览信息·素材 ID（id ?? material_id——注意与 materialGridKey 相反序，
 *  弹窗 metaId 同口径：/material/list 条目实测字段为 id） */
export function materialMetaId(it: MaterialGridItem | null | undefined): string {
  return String(it?.id ?? it?.material_id ?? '').trim()
}

/** 预览信息·文件 Hash（/material/list 条目实测字段 file_hash；缺失 → ''） */
export function materialMetaHash(it: MaterialGridItem | null | undefined): string {
  return String(it?.file_hash ?? '').trim()
}

/** 预览种类：media_type=image → image，否则一律按 video（弹窗 previewKind 同口径：
 *  类型字段缺失时不误伤视频预览） */
export function previewKindOf(it: MaterialGridItem | null | undefined): 'image' | 'video' {
  return String(it?.media_type || '').toLowerCase() === 'image' ? 'image' : 'video'
}

/** 分页总页数：total 缺失（-1，服务端未给分页字段）→ 单页 1 */
export function totalPagesOf(total: number, size: number): number {
  return total < 0 ? 1 : Math.max(1, Math.ceil(total / Math.max(1, size)))
}

/** 分页器可见性：总数不超一页时不显示（弹窗 hasPager 同口径） */
export function pagerVisible(total: number, size: number): boolean {
  return total > size
}

const ILLEGAL_NAME_RE = /[\\/:*?"<>|\r\n]+/g

/** 下载落盘文件名：filename 优先；缺失回退「素材{键}.{类型扩展名}」；
 *  键也缺失 →「未命名素材.{ext}」。非法文件名字符统一替换下划线（Windows 集内） */
export function downloadFileNameOf(it: MaterialGridItem | null | undefined): string {
  const ext = previewKindOf(it) === 'image' ? 'jpg' : 'mp4'
  const raw = String(it?.filename || '').trim()
  const base = raw || (materialGridKey(it) ? `素材${materialGridKey(it)}` : '未命名素材')
  const name = base.replace(ILLEGAL_NAME_RE, '_')
  return /\.[A-Za-z0-9]{1,8}$/.test(name) ? name : `${name}.${ext}`
}

/** 目录 + 文件名拼落盘路径（dialog.openDir 返回本机绝对路径；按系统主分隔符拼接，
 *  去重尾部分隔符。纯字符串拼接，不做 fs 校验——失败由下载层如实上报） */
export function joinDownloadPath(dir: string, name: string): string {
  const d = String(dir || '').trim()
  if (!d) return name
  const sep = d.includes('\\') ? '\\' : '/'
  return d.replace(/[\\/]+$/, '') + sep + String(name || '').trim()
}
