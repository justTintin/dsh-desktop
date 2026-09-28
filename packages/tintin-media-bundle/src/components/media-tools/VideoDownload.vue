<script setup lang="ts">
// VideoDownload.vue — 参考视频下载（SRC components/media-tools/VideoDownload.vue 1:1，
// 基线 9ca9050；2026-09-25 用户裁决随独立浏览器窗口一并启用）
// 两步流：粘贴链接解析 → 选档位下载。文案逐字对照 OpenCreator
// VideoDownloadWorkspace（文档《参考视频下载移植需求文档_OpenCreator_2026-09-07》第二节）。
// 渲染层零策略；行为在 useVideoDownload.ts（状态）+ 主进程 ytdlp-gate/ytdlp-logic。
import { computed } from 'vue'
import TButton from '@/components/common/TButton.vue'
import { useVideoDownload } from '@/composables/useVideoDownload'

const {
  url, probing, probeError, probeErrorCode, probeLoginCounts, probe, options, mediaType, downloads,
  analyze, resetProbe, openLoginBrowser, download, saveToLocal, formatDuration,
} = useVideoDownload()

const videoOptions = computed(() => options.value.filter((o) => o.mediaType === 'video'))
const audioOptions = computed(() => options.value.filter((o) => o.mediaType === 'audio'))
const visibleOptions = computed(() => (mediaType.value === 'audio' ? audioOptions.value : videoOptions.value))
const hasRunning = computed(() => downloads.value.some((d) => d.state === 'running'))
/** 已登录仍被拒（分区有登录态但平台仍要求登录）→ 引导风控口径而非重复登录 */
const loggedInButRejected = computed(() => {
  const counts = probeLoginCounts.value
  if (!counts) return false
  const n = /bilibili/i.test(url.value) ? (counts.bilibili ?? 0) : (counts.youtube ?? 0)
  return n > 0
})

function canDownload(optionId: string): boolean {
  return !hasRunning.value && !downloads.value.some((d) => d.url === (probe.value?.webpageUrl || url.value.trim()) && d.optionId === optionId && d.state !== 'error')
}
function openDir(path: string | undefined): void {
  if (path) void window.tintin.shell.revealInFolder(path)
}
</script>

<template>
  <div class="vd-page">
    <!-- Step0：公开视频链接（文案对照 OpenCreator Step0 逐字） -->
    <section class="card">
      <span class="sec-label">公开视频链接</span>
      <span class="hint">当前支持 YouTube 和 Bilibili 单个公开视频</span>
      <div class="row">
        <input
          v-model="url"
          class="input grow"
          placeholder="粘贴视频链接"
          aria-label="待下载视频链接"
          :disabled="probing || hasRunning"
          @keydown.enter="analyze()"
        />
        <TButton :label="probing ? '正在解析' : '解析链接'" :loading="probing" :disabled="hasRunning" @click="analyze()" />
      </div>
      <div v-if="probeError" class="error-msg">⚠ {{ probeError }}</div>
      <!-- login_required 分流（2026-09-28 用户裁决）：未登录→一键打开内置浏览器；已登录仍被拒→风控口径 -->
      <div v-if="probeErrorCode === 'login_required' && !loggedInButRejected" class="login-fix">
        <span class="hint">下载走的是 TinTin 内置浏览器的登录分区，系统浏览器（Chrome/Edge）的登录它读不到。点下方按钮在内置浏览器里登录，完成后回来重新「解析链接」即可。</span>
        <TButton label="打开内置浏览器登录" size="small" @click="openLoginBrowser()" />
      </div>
      <div v-else-if="probeErrorCode === 'login_required' && loggedInButRejected" class="login-fix">
        <span class="hint">已携带登录态仍被平台要求验证：多为平台风控（IP/请求频率），可稍后重试或更换网络。</span>
      </div>
    </section>

    <!-- Step1：视频信息 -->
    <section v-if="probe" class="card">
      <div class="info-row">
        <img v-if="probe.thumbnail" class="info-thumb" :src="probe.thumbnail" alt="" />
        <div v-else class="info-thumb info-thumb--empty">▶</div>
        <div class="info-main">
          <span class="info-platform" :class="probe.platform === 'bilibili' ? 'is-bili' : 'is-yt'">
            {{ probe.platform === 'bilibili' ? 'Bilibili' : 'YouTube' }}
          </span>
          <span class="info-title">{{ probe.title }}</span>
          <span class="hint">{{ probe.uploader }}<template v-if="probe.duration"> · {{ formatDuration(probe.duration) }}</template><template v-if="probe.resolution"> · {{ probe.resolution }}</template></span>
        </div>
        <TButton label="更换链接" plain size="small" :disabled="hasRunning" @click="resetProbe" />
      </div>
    </section>

    <!-- Step1：下载规格（分段 MP4/MP3 + 档位列表，首档「推荐」） -->
    <section v-if="probe" class="card">
      <div class="seg-row">
        <button class="seg-btn" :class="{ active: mediaType === 'video' }" @click="mediaType = 'video'">MP4 视频</button>
        <button class="seg-btn" :class="{ active: mediaType === 'audio' }" @click="mediaType = 'audio'">MP3 音频</button>
      </div>
      <div v-for="(opt, i) in visibleOptions" :key="opt.id" class="opt-row">
        <div class="opt-main">
          <span class="opt-label">{{ opt.label }}<span v-if="i === 0" class="opt-recommend">推荐</span></span>
          <span class="hint">{{ opt.detail }}</span>
        </div>
        <TButton
          :label="downloads.some((d) => d.url === (probe?.webpageUrl || url.trim()) && d.optionId === opt.id && d.state === 'done') ? '已完成 ✓' : '下载'"
          size="small"
          :disabled="!canDownload(opt.id)"
          @click="download(opt)"
        />
      </div>
      <div v-if="!visibleOptions.length" class="hint">该链接没有可用的{{ mediaType === 'audio' ? '音频' : '视频' }}规格</div>
    </section>

    <!-- Step1：本次下载（对照「项目文件」tab：行 + 阶段文案 + 进度条 + 打开目录/保存到本机） -->
    <section v-if="downloads.length" class="card">
      <span class="sec-label">本次下载</span>
      <div v-for="d in downloads" :key="d.key" class="dl-row">
        <div class="dl-main">
          <span class="dl-title">{{ d.title }} · {{ d.optionLabel }}</span>
          <span class="hint" :class="{ 'dl-error': d.state === 'error' }">
            {{ d.state === 'error' ? `⚠ ${d.error}` : d.phaseText }}
          </span>
          <progress v-if="d.state === 'running'" class="vd-progress" :value="d.pct" max="100" />
        </div>
        <div v-if="d.state === 'done'" class="dl-actions">
          <TButton label="打开目录" plain size="small" @click="openDir(d.path)" />
          <TButton label="保存到本机" plain size="small" @click="saveToLocal(d)" />
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.vd-page { display: flex; flex-direction: column; gap: var(--space-4); }
.card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-2); }
.sec-label { font-size: 13px; font-weight: var(--font-weight-semibold); color: var(--foreground); }
.hint { font-size: 12px; color: var(--muted-foreground); }
.hint.dl-error { color: var(--destructive, #e5484d); }
.row { display: flex; align-items: center; gap: var(--space-3); }
.grow { flex: 1 1 auto; min-width: 0; }
.input { height: 32px; padding: 0 10px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--background); color: var(--foreground); font-size: 13px; }
.error-msg { font-size: 12px; color: var(--destructive, #e5484d); }
.login-fix { display: flex; align-items: center; gap: var(--space-3); }

.info-row { display: flex; align-items: center; gap: var(--space-3); }
.info-thumb { width: 120px; height: 68px; object-fit: cover; border-radius: var(--radius-md); border: 1px solid var(--border); flex-shrink: 0; }
.info-thumb--empty { display: flex; align-items: center; justify-content: center; color: var(--muted-foreground); background: var(--surface-container); }
.info-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
.info-platform { align-self: flex-start; padding: 1px 8px; font-size: 11px; border-radius: var(--radius-sm); border: 1px solid var(--border); }
.info-platform.is-yt { color: #fff; background: #c00; border-color: #c00; }
.info-platform.is-bili { color: #fff; background: #fb7299; border-color: #fb7299; }
.info-title { font-size: 14px; font-weight: var(--font-weight-semibold); color: var(--foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.seg-row { display: flex; gap: 0; border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; width: fit-content; }
.seg-btn { padding: 5px 16px; font-size: 12px; color: var(--muted-foreground); background: transparent; }
.seg-btn.active { color: var(--primary-foreground); background: var(--primary); }
.opt-row { display: flex; align-items: center; gap: var(--space-3); padding: 8px 0; border-bottom: 1px solid var(--border); }
.opt-row:last-of-type { border-bottom: none; }
.opt-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
.opt-label { font-size: 13px; color: var(--foreground); display: flex; align-items: center; gap: 8px; }
.opt-recommend { padding: 0 6px; font-size: 11px; color: var(--primary); border: 1px solid var(--primary); border-radius: var(--radius-sm); }

.dl-row { display: flex; align-items: center; gap: var(--space-3); padding: 8px 0; border-bottom: 1px solid var(--border); }
.dl-row:last-child { border-bottom: none; }
.dl-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
.dl-title { font-size: 13px; color: var(--foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dl-actions { display: flex; gap: var(--space-2); flex-shrink: 0; }
/* 下载进度条（复用 vd-progress 配色，对照 Step1 split-progress 同款） */
.vd-progress { width: 100%; height: 6px; margin-top: 4px; }
</style>
