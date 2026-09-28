// test/tintin-voice-tts-pron.test.ts — TTS 读音标注第 0 步回归。
// 2026-09-28 实机事故：文案 "Blue VO!CE"（罗技麦克风营销拼写）被逐字母读——
// 标注机制「字母串(读法)」的字母串定义被 `!` 切断、读法不容空格，标注失效。
import { describe, expect, it } from 'vitest'
import { preprocessTtsText } from '../packages/tintin-bundle/lib/montage/voice-tts-logic.js'

describe('tts 读音标注（preprocessTtsText 第 0 步）', () => {
  it('标注括号内的字母串允许内嵌 !（品牌营销拼写）', () => {
    expect(preprocessTtsText('VO!CE(blue voice)')).toBe('blue voice')
    expect(preprocessTtsText('Blue VO!CE(蓝色 威斯)')).toBe('Blue 蓝色 威斯')
  })

  it('读法允许空格（多词读法）', () => {
    expect(preprocessTtsText('VO!CE(blue voice)')).toBe('blue voice')
    // 标注只作用于紧贴的字母/数字串（"PRO X 2" 中仅 "2" 紧贴括号——空格断链是既有口径）；
    // 替换后剩余的 "PRO" 仍走既有全大写逐字母拆分
    expect(preprocessTtsText('PRO X 2(普罗艾克斯二)')).toBe('P R O X 普罗艾克斯二')
  })

  it('既有口径不回归：数字读法与逐字母拆分', () => {
    expect(preprocessTtsText('555(三五)电池')).toBe('三五电池')
    // 无标注的全大写缩写仍逐字母拆分（含被 ! 切断的段）
    expect(preprocessTtsText('Blue VO!CE')).toBe('Blue V O!C E')
  })

  it('普通感叹句无标注括号时不受影响', () => {
    expect(preprocessTtsText('STOP!')).toBe('S T O P!')
    expect(preprocessTtsText('很好!(注释)')).toBe('很好!(注释)') // 中文串不参与标注
  })
})
