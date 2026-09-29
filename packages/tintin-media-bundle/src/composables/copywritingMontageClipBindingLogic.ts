// ═══════════════════════════════════════════════════════════════
// copywritingMontageClipBindingLogic.ts — 分镜素材绑定随脚本跨机同步·纯函数层
// （无 vue/IPC 依赖，可单测；铁律 8：纯逻辑下沉，编排壳可替换）
//
// 2026-09-29 用户裁决（A′ 附加字段方案，已实测服务端透传）：
//   绑定模型 = clipGroups（指向本机素材池 scenes 的下标数组），下标离开本机
//   池无意义——历史实现保存脚本时仅写单素材弱引用（material_path=首片段），
//   换机器/重新应用脚本后绑定全空。本模块把每镜绑定组编码为实体标识数组
//   （ref=素材池 serverPath：'material://<id>' 或服务端分割片路径）随 shots
//   的 `clip_groups` 附加字段上传（2026-09-29 实测：服务端存储原样透传、
//   详情 GET 原样返回，字段已存在于真实脚本库），加载时解码→入池→重建绑定。
// ═══════════════════════════════════════════════════════════════

/** 编码后的单段绑定：ref=素材池 serverPath（'material://<id>' 或服务端路径），
 *  duration=片段全长秒（恢复时入池直接用，免二次探测），
 *  mediaType=素材类型（素材库图片标注；本地分割恒 video 缺省可省） */
export interface ClipBindingSeg {
  ref: string
  duration: number
  mediaType?: 'video' | 'image'
}

/** 编码输入的素材池行（SplitSceneRow 的最小投影，解耦具体类型） */
export interface ClipBindingRowLike {
  idx: number
  serverPath: string
  duration: number
  mediaType?: 'video' | 'image'
}

/** 绑定组 → clip_groups 载荷。找不到/无 serverPath 的下标跳过该段；
 *  空组保留为空数组（占位对齐镜序，恢复侧按空组跳过） */
export function encodeClipGroups(
  groups: ReadonlyArray<ReadonlyArray<number>>,
  pool: ReadonlyArray<ClipBindingRowLike>,
): ClipBindingSeg[][] {
  const byIdx = new Map(pool.map((r) => [r.idx, r]))
  return (groups || []).map((g) => {
    const segs: ClipBindingSeg[] = []
    for (const idx of g || []) {
      const row = byIdx.get(idx)
      const ref = String(row?.serverPath || '').trim()
      if (!ref) continue
      const seg: ClipBindingSeg = { ref, duration: Number(row?.duration) || 0 }
      if (row?.mediaType) seg.mediaType = row.mediaType
      segs.push(seg)
    }
    return segs
  })
}

/** 详情响应 shots[].clip_groups → 绑定段数组（容错：非数组/段字段非法一律降级，
 *  duration 非正数 → 0（恢复侧入池后显「—」）；ref 去空，空 ref 段丢弃） */
export function decodeClipGroups(raw: unknown): ClipBindingSeg[][] {
  if (!Array.isArray(raw)) return []
  return raw.map((group) => {
    if (!Array.isArray(group)) return []
    const segs: ClipBindingSeg[] = []
    for (const seg of group) {
      const s = seg && typeof seg === 'object' ? (seg as Record<string, unknown>) : null
      const ref = String(s?.ref ?? '').trim()
      if (!ref) continue
      const duration = Number(s?.duration)
      const out: ClipBindingSeg = { ref, duration: Number.isFinite(duration) && duration > 0 ? duration : 0 }
      const mt = String(s?.mediaType ?? s?.media_type ?? '')
      if (mt === 'video' || mt === 'image') out.mediaType = mt
      segs.push(out)
    }
    return segs
  })
}

/** 详情响应 shots[] → 逐镜 clip_groups（与 normalizeShot 后的 shots 按下标对齐）。
 *  每镜的 clip_groups 是单个绑定组（ClipBindingSeg[]）——包一层走 decodeClipGroups
 *  的同一容错后取第 0 组 */
export function clipGroupsFromScriptShots(shots: unknown): ClipBindingSeg[][] {
  const arr = Array.isArray(shots) ? shots : []
  return arr.map((s) => {
    const cg = s && typeof s === 'object' ? (s as Record<string, unknown>).clip_groups : undefined
    return decodeClipGroups([cg])[0] || []
  })
}
