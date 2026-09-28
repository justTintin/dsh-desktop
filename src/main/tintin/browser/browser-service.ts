// ═══════════════════════════════════════════════════════════════
// browser-service.ts — 浏览器域壳层引擎（2026-09-25 用户裁决提前移植首片）
// 形态裁决（2026-09-25 用户确认）：**独立窗口**（SRC browser-window.js 先例，
// close=hide 保登录态驻留）——webview（需主窗口 webviewTag，安全面扩大）与
// 主窗口 overlay（原生 view 盖页内弹窗、跨 tab 生命周期复杂）两实验形态已删除。
//
// 登录态消费链（参考视频下载 yt-dlp 的前提，SRC 用户拍板方案「浏览器取 cookies」）：
//   各平台分区 session.cookies → Netscape 文件落 `<userData>/harness/tintin/browser/
//   cookies/cookies_<platform>.txt`（导航后防抖自动 + 窗口隐藏时 + 面板手动）→
//   宿主 ytdlp 门读该目录前置 --cookies。harness 子进程拿不到 Electron session，
//   导出只能在壳进程，走约定目录交接。
// ═══════════════════════════════════════════════════════════════
import { app, BrowserWindow, ipcMain, session, shell, WebContentsView } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PLATFORM_COOKIE_DOMAINS,
  PLATFORM_DEFS,
  PLATFORM_IDS,
  type PlatformDef,
} from './platform-meta'
import { formatNetscapeCookies } from './netscape-cookies'
import { createExtensionManager, platformSessions, findDouyinHelperDir, type ExtensionManager } from './ext-manager'
import { bilibiliHelperInstalled, findBilibiliHelperDir, injectBilibiliHelper } from './bilibili-ext'
import { createDownloadManager, type DownloadManager } from './download-manager'
import { createMediaStorage, type MediaStorage } from './media-storage'
import { captureHotspots } from './hotspot-capture'
import { startLoopbackService, type LoopbackService } from './loopback-service'
// 自动上架编排（SRC auto-listing/* 纯 JS 移植件；类型声明见 auto-listing/ipc.d.ts）
// @ts-expect-error 纯 JS ESM 移植件（附 ipc.d.ts 通配声明）
import { createAutoListingIpc } from './auto-listing/ipc.js'
import { homedir } from 'node:os'
import { dirname } from 'node:path'

/** 模块级日志（registerBrowserService 前也可能打点） */
function ctxLog(msg: string): void {
  console.log(`[TinTinBrowser] ${msg}`)
}

/** cookies 交接目录：与 harness 子进程的 DSH_HOME 同源（<userData>/harness） */
export function browserCookiesDir(): string {
  return join(app.getPath('userData'), 'harness', 'tintin', 'browser', 'cookies')
}

/** 抽取器脚本目录：打包=resources/extractors；开发=仓库 build/extractors（SRC thickShell 同形态） */
export function extractorScriptDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'extractors')
    : join(app.getAppPath(), 'build', 'extractors')
}

/** E3 结构化错误（SRC offline-page.js extractionError 1:1） */
export function extractionError(type: string, message: string, hint = '') {
  return { ok: false, error: { type: type || 'EXTRACTOR_ERROR', message: message || '抽取失败', hint: hint || '' } }
}

/**
 * 抽取脚本拼接（SRC thickShell-ipc browser:extractDOM wrapper 1:1）：
 * _common（公共契约挂 window.__TIN_EX_COMMON__）前置 + 平台脚本，wrapper 显式
 * return __TIN_EXTRACT_RESULT__（否则 IIFE 返回值被丢弃 → undefined）。
 * 执行期异常折叠为结构化 DOM_MISMATCH，主进程不崩。
 */
export function buildExtractorScript(commonScript: string, platformScript: string): string {
  const combined = commonScript + '\n' + platformScript
  return `(function(){
  var __TIN_EXTRACT_RESULT__;
  try { ${combined} }
  catch(e){ return { ok:false, error:{type:'DOM_MISMATCH', message:String(e.message||e), hint:'平台DOM可能已变更'} } }
  return (typeof __TIN_EXTRACT_RESULT__ !== 'undefined') ? __TIN_EXTRACT_RESULT__
    : { ok:false, error:{type:'DOM_MISMATCH', message:'抽取脚本未返回结果', hint:'平台脚本结构需升级'} }
})()`
}

interface ElectronCookie {
  domain: string
  path: string
  secure: boolean
  expirationDate?: number
  name: string
  value: string
}

/** 平台分区内的去重 cookie 集合（SRC ytdlp-gate exportCookiesForPlatform 同口径：
 *  domain 与去 . 变体双查 + domain|path|name 去重） */
async function collectPlatformCookies(platform: string): Promise<ElectronCookie[]> {
  const def: PlatformDef | undefined = PLATFORM_DEFS[platform]
  const domains = PLATFORM_COOKIE_DOMAINS[platform]
  if (!def || !domains || !domains.length) return []
  const sess = session.fromPartition(def.partition)
  const seen = new Set<string>()
  const unique: ElectronCookie[] = []
  for (const domain of domains) {
    for (const d of [domain, domain.replace(/^\./, '')]) {
      let cookies: ElectronCookie[] = []
      try { cookies = await sess.cookies.get({ domain: d }) as unknown as ElectronCookie[] } catch { continue }
      for (const c of cookies) {
        const key = `${c.domain}|${c.path}|${c.name}`
        if (seen.has(key)) continue
        seen.add(key)
        unique.push(c)
      }
    }
  }
  return unique
}

/** 导出平台分区 cookies 为 Netscape 文件；无 cookie 返回 null（未登录不算错） */
export async function exportPlatformCookies(
  platform: string,
  destPath: string,
): Promise<{ count: number; path: string } | null> {
  try {
    const cookies = await collectPlatformCookies(platform)
    if (!cookies.length) return null
    mkdirSync(join(destPath, '..'), { recursive: true })
    writeFileSync(destPath, formatNetscapeCookies(cookies), 'utf-8')
    return { count: cookies.length, path: destPath }
  } catch {
    return null
  }
}

// ── 引擎状态（单例 BrowserView，只挂独立窗口） ──────────────────────────────

let browserView: WebContentsView | null = null
let browserWindow: BrowserWindow | null = null
let currentPlatform: string | null = null
let userQuit = false
let extManager: ExtensionManager | null = null
let downloadManager: DownloadManager | null = null
let mediaStorage: MediaStorage | null = null
let loopback: LoopbackService | null = null

function platformOf(p: string | null): PlatformDef | null {
  return p ? PLATFORM_DEFS[p] ?? null : null
}

function ensureBrowserView(): WebContentsView {
  if (browserView && !browserView.webContents.isDestroyed()) return browserView
  browserView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 内嵌站点是任意第三方页面：guest 内不给 preload/Node 面
      webSecurity: true,
      spellcheck: false,
    },
  })
  browserView.setBackgroundColor('#ffffff')
  browserView.webContents.setWindowOpenHandler(({ url }) => {
    // C7 通用浏览器红线：外链一律交系统浏览器（SRC browser-window.js 同款）
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  // 登录态落盘：导航稳定后延迟导出（避免每帧请求写盘）
  let exportTimer: NodeJS.Timeout | null = null
  browserView.webContents.on('did-navigate', () => {
    if (exportTimer) clearTimeout(exportTimer)
    exportTimer = setTimeout(() => { void exportCurrentCookies() }, 2000)
    // B站下载助手：随包扩展注入（SRC viewpool platformId==='bilibili' 分支同口径；
    // 装了插件 → B站下载交给插件，无需嗅探）
    const view = browserView
    if (view && currentPlatform === 'bilibili' && bilibiliHelperInstalled()) {
      const extPath = findBilibiliHelperDir()
      const sess = session.fromPartition(PLATFORM_DEFS.bilibili!.partition)
      if (extPath && sess) injectBilibiliHelper(view.webContents, extPath, sess)
    }
  })
  return browserView
}

function attachToWindow(): void {
  const win = browserWindow
  if (!win || win.isDestroyed()) return
  const view = ensureBrowserView()
  // 原生下载接管（幂等：session 每分区只挂一次）
  const sess = session.fromPartition(platformOf(currentPlatform)?.partition || PLATFORM_DEFS.web!.partition)
  if (downloadManager && !(sess as unknown as { __tintinDlAttached?: boolean }).__tintinDlAttached) {
    ;(sess as unknown as { __tintinDlAttached?: boolean }).__tintinDlAttached = true
    downloadManager.attachSession(sess)
  }
  const size = win.getContentSize()
  view.setBounds({ x: 0, y: 0, width: size[0] ?? 0, height: size[1] ?? 0 })
  win.contentView.addChildView(view)
  // 视图跟随窗口尺寸（2026-09-28 用户报障：最大化后仍显示创建时的局部——
  // 挂载只设了一次 bounds，缺 resize 跟随）。resize 事件覆盖拖拽与最大化。
  if (!(win as unknown as { __tintinResizeWired?: boolean }).__tintinResizeWired) {
    ;(win as unknown as { __tintinResizeWired?: boolean }).__tintinResizeWired = true
    win.on('resize', () => {
      const v = browserView
      if (!v || v.webContents.isDestroyed() || !browserWindow || browserWindow.isDestroyed()) return
      const s = browserWindow.getContentSize()
      v.setBounds({ x: 0, y: 0, width: s[0] ?? 0, height: s[1] ?? 0 })
    })
  }
}

async function navigateTo(platform: string): Promise<{ ok: boolean; error?: string }> {
  const def = platformOf(platform)
  if (!def) return { ok: false, error: `未知平台: ${platform}` }
  currentPlatform = platform
  ensureBrowserView().webContents.loadURL(def.seedUrl).catch(() => { /* 加载失败页面自显示错误 */ })
  return { ok: true }
}

/** 导出 cookies（有当前平台只导它；否则全平台逐个导；返回各平台条数） */
async function exportCurrentCookies(): Promise<Record<string, number>> {
  const dir = browserCookiesDir()
  mkdirSync(dir, { recursive: true })
  const targets = currentPlatform ? [currentPlatform] : Object.keys(PLATFORM_COOKIE_DOMAINS)
  const result: Record<string, number> = {}
  for (const platform of targets) {
    const out = await exportPlatformCookies(platform, join(dir, `cookies_${platform}.txt`))
    result[platform] = out?.count ?? 0
  }
  return result
}

/** 独立窗口（SRC browser-window.js 先例）：单实例、close=hide（登录态/缓存驻留） */
function ensureBrowserWindow(mainWindow: BrowserWindow): BrowserWindow {
  if (browserWindow && !browserWindow.isDestroyed()) return browserWindow
  browserWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: '#ffffff',
    title: 'TinTin 浏览器',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  })
  browserWindow.on('close', (ev) => {
    if (userQuit) return
    ev.preventDefault()
    try {
      browserWindow?.hide()
      void exportCurrentCookies()
    } catch { /* hide 失败让系统关闭 */ }
  })
  browserWindow.on('hide', () => { void exportCurrentCookies() })
  browserWindow.once('ready-to-show', () => browserWindow?.show())
  // 宿主窗口关闭时同步收掉独立窗口（登录态由分区 session 持久化，不随窗口销毁）
  mainWindow.on('closed', () => {
    userQuit = true
    try { browserWindow?.destroy() } catch { /* 已销毁 */ }
  })
  return browserWindow
}

/** 注册壳侧 IPC（createWindow 之后调用；mainWindow 用于独立窗口生命周期联动） */
export function registerBrowserService(mainWindow: BrowserWindow): void {
  app.on('before-quit', () => { userQuit = true })

  // ── 扩展管理（SRC thickShell 启动段 + ext:* 三通道移植）────────────────
  // userData/extensions 清单 + 各平台分区 session 逐个 loadExtension；
  // 清单变化经 browser:extensions-changed 广播给 harness 主窗口（chrome 面板刷新）。
  extManager = createExtensionManager({
    getRoot: () => join(app.getPath('userData'), 'extensions'),
    listSessions: () => platformSessions((partition) => session.fromPartition(partition, { cache: true })),
    broadcast: (extensions) => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('browser:extensions-changed', { extensions })
        }
      } catch { /* 窗口已销毁 */ }
    },
    findDouyinHelperDir,
    log: (msg) => ctxLog(msg),
  })
  extManager.init()
  extManager.preloadBuiltinDouyin()
  void extManager.reloadInstalled()

  // ── 下载管理器 + 媒体存储（SRC thickShell ctx.downloadManager / media-storage 移植）──
  // 下载落盘根 = 默认工作区 materials（/tintin/media 白名单根内，产物可直接预览）
  const workspaceDir = (): string =>
    process.env.TINTIN_WORKSPACE_DIR
      || join(homedir(), 'Documents', 'tintin-workspace')
  downloadManager = createDownloadManager({
    workspacePath: workspaceDir,
    emit: (channel, payload) => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
      } catch { /* 窗口已销毁 */ }
    },
  })
  downloadManager.registerIpc(ipcMain)
  mediaStorage = createMediaStorage(ipcMain, {
    storeFile: join(app.getPath('userData'), 'tintin', 'browser', 'media-storage.json'),
    downloadsDir: () => app.getPath('downloads'),
  })

  // ── 回环门面（架构文档 §浏览器域三层形态第2层）：agent 工具经 HTTP+token
  // 调壳层引擎；握手文件落 DSH_HOME/tintin/browser/loopback.json（host 读它）。
  // auto_listing_run 预留：交互式流程 agent 直跑需产品裁决，未暴给 agent。
  void startLoopbackService({
    handshakeDir: join(browserCookiesDir(), '..'),
    log: (msg) => ctxLog(msg),
    handlers: {
      open: async (platform) => openPlatform(platform),
      extract: (platform) => extractNow(platform),
      loginStatus: async () => {
        const counts: Record<string, number> = {}
        for (const platform of Object.keys(PLATFORM_COOKIE_DOMAINS)) {
          counts[platform] = (await collectPlatformCookies(platform)).length
        }
        return { counts, cookiesDir: browserCookiesDir() }
      },
      exportCookies: () => exportCurrentCookies(),
      captureHotspots: () => captureHotspots({ userDataDir: app.getPath('userData') }),
    },
  }).then((svc) => { loopback = svc })
    .catch((err) => ctxLog('loopback start failed: ' + (err instanceof Error ? err.message : err)))

  // ── 自动上架（SRC auto-listing/ipc.js；fxg 分区视图 + store shim）──
  const autoListingStore = (() => {
    const file = join(app.getPath('userData'), 'tintin', 'browser', 'auto-listing.json')
    let data: Record<string, unknown> = {}
    try { data = JSON.parse(readFileSync(file, 'utf8')) } catch { /* 首次为空 */ }
    return {
      get: (key: string) => data[key],
      set: (key: string, value: unknown) => {
        data[key] = value
        try { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(data, null, 2), 'utf8') } catch { /* 写盘失败下次再试 */ }
      },
    }
  })()
  createAutoListingIpc(ipcMain, {
    store: autoListingStore,
    app,
    getBrowserWindow: () => browserWindow,
    getOrCreateView: (platformId: string) => {
      const win = ensureBrowserWindow(mainWindow)
      if (currentPlatform !== platformId) void navigateTo(platformId)
      const view = ensureBrowserView()
      const size = win.getContentSize()
      view.setBounds({ x: 0, y: 0, width: size[0] ?? 0, height: size[1] ?? 0 })
      const children = win.contentView.children ?? []
      if (!(children as unknown as Electron.WebContentsView[]).includes(view)) win.contentView.addChildView(view)
      return view
    },
  })

  // browser:captureHotspots — 手动触发今日热点采集（SRC scheduled:captureHotspots
  // 的浏览器域面；进度经 browser:hotspot-progress 广播，定时任务集成随 P2 local-scheduler）
  let hotspotRunning = false
  ipcMain.handle('browser:captureHotspots', async () => {
    if (hotspotRunning) return [false, '热点采集中，请稍后再试']
    hotspotRunning = true
    try {
      const [ok, data] = await captureHotspots({
        userDataDir: app.getPath('userData'),
        onProgress: (p) => {
          try {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('browser:hotspot-progress', p)
          } catch { /* 窗口已销毁 */ }
        },
      })
      return [ok, data]
    } finally { hotspotRunning = false }
  })
  ipcMain.handle('browser:extensionList', () => {
    try { return { success: true, data: extManager?.list() } } catch (err) {
      return { success: true, data: { installed: false, extensions: [] } }
    }
  })
  ipcMain.handle('browser:extensionInstall', async (_e, filePath: unknown) => {
    try { return await extManager!.install(String(filePath || '')) } catch (err) {
      return { success: false, message: '安装失败：' + (err instanceof Error ? err.message : err) }
    }
  })
  ipcMain.handle('browser:extensionUninstall', (_e, id: unknown) => {
    try { return extManager!.uninstall(String(id || '')) } catch (err) {
      return { success: false, message: '卸载失败：' + (err instanceof Error ? err.message : err) }
    }
  })

  // 打开平台（独立窗口 + 导航 seed URL）；窗口已存活则聚焦复用
  // 抽为 openPlatform 供回环门面复用
  const openPlatform = (id: string) => {
    if (!platformOf(id)) return { ok: false, error: `未知平台: ${id}` }
    const win = ensureBrowserWindow(mainWindow)
    attachToWindow()
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    return navigateTo(id)
  }
  ipcMain.handle('browser:open', (_e, platform: unknown) => openPlatform(String(platform || '')))

  // 各平台登录态条数（只读，不写文件；浏览器 tab 面板状态展示用）
  ipcMain.handle('browser:loginStatus', async () => {
    const counts: Record<string, number> = {}
    for (const platform of Object.keys(PLATFORM_COOKIE_DOMAINS)) {
      counts[platform] = (await collectPlatformCookies(platform)).length
    }
    return { counts, cookiesDir: browserCookiesDir() }
  })

  ipcMain.handle('browser:exportCookies', () => exportCurrentCookies())

  // browser:extractDOM — 运行平台抽取脚本（SRC thickShell-ipc browser:extractDOM
  // 移植；E3 结构化错误：NEED_LOGIN / RISK_CAPTCHA / DOM_MISMATCH / NETWORK_ERROR）。
  // 我们的单例 BrowserView 即 SRC 的 viewPool entry（当前平台=导航目标）。
  // 核心逻辑抽为 extractNow 供回环门面（loopback-service）复用
  const extractNow = async (platformId: unknown) => {
    try {
      const id = String(platformId || '')
      if (!PLATFORM_IDS.includes(id)) return extractionError('NEED_PLATFORM', '缺少平台参数')
      if (!browserView || browserView.webContents.isDestroyed() || currentPlatform !== id) {
        return extractionError('NOT_ATTACHED', '平台页面尚未打开', '先点击平台打开独立浏览器窗口')
      }
      const def = platformOf(id)
      const wc = browserView.webContents
      // 1) 当前 URL 检查（离线兜底页/未加载）
      try {
        const cur = wc.getURL?.() || ''
        if (cur.startsWith('data:text/html')) {
          return extractionError('NETWORK_ERROR', '当前处于离线兜底页，无法抽取', '请恢复网络后重试')
        }
        if (!cur || cur === 'about:blank') {
          return extractionError('DOM_MISMATCH', '页面尚未加载完成', '等待页面加载完成后再点解析')
        }
      } catch { /* URL 读取失败继续尝试抽取 */ }
      // 2) 读取抽取脚本（缺失 → 结构化 DOM_MISMATCH+hint，与 SRC 同口径）
      let commonScript = ''
      try {
        commonScript = readFileSync(join(extractorScriptDir(), '_common.ts'), 'utf8')
      } catch { commonScript = '' }
      let script: string | null = null
      try {
        script = readFileSync(join(extractorScriptDir(), def?.extractor ?? ''), 'utf8')
      } catch {
        return extractionError('DOM_MISMATCH', `${def?.name ?? id}抽取脚本尚未上线`, `脚本路径 ${def?.extractor ?? ''} 暂未写入`)
      }
      // 3) 页面内执行（永远 try/catch，主进程不崩）
      let result: unknown = null
      try {
        result = await wc.executeJavaScript(buildExtractorScript(commonScript, script), false)
      } catch (err) {
        return extractionError('DOM_MISMATCH', err instanceof Error ? err.message : '抽取脚本执行异常', '平台 DOM 可能已变更')
      }
      // 4) 结果结构校验
      if (!result || typeof result !== 'object') {
        return extractionError('DOM_MISMATCH', '抽取脚本返回了非对象结构', `需修复 ${def?.extractor ?? ''}`)
      }
      const r = result as { ok?: boolean; data?: unknown; error?: unknown }
      if (r.ok === false) {
        return { ok: false, error: (r.error as { type: string; message: string }) || { type: 'DOM_MISMATCH', message: '抽取失败' } }
      }
      return { ok: true, data: r.data ?? null }
    } catch (err) {
      return extractionError('EXTRACTOR_ERROR', err instanceof Error ? err.message : '未知错误')
    }
  }
  ipcMain.handle('browser:extractDOM', (_e, platformId: unknown) => extractNow(platformId))

  // 平台表（chrome 浏览器面板的唯一数据源；fxg 抖店仅自动上架用，不列）
  ipcMain.handle('browser:platforms', () => Object.entries(PLATFORM_DEFS)
    .filter(([id]) => id !== 'fxg')
    .map(([id, def]) => ({ id, name: def.name, seedUrl: def.seedUrl })))
}
