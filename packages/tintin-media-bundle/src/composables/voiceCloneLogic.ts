// ═══════════════════════════════════════════════════════════════
// voiceCloneLogic — 声音克隆 LLM 提示词/响应解析（纯函数，无 vue/IPC 依赖）
// 业务对齐 M3（条目④）：对照原客户端 studio/gui/voice_clone_page.py：
//   · PunctuationLLMWorker prompt L49 / 代码围栏剥离 L51-52（转写取词标点优化）
//   · transcription_page._show_rewrite_dialog 洗稿消息构造 L630-642
//
// 2026-09-29 拆句机器整体退役（只减不增）：原 _split_text_into_sentences /
// _estimate_max_chars / _merge_short_fragments / _validate_llm_split /
// SentenceSplitterLLMWorker prompt 随逐行模式删除一并移除——2026-09-29 用户
// 报障实证：品牌词「Blue VO!CE」被半角 '!' 当句读跨任务切碎（两段独立音频，
// 服务端品牌读音词典对碎片文本必然失配），整体克隆整段直发是唯一正确口径，
// 客户端不得再拆 TTS 文本。
// ═══════════════════════════════════════════════════════════════

/** PunctuationLLMWorker 系统提示词（对照 voice_clone_page.py L49 原文） */
export const PUNCTUATION_SYSTEM_PROMPT =
  '你是一个智能语音识别文本后处理助手。你的任务是给一段没有标点符号的语音识别文本添加合理的标点符号（，。！？：等），并进行合理的断句，使阅读更清晰自然。请绝对不要修改、增加或删除原文本的任何字词（只允许增删标点符号），直接输出加上标点后的纯文本，不要有任何多余的解释或包裹标记。'

/** /llm/chat/completions 响应 → 文本（choices[0].message.content，防御解析） */
export function extractLlmContent(resp: unknown): string {
  const r = resp as { choices?: Array<{ message?: { content?: unknown } }> } | null
  const content = r?.choices?.[0]?.message?.content
  return typeof content === 'string' ? content : ''
}

/** 洗稿消息构造（对照 transcription_page._show_rewrite_dialog L630-642；temperature=0.7 由调用方传） */
export function buildRewriteMessages(
  hint: string,
  originalText: string,
): Array<{ role: 'system' | 'user', content: string }> {
  const system =
    '你是一个短视频文案改写专家。请根据用户提供的原文案，' +
    '生成一篇主题相同、内容相近、字数相差不大的新文案。' +
    '保持原有的口播节奏与信息密度，只做表达优化。' +
    '直接输出新文案正文，不要任何解释、编号或 markdown 包裹。'
  const req = (hint || '').trim() || '与原文主题一致，字数相近'
  const user = '原文案：\n' + originalText + '\n\n改写要求：' + req + '\n\n请输出改写后的文案。'
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}
