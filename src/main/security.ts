import { shell, type BrowserWindow } from 'electron'
import { canGrantWindowPermission, isTrustedAppUrl } from './security-policy'

export function secureWindow(window: Pick<BrowserWindow, 'webContents'>): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedAppUrl(url)) return { action: 'allow' }
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (isTrustedAppUrl(url)) return
    event.preventDefault()
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
  })

  // 上游基线：宿主窗口一律拒绝 webview 挂载（TinTin 浏览器为独立窗口+原生视图，
  // 不依赖 webview；2026-09-28 曾短暂改白名单随 tab 内嵌形态，当晚整体形态回退后
  // 一并回退上游口径）。preventDefault 不可撤销——勿在此窗口叠加放行监听。
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.webContents.session.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin, details) =>
      canGrantWindowPermission(
        permission,
        details.requestingUrl ?? requestingOrigin,
        details.isMainFrame
      )
  )
  window.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      callback(
        canGrantWindowPermission(permission, details.requestingUrl, details.isMainFrame)
      )
    }
  )
}
