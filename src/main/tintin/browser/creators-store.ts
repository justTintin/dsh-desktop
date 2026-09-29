// creators-store.ts — 达人/创作者库存储与采集（SRC desktop/main/creators-store.js
// 1:1 ESM 移植，基线 SRC 9ca9050；铁律 8 分层：纯函数+runner+IPC 同文件对齐源结构）。
// 数据文件：<userData>/creators/creators.json（达人库）+ collected.json（采集清单，B8 入库状态回写）。
// 采集 runner：隐藏 WebContentsView（平台分区）自动滚动加载全部 → 提取视频链接 → 落清单。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserView, BrowserWindow, type App, type IpcMain } from 'electron'

function creatorsDir(userDataDir: string): string {
  return join(userDataDir, 'creators')
}
function creatorsFilePath(userDataDir: string): string {
  return join(creatorsDir(userDataDir), 'creators.json')
}
function collectedFilePath(userDataDir: string): string {
  return join(creatorsDir(userDataDir), 'collected.json')
}

const MAX_COLLECTED = 5000

function _today(): string {
  const d = new Date()
  const p2 = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

export interface CreatorItem {
  id: string
  platform: string
  name: string
  homepageUrl: string
  addedAt: number
}

export interface CollectedItem {
  platform: string
  creatorId: string
  creatorName: string
  title: string
  url: string
  source: string
  date: string
  collectedAt: string
  importStatus?: 'submitted' | 'imported' | 'failed' | string
  importTaskId?: string
  importError?: string
  importedAt?: string
}

export function normalizeCreator(creator: Partial<CreatorItem> | null): CreatorItem {
  return {
    id: String((creator && creator.id) || '').trim(),
    platform: String((creator && creator.platform) || '').trim(),
    name: String((creator && creator.name) || (creator && creator.id) || '').trim(),
    homepageUrl: String((creator && creator.homepageUrl) || '').trim(),
    addedAt: (creator && creator.addedAt) || Date.now(),
  }
}

/** 新增达人（按 id+platform 去重，已存在则原样返回） */
export function addCreator(list: CreatorItem[] | null, creator: Partial<CreatorItem> | null): CreatorItem[] {
  const arr = Array.isArray(list) ? list : []
  const c = normalizeCreator(creator)
  if (!c.id || !c.platform) return arr
  const exists = arr.find((x) => x.id === c.id && x.platform === c.platform)
  if (exists) return arr
  return [c, ...arr]
}

/** 删除达人（按 id+platform 过滤） */
export function deleteCreator(list: CreatorItem[] | null, payload: { id?: string; platform?: string }): CreatorItem[] {
  const id = String(payload?.id || '')
  const platform = String(payload?.platform || '')
  return (Array.isArray(list) ? list : []).filter((c) => !(c.id === id && c.platform === platform))
}

/** 采集链接去重（platform|url 键） */
export function dedupeCollectedItems(items: unknown): CollectedItem[] {
  const out: CollectedItem[] = []
  for (const it of (Array.isArray(items) ? items : []) as CollectedItem[]) {
    const key = String(it?.platform || '') + '|' + String(it?.url || '')
    if (!out.some((x) => String(x.platform || '') + '|' + String(x.url || '') === key)) out.push(it)
  }
  return out
}

/** 达人主页 URL 推导（平台搜索页；对照原 collectAllFromCreator L1271-1290） */
export function deriveProfileUrl(creatorName: string, platform: string): string {
  const kw = encodeURIComponent(creatorName || '')
  if (platform === 'bilibili') return `https://search.bilibili.com/upuser?keyword=${kw}`
  if (platform === 'douyin') return `https://www.douyin.com/search/${kw}?type=user`
  if (platform === 'xiaohongshu') return `https://www.xiaohongshu.com/search_result?keyword=${kw}&source=web_search_result_notes&type=user`
  if (platform === 'youtube') return `https://www.youtube.com/results?search_query=${kw}&sp=EgIQAg%3D%3D`
  if (platform === 'kuaishou') return `https://www.kuaishou.com/search/video?searchKey=${kw}&tab=user`
  if (platform === 'weixin') return `https://channels.weixin.qq.com/search?keyword=${kw}`
  if (platform === 'jimeng') return `https://www.douyin.com/search/${kw}?type=user`
  return `https://www.douyin.com/search/${kw}?type=user`
}

/** 自动滚动到底（找最大可滚动容器；原版 L1181-1190 逐句对照） */
export const SCROLL_SCRIPT = `(() => {
  let t = document.scrollingElement || document.documentElement;
  let m = t ? t.scrollHeight : 0;
  document.querySelectorAll('div, main, section, ul').forEach((e) => {
    if (e.scrollHeight > e.clientHeight + 300 && e.scrollHeight > m) { m = e.scrollHeight; t = e; }
  });
  try { if (t && t !== document.scrollingElement) t.scrollTop = t.scrollHeight; } catch (e) {}
  window.scrollTo(0, document.body.scrollHeight);
  return m;
})()`

/** 各平台视频详情链接特征（a[href] 命中即采集） */
export const VIDEO_LINK_PATTERNS: Record<string, RegExp[]> = {
  douyin: [/\/video\/\d+/i, /\/note\/\d+/i],
  bilibili: [/\/video\/(BV|av)\d+/i],
  kuaishou: [/\/short-video\/\w+/i, /\/photo\/\w+/i],
  xiaohongshu: [/\/explore\/[0-9a-f]{8,}/i, /\/discovery\/item\/[0-9a-f]{8,}/i],
  weixin: [/channels\.weixin\.qq\.com\/[^/]+\/[^/]+/i],
  youtube: [/\/watch\?v=[\w-]{6,}/i],
  jimeng: [],
}

/** 提取脚本（patterns 以 JSON 注入；标题取 title/text/aria-label/img alt 兜底） */
export function extractLinksScript(platform: string): string {
  const patterns = (VIDEO_LINK_PATTERNS[platform] || []).map((r) => r.source)
  return `(() => {
    const patterns = ${JSON.stringify(patterns)};
    const out = [];
    const seen = new Set();
    for (const a of document.querySelectorAll('a[href]')) {
      let full = '';
      try { full = new URL(a.getAttribute('href'), location.href).href; } catch (e) { continue; }
      if (!patterns.some((p) => new RegExp(p, 'i').test(full))) continue;
      if (seen.has(full)) continue;
      seen.add(full);
      let title = (a.getAttribute('title') || (a.textContent || '').trim() || '').trim();
      if (!title) title = (a.getAttribute('aria-label') || '').trim();
      if (!title) { const img = a.querySelector('img'); title = img ? (img.getAttribute('alt') || '') : ''; }
      out.push({ title: title || '未命名素材', url: full, source: location.href });
    }
    return out;
  })()`
}

function _sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)) }

/** 读 JSON 清单（缺失/损坏 → []） */
function _readJson(filePath: string): CollectedItem[] {
  try {
    if (!existsSync(filePath)) return []
    const raw: unknown = JSON.parse(readFileSync(filePath, 'utf-8'))
    return Array.isArray(raw) ? raw as CollectedItem[] : []
  } catch { return [] }
}

/** 追加采集条目到 collected.json（去重 + 上限裁剪） */
export function appendCollected(userDataDir: string, items: CollectedItem[]): { ok: boolean; count: number; error?: string } {
  const filePath = collectedFilePath(userDataDir)
  try {
    const arr = dedupeCollectedItems([..._readJson(filePath), ...(Array.isArray(items) ? items : [])])
    const trimmed = arr.slice(-MAX_COLLECTED)
    mkdirSync(join(filePath, '..'), { recursive: true })
    writeFileSync(filePath, JSON.stringify(trimmed, null, 2), 'utf-8')
    return { ok: true, count: trimmed.length }
  } catch (e) {
    return { ok: false, count: 0, error: (e as Error)?.message || String(e) }
  }
}

/** 达人主页全量采集（隐藏 WebContentsView，不打扰用户浏览；对照原
 *  collectAllFromCreator + _loadAllByScroll：settle 3500ms → 滚动
 *  maxRounds=30/stepMs=1200/稳定 3 次 → 提取链接 → 落 collected.json）。 */
export async function collectFromCreator(opts: {
  userDataDir: string
  creator: Partial<CreatorItem>
  onProgress?: (phase: string) => void
}): Promise<[boolean, { count: number; items: CollectedItem[]; profileUrl: string } | string]> {
  const userDataDir = (opts && opts.userDataDir) || ''
  const creator = (opts && opts.creator) || {}
  const onProgress = (opts && opts.onProgress) || null
  const platform = String(creator.platform || '')
  if (!userDataDir || !platform || !creator.id) return [false, '采集失败：达人信息不完整']

  const runner = collectFromCreator as unknown as { _running?: boolean }
  if (runner._running) return [false, '采集进行中，请稍后再试']
  runner._running = true

  const profileUrl = creator.homepageUrl || deriveProfileUrl(creator.name || creator.id, platform)
  const partition = `persist:tintin-${platform}`
  let view: BrowserView | null = null
  let attachedWin: BrowserWindow | null = null
  try {
    view = new BrowserView({
      webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    const wc = view.webContents
    // 挂到第一窗口（未开则跳过挂载），bounds 移出可视区（hotspot-capture 同法）
    attachedWin = BrowserWindow.getAllWindows()[0] || null
    if (attachedWin) {
      attachedWin.addBrowserView(view)
      view.setBounds({ x: -2400, y: 0, width: 1200, height: 800 })
    }

    if (onProgress) { try { onProgress(`正在打开「${creator.name || creator.id}」主页…`) } catch { /* 回调异常忽略 */ } }
    try { await wc.loadURL(profileUrl) } catch { /* 加载中断不阻塞 */ }
    await _sleep(3500)

    if (onProgress) { try { onProgress('正在自动滚动加载全部内容…') } catch { /* 忽略 */ } }
    let lastH = 0
    let stable = 0
    for (let i = 0; i < 30 && stable < 3; i++) {
      let h = 0
      try { h = await wc.executeJavaScript(SCROLL_SCRIPT) as number } catch { /* 页面未就绪继续 */ }
      if (h <= lastH) stable++
      else { stable = 0; lastH = h }
      if (i < 29) await _sleep(1200)
    }

    if (onProgress) { try { onProgress('正在收集内容链接…') } catch { /* 忽略 */ } }
    let links: Array<{ title?: string; url?: string; source?: string }> = []
    try { links = await wc.executeJavaScript(extractLinksScript(platform), true) as never } catch { links = [] }
    if (!Array.isArray(links)) links = []

    const date = _today()
    const items = (links as Array<{ title?: string; url?: string; source?: string }>).map((l) => ({
      platform,
      creatorId: String(creator.id),
      creatorName: creator.name || creator.id || '',
      title: String(l.title || '未命名素材'),
      url: String(l.url || ''),
      source: String(l.source || profileUrl),
      date,
      collectedAt: new Date().toISOString(),
    })).filter((it) => it.url)

    const res = items.length > 0 ? appendCollected(userDataDir, items) : { ok: true, count: 0 }
    if (!res.ok) return [false, `采集完成但写入清单失败：${res.error}`]
    return [true, { count: items.length, items, profileUrl }]
  } catch (e) {
    return [false, `采集失败：${(e as Error)?.message || e}`]
  } finally {
    runner._running = false
    try { if (view && attachedWin) attachedWin.removeBrowserView(view) } catch { /* ignore */ }
    try { if (view) (view.webContents as unknown as { destroy?: () => void }).destroy?.() } catch { /* ignore */ }
  }
}

/** 创建 B10 IPC handlers（browser-service 在 media-storage 之后调用；ctx={app,getBrowserWindow}） */
export function createCreatorsStoreIpc(
  ipcMain: IpcMain,
  ctx: { app: App; getBrowserWindow: () => BrowserWindow | null },
): void {
  if (!ipcMain) throw new Error('createCreatorsStoreIpc: ipcMain is required')
  const { app, getBrowserWindow } = ctx || {}

  function _userDataDir(): string {
    try { return app.getPath('userData') } catch { return '' }
  }
  function _loadCreators(): CreatorItem[] {
    return _readJson(creatorsFilePath(_userDataDir())) as unknown as CreatorItem[]
  }
  function _saveCreators(list: CreatorItem[]): void {
    const filePath = creatorsFilePath(_userDataDir())
    mkdirSync(join(filePath, '..'), { recursive: true })
    writeFileSync(filePath, JSON.stringify(list, null, 2), 'utf-8')
  }
  function _broadcastProgress(phase: string): void {
    try {
      const w = getBrowserWindow()
      if (w && !w.isDestroyed()) w.webContents.send('creators:collect-progress', { phase })
    } catch { /* 窗口销毁忽略 */ }
  }

  ipcMain.handle('creators:getCreators', () => {
    try { return { success: true, data: _loadCreators() } }
    catch (e) { return { success: false, error: (e as Error)?.message || String(e) } }
  })

  ipcMain.handle('creators:addCreator', (_e, creator: Partial<CreatorItem>) => {
    try {
      const next = addCreator(_loadCreators(), creator)
      _saveCreators(next)
      return { success: true, data: next }
    } catch (e) { return { success: false, error: (e as Error)?.message || String(e) } }
  })

  ipcMain.handle('creators:deleteCreator', (_e, payload: { id?: string; platform?: string }) => {
    try {
      const next = deleteCreator(_loadCreators(), payload || {})
      _saveCreators(next)
      return { success: true, data: next }
    } catch (e) { return { success: false, error: (e as Error)?.message || String(e) } }
  })

  ipcMain.handle('creators:getCollected', () => {
    try { return { success: true, data: _readJson(collectedFilePath(_userDataDir())) } }
    catch (e) { return { success: false, error: (e as Error)?.message || String(e) } }
  })

  // creators:collectFromCreator → 达人主页全量采集（隐藏视图 + 自动滚动）
  ipcMain.handle('creators:collectFromCreator', async (_e, payload: { creator?: Partial<CreatorItem> }) => {
    try {
      const creator = (payload && payload.creator) || null
      if (!creator || !creator.id || !creator.platform) return { success: false, error: '缺少达人参数' }
      const [ok, result] = await collectFromCreator({
        userDataDir: _userDataDir(),
        creator,
        onProgress: (phase) => _broadcastProgress(phase),
      })
      if (!ok) return { success: false, error: String(result) }
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: (e as Error)?.message || String(e) }
    }
  })
}
