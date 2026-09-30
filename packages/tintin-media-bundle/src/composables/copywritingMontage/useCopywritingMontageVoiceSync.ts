// ═══════════════════════════════════════════════════════════════
// useCopywritingMontageVoiceSync.ts — 文案混剪口播音频跨机同步·编排壳
// （2026-09-30 用户裁决 B：克隆产物 wav 上传服务端音频库、应用脚本后按 id 下载
//  回填。附加/提取纯函数在 copywritingMontageVoiceRefLogic.ts；本模块只做 IPC
//  桥接与 tab 状态回写，自 useCopywritingMontageStep3Voice.ts 分离以控其行数
//  ——铁律 10：新文件 ≤1000 行，宿主文件只留接缝。依赖经参数注入，不持状态。）
// 契约：上传 POST /audio/library/upload（category=口播→服务端归一「配音」池，
//  四值枚举别名表 2026-09-30 服务端口径）；下载 GET /audio/library/{id}/file。
// ═══════════════════════════════════════════════════════════════
import { clientError } from '../../utils/clientLog'
import { notify, errText, joinPath, unwrapIpc } from './context'
import { readCacheDir } from '../useSettingsConfig'

/** 编排壳所需的最小 tab 结构（StoryboardTab 结构性满足；voiceAudioId 由本模块维护） */
export interface VoiceSyncTab {
  id: string
  scriptId: string
  voiceWav: string
  voiceDurSec: number
  voiceAudioId: string
}

/** 上传单个 tab 的克隆产物到服务端音频库，成功回写 tab.voiceAudioId。
 *  best-effort：失败仅打点不抛出——脚本仍同步，只是该 tab 无口播引用，
 *  重新批量克隆即可重建（旧库条目自然遗留，tags 带 scriptId 可溯源）。 */
export async function uploadTabVoiceWav(tab: VoiceSyncTab): Promise<void> {
  if (!tab.voiceWav) return
  try {
    const up = unwrapIpc<Record<string, unknown>>(
      await window.tintin.server.audioLibraryUpload({
        filePath: tab.voiceWav,
        category: '口播',
        tags: tab.scriptId ? `文案混剪 script_${tab.scriptId}` : '文案混剪',
      }),
      '口播音频上传')
    const id = Number(up.id)
    if (Number.isInteger(id) && id > 0) tab.voiceAudioId = String(id)
  } catch (e) {
    clientError('copywriting-montage', '口播音频上传失败', errText(e))
  }
}

export interface VoiceRestoreDeps {
  ensureServerUrl: () => Promise<string>
  getServerUrl: () => string
  /** 响应式代理查找（2026-09-30 实测教训：直接写 addStoryboardTab 返回的原始
   *  对象不触发依赖更新，须经 storyboards.value 重新解析出代理再写） */
  findTab: (id: string) => VoiceSyncTab | undefined
}

/** 应用脚本后按 voice_audio_id 从音频库下载回填 tab.voiceWav。
 *  本地已有克隆产物不覆盖；落缓存与克隆产物同目录口径（copy-montage/voice/，
 *  文件名按脚本 id 稳定，重启/重复应用幂等覆盖）；失败 best-effort：打点+提示。 */
export async function restoreTabVoiceFromLibrary(
  tab: VoiceSyncTab,
  audioId: string,
  durSec: number,
  deps: VoiceRestoreDeps,
): Promise<void> {
  if (!audioId || tab.voiceWav) return
  try {
    await deps.ensureServerUrl()
    const base = deps.getServerUrl().replace(/\/$/, '')
    const url = `${base}/audio/library/${encodeURIComponent(audioId)}/file`
    const dl = unwrapIpc<{ path: string }>(
      await window.tintin.server.audioDownloadTemp({ url, prefix: 'voice_', defaultExt: '.wav' }),
      '口播音频下载')
    if (!dl.path || typeof dl.path !== 'string') throw new Error('下载未返回文件路径')
    const cacheDir = await readCacheDir()
    if (!cacheDir) throw new Error('本地缓存目录不可用，请重启应用后重试')
    const stableId = (tab.scriptId || tab.id).replace(/[^\w.-]/g, '_')
    const target = joinPath(cacheDir, 'copy-montage', 'voice', `voice_script_${stableId}.wav`)
    const saved = await window.tintin.server.ttsSaveAudio({ fromPath: dl.path, savePath: target })
    if (typeof saved !== 'string' || !saved) {
      throw new Error(typeof saved === 'object' && saved && 'error' in saved ? String(saved.error) : '落盘失败')
    }
    const live = deps.findTab(tab.id) ?? tab
    live.voiceWav = target
    live.voiceDurSec = Math.max(0, durSec)
    live.voiceAudioId = audioId
    notify('口播已恢复', '脚本携带的口播音频已从服务端音频库下载回填；重新「批量克隆」可覆盖。')
  } catch (e) {
    clientError('copywriting-montage', '口播音频恢复失败', errText(e))
    notify('口播恢复失败', `${errText(e)}——可重新「批量克隆」生成本地口播。`)
  }
}
