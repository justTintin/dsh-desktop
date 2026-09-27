// test/tintin-copywriting-storyboard-name.test.ts — 分镜 tab 名·保存回学规则回归
// 2026-09-25 用户报障「脚本已保存 tab 还叫脚本 1」后裁决：保存成功后 tab 名
// 回学选题——仍是默认「脚本N」才回学，用户双击重命名过的名字保留。
// 源项目（SRC useCopywritingMontageStep3Voice.ts:989 同款）保存也不回学名，
// 本规则为两边之上的新裁决。
import { describe, expect, it } from 'vitest'
import {
  isAutoStoryboardName,
  storyboardNameAfterSave,
} from '../packages/tintin-media-bundle/src/composables/copywritingMontageStep3VoiceLogic'

describe('isAutoStoryboardName（默认「脚本N」判定）', () => {
  it('脚本1/脚本12 命中；含内嵌空格的「脚本 1」按既有正则属用户命名不命中', () => {
    expect(isAutoStoryboardName('脚本1')).toBe(true)
    expect(isAutoStoryboardName('脚本12')).toBe(true)
    expect(isAutoStoryboardName(' 脚本3 ')).toBe(true) // 首尾空白 trim 后命中
    expect(isAutoStoryboardName('脚本 1')).toBe(false) // 内嵌空格≠自增默认名（保守：视为用户命名不覆盖）
  })

  it('用户重命名/选题名/空值 不命中', () => {
    expect(isAutoStoryboardName('卫衣上新')).toBe(false)
    expect(isAutoStoryboardName('分镜脚本_20260924_1529')).toBe(false)
    expect(isAutoStoryboardName('脚本一')).toBe(false)
    expect(isAutoStoryboardName('')).toBe(false)
  })
})

describe('storyboardNameAfterSave（保存回学规则）', () => {
  const topic = '分镜脚本_20260924_1529'

  it('默认名「脚本N」→ 回学选题', () => {
    expect(storyboardNameAfterSave('脚本1', topic)).toBe(topic)
    expect(storyboardNameAfterSave('脚本10', topic)).toBe(topic)
  })

  it('用户重命名过 → 保留不覆盖', () => {
    expect(storyboardNameAfterSave('卫衣上新', topic)).toBe('卫衣上新')
  })

  it('选题为空/全空白 → 维持原名（含默认名）', () => {
    expect(storyboardNameAfterSave('脚本1', '')).toBe('脚本1')
    expect(storyboardNameAfterSave('脚本1', '   ')).toBe('脚本1')
    expect(storyboardNameAfterSave('卫衣上新', '')).toBe('卫衣上新')
  })

  it('选题两端空白被裁掉后回学', () => {
    expect(storyboardNameAfterSave('脚本2', `  ${topic}  `)).toBe(topic)
  })
})
