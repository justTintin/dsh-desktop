// 欠装补片/检测纯函数回归（2026-09-30 用户裁决 A+B：「先智能匹配、后克隆声音」时序下
// 镜标按旁白等比放大，旧绑定组全长不足新目标——生成剪辑方案前自动补片 +
// 克隆完成后欠装提示）。场景取自当日实测：9 段 4s 素材、镜标 [4,5,3]、旁白放大 1.265。
import { describe, expect, it } from 'vitest'
import { topUpClipGroups, underfillAfterVoice, voiceScaleOf } from '../packages/tintin-media-bundle/src/composables/copywritingMontageAssignLogic'
import type { SplitSceneRow } from '../packages/tintin-media-bundle/src/composables/copywritingMontageStep1SplitLogic'
import type { AssignPoolItem } from '../packages/tintin-media-bundle/src/composables/copywritingMontageStep2ConcatLogic'

const row = (idx: number, duration: number): SplitSceneRow =>
  ({ idx, name: `s${idx}`, sourceName: `s${idx}`, startSec: 0, endSec: duration, duration }) as unknown as SplitSceneRow
const pool = (...rows: SplitSceneRow[]): AssignPoolItem[] => rows.map((r, i) => ({ key: `k${i}`, scene: r }))

describe('voiceScaleOf / underfillAfterVoice / topUpClipGroups', () => {
  it('voiceScaleOf：旁白/镜标和的比例，clamp 与缺省', () => {
    expect(voiceScaleOf(67.04, 53)).toBeCloseTo(1.265, 2)
    expect(voiceScaleOf(0, 53)).toBe(1)
    expect(voiceScaleOf(53 * 5, 53)).toBe(4)
    expect(voiceScaleOf(10, 53)).toBeCloseTo(0.2, 5)
  })

  it('underfillAfterVoice：放大后全长不足的镜数与差值（实测场景 4s 池）', () => {
    const p = pool(row(1, 4), row(2, 4), row(3, 4))
    const shots = [{ duration: 4 }, { duration: 5 }, { duration: 3 }]
    // 旁白 = 12×1.265 = 15.18 → 目标 [5.06, 6.33, 3.79]；绑定各 1 段 4s
    const u = underfillAfterVoice(shots, [[1], [2], [3]], p, 15.18)
    expect(u.shotsShort).toBe(2) // 5.06 与 6.33 的镜欠装；3.79×全 4s 够
    expect(u.deficitSec).toBeCloseTo(1.06 + 2.33, 1)
    // 无旁白（scale=1）：4/3 目标均被 4s 覆盖，仅 5s 镜欠 1s
    const u2 = underfillAfterVoice(shots, [[1], [2], [3]], p, 0)
    expect(u2.shotsShort).toBe(1)
    expect(u2.deficitSec).toBeCloseTo(1, 5)
  })

  it('topUpClipGroups：欠装组按预筛追加、组内去重、满装不动、池耗尽即止', () => {
    const p = pool(row(1, 4), row(2, 4), row(3, 4))
    const shots = [{ duration: 4 }, { duration: 5 }]
    // 目标 [5.06, 6.33]；绑定 [[1],[2]] → 两组都需各补 1 段（非本组内行）
    const r = topUpClipGroups(shots, [[1], [2]], p, 11.385)
    expect(r.appendedTotal).toBe(2)
    expect(r.appendedByShot).toEqual([1, 1])
    expect(r.groups[0]!.length).toBe(2)
    expect(r.groups[0]![0]).toBe(1)
    expect(new Set(r.groups[0]).size).toBe(2) // 组内不重复
    expect(new Set(r.groups[1]).size).toBe(2)
    // 满装组（全长 ≥ 目标）不追加
    const r2 = topUpClipGroups([{ duration: 3 }], [[1, 2]], p, 0)
    expect(r2.appendedTotal).toBe(0)
    expect(r2.groups).toEqual([[1, 2]])
    // 池耗尽：单行池、绑定即该行 → 无可补，保持欠装（欠装明示口径不变）
    const p1 = pool(row(9, 4))
    const r3 = topUpClipGroups([{ duration: 4 }], [[9]], p1, 5.06 * 0 + 11.385)
    expect(r3.appendedTotal).toBe(0)
    expect(r3.groups).toEqual([[9]])
  })
})
