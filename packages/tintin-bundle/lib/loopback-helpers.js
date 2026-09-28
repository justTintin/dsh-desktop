// loopback-helpers.js — host 侧回环门面消费助手（tintin-bundle agent 工具用）
// 握手文件：DSH_HOME/tintin/browser/loopback.json（壳层 startLoopbackService 写入）。
// 每次 call 现读（端口/_TOKEN 随应用重启变化）；无服务 → 结构化 NO_SERVICE。
import { readFileSync } from 'node:fs'
import http from 'node:http'
import { join } from 'node:path'

/** 读回环握手配置（port/token）；不存在或残缺 → null */
export function readLoopbackConfig() {
  try {
    const home = process.env.DSH_HOME || ''
    if (!home) return null
    const file = join(home, 'tintin', 'browser', 'loopback.json')
    const cfg = JSON.parse(readFileSync(file, 'utf8'))
    if (!cfg || !cfg.port || !cfg.token) return null
    return cfg
  } catch {
    return null
  }
}

/** 回环调用（POST JSON + token 头）；服务缺失 → 结构化 NO_SERVICE（永不抛）。
 *  timeoutMs：慢通道（热点采集/抽取）默认 180s；登录态同步等快通道传短超时（3s 级）。 */
export function loopbackCall(path, body = {}, timeoutMs = 180000) {
  const cfg = readLoopbackConfig()
  if (!cfg) {
    return Promise.resolve({ ok: false, error: { type: 'NO_SERVICE', message: '浏览器引擎回环服务未就绪（需先启动桌面应用）' } })
  }
  return new Promise((resolve) => {
    const payload = JSON.stringify(body || {})
    const req = http.request({
      hostname: '127.0.0.1',
      port: cfg.port,
      path,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        'x-tintin-loopback-token': cfg.token,
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
        catch { resolve({ ok: false, error: { type: 'LOOPBACK_ERROR', message: '回环响应非 JSON' } }) }
      })
    })
    req.on('error', (err) => resolve({ ok: false, error: { type: 'LOOPBACK_ERROR', message: String(err.message || err) } }))
    req.on('timeout', () => { req.destroy(new Error('回环调用超时')) })
    req.on('error', () => {}) // destroy 后的二次 error 不再处理
    req.write(payload)
    req.end()
  })
}

/** page_extract 结果摘要化（架构 §4.5 成本护栏：agent 只看决策所需字段） */
export function summarizeExtract(res) {
  if (!res || res.ok === false) {
    const err = (res && res.error) || {}
    return { ok: false, error: [err.type, err.message].filter(Boolean).join(': ') || '抽取失败' }
  }
  const data = res.data
  if (!data || typeof data !== 'object') return { ok: true, summary: '抽取成功但内容为空' }
  // 通用摘要：平台/标题/条目数 + 前 3 条预览
  const d = data
  const meta = d.meta && typeof d.meta === 'object' ? d.meta : {}
  const title = String(d.title || meta.title || meta.name || '')
  const lists = ['items', 'comments', 'images', 'videos', 'goods', 'list', 'contents']
    .map((k) => (Array.isArray(d[k]) ? { key: k, n: d[k].length } : null))
    .filter(Boolean)
  const previewSrc = lists.length ? d[lists[0].key].slice(0, 3) : []
  const preview = previewSrc
    .map((it) => {
      if (typeof it === 'string') return it.slice(0, 80)
      if (it && typeof it === 'object') {
        return String(it.title || it.name || it.text || it.url || JSON.stringify(it).slice(0, 80)).slice(0, 80)
      }
      return ''
    })
    .filter(Boolean)
  const parts = [
    title ? '标题: ' + title : '',
    lists.map((l) => l.key + ': ' + l.n + ' 条').join('，'),
    preview.length ? '预览: ' + preview.join(' | ') : '',
  ].filter(Boolean)
  return { ok: true, summary: parts.join('\n') || '抽取成功（无结构化字段）' }
}
