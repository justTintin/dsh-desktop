// test/tintin-transition-boundaries.test.mjs — 镜间转场边界判定回归（2026-09-29）。
// 背景：用户实测单分镜脚本 23 镜草稿 0 条转场（剪映加载备份 load.bak 明文实锤）。
// 0924 裁决"同视频连续镜间不重样；镜内片间硬切"的"镜间"=每个镜头之间（shotFirst，
// 与音效挂载同源）；旧实现用 planFirst（分镜脚本首段）——一镜一片时代两者恒等，
// 一镜多片装填引入后单脚本多镜工程被整体判成镜内硬切。修后锁定：
//   · 每个镜首（shotFirst）且非首段 → 转场（random 时池内轮转、相邻不重样）
//   · 同一镜内的后续片段（shotFirst=false）→ 'none' 硬切
//   · 跨分镜脚本的首段同样是镜首 → 转场（多脚本场景）
// .mjs：media-bundle 源码有自己的 tsconfig/构建约定（.ts 后缀导入），不进根 tsc 编译面。
import { describe, expect, it } from 'vitest'
import { buildBoundaryTransitions, RANDOM_TRANSITION_POOL } from '../packages/tintin-media-bundle/src/composables/copywritingMontageStep2ConcatLogic.ts'

describe('buildBoundaryTransitions (2026-09-29 shot-boundary fix)', () => {
  it('single-script multi-shot project: every shot boundary gets a transition, intra-shot clips stay hard cuts', () => {
    // 复刻用户实测形态：1 个分镜脚本，4 个镜（首镜 2 片、后三镜各 1-2 片）
    const segs = [
      { planFirst: true, shotFirst: true, planKey: 'plan:t1' },   // 镜1 片1（首段，无前边界）
      { planFirst: false, shotFirst: false, planKey: 'plan:t1' }, // 镜1 片2（镜内硬切）
      { planFirst: false, shotFirst: true, planKey: 'plan:t1' },  // 镜2 首片 → 转场
      { planFirst: false, shotFirst: true, planKey: 'plan:t1' },  // 镜3 首片 → 转场
      { planFirst: false, shotFirst: false, planKey: 'plan:t1' }, // 镜3 片2（镜内硬切）
      { planFirst: false, shotFirst: true, planKey: 'plan:t1' },  // 镜4 首片 → 转场
    ]
    const out = buildBoundaryTransitions(segs, 'random', () => 0)
    expect(out).toHaveLength(5)
    expect(out[0]).toBe('none') // 镜1 片1→片2：镜内硬切
    expect(out[1]).toBe('fade') // 镜1→镜2：转场（rotation=0 起点池头）
    expect(out[2]).toBe('dissolve')
    expect(out[3]).toBe('none') // 镜3 片1→片2：镜内硬切
    expect(out[4]).toBe('slideleft')
  })

  it('multi-script project: script boundaries are also shot boundaries and rotate the pool without repeats', () => {
    const segs = [
      { planFirst: true, shotFirst: true, planKey: 'plan:t1' },
      { planFirst: true, shotFirst: true, planKey: 'plan:t2' }, // 分镜2 首段=镜首 → 转场
      { planFirst: false, shotFirst: false, planKey: 'plan:t2' },
      { planFirst: true, shotFirst: true, planKey: 'plan:t3' },
    ]
    const out = buildBoundaryTransitions(segs, 'random', () => 0)
    expect(out).toEqual(['fade', 'none', 'dissolve'])
    // 相邻转场不重样（0924 裁决：连续镜间不重样）
    const trans = out.filter((x) => x !== 'none')
    for (let i = 1; i < trans.length; i++) expect(trans[i]).not.toBe(trans[i - 1])
    expect(trans.every((x) => RANDOM_TRANSITION_POOL.includes(x))).toBe(true)
  })

  it('fixed mode lands the same mode on every shot boundary; modeOf overrides per tab', () => {
    const segs = [
      { planFirst: true, shotFirst: true, planKey: 'plan:t1' },
      { planFirst: false, shotFirst: false, planKey: 'plan:t1' },
      { planFirst: false, shotFirst: true, planKey: 'plan:t2' },
    ]
    expect(buildBoundaryTransitions(segs, 'fade', () => 0)).toEqual(['none', 'fade'])
    const perTab = buildBoundaryTransitions(segs, 'fade', () => 0, (seg) => (seg.planKey === 'plan:t2' ? 'slideleft' : ''))
    expect(perTab).toEqual(['none', 'slideleft'])
  })

  it('regression: the old planFirst rule would produce all-none for a single-script project', () => {
    // 旧行为守卫：同样的段序列若仍按 planFirst 判定，单脚本工程必为全 'none'（用户实测的事故形态）
    const segs = [
      { planFirst: true, shotFirst: true, planKey: 'plan:t1' },
      { planFirst: false, shotFirst: true, planKey: 'plan:t1' },
      { planFirst: false, shotFirst: true, planKey: 'plan:t1' },
    ]
    const legacyView = buildBoundaryTransitions(
      segs.map((s) => ({ shotFirst: s.planFirst, planKey: s.planKey })),
      'random',
      () => 0
    )
    expect(legacyView).toEqual(['none', 'none']) // 旧行为：0 转场
    expect(buildBoundaryTransitions(segs, 'random', () => 0)).toEqual(['fade', 'dissolve']) // 修后
  })
})
