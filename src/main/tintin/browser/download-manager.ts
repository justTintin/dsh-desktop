// download-manager.ts — 统一下载管理器（SRC desktop/main/download-manager.js 一比一移植，基线 9ca9050）
// 支持 BrowserView 原生下载（will-download）+ 手动 URL 下载（重定向跟随/进度限流广播）。
// 移植差异：BrowserWindow.getAllWindows() 广播改为注入 emit（browser-service 接 mainWindow；
// harness 主窗口即 chrome 面板宿主）；其余逻辑（任务表/速度计算/暂停取消/广播节流）逐字对齐。
import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { basename, dirname, join } from 'node:path'
import { URL } from 'node:url'
import type { DownloadItem, WebContents } from 'electron'

interface NativeTask {
  type: 'native'
  item: DownloadItem
  savePath: string
}
interface UrlTask {
  type: 'url'
  req?: http.ClientRequest
  fileStream?: import('node:fs').WriteStream
  savePath: string
  paused?: boolean
  receivedBytes?: number
  totalBytes?: number
  startTime?: number
}
type DownloadTask = NativeTask | UrlTask

export interface DownloadManagerDeps {
  /** 下载默认落盘根（<workspace>/materials） */
  workspacePath: () => string
  /** 广播出口（channel: downloads:progress|done|error；browser-service 接 mainWindow） */
  emit: (channel: 'downloads:progress' | 'downloads:done' | 'downloads:error', payload: Record<string, unknown>) => void
}

export function createDownloadManager(deps: DownloadManagerDeps) {
  const { workspacePath, emit } = deps
  const downloadTasks = new Map<string, DownloadTask>()
  const speedTrackers = new Map<string, { lastTime: number; lastBytes: number; speed: number }>()
  let taskIdCounter = 0

  function genTaskId(): string {
    taskIdCounter++
    return `dl_${Date.now().toString(36)}_${taskIdCounter}`
  }

  function broadcastProgress(taskId: string, progress: Record<string, unknown>): void {
    emit('downloads:progress', { taskId, ...progress })
  }
  function broadcastDone(taskId: string, result: Record<string, unknown>): void {
    emit('downloads:done', { taskId, ...result })
    downloadTasks.delete(taskId)
  }
  /** file 为附加字段（2026-09-28 浏览器窗口下载栏显示文件名用；SRC 契约字段不变） */
  function broadcastError(taskId: string, error: Error, file = ''): void {
    emit('downloads:error', file ? { taskId, error: error.message, file } : { taskId, error: error.message })
    downloadTasks.delete(taskId)
  }

  function calculateSpeed(taskId: string, received: number): number {
    const now = Date.now()
    if (!speedTrackers.has(taskId)) speedTrackers.set(taskId, { lastTime: now, lastBytes: 0, speed: 0 })
    const tracker = speedTrackers.get(taskId)!
    const elapsed = (now - tracker.lastTime) / 1000
    if (elapsed > 0.5) {
      tracker.speed = Math.round((received - tracker.lastBytes) / elapsed)
      tracker.lastTime = now
      tracker.lastBytes = received
    }
    return tracker.speed
  }

  /** Electron 原生下载（来自 BrowserView/webContents 的 will-download） */
  function handleNativeDownload(item: DownloadItem, _webContents: WebContents, params: { savePath?: string }): string {
    const taskId = genTaskId()
    const savePath = params.savePath || join(workspacePath(), 'materials', item.getFilename())
    mkdirSync(dirname(savePath), { recursive: true })
    item.setSavePath(savePath)

    let lastPercent = 0
    item.on('updated', (_e, state) => {
      if (state === 'interrupted') {
        broadcastProgress(taskId, { state: 'paused', percent: lastPercent, file: item.getFilename() })
      } else if (state === 'progressing') {
        const received = item.getReceivedBytes()
        const total = item.getTotalBytes()
        const percent = total > 0 ? Math.round((received / total) * 100) : 0
        const speed = calculateSpeed(taskId, received)
        lastPercent = percent
        broadcastProgress(taskId, { state: 'downloading', percent, speed, downloaded: received, total, file: item.getFilename() })
      }
    })
    item.once('done', (_e, state) => {
      if (state === 'completed') {
        const stat = statSync(savePath)
        broadcastDone(taskId, { finalPath: savePath, size: stat.size, file: item.getFilename() })
      } else {
        broadcastError(taskId, new Error(`Download ${state}`), item.getFilename())
      }
    })
    downloadTasks.set(taskId, { type: 'native', item, savePath })
    return taskId
  }

  /** 手动 URL 下载（http/https；重定向跟随；进度 500ms/100% 限流广播） */
  function startUrlDownload(url: string, savePath: string, { referer, headers }: { referer?: string; headers?: Record<string, string> } = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      const taskId = genTaskId()
      const parsedUrl = new URL(url)
      const isHttps = parsedUrl.protocol === 'https:'
      const lib = isHttps ? https : http

      mkdirSync(dirname(savePath), { recursive: true })
      const fileStream = createWriteStream(savePath)
      // Windows 下非 200/重定向分支的 unlink 会与写流惰性打开竞态，产生未处理
      // ENOENT 流错误打穿进程（SRC 隐患）；挂空监听吸收，行为等价。
      fileStream.on('error', () => {})

      const reqHeaders: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...headers,
      }
      if (referer) reqHeaders['Referer'] = referer

      const req = lib.request({
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: reqHeaders,
        timeout: 60000,
      }, (res) => {
        // 响应分支（2026-09-25 修根）：仅重定向/非 200 关流+清理——close() 是异步的，
        // Windows 上立即 unlink/重建写流会 EBUSY，必须等 close 回调（并行负载下必现）。
        const isRedirect = (res.statusCode ?? 0) >= 300 && (res.statusCode ?? 0) < 400 && !!res.headers.location
        if (!isRedirect && res.statusCode === 200) {
          const totalBytes = parseInt(res.headers['content-length'] || '0', 10)
          let receivedBytes = 0
          const startTime = Date.now()
          let lastSpeedUpdate = 0
          const urlFileName = basename(savePath)

          downloadTasks.set(taskId, { type: 'url', req, fileStream, savePath, receivedBytes, totalBytes, startTime })

          res.on('data', (chunk) => {
            receivedBytes += chunk.length
            fileStream.write(chunk)
            const percent = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : 0
            const elapsed = (Date.now() - startTime) / 1000
            const speed = elapsed > 0 ? Math.round(receivedBytes / elapsed) : 0
            const now = Date.now()
            if (now - lastSpeedUpdate > 500 || percent === 100) {
              broadcastProgress(taskId, { state: 'downloading', percent, speed, downloaded: receivedBytes, total: totalBytes, file: urlFileName })
              lastSpeedUpdate = now
            }
            const task = downloadTasks.get(taskId)
            if (task && task.type === 'url') task.receivedBytes = receivedBytes
          })
          res.on('end', () => {
            fileStream.end(() => {
              const stat = statSync(savePath)
              broadcastDone(taskId, { finalPath: savePath, size: stat.size, file: urlFileName })
            })
          })
          res.on('error', (err) => {
            fileStream.close()
            try { unlinkSync(savePath) } catch { /* ignore */ }
            broadcastError(taskId, err, urlFileName)
          })
          return
        }
        fileStream.close(() => {
          try { unlinkSync(savePath) } catch { /* 文件可能未创建 */ }
          if (isRedirect) {
            const redirectUrl = new URL(res.headers.location as string, url).href
            startUrlDownload(redirectUrl, savePath, { referer, headers }).then(resolve).catch(reject)
            return
          }
          reject(new Error(`HTTP ${res.statusCode}`))
        })
      })
      req.on('error', (err) => {
        fileStream.close()
        try { unlinkSync(savePath) } catch { /* ignore */ }
        broadcastError(taskId, err)
      })
      req.on('timeout', () => { req.destroy(new Error('Download timeout')) })
      req.end()
      resolve(taskId)
    })
  }

  /** 注册 IPC（downloads:start/pause/resume/cancel；由 browser-service 传入 ipcMain） */
  function registerIpc(ipcMain: Electron.IpcMain): void {
    ipcMain.handle('downloads:start', async (_e, params: { url: string; savePath?: string; referer?: string; headers?: Record<string, string> }) => {
      const { url, savePath, referer, headers } = params || {}
      const dest = savePath || join(workspacePath(), 'materials', decodeURIComponent(new URL(url).pathname.split('/').pop() || 'download'))
      return await startUrlDownload(url, dest, { referer, headers })
    })
    ipcMain.handle('downloads:pause', (_e, taskId: string) => {
      const task = downloadTasks.get(taskId)
      if (!task) return
      if (task.type === 'native') task.item.pause()
      else if (task.req) { task.req.destroy(); task.paused = true }
    })
    ipcMain.handle('downloads:resume', (_e, taskId: string) => {
      const task = downloadTasks.get(taskId)
      if (!task) return
      if (task.type === 'native') task.item.resume()
      else if (task.paused) task.paused = false // URL 下载需重新请求（SRC 注记同）
    })
    ipcMain.handle('downloads:cancel', (_e, taskId: string) => {
      const task = downloadTasks.get(taskId)
      if (!task) return
      if (task.type === 'native') task.item.cancel()
      else if (task.req) {
        task.req.destroy()
        task.fileStream?.close()
        try { unlinkSync(task.savePath) } catch { /* ignore */ }
      }
      downloadTasks.delete(taskId)
      speedTrackers.delete(taskId)
    })
  }

  /** will-download 挂接（browser-service 在 BrowserView 的 session 上调用） */
  function attachSession(session: Electron.Session): void {
    session.on('will-download', (_e, item, wc) => {
      handleNativeDownload(item, wc, {})
    })
  }

  return { handleNativeDownload, startUrlDownload, registerIpc, attachSession }
}

export type DownloadManager = ReturnType<typeof createDownloadManager>

/** 下载记录条目形状（media-storage 持久化用；SRC 渲染层契约） */
export function taskExistsAt(path: string): boolean {
  return existsSync(path)
}
