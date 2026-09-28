#!/usr/bin/env node
/**
 * verify-tintin-customizations — 定制功能锚点一键核查（docs/定制功能合入核查清单.md 的可执行形态）。
 *
 * 用途：每次合入上游（merge upstream）之后、打包之前，整表跑一遍；FAIL>0 禁止打包。
 * 判定原则见清单文档 §0：有裁决/提交记录的消失属"有意适配"（更新本脚本），无记录的
 * 消失 = 意外丢失（回滚或补回）。测试全绿 ≠ 定制还在，本脚本是清单的机器可读层。
 *
 * v1.1（2026-09-28）：吸收 0.1.7 合并连环事故——补弹层形态/设置存储缝/补丁内容级
 * 三类盲区锚点；5.2 清扫路径更新为 asar.unpacked 布局；新增补丁版本对账。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (p) => readFileSync(join(root, p), 'utf8')
const count = (p, re) => (existsSync(join(root, p)) ? (read(p).match(new RegExp(re, 'g')) ?? []).length : -1)

let pass = 0
const failures = []

/** 计数锚点：实际 ≥ 最小期望（只增不减，避免误报）。 */
function chkGE(id, desc, file, pattern, min, flags = 'g') {
  let actual = 0
  try {
    actual = (read(file).match(new RegExp(pattern, flags)) ?? []).length
  } catch (e) {
    actual = -1
  }
  if (actual >= min) pass++
  else failures.push(`${id} ${desc} — ${file} 实际 ${actual}，期望 ≥${min}`)
}

/** 相等锚点。 */
function chkEQ(id, desc, file, pattern, expected, flags = 'g') {
  let actual = 0
  try {
    actual = (read(file).match(new RegExp(pattern, flags)) ?? []).length
  } catch {
    actual = -1
  }
  if (actual === expected) pass++
  else failures.push(`${id} ${desc} — ${file} 实际 ${actual}，期望 =${expected}`)
}

/** 反向锚点：必须为 0。 */
function chkZero(id, desc, file, pattern) {
  let actual = 0
  try {
    actual = (read(file).match(new RegExp(pattern, 'g')) ?? []).length
  } catch {
    actual = -1
  }
  if (actual === 0) pass++
  else failures.push(`${id} ${desc} — ${file} 应无而有无 ${actual} 处`)
}

// ── 1. 身份与品牌 ────────────────────────────────────────────────────────────
chkGE('1.1', "应用名 TinTin", 'src/main/index.ts', "app\\.setName\\('TinTin'\\)", 1)
chkGE('1.2', 'appId com.tintin.desktop', 'package.json', 'com\\.tintin\\.desktop', 1)
chkGE('1.3', '服务端种子/provider 自愈', 'src/main/tintin-first-boot.ts', 'DEFAULT_SERVER_URL|ensureTinTinProvider', 3)
chkGE('1.3b', '默认工作区注册', 'src/main/tintin-first-boot.ts', 'tintin-workspace', 2)
chkGE('1.4', '模型服务商默认指向 tintin-server', 'src/main/tintin-first-boot.ts', 'tintin-server', 5)
chkGE('1.5', '/llm baseURL 锚点', 'src/main/tintin-first-boot.ts', 'baseURL', 2)
chkGE('1.6', 'agent 默认模型', 'src/main/tintin-first-boot.ts', 'agent-default-model', 1)
chkGE('1.7', '自有存储种子（config.json，0.1.7 设置缝）', 'src/main/tintin-first-boot.ts', 'config\\.json', 2)
chkGE('1.8', '自愈 store 兜底（readStoreServerUrl）', 'src/main/tintin-first-boot.ts', 'readStoreServerUrl', 2)

// ── 2. 壳层 main 进程 ────────────────────────────────────────────────────────
chkGE('2.1', '退出连树杀', 'src/main/runtime/harness-runtime.ts', 'killWindowsProcessTree', 3)
chkGE('2.2', 'pid 契约 getter', 'src/main/runtime/disclaimed-utility-process.ts', 'get pid', 1)
chkGE('2.3', '浏览器域壳层', 'src/main/tintin/browser/platform-meta.ts', '.', 1)

// ── 3. tintin-bundle 插件 ───────────────────────────────────────────────────
chkGE('3.1', '工具注册隔离 registerTool', 'packages/tintin-bundle/index.js', 'registerTool\\(\\{', 4)
chkGE('3.2', '[bridge] 全量追踪', 'packages/tintin-bundle/index.js', '\\[bridge\\]', 1)
chkGE('3.3', 'context:writeTask 通道', 'packages/tintin-bundle/index.js', 'context:writeTask', 1)
chkGE('3.4', 'SSE 透传路由', 'packages/tintin-bundle/index.js', 'tintin/sse', 1)
chkGE('3.5', 'agent 工具避开保留键 workflow_type', 'packages/tintin-bundle/lib/agent-tools.js', 'workflow_type', 3)
chkGE('3.5b', '嵌套 schema 显式 additionalProperties（0.1.7 编译器）', 'packages/tintin-bundle/lib/agent-tools.js', "additionalProperties: true", 3)
if (readdirSync(join(root, 'packages/tintin-bundle/presets')).length >= 5) pass++
else failures.push('3.6 五角色 preset — packages/tintin-bundle/presets 少于 5 个')
const presetDir = 'packages/tintin-bundle/presets'
const presetFiles = readdirSync(join(root, presetDir)).flatMap((r) => readdirSync(join(root, presetDir, r)).map((f) => join(presetDir, r, f)))
const presetHits = presetFiles.reduce((n, f) => n + (read(f).match(/workflow-worker-thread/g) ?? []).length, 0)
if (presetHits === 0) pass++
else failures.push(`3.6c preset 源引用 0.1.7 已移除包（workflow-worker-thread）—— ${presetHits} 处`)
chkGE('3.14', '设置卡测试连接按钮（SRC pingServer 对齐）', 'packages/tintin-bundle/client.js', 'serverPing', 2)
chkGE('3.7', 'ESM 纯度由 test/tintin-bundle-esm.test.ts 把关（提示）', 'test/tintin-bundle-esm.test.ts', 'module\\\\.exports', 1)
chkGE('3.9', 'config:get/merge 自有存储通道', 'packages/tintin-bundle/index.js', "'config:(get|merge)'", 2)
chkGE('3.9b', '自有存储模块接线', 'packages/tintin-bundle/index.js', 'tintin-config-store', 1)
chkGE('3.10', 'settings.yaml.imported 恢复接线', 'packages/tintin-bundle/index.js', 'planImportedSettingsRecovery', 2)
chkGE('3.11', 'resolver store 档', 'packages/tintin-bundle/lib/server-proxy.js', 'readTintinStore', 3)
chkGE('3.11b', 'resolver 字符串守卫（schemastery 占位符防回归）', 'packages/tintin-bundle/lib/server-proxy.js', "typeof u === 'string'", 2)
chkGE('3.12', 'client config 命名空间', 'packages/tintin-bundle/client.js', "namespaced\\('config'", 1)
chkGE('3.13', 'volatile 标记（schema 声明完整性）', 'packages/tintin-bundle/index.js', '\\.volatile\\(\\)', 3)
chkGE('3.9c', '占位符剥除（schemastery volatile 空对象——"[object Object]" 事故锚点）', 'packages/tintin-bundle/lib/tintin-config-store.js', 'stripEmptyObjectLeaves', 1)
chkGE('3.9d', 'client 向导/设置卡 URL 字符串守卫', 'packages/tintin-bundle/client.js', 'typeof (prefill|u) === .string.', 2)

// ── 4. tintin-media-bundle ──────────────────────────────────────────────────
chkEQ('4.1', '卡片挂载链 12 卡', 'packages/tintin-media-bundle/src/App.vue', 'v-if="active ===|v-else-if="active ===', 12)
chkEQ('4.1b', 'P2 四卡逐一挂载', 'packages/tintin-media-bundle/src/App.vue', "v-else-if=\"active === '(video-transcribe|subtitle-removal|viral-clone|live-slice)'\"", 4)
chkGE('4.2', '作用域根 border-box', 'packages/tintin-media-bundle/src/styles/tintin-global.css', '^\\.tintin-media-scope \\{', 2, 'gm')
chkGE('4.3', '契约链文件', 'packages/tintin-media-bundle/src/types/server-api.ts', '.', 1)
chkGE('4.5', '[tintin][bridge] 渲染层兜底', 'packages/tintin-bundle/client.js', '\\[tintin\\]\\[bridge\\]', 1)
chkGE('4.6', 'composer-left 挂载', 'packages/tintin-media-bundle/src/client-entry.ts', 'conversation\\.input\\.left', 4)
// 4.7 弹层形态（2026-09-28 高级脚本设置连环事故锚点）：全部 teleport 走 body 的
// token 容器，且容器内 mask 层级压过宿主面板；旧形态必须归零。
const dlgDir = 'packages/tintin-media-bundle/src/components/media-tools/copywriting-montage'
const dlgFiles = readdirSync(join(root, dlgDir)).filter((f) => f.endsWith('.vue')).map((f) => join(dlgDir, f))
const teleportNew = dlgFiles.reduce((n, f) => n + (read(f).match(/<teleport to="body"><div class="tintin-media-scope tintin-modal-layer">/g) ?? []).length, 0)
const teleportOld = dlgFiles.reduce((n, f) => n + (read(f).match(/<teleport to=".tintin-media-scope">/g) ?? []).length, 0)
if (teleportNew === 14 && teleportOld === 0) pass++
else failures.push(`4.7 弹层形态 — 新形态 ${teleportNew}/14，旧形态残留 ${teleportOld}`)
chkGE('4.7c', 'mask 层级 12000 规则', 'packages/tintin-media-bundle/src/styles/tintin-global.css', 'body > \\.tintin-modal-layer \\.modal-mask \\{ z-index: 12000', 1)
chkGE('4.7d', '容器 display:contents（不占流）', 'packages/tintin-media-bundle/src/styles/tintin-global.css', '\\.tintin-modal-layer \\{ display: contents; \\}', 1)

// ── 5. 打包器 ────────────────────────────────────────────────────────────────
chkGE('5.1', '清扫宏 customCheckAppRunning', 'build/installer.nsh', 'customCheckAppRunning', 2)
chkGE('5.2', '双侧孤儿清扫（asar.unpacked 布局，2026-09-28 更新）', 'build/installer.nsh', 'app\\.asar\\.unpacked\\\\node_modules\\\\node', 2)
chkGE('5.3', 'GameBar 固化', 'build/installer.nsh', 'UseNexusForGameBarEnabled', 1)
chkZero('5.4', '无跨产品 session.json 删除', 'build/installer.nsh', 'Delete "\\$APPDATA/dsh-desktop')
chkGE('5.5', 'Defender 排除指向 tintin', 'build/installer.nsh', 'APPDATA\\\\tintin|\\$APPDATA\\\\tintin', 2)
chkGE('5.6', '上游 dshFinishDirectories 保留（原子目录提升）', 'build/installer.nsh', 'dshFinishDirectories', 1)

// ── 6. 补丁内容级锚点（0.1.7 合并丢定制事故面）───────────────────────────────
chkGE('6.1', 'settings-models 补丁：隐藏 deepseek-official', 'patches/@deepseek-ai+dsh-client-ui-settings-models+0.1.7-rc.2.patch', 'visibleProviders', 2)
chkGE('6.1b', 'settings-models 补丁：tintin-server 不可删', 'patches/@deepseek-ai+dsh-client-ui-settings-models+0.1.7-rc.2.patch', 'entry\\.provider !== "tintin-server"', 1)
chkGE('6.2', 'dsh 补丁：tintin-bundle 依赖注入', 'patches/@deepseek-ai+dsh+0.1.7-rc.2.patch', '\\+    "tintin-bundle": "0\\.1\\.0"', 1)
chkGE('6.2b', 'dsh 补丁：tintin-media-bundle 依赖注入', 'patches/@deepseek-ai+dsh+0.1.7-rc.2.patch', '\\+    "tintin-media-bundle": "0\\.1\\.0"', 1)
chkGE('6.3', 'cordis loader 补丁（DSH_LOADER_TIMEOUT_MS）', 'patches/@deepseek-ai+cordis-plugin-loader+1.0.5.patch', 'DSH_LOADER_TIMEOUT_MS', 1)
chkGE('6.4', 'host patch 组合含 tintin 插件', 'build/dsh-desktop.patch.yml', 'tintin-bundle', 1)
chkGE('6.5', 'host patch 默认 preset 指向 0.1.7 registry id（agent-preset-registry）', 'build/dsh-desktop.patch.yml', 'agent-preset-registry', 1)
chkZero('6.5b', '0.1.5 旧 registry id 归零（agent-presets not found 警告源）', 'build/dsh-desktop.patch.yml', '- id: agent-presets')

// ── 7. 补丁版本对账（patches/ 每个文件 vs package-lock 实际版本）─────────────
try {
  const lock = JSON.parse(read('package-lock.json'))
  const patchDir = join(root, 'patches')
  let patchCount = 0
  let mismatch = 0
  for (const name of readdirSync(patchDir)) {
    const m = name.match(/^@([^+]+)\+([^+]+)\+([0-9][^+]*)\.patch$/)
    if (!m) continue
    patchCount++
    const pkg = `node_modules/@${m[1]}/${m[2]}`
    const installed = lock.packages?.[pkg]?.version
    if (installed !== m[3]) {
      mismatch++
      failures.push(`7.x 补丁版本对账 — ${name} 钉 ${m[3]}，lock 实际 ${installed ?? '未安装'}`)
    }
  }
  if (mismatch === 0 && patchCount > 0) pass++
  else if (patchCount === 0) failures.push('7.x 补丁目录为空？')
} catch (e) {
  failures.push(`7.x 补丁版本对账执行失败 — ${e.message}`)
}

// ── 汇总 ────────────────────────────────────────────────────────────────────
console.log(`定制锚点核查：PASS=${pass} FAIL=${failures.length}`)
for (const f of failures) console.log(`  FAIL  ${f}`)
if (failures.length === 0) {
  console.log('✅ 全部定制锚点在位。继续 §7：npm test + verify:contract + 真实启动观察（清单文档）。')
  process.exit(0)
}
console.log('❌ 存在丢失/过时项。判定原则见 docs/定制功能合入核查清单.md §0：有裁决记录=更新锚点；无记录=回滚或补回。')
process.exit(1)
