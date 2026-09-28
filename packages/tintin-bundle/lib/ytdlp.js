// ytdlp.js — 参考视频下载宿主门（SRC desktop/main/ytdlp-gate.js 移植，
// 搬运基线 SRC 9ca9050；2026-09-25 随参考视频下载卡落地）。
// 策略（白名单/参数/档位/进度解析/错误分类）全在 ytdlp-logic.js；本文件只做 I/O。
//
// 与 SRC 的两处架构差异（铁律 6 契约注记）：
// 1. cookies 来源：SRC 在主进程经 Electron session 导出；本仓壳进程已把各平台
//    分区 cookies 导出为 Netscape 文件（src/main/tintin/browser/ 引擎，交接目录
//    `<DSH_HOME>/tintin/browser/cookies/cookies_<platform>.txt`），本门只读该目录
//    前置 --cookies（有文件才带，静默跳过不阻塞——SRC 同口径）。
//    2026-09-28 用户裁决追加：probe/download 前经回环服务主动同步一次（免手动
//    导出）；并新增 ytdlp:openLoginBrowser 通道供未登录引导一键拉起内置浏览器。
// 2. 进度事件：SRC 经 event.sender.send('ytdlp:progress') 推送；宿主桥无事件通道
//    （同 montage:split 口径），下载阻塞到终态返回，渲染层按 busy 态呈现。
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, realpathSync, statSync, unlinkSync } from 'node:fs'
import { basename, join } from 'node:path'
import * as logic from './ytdlp-logic.js'
import { loopbackCall } from './loopback-helpers.js'

/** 执行 yt-dlp 收集完整输出（probe 用，一次性 JSON；SRC runYtDlpCollect 同口径） */
function runCollect(binPath, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(binPath, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => { proc.kill(); reject(new Error('yt-dlp 解析超时')) }, timeoutMs)
    proc.stdout.on('data', (d) => { stdout += d })
    proc.stderr.on('data', (d) => { stderr += d })
    proc.on('error', (e) => { clearTimeout(timer); reject(e) })
    proc.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

/** safeOutputPath：realpath 校验输出不逃逸工作目录（SRC safeOutputPath 1:1） */
export function safeOutputPath(workDir, filePath) {
  const resolved = join(filePath)
  let realDir = workDir
  try { realDir = realpathSync(workDir) } catch { /* 目录尚未创建时用解析路径 */ }
  if (!resolved.startsWith(realDir + (process.platform === 'win32' ? '\\' : '/')) && resolved !== realDir) {
    throw new Error('download_output_escape: 输出路径越界')
  }
  return resolved
}

export function createYtdlpApi({ ytdlpPath, ffmpegPath, ffprobePath, ffmpegDir, cookiesDir, cacheDir, log = () => {}, warn = () => {}, loopback = loopbackCall }) {
  /** 登录态自动同步（2026-09-28 用户裁决：解析/下载前从壳层回环导出一次分区 cookies，
   *  免去"登录后手动导出"步骤；回环不可达/超时静默跳过——沿用目录里已有文件，退化为旧口径） */
  async function syncLoginCookies() {
    try {
      const res = await loopback('/tintin-browser/cookies/export', {}, 3000)
      if (res && !res.error) log('ytdlp', `cookies synced: ${JSON.stringify(res)}`)
    } catch { /* 回环异常不阻塞解析/下载 */ }
  }

  /** 各平台登录态条数（回环只读；失败返回 null——login_required 时供渲染层判别未登录/已登录仍被拒） */
  async function loginCountsSafe() {
    try {
      const res = await loopback('/tintin-browser/login/status', {}, 3000)
      return res && res.counts ? res.counts : null
    } catch { return null }
  }

  /** 浏览器登录态 cookies（壳层已导出的 Netscape 文件；平台无文件=未登录，不带） */
  function withBrowserCookies(args, url) {
    try {
      const platform = logic.platformFromUrl(url)
      if (!platform) return args
      const file = join(cookiesDir(), `cookies_${platform}.txt`)
      if (existsSync(file) && statSync(file).size > 0) {
        log('ytdlp', `cookies: ${platform} -> ${file}`)
        return ['--cookies', file, ...args]
      }
    } catch (err) {
      warn('ytdlp', `cookies check failed: ${err instanceof Error ? err.message : err}`)
    }
    return args
  }

  /** ffprobe JSON（返回原始 parsed，含 streams；供兼容判定/元数据） */
  function runFfprobe(file) {
    return new Promise((resolve, reject) => {
      const proc = spawn(ffprobePath, ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file], { windowsHide: true })
      let stdout = ''
      proc.stdout.on('data', (d) => { stdout += d })
      proc.on('error', reject)
      proc.on('close', (code) => {
        if (code !== 0) { reject(new Error('ffprobe failed')); return }
        try { resolve(JSON.parse(stdout)) } catch (e) { reject(e) }
      })
    })
  }

  /** ffmpeg 原子转码（归一化用，5 分钟兜底超时；SRC runFfmpegArgs 同口径） */
  function runFfmpegArgs(args) {
    return new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath, args, { windowsHide: true })
      let stderr = ''
      proc.stderr.on('data', (d) => { stderr += d })
      const timer = setTimeout(() => { try { proc.kill() } catch { /* 已退出 */ } reject(new Error('ffmpeg 转码超时')) }, 5 * 60 * 1000)
      proc.on('error', (e) => { clearTimeout(timer); reject(e) })
      proc.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) resolve(true)
        else reject(new Error(`ffmpeg failed: ${stderr.slice(-500)}`))
      })
    })
  }

  return {
    'ytdlp:status': () => {
      const available = ytdlpPath !== 'yt-dlp' && existsSync(ytdlpPath)
      return { available, path: ytdlpPath, external: ytdlpPath !== 'yt-dlp' }
    },

    // probe：--dump-single-json → 宽容解析 + 档位生成（SRC ytdlp:probe 同口径）
    'ytdlp:probe': async (args) => {
      const payload = args?.[0] ?? {}
      const url = String(payload?.url || '').trim()
      if (!logic.isSupportedUrl(url)) {
        return { error: logic.downloadErrorText('unsupported_source') }
      }
      try {
        await syncLoginCookies()
        const finalArgs = withBrowserCookies(logic.buildProbeArgs(url, String(payload?.proxy || '')), url)
        const { code, stdout, stderr } = await runCollect(ytdlpPath, finalArgs)
        if (code !== 0 || !stdout.trim()) {
          const cls = logic.classifyDownloadError(stderr)
          const out = { error: logic.downloadErrorText(cls.code), code: cls.code, stderrTail: cls.stderrTail }
          // login_required 附带登录态条数：渲染层据此区分「未登录」与「已登录仍被平台拒」
          if (cls.code === 'login_required') out.loginCounts = await loginCountsSafe()
          return out
        }
        // stdout 可能混入 --print 的附加行：取第一个 { 起的 JSON 主体
        const jsonStart = stdout.indexOf('{')
        const probe = logic.parseProbeJson(JSON.parse(stdout.slice(jsonStart)))
        return { probe, options: logic.createDownloadOptions(probe) }
      } catch (err) {
        const cls = logic.classifyDownloadError(String(err instanceof Error ? err.message : err))
        return { error: `${logic.downloadErrorText(cls.code)}（${err instanceof Error ? err.message : err}）`, code: cls.code }
      }
    },

    // download：按档位下载 → 落盘 video_download → 播放兼容归一化 → ffprobe 元数据。
    // 进度事件不落桥（见文件头注记 2），阻塞到终态。
    'ytdlp:download': async (args) => {
      const payload = args?.[0] ?? {}
      const url = String(payload?.url || '').trim()
      const option = payload?.option || {}
      if (!logic.isSupportedUrl(url)) {
        return { error: logic.downloadErrorText('unsupported_source') }
      }
      const jobDir = join(cacheDir(), 'video_download', `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`)
      mkdirSync(jobDir, { recursive: true })

      const buildArgs = option.mediaType === 'audio'
        ? logic.buildAudioDownloadArgs({ url, formatId: option.audioFormatId, kbps: option.kbps || 192, outTemplate: logic.outTemplateFor(jobDir), ffmpegDir: ffmpegDir || '', proxy: String(payload?.proxy || '') })
        : logic.buildVideoDownloadArgs({ url, formatId: option.videoFormatId, audioFormatId: option.audioFormatId, outTemplate: logic.outTemplateFor(jobDir), ffmpegDir: ffmpegDir || '', proxy: String(payload?.proxy || '') })
      await syncLoginCookies()
      const finalArgs = withBrowserCookies(buildArgs, url)

      const downloaded = await new Promise((resolve) => {
        const proc = spawn(ytdlpPath, finalArgs, { windowsHide: true })
        let stderr = ''
        let printedPath = ''
        let pending = ''
        proc.stdout.on('data', (d) => {
          // --print after_move:filepath 的产物路径从 stdout 末行取（不猜文件名）
          pending += String(d)
          let idx
          while ((idx = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, idx).trim(); pending = pending.slice(idx + 1)
            if (line && !line.startsWith('[')) printedPath = line
          }
        })
        proc.stderr.on('data', (d) => { stderr += d })
        proc.on('error', (e) => resolve({ error: String(e instanceof Error ? e.message : e) }))
        proc.on('close', (code) => {
          if (pending.trim() && !pending.trim().startsWith('[')) printedPath = pending.trim()
          if (code !== 0) {
            const cls = logic.classifyDownloadError(stderr)
            resolve({ error: logic.downloadErrorText(cls.code), code: cls.code, stderrTail: cls.stderrTail })
            return
          }
          resolve({ printedPath })
        })
      })
      if (downloaded.error) return downloaded

      // 产物定位：--print 优先，回退目录内唯一文件（排除 .part 残片）
      let produced = downloaded.printedPath
      if (!produced) {
        const files = readdirSync(jobDir).filter((f) => !f.endsWith('.part'))
        if (files.length === 1) produced = join(jobDir, files[0])
      }
      if (!produced || !existsSync(produced)) {
        return { error: '下载完成但未找到产物文件，请重试' }
      }
      produced = safeOutputPath(jobDir, produced)

      // 播放兼容归一化（对照 normalizeVideoForPlayback：不兼容转 .playable.mp4，成功删原件）
      let finalPath = produced
      let normalized = false
      try {
        const info = await runFfprobe(produced)
        if (!logic.isPlaybackCompatible(info)) {
          const dst = produced.replace(/\.[^.]+$/, '') + '.playable.mp4'
          await runFfmpegArgs(logic.buildNormalizeArgs(produced, dst, info))
          if (existsSync(dst) && statSync(dst).size > 1024) {
            const recheck = await runFfprobe(dst)
            if (logic.isPlaybackCompatible(recheck)) {
              try { unlinkSync(produced) } catch { /* 删原件失败不阻断 */ }
              finalPath = dst
              normalized = true
            }
          }
          if (!normalized) {
            return { error: logic.downloadErrorText('download_playback_conversion_failed'), code: 'download_playback_conversion_failed' }
          }
        }
        const meta = await runFfprobe(finalPath).catch(() => null)
        log('ytdlp', `downloaded: ${basename(finalPath)}${normalized ? ' (normalized)' : ''}`)
        return {
          path: finalPath,
          fileName: basename(finalPath),
          normalized,
          meta: meta ? { width: meta.width, height: meta.height, duration: meta.duration } : null,
        }
      } catch (err) {
        return { error: `下载后处理失败：${err instanceof Error ? err.message : err}` }
      }
    },

    // 归档：把产物复制到用户指定位置（保存到本机，桌面壳 saveFile 桥选路径）
    'ytdlp:saveAs': (args) => {
      const src = String(args?.[0]?.src || '')
      const dst = String(args?.[0]?.dst || '')
      if (!src || !dst || src === dst) return { error: '参数缺失' }
      try {
        mkdirSync(join(dst, '..'), { recursive: true })
        copyFileSync(src, dst)
        return { ok: true }
      } catch (err) {
        return { error: `保存失败：${err instanceof Error ? err.message : err}` }
      }
    },

    // 打开内置浏览器登录（2026-09-28 用户裁决：login_required 提示一键跳登录，
    // 经壳层回环 /tintin-browser/open 拉起独立浏览器窗口；平台合法性由壳侧校验）
    'ytdlp:openLoginBrowser': (args) => {
      const platform = String(args?.[0]?.platform || 'youtube')
      return loopback('/tintin-browser/open', { platform }, 5000)
    },
  }
}
