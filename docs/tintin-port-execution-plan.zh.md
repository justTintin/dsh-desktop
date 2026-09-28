# TinTin 移植执行计划（可执行版）

> 状态：**执行文档**（任务分解到文件级，随做随勾）。决策依据见 `docs/tintin-plugin-architecture.zh.md`（架构裁决）与 `docs/tintin/客户端集成DeepSeek-Harness实现方案_2026-09-12.md`（上游方案快照）；三者的冲突以架构裁决 + 本文为准。强制门禁：`docs/tintin/工程规范铁律.md`（经根 `AGENTS.md` §5 挂载）。
> 基线：本仓库 main（`@deepseek-ai/dsh@0.1.5-rc.3`，npm `next` 通道，2026-09-23 升级；28 个上游 patch）。源项目 `D:\Project\TinTin_Client_Electron`（下称 **SRC**）。标注 ✅ 的 API 锚点已在 0.1.5-rc 系列实读验证；标注 ⚠️ 的继承自 0.1.2-rc.1 基线，动手前须重验。升级记录见 `docs/harness-0.1.5-rc.1-upgrade.md` 的 rc.3 跟进注记。

## 0. 使用方式与环境

- 每个任务块 = 一个 PR 粒度；动手前读该块全部内容，完成后勾选验收项并在 PR 描述引用本文小节号。
- 开发调试一律用隔离 Profile：`DSH_HOME=%TEMP%\tintin-p0-dsh`（根 AGENTS.md §3 调试规则）。启动前确认实际 userData/DSH_HOME。
- 分支：`feature/tintin-p0-*`、`feature/tintin-wp<N>-*`，合入 main 前过 §5 门禁矩阵。
- 全程对照铁律：typecheck 必过、契约不猜字段、失败必打点、操作有四类依据、单文件 ≤1000 行（新文件）。
- **SRC 跟进纪律（A8 裁决 2026-09-23：跟进制不冻结）**：不设基线 tag；每个工作包搬运时记录所用 SRC commit hash（回填本文对应 WP 小节）；SRC 后续变更跟进重同步受影响模块（搬运前后各 diff 一次）；P1 切换前做一次终同步对账。SRC 侧将逐渐减少修改。

环境就绪（P0-0，0.5d）：

```bash
npm ci                # 检查 postinstall 完整：28 个 patch 全部 Applied
npm test              # 基线 754 用例全绿（记录基线数）
npm run typecheck && npm run build
```

- [ ] postinstall 无补丁失败；`npm test` 基线用例数记录到 PR
- [ ] `node -e "console.log(require('./package-lock.json').packages['node_modules/@deepseek-ai/dsh'].version)"` 输出 `0.1.5-rc.3`

Windows + npm 12 环境要点（2026-09-23 升级实测，换机/重装必读，详见 `docs/harness-0.1.5-rc.1-upgrade.md` rc.3 注记）：

- 锁文件 resolved 全指向 npmmirror，安装/装包命令一律带 `npm_config_registry=https://registry.npmmirror.com`，否则 EALLOWREMOTE。
- npm 12 的 install-scripts 白名单**按包版本生效**：`node`/`esbuild`/`koffi`/`node-pty`/`protobufjs`/`@deepseek-ai/dsh-subprocess-local`/`@google/genai` 需 `npm install-scripts approve <pkg>`（依赖升级后要重批）；`node` 包批完补 `npm rebuild node` 才有 `node_modules/node/bin/node.exe`（子进程测试依赖它）。
- 本机测试基线参照：`npm test` 已知 9 个环境性失败（python3 不在 PATH 的 release-notes ×8、需 git+ssh 外网的 generation 集成 ×1；ppt 三个 tgz 测试文件另有进程内 tar 解包问题）。这些与代码无关，升级/改动后的判定口径是「失败集合不超出此清单」；装 python3 可消掉 8 个。

## 1. P0：tintin-bundle 地基骨架（6~9d，闸门期）

> 目标：验证「打包 → 注入 → host 路由 → client module → 进度通道 → 工具 → 模型」全链路。**V1~V7 全过才投 P1**；V4 决定 P1 UI 形态。

### P0-1 建包与三件套接线（1d）

新建 `packages/tintin-bundle/`：

| 文件 | 内容 | 参照样例（✅ 已验证） |
| --- | --- | --- |
| `package.json` | `name:"tintin-bundle"`、`private`、`type:module`、`main:./index.js`、`exports:{".":"./index.js","./client":"./client.js"}`、`dsh.bundle.patch:"./cordis.patch.yml"`、`dsh.client:{inject:[],platform:"web"}`、peer：`@deepseek-ai/cordis` 与 `@deepseek-ai/dsh-host-webserver`（区间**照抄** `packages/dsh-image-generation/package.json` 实文，不凭记忆写） | `packages/dsh-image-generation/package.json` |
| `index.js` | `export const name/inject`；`ctx.inject(['webServer'])` 注册 `kind:'exact', path:'/tintin/ping'`；`isTrustedRequest` 移植 | 路由：`packages/dsh-desktop-market-installer/index.js:988-1079`（✅） |
| `client.js` | `window.__ModuleLoader__.load({id:'tintin-bundle', factory})`，factory 内同源 `fetch('/tintin/ping')` 打 console | 同上包 `client.js`；模块加载协议见根 AGENTS.md「后端与客户端启动协议」 |
| `cordis.patch.yml` | 单行 insert | `packages/dsh-image-generation/cordis.patch.yml` |

三件套接线（缺一不可，`test/desktop-plugin-closure.test.ts` 自动守护）：

1. 根 `package.json` dependencies 加 `"tintin-bundle": "file:packages/tintin-bundle"`；
2. `build/dsh-desktop.patch.yml` 追加 `- insert: [{id: tintin-bundle, name: tintin-bundle}]`（行式对照该文件现有行照抄）；
3. `patches/@deepseek-ai+dsh+0.1.5-rc.3.patch`：打开现有 patch，**照抄其中既有内置包的注入行式**为 tintin-bundle 增行，然后 `npx patch-package @deepseek-ai/dsh` 重新生成。

- [x] `npm test -- test/desktop-plugin-closure.test.ts` 通过（26/26，含 release + patch-hunk-counts；2026-09-23 P0-1 完成注记：① Windows 下 `patch-package <pkg>` 重生成模式不可用——其临时 `npm install` 子进程静默失败（上游均在 macOS 重生成）；替代流程 = 修 node_modules 后手工同步补丁行与 hunk 计数，再用 GNU patch `-p1 -l` 对干净 tarball 沙箱完整应用 + 与 node_modules 逐字节比对校验。② `test/patch-hunk-counts.test.ts` 夹具钉死 hunk 计数 `+28,13`，增行后须同步为 `+28,14`（与版本串升级同类维护项）③ peer 区间未照抄 image-generation 的陈旧 `^0.1.2-rc.1`（其靠 legacy-peer-deps 容忍），按 rc.1 升级文档惯例写 `^0.1.5-rc.3`）

### P0-2 开发路验证（2~3d，V1~V8）

```bash
DSH_HOME=%TEMP%/tintin-p0-dsh npm run dev    # harness dev 端口 ⚠️ 43130，重验
```

| # | 验证点 | 步骤 | 通过标准 |
| --- | --- | --- | --- |
| V1 | 插件加载 | 看 harness 子进程日志 | ✅ 2026-09-23：加载零错误（ring 桥接的 stderr 无任何 tintin 装载失败）。**发现**：`ctx.logger.info` 只进内存日志环，log-bridge 仅桥接 warn/error，"host ready" 不落 stdout 属设计行为——激活证据以路由应答（V2）为准 |
| V2 | host 路由 | 工作台内开 DevTools `fetch('/tintin/ping')`；命令行验证走 token→cookie 链（照 `scripts/verify-harness-auth.mjs` 模式，勿绕过鉴权） | ✅ 2026-09-23：真实子进程（bundled Node + `--patch build/dsh-desktop.patch.yml` + 隔离 DSH_HOME）token→cookie→`GET /tintin/ping` 返回 **200 `{"ok":true,"plugin":"tintin-bundle",…}`**；闭包镜像（profiles/node_modules/tintin-bundle 四文件完整）验证通过 |
| V3 | client module | 工作台 renderer 同源调用（真实 Chromium/IAB） | ✅ 2026-09-23：tintin-bundle 进模块图；renderer 同源 `fetch('/tintin/ping')` → 200 JSON；品牌槽位 TinTin 生效（client module 加载 + 模块图注册 + 同源鉴权链全通） |
| V4 | slot 勘察 | 枚举可用 slot（已知 ✅ `settings.plugins.tab`、`settings.section`、`settings.plugin.item`（`dsh-image-generation/client.js:310`、`market-installer/client.js:685-710`）、`conversation.chat.node`（image-gen client.js:300）、`conversation.input.accessory`/`conversation.composer.dock`（`packages/ppt-runtime/adapter` client.js:963-977））；向 `settings.plugins.tab` 注入可见面板作证 | ✅ 2026-09-23 实机勘察（附录 A）：无大面积 slot → P1 UI 形态定为 `conversation.input.accessory` 入口 + 展开面板（决策树第二档）。设置分区/插件卡活验证在位 |
| V5 | 本地文件 | host 插件内 `fs.writeFile` 写临时文件成功 | ✅ 2026-09-23：`POST /tintin/probe/file` 写入 `%TEMP%/tintin-p0/probe-*.txt`（42 字节），同机实测 |
| V6 | 外部进程 | host 侧 spawn 外部二进制返回版本号 | ✅ 2026-09-23：`POST /tintin/probe/spawn` 拉起 bundled `node.exe --version` → exit 0、stdout `v24.9.0`；ffmpeg 路径等 WP-1 落地 TINTIN_BIN_DIR 后同代码路径复用 |
| V7 | 进度通道 | 建 `POST /tintin/jobs` 返 202+jobId、`GET /tintin/jobs/:id` 轮询翻转（模式照抄 market-installer install 路由 ✅） | ✅ 2026-09-23：202+jobId → running（elapsedMs 156）→ 2s 后 done ✅；未知 job 404。发现：`prefix` 路由匹配是 `pathname.startsWith(prefix + '/')`，注册 path 不得带尾斜杠 |
| V8 | 锁定评估 | 记录：npm 精确 pin 可复现性、28 patch 与 tintin 增量的冲突面清单、在 scratch 分支做一次「bump 一个 rc 版本 → npm ci → 观察补丁重放」演练（不合并） | 《升级成本备忘》写入本文附录 B |

### P0-3 安装路与 agent 验证（2~3d，V9~V11 + 安装路）

| # | 验证点 | 步骤 | 通过标准 |
| --- | --- | --- | --- |
| V9 | agent 调工具 | bundle 内 `defineTool` 注册 `ping_server`（写法照 ✅ `dsh-image-generation/index.js:19-62,87`），会话中让 agent 自主调用 | ✅ 2026-09-23（完整壳 + TinTin provider + tintin-workspace）：轨迹显示 `工具 ping_server {} → {"ok":true,"pid":…}`，agent 自主调用并回读 liveness；bundle→defineTool→agent 编排接缝（§3.5a）机制证明成立 |
| V10 | 工作区读写 | 工具/agent 读写会话工作区文件 | ✅ 2026-09-23：agent 经 `write` 工具写 `Documents\tintin-workspace\task.json` 并读回；磁盘实测内容 `{"hello":"tintin"}` 正确（铁律 2：验到磁盘值，不只看轨迹） |
| V11 | 模型接入 | harness provider `base_url=http://<TinTin服务器>/llm`，model `deepseek-v4-flash` | ✅ 2026-09-23 **端到端通过**（完整壳 npm run dev，tintin-dev 档）：契约层 curl 流式+tool-calling 全绿（P0-S①）；接入层自定义提供方 TinTin（tintin-server，baseURL `/llm`，openai-completions，密钥 env `TINTIN_SERVER_API_KEY`）创建成功且 **`agent-default-model` 已指向它**（settings.yaml 实证）；**端到端推理成功**：tintin-workspace 工作区建会话发消息，agent 正常应答（1s/12000 tok/s），工作区沙箱上下文正确装配。**工作区默认目录落实**：`C:\Users\Administrator\Documents\tintin-workspace`（2026-09-23 用户裁决，经 RPC `workspace/create` 注册——顺带绕开了 B9 目录桥问题）。注：onboarding 默认 DeepSeek 提供方密钥格式校验宽松可占位通过 |
| V12 | 安装路 | `npm pack packages/tintin-bundle` → 隔离 `DSH_HOME` 下 `node node_modules/@deepseek-ai/dsh/bin.js plugin --profile web install ./tintin-bundle-0.1.0.tgz` → 重启加载 | generation 投影成功且 ping 通；Windows 下补 junction/物理路径验证（根 AGENTS.md §3） |
| V13 | machine-id 连续性 | host 进程跑移植后的 machine-id 逻辑，与老客户端同机产出比对 | 同一 ID（X-Machine-ID 租户数据连续的前提；理论输入为 os/mac，✅ 已实读） |
| V14 | zh 词典跨包注册 | **降级（A4 优先级裁决）：P0-V4 勘察时顺带验证，不作过闸条件**——client module 里 `ctx.locale.register` 为上游 UI key 注册一条 zh 数据，切语言看是否生效（机制事实：locale 引擎含 fallback 链 + 语言设置行 + zh 合法码，✅ 已实读 dsh-client-locale） | 记录可行性结论供词典启动时用；不影响 P0 判定 |

**P0 判定**：V1~V7 全过 → 投 P1；V4 无大面积 slot → 按 §3 决策树降级（附件 slot 或壳独立窗口），不阻塞；路由缝不可用 → 触发主方案垫档评估。P0 结论（各 V 项结果 + slot 清单 + 升级备忘）回填本文后开工 P1。

### P0-S 服务端配套（并行轨，约 1~2 人日，阻塞 V11；清单依据架构文档 §4.6）

dsh 侧已实证（0.1.5-rc.3 node_modules 实读）：provider 走 `dsh-llm-deepseek`，`baseURL` 可配、拼 `<baseURL>/chat/completions`；`tools` 序列化/`tool_calls` 解析在 provider 层；流式贯穿全栈（87 处引用）；鉴权 Bearer/api-key 头。据此服务端要做：

| # | 事项 | 验收 |
| --- | --- | --- |
| ① | `/llm/chat/completions` 补齐完整 OpenAI 兼容：`tools`/`tool_choice` 透传且模型真执行 function calling、`tool_calls` 流式增量、parallel tool calls、SSE `stream:true`、稳定 `usage`。旧工作台只走过纯补全，这两条路大概率未验过 | ✅ 2026-09-23 实测（192.168.111.31:8000，curl 直连）：流式 SSE 标准（delta 增量/finish_reason/usage/[DONE]）✅；tool-calling 非流式返回标准 `tool_calls[].function.{name,arguments}` + `finish_reason:"tool_calls"` ✅；**流式 tool_calls 增量分片**（id/name 骨架先行、arguments 逐字）✅。parallel tool calls 未单独验（组合已覆盖主路径） |
| ② | 修复 `/v1/chat/completions`（2026-09-12 实测 500/挂起，约 0.5d） | 待服务端修复（标准 OpenAI 生态兼容与双路径冗余） |
| ③ | `/llm` 加 Bearer 鉴权（key 随激活下发，复用 `/system/license/*` 体系）；无 key 拒绝 | 无 key 401，provider 配 key 后通 |
| ④ | per-key 限流 + 用量审计（落 `/llm/records`/`/llm/stats`） | 超限 429；审计可查单机用量 |

明确不做：约 260 个算力端点零改动（bundle 工具直接包装）；任务进度沿用 `/tasks` 语义由 host 桥适配；`/output/` 改写留在客户端桥；MCP 不做。

## 2. P1 工作包（30~42d，WP-2/3 可并行；2026-09-23 A1 裁决：P1 = WP-1/2/3/5，WP-4 移 P3）

### WP-1 地基扩展：桥服务端与原生能力（8~12d）

**进度（2026-09-23 开工，P0 同日）**：
- ✅ 纯逻辑模块：`lib/machine-id.js`、`lib/server-proxy.js`（ESM 近 1:1 搬运，去 ipcMain 壳），8 单测全绿
- ✅ host 编排：`/tintin/ipc/<channel>` 分发路由（server:* → FastAPI，信任门+错误保留）、tintin settings namespace（schemastery）、tintinBridge 服务（`ctx.provide`）
- ✅ 端到端实测：`/tintin/ipc/server:llmModels` 转发 `192.168.111.31:8000/llm/models` 返回完整模型列表；未知通道 404；server.url 未配置时回退 127.0.0.1:8766
- ⏳ 待做：TINTIN_BIN_DIR 壳注入 + ffmpeg/剪映模块搬运、老配置迁移、机器码端到端比对

**WP-1 排错记录（真实启动抓到，铁律 5/7 打点价值实证）**：
1. `cannot get property "settings" without inject`——settings 服务必须进插件顶层 `inject` 数组（scoped `ctx.inject(['webServer','tools'])` 不覆盖它）。
2. `schema is not a function`——`settings.register` 要 schemastery `z.object()`，不是普通 JSON schema。
3. `z.object().optional is not a function`——schemastery 无 `.optional()`（实测 undefined）；空对象 schema 全可选，读取判空。

范围（host 侧，全部进 `packages/tintin-bundle/`，按域拆模块，单文件 ≤1000 行）：

| 模块 | 来源（SRC） | 方式 | 要点 |
| --- | --- | --- | --- |
| server-proxy | `desktop/main/server-proxy.js` | 近 1:1 | Node http 转发、`X-Machine-ID` 注入、`/output/` URL 改写；base URL 解析链保留 |
| machine-id | `desktop/main/machine-id.js` | 近 1:1 | 租户隔离依赖 |
| IPC 分发 | `desktop/preload/preload.js` 的对端 | 重写壳 | `POST /tintin/ipc/<channel>` → 模块分发表；`{result|error}` 包裹；错误体含阶段与原始 cause（根 AGENTS.md §3 加载失败保留诊断） |
| jobs 注册表 | P0-V7 产物 | 扩展 | 事件类 IPC（`*OnProgress`）改 jobId 模式 |
| media 流 | 新写 | 新写 | `GET /tintin/media?path=` Range 流（替代 `file://`，主方案 §3.4） |
| 剪映/花字/混剪逻辑 | `jianying-exporter.js`、`jianying-*.js`、`fancy-templates.js`、`montage-*-ipc.js` 中纯函数 | 原样搬 | 仅 handler 壳改路由；逐符号守恒（铁律 10 拆分五项） |
| ffmpeg 门控 | `ffmpeg-gate.js` | 搬 + 改一处 | `getBinDir()` 改 `process.env.TINTIN_BIN_DIR ?? 旧逻辑` |

壳侧唯一改动点（2026-09-23 扩为三项）：① `src/main/` 创建 `HarnessRuntime` 处注入 `TINTIN_BIN_DIR=<resources>/bin/win`（定位 ⚠️ `src/main/runtime/harness-runtime.ts:448-486` 命令组装处，重验）；ffmpeg/ffprobe/yt-dlp/花字资产进 electron-builder `extraResources`（对照现有打包配置）。② **应用身份隔离——✅ 2026-09-23 已完成（用户实机撞档触发提前实施）**：`configureAppIdentity()` 改为 `TinTin`/`tintin`（dev：`TinTin Dev`/`tintin-dev`），`package.json` build `appId: com.tintin.desktop`、`productName: TinTin`、artifactName 全部 tintin 前缀，`electron-builder.dev.cjs` 同步；**产品名 TinTin 为占位，正式名一句话可换**；品牌文案扫荡（托盘/关于/恢复向导的 "DSH Desktop" 字样）另列品牌项未做。事件记录：2026-09-23 用户在装有官方 dsh 的机器上运行未改名包，继承并可能重 pin 了 `%APPDATA%/dsh-desktop` 官方档案（会话无损，官方应用下次启动自行重 pin）。DSH_HOME 由 `<userData>/harness` 派生（✅ index.ts:818 → harness-runtime.ts:320 传 env），userData 一分则 profiles/插件 generations/会话/凭据/设置全部隔离。③ 打包阶段核对 URL 协议/文件关联无重叠 scheme。并装验收进 §5 门禁矩阵。

- [ ] 分发路由 240 通道中 P1 所需子集（以 `scripts/audit-ipc-consumers.js` 跑 SRC 得到混剪+公共层实际用量清单）全部通
- [ ] 每路由失败分支有错误体 + `ctx.logger` 打点（铁律 7）
- [ ] 契约字段对齐 `desktop/types/global.d.ts` + `server-api.ts`，逐字段不兜底（铁律 6）

**tintinBridge 服务契约（插件互调用的唯一通道，2026-09-23 定案）**：

- 地基以 `ctx.provide('tintinBridge', ...)` 发布服务（写法参照 ✅ `market-installer/index.js:824-825` 提供 `desktopProfiles`/`desktopPnpm` 的先例），面覆盖：IPC 分发、serverProxy（含 X-Machine-ID）、jobs 注册表、media 流、配置读取。
- 域插件（media/ops）host 侧声明 `inject: ['tintinBridge']` 静态依赖——地基被禁用或 Safe Mode 下，Cordis 自动不激活域插件（天然降级，不会半死）。
- 反向通知走事件（`ctx.on/emit`）：任务完成、服务器在线状态变化由地基广播，域插件只做 UI 状态更新。
- **预留 loopback 契约**：地基内留本机回环服务接口位（token 鉴权，照 harness 自身 auth 模式），P2 浏览器域门面（`browser_open`/`page_extract` 等工具）经它调壳层引擎——P1 只留接口不实现。

**插件间依赖规则**：单向（域插件 → 地基），域插件之间禁止互相调用；出现 media↔ops 共享需求一律下沉地基，不横向拉线；永不直接 import 另一插件的包（绕过生命周期会留悬空引用）。

### WP-2 polyfill 桥（8~10d，可与 WP-3 并行）

- 实现 `window.tintin` 同签名面（约 300~500 行，client module 内）：invoke → `/tintin/ipc/*`；进度事件 → jobId 轮询；`shell.openItem` → `/tintin/shell/open`；目录选择优先复用 harness 选择器（✅ `ctx.directoryPicker` 服务存在，patch 实证）。
- `<video>`/`<audio>` src 重写：`file://` → `/tintin/media?path=`。
- 范围纪律：只实现 P1 视图实际消费的通道（用量清单同 WP-1），其余通道 P2 随卡片补。
- [ ] 移植视图**零改动**加载（唯一允许的差异：媒体 src 重写经统一工具函数）

### WP-3 tintin-media-bundle + 文案混剪/剪映模板两卡（12~18d，重链路燃烧在 P1 完成）

> 裁决链：2026-09-23 智能混剪永久废用；同日追加裁决——**媒体工具 P1 先移植文案混剪 + 剪映模板两张卡，其余卡片入口暂不实现**（卡片注册表保持声明式，P2 恢复一张加一行）。原"轻卡三张先行"安排作废。重链路（本地合成+剪映导出）随之回到 P1 覆盖，§7 风险登记已改写。**命名已落定（源仓库 2026-09-23 三连提交 80c9684→00b2235→430d9bb）**：产品名维持**文案混剪**（"方案混剪"为误称已纠正），代码前缀经 plan→copywriting 二次重命名，最终为 `copywriting-montage`；本文路径已按最终形态更新。

- 建包三件套（同 P0-1 流程，含 `test/desktop-plugin-closure.test.ts` 守护）。
- 工程形态（决策已定，实现细节开工首日定稿并回填本文）：对照 `packages/ppt-runtime`「源码维护 + 构建 + 分发」先例——`packages/tintin-media-bundle/src/`（Vue+TS，自带 vite 构建）产出 client chunk；包内 `npm run typecheck`（vue-tsc）纳入铁律门禁。
- 首周技术验证（主方案 §3.4 风险项，先行）：
  1. Vue `createApp().mount(el)` 挂 slot 容器（宿主只强制 react/`@deepseek-ai/*` 单例 ✅ `installer.mjs:31`，无框架限制）；
  2. CSS 自注入 + 幂等 guard；slot 卸载时 `app.unmount()` 清理；
  3. `/tintin/media` 视频预览在真实工作台可播（loadedmetadata/readyState≥4，铁律 2）——文案混剪重度依赖预览，此项为硬前置。
- 移植范围（近 1:1）：
  - **文案混剪**：`copywriting-montage/` 全家（CopywritingMontage + CopywritingStep1-4Panel + CopywritingStoryboard + CopywritingBgmPickDialog + UiContext）+ `composables/copywritingMontage/*` + `copywritingMontage*Logic.ts` + `useCopywritingMontage`；**含与智能混剪共享的 `composables/montage/*` 子集**（以 `audit-ipc-consumers.js` 实际引用圈定，不搬废用卡独有部分）；
  - **剪映模板**：`JianYingTemplates.vue` + `main/jianying-templates.js`（含模板预览资产路由）；
  - `views/MediaTools.vue` 卡片注册表只启用这两张；所需 `components/common/*`、stores 子集（server/tasks）。
- **UI 形态（2026-09-23 最终裁决，用户确认）**：会话标题栏右侧（"标准模式"行右侧空白）挂 `运营工具`、`媒体工具` 入口，落点 **`conversation.session.header.actions` slot**（现成插件 slot，conversation 包 `renderSlot` 渲染，jobs/schedule/subagent 等包先例）——**非 patch、非壳层定制**。点击展开对应工具面板/页（卡片 UI 形态依展开面板/右侧栏 tab 细化，实现时定）。替代此前的"附件入口+面板"与"壳层顶栏"方案。
- [ ] 文案混剪全流程可用：文案/分镜→智能匹配（方案C）→本地合成→配音（含时长对齐）→特效/BGM→成片导出 + 一键剪映草稿；进度全程可见；服务端离线不影响本地直出主路径
- [ ] 剪映模板可用：模板列表/预览/套用导入；依赖的剪映互通产物（jianying-templates 数据）随 WP-1 模块就绪
- [ ] 其余卡片入口不可见（注册表只有两行），服务端离线时"未部署"态正确

### WP-4 tintin-ops-bundle ——已移至 P3（2026-09-23 A1 裁决"运营工具三期"；以下内容保留作 P3 工作包基础）

- 6 卡全量：`OtProductLibrary`（含 `OtCopywritingPanel`）、`OtKnowledgeBase`(planned 占位)、`ReversePromptImage/Video`（注意：现居 media-tools 目录，搬运时归位 ops）、`OtVideoScore`、`OtVideoMarketing`；本地记录库 `video-prediction-store.js` → host 存储（位置 `$DSH_HOME/tintin/`，不进 profile 数据）。
- [ ] 产品资料增删改查 + 文案生成全流程可用；服务端离线时卡片显示"未部署"态（现行为保持）

### WP-5 模型接入与会话业务组件（5~8d，2026-09-23 按产品定位修正重写）

> 定位修正（2026-09-23 用户裁决）：**会话交互保留并复用 harness 会话 UI**——TinTin 媒体业务由会话驱动（"说需求→智能体拆解编排执行"），harness 提供对话引擎，TinTin 往里挂业务组件。不替换会话 UI、不做独立工作台。

**5a. 模型接入与默认固化**
- provider 固化默认指向 TinTin `/llm`（key 不落客户端）；`ctx.settings.register` 提供服务器地址配置卡（写法 ✅ `dsh-image-generation/index.js:68`）。默认模型 `agent-default-model` 指向 tintin-server（P0-V11 已实证此形态可行）。
- 首启预置 locale=zh + `ctx.systemPrompt.section` 固化"始终中文回复"（A4 裁决）；插件自身文案仅 zh（国际化后补）。

**5b. 业务上下文组件（会话输入区，替代原"装配面板"）**
- 落点 `conversation.input.accessory` slot（V4 已实证，ppt 先例 ✅ `packages/ppt-runtime/adapter/client.js`）：会话输入框上方挂 TinTin 上下文条——**产品 / 素材 / 脚本 / 音色**选择器（移植 SRC `components/workbench/WbPick*.vue` 的产品库/素材库/脚本选择器，近 1:1）。
- 选择结果序列化 `task.json` 落会话工作区（主方案 §3.5b 三层设计照做，schema 通用化，为 P2 重流水线卡预留字段位）；工具缺参时读 task.json（对话参数 > task.json > 默认 合并优先级）。
- [ ] 输入区上下文条可见可选；选产品/素材/脚本后写 task.json；agent 一句"开始"读 task.json 走通

**5c. 智能体角色（harness 原生 preset 机制，2026-09-23 裁决）**
- 五角色用 preset 承载：`packages/tintin-bundle/presets/` 下五目录（总助手/编导智能体/制作智能体/质检智能体/素材库智能体），经 preset root 注册（`dsh-agent-presets` bundle 提供先例 ✅，AgentPreset 目录 = 人设+工具集+技能+默认模型组合，`Config.default` 设总助手为默认）。
- **人设内容重写而非照搬**：SRC 原人设按"服务端编排+客户端轮询"写成，含过时编排指令；按 dsh 模型重写为"角色职责 + 可用工具/技能"，编排交 agent-loop。保留五角色的职责划分（业务资产）。
- 会话顶部智能体切换 = harness preset 选择器（`Agent 预设` 分区已有）。
- [ ] 五个 preset 注册可见可切换；切换后会话人设与工具集随之变化

**5d. 识图路由（服务端，2026-09-23 裁决）**
- 视觉理解（选素材/抽帧研判）走**服务端** `/llm/vision`（qwen-vl），在媒体工具的 `defineTool.execute` 内部调用——**不经对话 LLM（DeepSeek）识图**（成本与延迟双重原因，架构文档 §4.5）。
- 落实为工具实现约束：所有视觉类工具的视觉调用一律指向服务端 vision 端点，禁止路由到对话模型。

**设置迁移映射（2026-09-23 对齐定稿；键面经主进程+渲染层实测扫描核对）**——设置页 UI 整体不移植，逐项分流：

| 源设置项（实测使用处数） | 去向 | 状态/裁决 |
| --- | --- | --- |
| `server.url`（14 处） | tintin settings namespace + 老配置迁移 + resolver 三级回退 | ✅ 已通；设置卡 UI 随 WP-5a |
| `machineIdV2` | lib/machine-id 同机同值（实测一致） | ✅ 无需持久化 |
| `llm.defaultModel`（3 处） | harness 模型选择器 + agent-default-model | ✅ 原生替代；WP-5a 固化默认 |
| `llm.webSearch`（2 处） | harness web 搜索设置 | ✅ 原生替代，不迁 |
| `themeMode`（2 处）/ `window.*` / `windowState` | harness 外观/上游壳 | ✅ 原生替代，不迁 |
| `inference.*`（5 键，本地 AI 双模式） | 缓议（既有裁决） | 不迁 |
| `local.cacheDir`（5 处） | **固定 `$DSH_HOME/tintin/cache`，不做设置项**（2026-09-23 裁决） | WP-5a 落地 |
| `downloadDir` + `media.settings.downloadDir` | **随 P2 再定**，届时缺省=工作区 `downloads/`（2026-09-23 裁决；P1 文案混剪不消费） | P2 |
| `feishu.*`（7 键） | P2 随飞书集成（既有裁决） | P2 |
| 激活/license 卡（CardAccountLogin） | **P1 不做激活**（2026-09-23 裁决：内部运营团队内部分发，X-Machine-ID 租户隔离已够；license 体系保留对接能力，需要时再加卡） | 不做 |
| `env.logLevel` | 不迁（harness 自带日志体系）；需调试时再加 tintin namespace 字段 | 不做 |
| LogViewerDialog / CardAbout | 不搬（harness.log + 上游壳关于/更新） | ✅ 原生替代 |
| 模型 provider 设置 | harness 原生 settings-models；WP-5a 固化 tintin-server 指向 `/llm` | ✅ 原生替代 |

WP-5a 待做清单（已排期，非遗漏）：tintin 设置卡（服务器地址）、provider 首启固化、预置 zh + 固化"始终中文回复"、cacheDir 固定目录落地。

**P1 交付边界**：P1 交付 = 地基（tintin-bundle：桥/原生能力/tintinBridge）+ polyfill 桥 + **媒体 2 卡（文案混剪、剪映模板）+ 会话业务组件（WP-5：上下文条/五智能体 preset/识图路由/设置迁移）** + 模型接入。**明确不包含**：其余 11 张媒体卡（P2 占位等排期，2026-09-23 A1 裁决；恢复一张加一行注册表）；**运营工具 6 卡（P3）**；智能混剪**永久不移植**（功能本就计划过期，2026-09-23，见附录 D）；浏览器域全家（P2 spike + 搬运）；本地 AI 离线双模式（缓议）；定时任务/飞书/Office（P2 按需）；无人值守与集中调度（MCP 后补）。数据迁移仅老用户配置（A2 裁决），会话历史不迁（A5）。**会话交互保留复用 harness 会话 UI**（2026-09-23 定位修正：换编排引擎不换会话形态）——依据与缺口分析见架构文档 §4 及本文附录 C/D。

## 3. P2/P3 清单（顺序可调；2026-09-23 A1 裁决后的批次划分）

**P3（运营域，2026-09-23 A1 裁决"运营工具三期"）**：

| 项 | 范围 | 估 |
| --- | --- | --- |
| tintin-ops-bundle | 运营 6 卡全量（WP-4 内容为基础：产品资料+文案、图片/视频反推、评价预测、营销检测；知识库缓议） | 5~8d |

**P2**：

| 项 | 范围 | 估 |
| --- | --- | --- |
| 媒体卡恢复（入口逐张重开） | 音频生成、声音克隆、视频转文字（原轻卡三张，2026-09-23 裁决移出 P1）、仿爆款、直播切片、去水印字幕、参考视频下载、图像抠图、分镜脚本创作；wip 卡（封面制作/视频修复）按产品裁决 | 每卡 2~5d |
| agent 工具化 | `defineTool` 粗粒度 full_pipeline 工具以文案混剪为样板 → 逐步拆细；工具输出**摘要化**（架构文档 §4.5 成本护栏） | 5~8d |
| Skill 化 | SRC `.zcode/skills/text-storyboard`、`viral-writer` 转 SKILL.md provider（✅ `dsh-image-generation/index.js:89-96` 写法）；新增「电商混剪 SOP」 | 2~3d |
| harness UI 中文词典 | **后置项（A4 优先级裁决 2026-09-23：功能移植优先，词典不与功能移植抢资源、不进 P1 验收，启动时机由产品定；启动前置 = V14 结论）**。全界面翻译；中文术语表先行（session=会话/approval=审批/skill=技能/deliverable=交付物/preset=预设/workspace=工作区/profile=配置档…一次定表，词典/agent 输出/文档三处共用）；实现载体依 V14 结论（bundle 注册或 fork 层）；每次 dsh 升级补跟上游新增字符串 | 首版 5~8d + 升级跟版 |
| 浏览器域 spike | webview 标签 vs 壳层 overlay 二选一验证（架构文档 §浏览器域三层形态） | 3~5d |
| 浏览器域搬运 | 引擎近 1:1 进 `src/main/tintin/browser/` + 地基 loopback 门面 + 面板 UI | 10~15d |

**浏览器域首片已落地（2026-09-25 用户裁决提前，驱动项=参考视频下载的 yt-dlp 登录态）**：
顶部新增「浏览器」tab（chrome 原生面板：每平台登录态卡（cookie 条数）+ 打开独立浏览器窗口 + 导出登录态）；壳层引擎 `src/main/tintin/browser/`（platform-meta 一比一 + netscape-cookies 纯序列化 + browser-service 独立窗口引擎：单例 WebContentsView、close=hide 保登录态、cookies 导出 `<userData>/harness/tintin/browser/cookies/cookies_<platform>.txt`（导航后 2s 防抖/窗口隐藏/手动））+ preload `dshDesktopBrowser` 桥（platforms/open/loginStatus/exportCookies）。**spike 已裁决（2026-09-25 用户确认）：独立窗口胜出**——webview（需主窗口 webviewTag，安全面扩大）与主窗口 overlay（原生 view 盖页内弹窗、跨 tab 生命周期复杂）两实验形态已删除，主窗口 webviewTag 保持 false。
**形态终裁（2026-09-28 晚，用户裁决；同日早间「嵌入 tab（webview）」试验形态废弃）**：浏览器整体按原客户端形态实现——独立窗口加载本地页面 `build/tintin-browser.html`（结构对照 SRC Browser.vue：工具条+左栏（平台组/功能扩展组/服务端）+ 主区宿主 + 右栏嗅探位 + 下载栏），原生 WebContentsView（平台分区）经页面宿主矩形 bounds 同步覆盖主区（SRC useBrowserBounds 同款机制），preload 复用 index.cjs（dshDesktopBrowser + tintinBrowserPage 通道：bounds/open/action/state/downloads）。主窗口 webviewTag 维持上游 false；`security.ts` 回退上游「will-attach-webview 一律 preventDefault」基线（当日白名单放行随内嵌形态一并回退）。**功能扩展组 6 视图（收藏/每日素材/达人库/素材采集/嗅探面板/自动上架工作流）已在窗口内占位，按 SRC 近 1:1 回归的载体已就位**。同裁决：主窗口顶部 Tab 栏撤销，「运营工具/媒体工具/浏览器」入口注入左侧「插件」面板下（克隆面板行注入 + MutationObserver 守卫，点侧栏其他区域回工作台），切换沿用覆盖层 KeepAlive 机制。
**登录即同步（2026-09-28 用户裁决，落 UX 自动同步原则）**：`security.ts` 的 webview 拒载兜底改为上述白名单（原无条件 preventDefault 会杀全部挂载——白屏根因）；`browser-service` 监听各平台分区 `cookies.on('changed')` → 2s 防抖自动导出（登录/登出即落盘，webview 与独立窗口两形态通用），加上宿主门 probe/download 前回环核验，构成"cookie 变化即落盘 + 消费前再核验"双保险；面板删除「导出登录态」手动按钮（0925 首片遗留，已无存在必要），卡片登录状态随内嵌页导航自动刷新。实机验证：dev 实例内嵌 YouTube 页种探针域 cookie，≤6s 自动出现在交接文件（无任何手动动作）。
**参考视频下载同日落地**：宿主 `lib/ytdlp-logic.js`（SRC 纯逻辑 1:1：白名单/参数/档位/错误分类）+ `lib/ytdlp.js` 宿主门（status/probe/download/saveAs；cookies 从壳层交接目录读、有文件才前置 `--cookies`；下载阻塞到终态、进度事件不落桥）+ polyfill `ytdlp` 命名空间 + `VideoDownload.vue`/`useVideoDownload` 1:1 + 卡启用（视频组）。**yt-dlp 随包分发**（2026-09-25 用户确认）：仓 `resources/bin/yt-dlp.exe`（2026.08.19）经既有 extraResources 整目录随包；builder 前置检查/自动补齐脚本已含 yt-dlp，产物校验已补 ffprobe/yt-dlp 两项（2026-09-25）。
纯函数单测 `test/tintin-browser-platform.test.ts` + `test/tintin-ytdlp.test.ts`。**浏览器域后续**：extractors/ext-manager/download-manager/自动上架/热点采集、loopback 门面（agent 工具）。
| 按需项 | 定时任务（schtasks 逻辑搬 host）、Office 预览导出、飞书、`/ollama` 低成本路由接入 | 各 1~3d |
| 本地 AI 双模式 | 默认**缓议**：服务端在线为前提；确需离线再立项（架构文档 §4 缺失清单） | 另评估 |

## 4. 既定裁决（执行时不再讨论）

- **范围裁决链（2026-09-23，A1）**：智能混剪永久不移植（功能本就计划过期）；**P1 = 文案混剪 + 剪映模板 + 会话内设置及其依赖（地基/桥/契约链）**；其余媒体卡 P2 占位等排期；**运营工具 6 卡 P3**。命名已落定：产品名文案混剪，代码前缀 `copywriting-montage`。
- 工作台聊天 UI 不移植（harness 会话 UI 替代）；映射表见架构文档 §4。
- **默认工作区（2026-09-23 用户裁决）**：运行时默认工作区 = 当前用户文档目录下 `C:\Users\Administrator\Documents\tintin-workspace`（按用户实际 Documents 路径派生，非硬编码绝对路径）。P0 经 RPC `workspace/create` 注册实现；WP-1/WP-5 落地为首启自动建目录 + 注册（含不存在时创建）。
- **官方渠道切断（2026-09-23 实施，用户发现更新弹窗官方 v0.9.0 触发）**：① `desktop-service/index.ts checkDesktopUpdate` 直返 `{updateAvailable:false}`——上游策略服务器硬编码校验 feedUrl 为官方归档 URL（service.ts:134），本产品永远不可能合法经它更新，切断到策略层为止；② crash 遥测发往 dshdesktop.com 的同意弹窗改为静默丢弃（fork 数据不外流官方）；③ `build.publish` URL 换占位 `https://updates.tintin.example.com/desktop/`（inert，策略层切断后永不被请求）。**品牌清扫（同日）**：工作台侧栏名与会话首页徽标换上槽位（dsh-desktop-client-ui 不再引用上游 BrandWordmark/FishLogo，侧栏文字排版 "TinTin"、会话首页保留壳自有 window-mark）；壳内用户可见 "DSH Desktop" 字样清零（托盘/关于/恢复向导/错误框）；CI 产物与烟雾测试命名同步（release.yml，ModelScope 镜像仓 alexyaojin/dsh-desktop 为第三方托管仓保留）。配套测试更新：desktop-client-ui（槽位断言换品牌）、release（契约 fixture 换名）。**TinTin 真实更新端点接入属于 A3 发版前残留项**（届时换 strategy/feed/TERM 占位）。
- **分发机游戏集成静默关闭（2026-09-25 用户裁决授权）**：安装器 customInstall 写三条用户级注册表（GameBar UseNexusForGameBarEnabled=0、GameConfigStore GameDVR_Enabled=0、GameDVR AppCaptureEnabled=0，HKCU 可逆免管理员），根治分发机精简 Xbox Game Bar 后启动应用弹 ms-gamingoverlay 商店搜索（系统游戏检测误判 Chromium/Electron 形态 + 手柄检测触发协议激活）。卸载不回写（恢复会复发弹窗）。见 build/installer.nsh。
- 成本三通道与四条护栏见架构文档 §4.5；工具输出摘要化是 P2 工具的硬性验收项。
- dsh 升级：跟 `latest`/`next` 通道、跳过 alpha（现状：已锁 next 的 `0.1.5-rc.3`）；流程 = 架构文档 §5 + 本仓库 `docs/harness-*-upgrade.md` runbook；每次升级加跑 V1~V3/V9 冒烟子集。**0.1.6 前瞻**（alpha.2 实测，升 0.1.6-rc 时复核）：`dsh-client-modules` 发现协议内部重构（526 行差异）是最大敞口，V3 冒烟第一项抓牢；`dsh-tools` 为 schema 演进式改动；webServer 路由/settings 面未动。

## 5. 门禁矩阵（每个 PR 必过；按改动类型叠加）

| 改动类型 | 必跑 |
| --- | --- |
| 任意 | `npm run typecheck`；`npm test`；`git diff --check`；铁律自查（新文件 ≤1000 行、无猜字段、失败有打点） |
| 插件包/patch.yml/闭包 | + `npm test -- test/desktop-plugin-closure.test.ts`；真实子进程起 web profile 验证加载（不以 import 成功为证） |
| client 侧 | + 认证后 HTML + bootstrap 响应 + 执行注册验证（根 AGENTS.md「后端与客户端启动协议」）；Chromium console 零新增错误 |
| src/main 壳改动 | + Safe Mode 回归 `test/safe-mode-*.test.ts`；升级链路不受影响 |
| 安装/打包 | + `scripts/verify-target.mjs <platform> <arch>`；安装路 `npm pack` + 隔离 DSH_HOME 安装演练；**并装隔离验证**（装了官方 dsh-desktop 的机器上并装 TinTin：appId/userData/DSH_HOME 互不可见，卸载任一不影响另一个） |
| 涉及 Windows 路径/进程 | + 本机 Windows 实测（其他平台通过不能代替） |

交付说明模板（PR 描述）：改动与原因（引用本文小节 + 依据分类）｜实际运行的检查及输出要点｜未验证项与限制。

## 6. 测试策略（每层"写什么测试"；§5 门禁矩阵是每 PR "跑什么命令"）

| 层 | 写什么 | 放哪 / 怎么跑 | 依据 |
| --- | --- | --- | --- |
| L1 搬运单测 | SRC 既有测试随纯逻辑模块**一起搬**（SRC 快照时 1027 用例，随源项目演进以实时为准，按 WP-1 模块清单圈定搬运子集）；拆分搬运过铁律 10 五项核对（行数守恒/符号完整/导入完整/单测全过/分支闭环） | tintin 包内 vitest，纳入 `npm test` | 铁律 8/10 |
| L2 契约测试 | ① openapi 契约链迁入（`contract:gen` + `verify-contract.js` + `audit-ipc-consumers.js` 进 tintin 包构建）；② 桥通道"四处同值"断言：`global.d.ts` ↔ preload 桥实现 ↔ host 路由 ↔ `server-api.ts`；③ 新增通道必须有 happy path + 失败路径两用例 | tintin 包 + 本仓库 `test/` | 铁律 6 |
| L3 行为/集成 | host 路由分发表、jobs 生命周期（202→轮询→终态→清理）、`/tintin/media` Range 流（206/断点续传）、tintinBridge provide/inject（含地基禁用时域插件自动降级）、三件套一致性 | 本仓库 vitest，沿用 `plugin-startup-failure`/`safe-mode-*` 真实子进程模式 | AGENTS §4（行为优先于字符串契约） |
| L4 UI 回归 | 每卡冒烟清单：打开→主操作→断言结果与状态（含服务端离线"未部署"态）；绑定值到 DOM 的断言（如 `loadedmetadata`/`readyState>=4`）；Chromium console 零新增错误 | 真实工作台执行，清单挂在附录 D 各行备注 | 铁律 2 |
| L5 真机验收 | 安装路（V12）、Safe Mode、Windows 专项（junction/物理路径）、发版 `verify-target` | 发版 runbook + P0/P2 节点 | AGENTS §4 |

原则：L2 字符串/源码契约测试只作补充，不替代 L3 行为验证；SRC 搬来的测试改造后必须仍能捕获原缺陷类型，禁止"删测试保绿灯"；每张卡完成定义 = L1~L4 对应项全绿。

## 7. 风险登记（继承主方案 §6，按新基线修订）

| 风险 | 等级 | 缓解 |
| --- | --- | --- |
| Vue-in-slot（无先例） | 高 | WP-3 首周先行验证；退出路径 = React 原生重写（远期）或壳独立窗口（已批兜底） |
| slot 面积不足 | 中 | P0-V4 勘察 + §3 决策树三档 |
| 上游升级破坏接缝 | 中 | 只用公开扩展点；28 patch 冲突面已在 V8 备忘；升级跑门禁矩阵 |
| 媒体预览受同源限制 | 中 | `/tintin/media` Range 流（WP-1）；铁律 2 用真实 origin 最小探针先验证 |
| 服务端不可用 | 低 | 本地直出路径保留；卡片"未部署"态保持 |
| 重链路验证时机（裁决演变） | 低（已缓解） | 2026-09-23 追加裁决将文案混剪拉回 P1，"本地合成（ffmpeg）+ 剪映导出"重链路在 P1 即被真实业务覆盖；残余项：服务端合成按源项目 09-22 裁决暂停、本地直出为主，恢复启用时补验服务端路径 |
| key 泄露 | 高 | 仅服务端代理持 key；provider 固化 base_url |

## 附录 A：slot 清单（P0-V4 回填，2026-09-23 实机勘察）

**勘察方式**：真实 Chromium 工作台（IAB）+ node_modules slot 注册枚举。

**宿主侧结论**：渲染挂载点只有 `renderSlot('root')` 一个总口——**无大面积/主界面级 slot**。P1 UI 形态最终定为（2026-09-23 用户确认）：**会话标题栏右侧挂"运营工具/媒体工具"入口，落点 `conversation.session.header.actions` slot**（现成插件 slot，conversation 包 renderSlot 渲染，jobs/schedule/subagent 先例），点击展开工具面板/页。

**可用 slot 名录（实读 + 活验证）**：

| slot | 面积 | 证据 | 用途归属 |
| --- | --- | --- | --- |
| `conversation.session.header.actions` | 会话标题栏右侧操作区 | conversation 包 renderSlot 实证，jobs/schedule/subagent 挂入先例 | **运营工具/媒体工具入口（最终形态）** |
| `sidebar.panellist` | 左侧栏面板列表 | `dsh-client-ui-sidebar/lib/client.js:123` renderSlot + :350 订阅（他人定制"工作台"区实证） | 业务入口面板（备选） |
| `sidebar.right.pane.tab` / `sidebar.right.tab.*` | 右侧栏自定义 tab | sidebar-right 包 slot | 工具页展开（备选） |
| `settings.section` | 整分区 | 活验证："插件市场"分区即 market-installer 贡献 | TinTin 设置分区候选 |
| `settings.plugin.item` | 插件卡 | 活验证："生图工具"卡在插件配置列表（image-generation） | 各插件设置卡（WP-5） |
| `settings.plugins.tab` | 分区 tab | market-installer/client.js:685-710 | |
| `conversation.input.accessory` | 输入区附件位 | ppt adapter 用例（patch 新增） | **WP-5b 业务上下文条（产品/素材/脚本/音色选择器）** |
| `conversation.composer.dock` / `conversation.hero.modeActions` | 编排区/首页动作 | ppt adapter 用例（patch 新增） | 备选 |
| `conversation.chat.node` | 对话流自定义节点 | image-generation client.js:300 | 进度/产物节点 |
| `sidebar.brand.mark/name`、`conversation.hero.brand.mark` | 品牌位 | 本 fork client-ui 已占用（TinTin 品牌） | 品牌 |

**勘察时顺带的两项活验证**：
- **V3 ✅**：模块图含 tintin-bundle；工作台 renderer 同源 `fetch('/tintin/ping')` → 200 JSON（client module 加载 + 模块图注册 + 同源鉴权链全通）。
- **A4 重大修正**：上游 UI **自带中文词典**（"新建会话/搜索会话/选择工作区/稍后配置"等字符串在上游包内，之前静态 grep `'zh'` 键漏判）；工作台跟随系统语言已全中文，语言选择器在位。zh 词典工作量从"全界面翻译"缩为"补齐缺口"（词典行仍后置，启动时先差量盘点上游已覆盖/未覆盖的键）。内测声明弹窗与模型接入引导里残留 "DeepSeek Harness" 字样——品牌文案项（非 slot 问题）。
- 中文字体渲染与上游 font-family 一致（A4-⑦ 实测通过，无需补字体资产）。

## 附录 B：升级成本备忘（P0-V8 回填，2026-09-23）

**实战演练素材**：合并上游 `origin/main` 69705b2（#539 删 Green Pulse PPT 模板 + #530 重做插件恢复页/安全模式管理器）。

| 项 | 实测结果 | 经验 |
| --- | --- | --- |
| 补丁重放（28 个） | **28/28 干净套用，零重做**——上游改动集中在 `packages/ppt-runtime`，不触及任何补丁覆盖的上游 `node_modules/@deepseek-ai/*` 包 | 补丁面与上游"插件内改动"天然隔离；真正的升级风险在补丁打到的上游包被改时（届时逐个重做，不机械修上下文） |
| 源码合并冲突 | 4 文件交集，1 个真冲突（恢复页文案区），git 自动合掉 3 个 | fork 定制面（品牌/身份/渠道字符串）与上游结构改动天然错开；冲突点可预料 |
| lockfile | 1 冲突块（PPT tarball integrity）；正确解法 = **取上游 lockfile + npm install 补回 tintin-bundle 链接**，勿手工解 | file: tarball 升级后必须强制重装刷新 node_modules 缓存（npm 对 tarball 不自动刷新——本次 ppt-activation 假失败的根因） |
| 合并后验证 | 补丁重放 + typecheck + 全量测试回基线（9 环境性失败/1114 通过，零新增） | 合并后门禁矩阵全跑一遍即可定位回归 |

**升级节奏建议**：跟随 latest/next 通道；每次升级按 docs/harness-*-upgrade.md runbook + 本附录流程（补丁重放 → 冲突面评估 → 强制重装 file: tarball → 全量门禁）。

## V13 记录（2026-09-23）：machine-id 派生输入实读 SRC `machine-id.js` = hostname + networkInterfaces(MAC) + platform + createHash，**无应用名参与**——同机新老客户端理论同 ID（X-Machine-ID 租户连续性成立）。**✅ 端到端比对完成（2026-09-23）**：SRC 原版（CJS）与移植版（lib/machine-id.js ESM）同机各跑一次，machine_id 完全一致（`fbecd90627372842`），派生输入（hostname/mac/cpu）逐项一致——服务端注册与任务归属在新客户端无缝衔接。V13 关闭。

## 附录 C：SRC 模块地图（搬运索引）

- 主进程 76 文件 ~22.9k 行；渲染层 ~66k 行；IPC 240 通道/48 域；桥 `window.tintin` ~30 方法域。
- 媒体 14 卡/运营 6 卡组件路径：见架构文档 §1 与主方案；浏览器域 `thickShell-ipc`/`browser-window`/`ext-manager`/`extractors`/`auto-listing`/`hotspot-capture` ~7k 行 → P2 壳层。
- 契约链原样保留：`openapi-latest.json` → `contract:gen` → `api-contract.generated.ts`；`scripts/verify-contract.js`、`audit-ipc-consumers.js` 一并搬入 tintin 包构建。

## 附录 D：功能点清单与处置（2026-09-23 建档；处置变更须记录裁决日期）

> 处置图例：P1/P2/P3=移植批次｜替换=harness/上游原生能力替代｜**废用=不移植·入口过期废用**｜缓议=需产品再裁决。路径均相对 SRC `desktop/renderer/src`（UI）或 `desktop/main`（主进程）。每卡完成定义见 §6 测试策略（L1~L4 全绿）。

### 工作台域

| 功能点 | 源 | 处置 | 备注 |
| --- | --- | --- | --- |
| 会话/消息流/输入框/审批 | `views/Workbench.vue` + `components/workbench/Wb*.vue` | **复用 harness 会话 UI**（2026-09-23 修正：换编排引擎不换会话形态） | 会话外壳沿用 harness，业务组件挂 slot |
| 业务上下文选择器（产品/素材/脚本/音色） | `WbPick*.vue` + `useWorkbenchPickers` | P1（WP-5b 会话输入区 accessory slot） | → task.json |
| 智能体切换（总助手/编导/制作/质检/素材库） | SRC 人设/角色逻辑 | P1（WP-5c harness preset） | 人设按 dsh 重写不照搬 |
| 识图/视觉研判 | 服务端 `/llm/vision` 调用 | P1（WP-5d 工具内服务端路由） | 不经对话 LLM |
| 定时任务（面板+本地调度） | Wb 抽屉 + `main/local-scheduler.js` | P2 按需 | schtasks 逻辑搬 host |
| 通知中心/任务队列 | `Wb*.vue` + `useWorkbenchTask*` | 替换 + jobs 路由供数 | `/tintin/jobs/*` |
| 技能广场 | `skill-store.js` + `skills-server-ipc.js` | 替换 | text-storyboard/viral-writer 转 SKILL.md（P2） |

### 媒体工具（原 14 卡）

| 功能点 | 源 | 处置 | 备注 |
| --- | --- | --- | --- |
| **智能混剪** | `VideoMontage.vue` + `MontageStep1-4Panel` + `composables/montage/*` | **废用（2026-09-23 裁决：永久不移植，产品入口标记过期废用；功能本就计划过期，以降低移植复杂度——用户说明）** | 剪映导出/花字/合成等共享纯逻辑模块随 WP-1 保留，供文案混剪等卡复用 |
| 文案混剪 | `copywriting-montage/`（CopywritingMontage + CopywritingStep1-4Panel + CopywritingStoryboard + CopywritingBgmPickDialog，组件+composables 约 24 文件；2026-09-23 源仓库三连提交落定最终前缀） | **P1（2026-09-23 追加裁决：与剪映模板同为媒体首批两卡）** | "本地合成+剪映导出"重链路燃烧在 P1 完成；服务端合成按源项目 09-22 裁决暂停、本地 ffmpeg 直出为主 |
| 音频生成 | `AudioGen.vue` | **已移植（2026-09-25 用户裁决随产品资料批次）**：列表语义搜索/服务端分类过滤/试听/行内下载/删除 + BGM/音效生成（生成即归档 + 一键入库） | /tts、/audio；随卡出清 PENDING 三通道（downloadTemp/archiveGen/bgmUpload）；行内下载经新增桌面壳 save-file-picker 原生保存桥 |
| 声音克隆 | `VoiceClone.vue` + `useVoiceCloneStudio` | P2（2026-09-23 裁决移出 P1） | 铁律起源案例，L4 回归重点 |
| 视频转文字 | `VideoTranscribe.vue` | P2（2026-09-23 裁决移出 P1） | /asr + 转写队列 |
| 分镜脚本创作 | `ops-tools/OtStoryboard.vue` | P2 | 搬运时归位 media 目录 |
| 剪映模板 | `JianYingTemplates.vue` + `main/jianying-templates.js` | **P1（2026-09-23 追加裁决）** | 依赖剪映互通产物（WP-1 随迁） |
| 仿爆款 | `ViralClone.vue` | P2 | /viral/clone 全家 |
| 直播切片 | `LiveClip.vue` + `main/liveclip-ipc.js` | P2 | 本地重流水线 |
| 视频去水印字幕 | `SubtitleRemoval.vue`（+VsrFrameScrubber） | P2 | /vsr |
| 参考视频下载 | `VideoDownload.vue` + `main/ytdlp-*` | **已移植（2026-09-25 用户裁决，随独立浏览器窗口）**：解析→档位下载→归一化→保存到本机 | 本地重；yt-dlp 登录态=浏览器 tab 分区导出 cookies |
| 图像抠图 | `ImageMatting.vue` | **已移植（2026-09-25 用户裁决提前，随产品资料一并）**：/matting 同步契约，宿主 rembg:submit 落盘原图旁 | /matting；预览经 media:unlock 单文件登记 |
| 封面制作（wip） | `CoverMaker.vue` | 缓议 | 产品定优先级 |
| 视频修复（wip） | `VideoRepair.vue` | 缓议 | /vsr |
| 花字（混剪内嵌能力） | `main/fancy-templates.js` + `resources/fancy/` | 随共享逻辑保留 | 呈现形态随文案混剪定 |

### 运营工具（6 卡，P3——2026-09-23 A1 裁决"运营工具三期"）

| 功能点 | 源 | 处置 | 备注 |
| --- | --- | --- | --- |
| 产品资料 + 文案面板 | `OtProductLibrary.vue` + `OtCopywritingPanel.vue` | **已移植（2026-09-25 用户裁决提前于 P3，挂媒体包 'ops' 视图提供方）**：仓库同步/树/增删改/智能挖掘/全量挖掘/文案生成 | /product-library 族；Excel 导入导出仍待 SheetJS 批次；文案「前往分镜」写入 pendingStoryboard 信号（分镜卡 P2 消费） |
| 图片反推提示词 | `media-tools/ReversePromptImage.vue` | P3 | /prompt/image，归位 ops 目录 |
| 视频反推提示词 | `media-tools/ReversePromptVideo.vue` | P3 | /prompt/video，归位 ops 目录 |
| 视频评价预测 | `OtVideoScore.vue` + `main/video-prediction-store.js` | P3 | 本地记录库搬 host 存储 |
| 视频营销检测 | `OtVideoMarketing.vue` | P3 | |
| 我的知识库（planned） | `OtKnowledgeBase.vue` | 缓议 | 源项目未启动 |

### 浏览器域（壳层实现，三层形态见架构文档）

| 功能点 | 源 | 处置 | 备注 |
| --- | --- | --- | --- |
| 平台 DOM 抽取（B站/抖音/快手/微信/小红书） | `main/extractors/*.ts` | P2/P3 | 引擎进 `src/main/tintin/browser/` |
| 浏览器扩展管理（B站助手/抖音插件） | `main/ext-manager.js`、`bilibili-ext.js` + `assets/` | P2/P3 | |
| 自动上架 | `main/auto-listing/*` | P3 | 隐藏浏览器自动化 |
| 热点采集 | `main/hotspot-capture.js` | P3 | |
| 下载嗅探/下载管理 | `main/download-manager.js`、`media-storage.js` | P3 | |
| 厚壳多窗口/浮动面板 | `thickShell-*`、`browser-window.js`、`*-panel.html` | 形态变更 | overlay/独立面板窗口 |

### 主进程与基础设施

| 功能点 | 源 | 处置 | 备注 |
| --- | --- | --- | --- |
| server-proxy / machine-id | `main/server-proxy.js`、`machine-id.js` | P1（WP-1 近 1:1） | 租户隔离，X-Machine-ID |
| ffmpeg / yt-dlp 门控 | `ffmpeg-gate.js`、`ytdlp-gate.js` | P1（WP-1） | TINTIN_BIN_DIR |
| 剪映草稿读写族 | `jianying-*.js` | P1 保留（共享逻辑） | 供文案混剪等复用 |
| 剪映音频素材自动同步 | `jianying-audio-sync.js`（2026-09-22 新增：内置定时任务，本机剪映音效/音乐增量上传服务端音频库） | P2 随剪映族 | 定时器+扫描+上传编排，host 化候选；纯扫描逻辑可测（源模块已按铁律 8 分层） |
| Office 预览导出 | `office-ipc.js` | P2 按需 | |
| 飞书集成 | `feishu-ipc.js` | P2 按需 | |
| 本地 AI（ONNX/OCR/向量库） | `model-manager.js`、`inference-router.js` 等 | 缓议 | 服务端在线为前提 |
| 技能包管理 | `skill-store.js`、`skills-logic.js` | 替换 | harness 技能机制 |
| 素材入库/每日素材/创作者库/抖音解析 | `material-import.js`、`daily-assets.js`、`creators-store.js`、`douyin-parse-logic.js` | P2 | 服务端数据为主 |
| 托盘/更新/自启动/激活 | `tray.js`、`updater.js`、`platform-ipc.js` | 替换（上游壳） | license 体系保留对接 |

## 附录 E：待裁决与未验证清单（2026-09-23 自查建档；随裁决/验证回填）

> 背景：此前产品级取舍多从主方案快照/源码现状推断（混剪废用与更名风波证明二者均不可信），本清单把所有未决项显式化。**A 类须用户裁决后才可依赖；B 类排入对应 P0/P1/P2 验证。**

### A. 待用户裁决

| # | 事项 | 影响 | 状态 |
| --- | --- | --- | --- |
| A1 | 功能范围——**已裁决（2026-09-23）**：P1 = 文案混剪 + 剪映模板 + 会话内设置及其依赖（地基/桥/契约链）；其余媒体卡 P2 占位等排期；**运营工具 6 卡 P3**；智能混剪永久废用（功能本就计划过期，2026-09-23 用户说明）。卡片占位形态（灰色占位/隐藏）实现时确认 | 范围/排期 | **已裁决** |
| A2 | 过渡与迁移——**已裁决（2026-09-23）**：仅老用户**配置数据**迁移（CardLocalConfig 族：服务器地址等）；素材/草稿/任务/会话一律不迁；老客户端停止发布（硬切换，无双开窗口） | 发布计划 | **已裁决** |
| A3 | 分发——**已裁决（2026-09-23）**：内部运营团队、内部分发；appId 改（已入 WP-1）；老客户端停止。**渠道切断已实施（同日，见 §4 既定裁决）**；残留小项（首次发版前定）：TinTin 真实更新端点（策略+feed+crash）、Windows 签名策略（内部分发可暂容忍无签名） | 发布工程 | **已裁决，渠道已切断** |
| A4 | harness UI 中文化——**已裁决（2026-09-23）**：①默认中文；中文数据由**定制版自身内置**（fork 出厂能力，非第三方插件外挂；翻译跟版纳入升级流程）②跨包注册可行性进 P0（V14）③预置 zh + 保留用户切换 ④全界面翻译，需单独处理的细节后置 ⑤systemPrompt 固化"始终中文回复" ⑥中文术语表一次定表全局一致 ⑦字体与上游 font-family 保持一致（实测不合格才补）⑧插件自身文案仅 zh，国际化以后再补。**追加裁决（同日·优先级栈）：功能移植 > 默认中文 > 中文词典 > 国际化（不考虑）**——zh 词典后置、不与功能移植抢资源、不进 P1 验收；V14 降为 P0-V4 勘察顺带项不作闸门；仅保留 WP-5 零成本预置项（预置 zh/中文回复/插件仅 zh） | 全部用户体验 | **已裁决** |
| A5 | 会话历史——**已裁决（2026-09-23）：不迁** | 数据迁移 | 已裁决 |
| A6 | onboarding——**已裁决（2026-09-23）：暂不做自有 onboarding**，沿用 dsh 原生引导 | onboarding | 已裁决 |
| A7 | 配色——**已裁决（2026-09-23）：统一 token**（TinTin 卡片与 harness 主题统一；用户答复原文"配音统一token"，依 A7 上下文记为配色，如有出入请纠正） | 视觉一致性 | 已裁决 |
| A8 | 源仓库策略——**已裁决（2026-09-23）：跟进制，不冻结**（否决 tag 基线建议）：SRC 新改也跟进，SRC 侧将逐渐减少修改。实施纪律见 §0（每包记录 SRC commit、变更重同步、切换前终同步） | 漂移返工 | **已裁决** |

### B. 技术未验证/未设计

| # | 事项 | 落点 | 状态 |
| --- | --- | --- | --- |
| B1 | `/tintin/ipc` 文件操作路由的路径白名单/沙箱（防穿越/任意读写） | WP-1 安全设计，L3 测试 | **必须补**（2026-09-25 注记：server:*/upload 已限 API 面；/tintin/media 白名单根 + `media:unlock` 用户显式单文件登记（FIFO 512）覆盖用户自选目录预览，登记只能由受信渲染层发起） |
| B2 | 内网 HTTPS/自签证书下 provider 的 CA 信任 | P0-V11 前验证 | 未验 |
| B3 | harness CSP 对插件注入样式/字体（iconfont）兼容 | 并入 WP-3 首周验证项 2 | 未验 |
| B4 | 磁盘管理：合成产物/媒体缓存目录规划与清理策略 | WP-1 设计 | 未设计 |
| B5 | 契约同步：源项目 openapi-latest.json → tintin 包 contract:gen 的输入与两仓库同步流程 | WP-1/L2 | 未定 |
| B6 | machine-id 连续性：同机新老客户端同 ID（输入为 os/mac，理论稳定） | P0 实测项 V13 | 待实测 |
| B7 | renderer 性能预算：agent 回路+Vue 子应用+媒体流内存水位、大素材列表 | WP-3 验收加观测 | 未测 |
| B8 | zh 词典跨包注册可行性：插件身份为上游 UI key 注册 zh 数据是否生效（A4 前置闸门；不生效则中文化改走 patch，需重新裁决） | **P0-V14** | **范围缩减（2026-09-23 实机勘察）：上游已自带中文，词典降级为补缺口；跨包注册验证仍留作词典启动前置** |
| B9 | 工作区目录桥在 harness http 页面不可用：壳 preload 注入 `window.dshDesktopDirectoryPicker`（src/preload/index.ts:151），但 harness UI（loadURL http://127.0.0.1）页里报 "bridge is unavailable"（补丁改的 directory-picker-native client.js:60-64 检测）。纯 web 实例与完整壳（npm run dev，sandbox:true preload）**均复现**。**2026-09-23 已通过默认工作区旁路**：用户裁决默认工作区 `Documents\tintin-workspace`，经 RPC `workspace/create`（payload `{args:{request:{path}}}`）直接注册，绕过 UI 目录选择器——会话/推理/沙箱全部可用。GUI 目录选择器的桥修复降为独立项（P1 用户自选目录时仍需） | GUI 桥定位（P1 再修） | **已旁路（默认工作区）；GUI 桥修复待 P1** |
