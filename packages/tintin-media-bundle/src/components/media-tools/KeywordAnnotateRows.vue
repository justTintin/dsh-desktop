<script setup lang="ts">
// KeywordAnnotateRows.vue — 字幕关键词标注面板（2026-09-23 用户裁决）
// 每视频一块：字幕段横向平铺（时间戳+文本），命中词按词表序彩色标注。
// 选中文字→右键「标注为关键词」，右键彩色词→「取消标注」。
// 变色为本地乐观更新（立即生效），同时上报父层持久化（localStorage+预览轨重刷）。
import { ref, reactive, watch, onMounted, onUnmounted } from 'vue'

export interface KeywordAnnotateTrack {
  key: string
  name: string
  durationSec: number
  rows: Array<{ text: string; start: number; end: number }>
  hits: Array<{ text: string; start: number; end: number }>
  words: string[]
  /** 按位置的手工标注（2026-09-24 用户裁决①②）：只作用于选中位置 */
  occs: Array<{ rowStart: number; text: string }>
}
const props = defineProps<{ tracks: KeywordAnnotateTrack[] }>()
const emit = defineEmits<{
  (e: 'add', planKey: string, rowStart: number, word: string): void
  (e: 'removeOcc', planKey: string, rowStart: number, word: string): void
  (e: 'remove', planKey: string, word: string): void
}>()

function fmt(t: number): string {
  const s = Math.max(0, Number(t) || 0)
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`
}

// ── 本地词表（乐观更新）：trackKey → 词表。add/remove 先改本地立即变色，
//  同时 emit 给父层持久化；父层权威刷新（props.words 变化）后整体覆盖同步。──
const wordsByKey = reactive<Record<string, string[]>>({})
function wordsOf(key: string, fallback: string[]): string[] {
  return wordsByKey[key] ?? (fallback || [])
}
function syncFromProps(): void {
  for (const t of props.tracks) {
    if (!(t.key in wordsByKey)) wordsByKey[t.key] = [...(t.words || [])]
  }
}
watch(() => props.tracks, (tracks) => {
  // 父层权威刷新落地：覆盖为最新词表（含手工词，add/remove 已同步进存储）
  for (const t of tracks) wordsByKey[t.key] = [...(t.words || [])]
})
watch(() => props.tracks, syncFromProps, { immediate: true })

function hitWord(row: { text: string }, words: string[]): string {
  const t = String(row.text || '').toLowerCase()
  for (const w of words) {
    const k = String(w || '').toLowerCase()
    if (k && t.includes(k)) return String(w)
  }
  return ''
}
function seg(row: { text: string }, words: string[]): { pre: string; kw: string; post: string } {
  const t = String(row.text || '')
  const w = hitWord(row, words)
  if (!w) return { pre: t, kw: '', post: '' }
  const i = t.toLowerCase().indexOf(w.toLowerCase())
  return { pre: t.slice(0, i), kw: t.slice(i, i + w.length), post: t.slice(i + w.length) }
}

// ── 右键菜单：标注 / 取消标注 ──
const menu = ref({ show: false, x: 0, y: 0, planKey: '', word: '', rowStart: 0, mode: 'add' as 'add' | 'removeOcc' | 'remove' })
function openAdd(planKey: string, rowStart: number, rowText: string, e: MouseEvent): void {
  const sel = (window.getSelection?.()?.toString() || '').trim()
  // 必须是本段文本的非空子串（跨段选择不算），长度限 30
  if (!sel || sel.length > 30 || !rowText.includes(sel)) { menu.value.show = false; return }
  menu.value = { show: true, x: e.clientX, y: e.clientY, planKey, word: sel, rowStart, mode: 'add' }
}
function openRemove(planKey: string, word: string, e: MouseEvent): void {
  menu.value = { show: true, x: e.clientX, y: e.clientY, planKey, word, rowStart: 0, mode: 'remove' }
}
function confirmMenu(): void {
  const { planKey, word, mode, rowStart } = menu.value
  // 乐观更新本地词表（立即褪色），再上报父层持久化。add 走按位置标注（occ），
  // 不进词表——词表是全局着色（产品/LLM），会连带其它位置（2026-09-24 裁决①）。
  const cur = wordsByKey[planKey] || []
  if (mode === 'remove') wordsByKey[planKey] = cur.filter((x) => x !== word)
  if (mode === 'add') emit('add', planKey, rowStart, word)
  else if (mode === 'removeOcc') emit('removeOcc', planKey, rowStart, word)
  else emit('remove', planKey, word)
  menu.value.show = false
  try { window.getSelection?.()?.removeAllRanges?.() } catch (_) {}
}
function closeMenu(): void { menu.value.show = false }
// ── 按位置的手工标注（2026-09-24 用户裁决①②）────────────────────────
// 渲染：行上有手工标注（rowStart 匹配）→ 该行按标注文本着色（优先于词级命中）；
// 无标注的行 → 词级命中着色（产品/LLM 词，全局）。同词不同位置互不影响。
// 右键：行有手工标注 → 「取消本位置」；否则彩色词 → 「取消标注（拉黑该词）」；
// 纯文本 → 「标注为关键词（本位置）」。
function occForRow(tr: KeywordAnnotateTrack, rowStart: number): { rowStart: number; text: string } | undefined {
  return (tr.occs || []).find((o) => Math.abs(o.rowStart - rowStart) < 0.02)
}
interface RowPart { t: string; kw: boolean; kind: '' | 'occ' | 'word' }
function rowSegs(tr: KeywordAnnotateTrack, row: { text: string }): RowPart[] {
  const t = String(row.text || '')
  const occ = occForRow(tr, row.start)
  if (occ) {
    const i = occ.text ? t.indexOf(occ.text) : -1
    if (i >= 0) return [{ t: t.slice(0, i), kw: false, kind: '' }, { t: occ.text, kw: true, kind: 'occ' }, { t: t.slice(i + occ.text.length), kw: false, kind: '' }]
  }
  const s = seg(row, wordsOf(tr.key, tr.words))
  if (s.kw) return [{ t: s.pre, kw: false, kind: '' }, { t: s.kw, kw: true, kind: 'word' }, { t: s.post, kw: false, kind: '' }]
  return [{ t, kw: false, kind: '' }]
}
function rowRightClick(tr: KeywordAnnotateTrack, row: { text: string; start: number }, e: MouseEvent): void {
  const occ = occForRow(tr, row.start)
  if (occ) {
    menu.value = { show: true, x: e.clientX, y: e.clientY, planKey: tr.key, word: occ.text, rowStart: occ.rowStart, mode: 'removeOcc' }
    return
  }
  const w = hitWord(row, wordsOf(tr.key, tr.words))
  if (w) { openRemove(tr.key, w, e); return }
  openAdd(tr.key, row.start, String(row.text || ''), e)
}
onMounted(() => document.addEventListener('click', closeMenu))
onUnmounted(() => document.removeEventListener('click', closeMenu))
</script>

<template>
  <div class="kwar">
    <template v-if="tracks.length">
      <div v-for="(tr, ti) in tracks" :key="tr.key" class="kwar-track">
        <div class="kwar-track-head">
          <span class="kwar-track-name" :title="tr.name">第{{ ti + 1 }}条</span>
          <span class="kwar-track-meta">{{ tr.rows.length }} 段字幕 · 全长 {{ fmt(tr.durationSec) }}</span>
          <span class="kwar-track-hint">选中文字→右键标注为关键词；右键彩色词→取消标注</span>
        </div>
        <!-- 字幕段横向平铺：一段一个[时间戳+文本]，从左到右自动换行 -->
        <div class="kwar-flow">
          <span v-for="(row, ri) in tr.rows" :key="ri" class="kwar-seg"
            @contextmenu.prevent="rowRightClick(tr, row, $event)">
            <span class="kwar-ts">[{{ fmt(row.start) }}]</span><template v-for="(part, pi) in rowSegs(tr, row)"><span v-if="part.kw" :key="'k' + pi" class="kwar-kw"
              :title="'已标注（本位置）：' + part.t + '（右键取消标注）'">{{ part.t }}</span><span v-else :key="'p' + pi">{{ part.t }}</span></template>
          </span>
          <span v-if="!tr.rows.length" class="kwar-empty">该视频暂无字幕行（未配音或未生成 timing）</span>
        </div>
      </div>
    </template>
    <div v-else class="kwar-empty">完成上一步配音合成后，这里按视频逐条显示字幕文本，可标注关键词</div>
    <!-- 右键菜单（固定定位跟鼠标；点击页面其他处关闭） -->
    <div v-if="menu.show" class="kwar-menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
      @click.stop @contextmenu.prevent>
      <button class="kwar-menu-item" :class="{ danger: menu.mode !== 'add' }" @click="confirmMenu">
        {{ menu.mode === 'add' ? `标注为关键词（本位置）：「${menu.word}」` : menu.mode === 'removeOcc' ? `取消标注（本位置）：「${menu.word}」` : `取消标注（该词全部位置）：「${menu.word}」` }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.kwar { display: flex; flex-direction: column; gap: 12px; width: 100%; }
.kwar-track { display: flex; flex-direction: column; gap: 6px; }
.kwar-track-head { display: flex; align-items: baseline; gap: 10px; }
.kwar-track-name { font-size: 13px; font-weight: 700; color: var(--primary); }
.kwar-track-meta { font-size: 12px; color: var(--muted-foreground); }
/* 2026-09-30 用户反馈：提示要显眼但不要胶囊形态——主色加粗纯文字（无边框/底色/圆角） */
.kwar-track-hint {
  margin-left: auto; font-size: 12px; font-weight: 600; color: var(--primary);
  white-space: nowrap;
}
/* 字幕段横向平铺（2026-09-23 用户裁决：不再逐行纵向堆叠） */
.kwar-flow {
  display: flex; flex-wrap: wrap; align-content: flex-start;
  gap: 4px 16px; padding: 8px 10px;
  background: var(--surface-container); border-radius: var(--radius-md);
}
.kwar-seg { font-size: 13px; color: var(--foreground); user-select: text; cursor: text; }
.kwar-ts { font-size: 11px; font-weight: 700; color: var(--muted-foreground); font-variant-numeric: tabular-nums; margin-right: 2px; }
.kwar-kw {
  color: var(--primary); font-weight: 700; cursor: context-menu;
  background: color-mix(in srgb, var(--primary) 14%, transparent);
  border-radius: 4px; padding: 0 2px;
}
.kwar-empty { font-size: 12px; color: var(--muted-foreground); }
.kwar-menu {
  position: fixed; z-index: 1200; min-width: 180px; padding: 4px;
  background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius-md); box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
}
.kwar-menu-item {
  display: block; width: 100%; padding: 6px 12px; border: none; border-radius: var(--radius-sm);
  background: none; color: var(--foreground); font-size: 13px; text-align: left; cursor: pointer;
  white-space: nowrap;
}
.kwar-menu-item:hover { background: var(--surface-container); }
.kwar-menu-item.danger { color: var(--destructive, #e5484d); }
.kwar-menu-item.danger:hover { background: color-mix(in srgb, var(--destructive, #e5484d) 12%, transparent); }
</style>
