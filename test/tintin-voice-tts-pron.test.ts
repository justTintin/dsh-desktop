// test/tintin-voice-tts-pron.test.ts — TTS 读音标注第 0 步回归。
// 2026-09-28 实机事故：文案 "Blue VO!CE"（罗技麦克风营销拼写）被逐字母读——
// 标注机制「字母串(读法)」的字母串定义被 `!` 切断、读法不容空格，标注失效。
import { describe, expect, it } from 'vitest'
import {
  preprocessTtsKeepingPause,
  preprocessTtsText,
} from '../packages/tintin-bundle/lib/montage/voice-tts-logic.js'

describe('tts 品牌读音词典（免标注自动读对）', () => {
  it('Blue VO!CE 无标注也读对（2026-09-28 用户实机文案原样）', () => {
    expect(preprocessTtsText('Blue VO!CE降噪一开')).toBe('Blue Voice降噪一开')
    // 词典已替换 VO!CE 时，同形标注括号消费后读法仍正确（双写不叠加错误）
    expect(preprocessTtsText('Blue VO!CE(blue voice)')).toBe('Blue blue voice')
  })
})

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
    // 词典内的品牌拼写无标注也读对（2026-09-28 需求：免标注自动读对）
    expect(preprocessTtsText('Blue VO!CE')).toBe('Blue Voice')
    // 词典外的怪拼写仍逐字母拆分（读音标注括号是这类词的正路）
    expect(preprocessTtsText('XQ!AB')).toBe('X Q!A B')
  })

  it('普通感叹句无标注括号时不受影响', () => {
    expect(preprocessTtsText('STOP!')).toBe('S T O P!')
    expect(preprocessTtsText('很好!(注释)')).toBe('很好!(注释)') // 中文串不参与标注
  })

  it('统一入口 preprocessTtsKeepingPause：所有克隆文案强制过归一化（tts:generate 同口径）', () => {
    // 无停顿标记 = 直接归一化
    expect(preprocessTtsKeepingPause('VO!CE(blue voice)上架了')).toBe('blue voice上架了')
    // 停顿标记原样保留，两侧段落各自归一化（2026-09-08 服务端停顿约定）
    expect(preprocessTtsKeepingPause('PRO X 2(普罗)上市。((pause=500))555(三五)电池'))
      .toBe('P R O X 普罗上市。((pause=500))三五电池')
  })
})
