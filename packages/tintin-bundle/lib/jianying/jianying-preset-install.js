// jianying-preset-install.js — 文字模板预设「服务端 → 本机剪映」安装器
// （2026-09-30 用户裁决：进入剪映模板工具与文案混剪第四步导出前，自动从服务端
//  下载预设并安装到本机剪映，消除"换机后文字模板退化为纯文本"。）
//
// 服务端契约（2026-09-30 实测）：GET /jianying_presets/text_v2 → 全量 zip
// （根级 `预设文本N.textpreset` + 同名 `.jpeg` 预览缩略图，即剪映 Text_V2 目录原貌，
//  openapi 已登记该端点）。预设内部（含 content 嵌套 JSON 字符串）携带导出机
// 绝对路径（C:/Users/<导出机>/AppData/Local/JianyingPro/...——字体 Cache/effect、
// effectStyle Cache/artistEffect、预览 jpeg 路径），安装时统一重写到本机基座。
// 注意：包不含 artistEffect 缓存本体——剪映按 resource_id 云端解析为预期路径，
// 实机渲染效果为验收项。
// 幂等：本机 Text_V2 已有同 resource_id 预设时跳过该条（skipped 计数）。
// 落盘前置检查（2026-09-30 用户要求）：本机剪映 User Data\Presets 目录必须存在，
// 不存在=本机未装剪映，显式报错不盲建目录。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

/** 本机剪映相关目录（依赖注入便于测试） */
export function jyPresetDirs(env = process.env) {
  const local = env.LOCALAPPDATA || ''
  return {
    userData: path.join(local, 'JianyingPro', 'User Data'),
    presetDir: path.join(local, 'JianyingPro', 'User Data', 'Presets', 'Text_V2'),
  }
}

/** 本机剪映预设根目录存在性（用户要求：同步前检查本机剪映路径，不盲建） */
export function localJianYingPresetsReady(dirs = jyPresetDirs()) {
  return !!dirs.presetDir && fs.existsSync(path.dirname(dirs.presetDir))
}

/** 预设 JSON 内的"导出机绝对路径"重写：任意字符串值（含 content 嵌套 JSON 串）中
 *  形如 `<盘符:/...>…/JianyingPro` 的前缀全局替换为本机 `<LOCALAPPDATA>\JianyingPro`，
 *  JianyingPro 之后的相对段原样保留（导出机原生即正斜杠混排，剪映兼容）。
 *  深度遍历对象/数组，返回新结构（不改入参）。 */
export function rebasePresetPaths(value, env = process.env) {
  const local = String((env && env.LOCALAPPDATA) || '')
  if (!local) return value
  // 基座统一正斜杠（剪映预设原生路径即正斜杠混排，保持同风格）
  const base = local.replace(/\\/g, '/') + '/JianyingPro'
  // 从盘符/根斜杠起、到 JianyingPro 标记止的路径前缀（排除 JSON 结构字符，防跨值误吞）
  const pattern = /(?:[A-Za-z]:[\\/]|[\\/])[^\s"'{}]*[\\/]JianyingPro/g
  const walk = (v) => {
    if (typeof v === 'string') return v.includes('JianyingPro') ? v.replace(pattern, base) : v
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const out = {}
      for (const k of Object.keys(v)) out[k] = walk(v[k])
      return out
    }
    return v
  }
  return walk(value)
}

/** 读取 .textpreset 的 resource_id（无/解析失败返回空串） */
export function presetRid(file) {
  try {
    const p = JSON.parse(fs.readFileSync(file, 'utf8'))
    return String((p && p.effect && (p.effect.resource_id || p.effect.effect_id)) || '')
  } catch { return '' }
}

/** Text_V2 已装 resource_id → 文件名 索引（幂等判定） */
export function installedPresetIndex(presetDir) {
  const idx = new Map()
  let files = []
  try { files = fs.readdirSync(presetDir) } catch { return idx }
  for (const f of files) {
    if (!f.endsWith('.textpreset')) continue
    const rid = presetRid(path.join(presetDir, f))
    if (rid) idx.set(rid, f)
  }
  return idx
}

/** 解压后的 bundle 目录 → 安装到本机 Text_V2。
 *  wantRids 为空=全量；否则只装命中 rid 的 .textpreset（同名 .jpeg 预览随行）。
 *  返回 {installed, skipped}（按预设条目计；其它文件不计数原样补齐缺失）。 */
export function installPresetBundle(extractDir, wantRids, dirs = jyPresetDirs(), env = process.env) {
  if (!localJianYingPresetsReady(dirs)) {
    throw new Error(`本机未检测到剪映预设目录（${path.dirname(dirs.presetDir)} 不存在）——请先安装/启动一次剪映专业版`)
  }
  fs.mkdirSync(dirs.presetDir, { recursive: true })
  const want = wantRids && wantRids.size ? (rid) => wantRids.has(String(rid)) : () => true
  const installed = new Map() // rid → 文件名（本轮新装）
  let installedCount = 0
  let skippedCount = 0
  let names = []
  try { names = fs.readdirSync(extractDir) } catch { return { installed: 0, skipped: 0 } }
  const existing = installedPresetIndex(dirs.presetDir)
  for (const name of names) {
    const src = path.join(extractDir, name)
    let st = null
    try { st = fs.statSync(src) } catch { continue }
    if (st.isDirectory()) continue
    if (!name.endsWith('.textpreset')) {
      // 预览缩略图等伴随文件：缺失才补（不覆盖本机已有）
      const dest = path.join(dirs.presetDir, name)
      if (!fs.existsSync(dest)) fs.copyFileSync(src, dest)
      continue
    }
    const rid = presetRid(src)
    if (!rid) continue
    if (!want(rid)) continue
    if (existing.has(rid)) { skippedCount++; continue }
    let parsed = null
    try { parsed = JSON.parse(fs.readFileSync(src, 'utf8')) } catch { continue }
    fs.writeFileSync(path.join(dirs.presetDir, name), JSON.stringify(rebasePresetPaths(parsed, env)))
    installed.set(rid, name)
    installedCount++
  }
  return { installed: installedCount, skipped: skippedCount, installedNames: installed }
}

/** host 通道工厂：jytpl:install（final-ipc 注入 httpRequest）。
 *  payload {ids?: string[]}（jy_<rid>；空=服务端 bundle 全量）。
 *  契约端点：GET /jianying_presets/text_v2 → 全量 zip（2026-09-30 实测可用）。 */
export function createJytplInstallChannel(httpRequest) {
  return async function jytplInstall(payload) {
    const wantRids = new Set(
      (Array.isArray((payload || {}).ids) ? payload.ids : [])
        .map((id) => String(id))
        .filter((id) => id.startsWith('jy_'))
        .map((id) => id.slice(3)),
    )
    const dirs = jyPresetDirs()
    const workRoot = path.join(process.env.TEMP || process.env.LOCALAPPDATA || '.', 'tintin-jytpl-install')
    try {
      const res = await httpRequest('GET', '/jianying_presets/text_v2', { timeout: 120000 })
      const buf = Buffer.from((res && res.raw) || Buffer.alloc(0))
      if (buf.length < 4 || buf.slice(0, 2).toString('ascii') !== 'PK') {
        return { error: '服务端预设包响应非 zip（/jianying_presets/text_v2）' }
      }
      fs.rmSync(workRoot, { recursive: true, force: true })
      const extractDir = path.join(workRoot, 'bundle')
      fs.mkdirSync(extractDir, { recursive: true })
      const zipPath = path.join(workRoot, 'presets.zip')
      fs.writeFileSync(zipPath, buf)
      execFileSync('powershell', ['-NoProfile', '-Command',
        `Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${extractDir}'`], { stdio: 'pipe' })
      const placed = installPresetBundle(extractDir, wantRids, dirs)
      return {
        ok: true,
        installed: placed.installed,
        skipped: placed.skipped,
        note: placed.installed
          ? `已安装 ${placed.installed} 个文字模板预设到本机剪映（${placed.skipped} 已存在）`
          : `本机剪映预设已齐备（${placed.skipped} 个模板均已安装）`,
      }
    } catch (e) {
      return { error: String((e && e.message) || e).slice(0, 160) }
    } finally {
      try { fs.rmSync(workRoot, { recursive: true, force: true }) } catch { /* 清理失败不影响结果 */ }
    }
  }
}
