import type { CharacterMatrix } from '#/api/core/dramafloow';

import { describe, expect, it } from 'vitest';

import { firstCandidateId, planViewsToGenerate } from '../batchPlan';

/**
 * 「一键生成 7 图」的补齐判据（用户 2026-10-04 要求）。
 *
 * 用户原话：
 * > 「一个角色名旁边 右侧 加一个 一键生成 7图（旁边加一个 checked 自动定稿）
 * >  自动按照全默认参数 但是每个视图生成 1 张就好 **把 7 张图 补齐**」
 *
 * ## 这类判据的失效为什么危险（都不报错）
 *
 *   · **该跳的不跳** → 把用户已定稿的图重新生成一遍、`Approve` 会改选定稿，
 *     下游引用被标 stale。用户只是点了个"补齐"，却把已完成的活覆盖了。
 *   · **不该跳的跳了** → 静默少生成几张，用户以为 7 张都补齐了，
 *     实际永远缺格子，且没有任何错误提示。
 *   · **spec 没关联上** → 任务照发、图照出，但提示词是空的 →
 *     产出与"这个视图"无关的图（这正是本项目反复出现的静默缺陷类型）。
 *
 * 所以下面把三类判据分别钉死。
 */

/** 造一个角色行：views 只给关键字段 */
function row(
  views: {
    approvedAssetId?: null | number;
    label?: string;
    requirementId?: null | number;
    suffix: string;
  }[],
): Parameters<typeof planViewsToGenerate>[0] {
  return {
    candidates: [],
    name: '丽迪雅',
    views: views.map((v) => ({
      label: v.label ?? v.suffix,
      status: 'pending',
      ...v,
    })),
  };
}

/** 造列定义（spec/尺寸挂在列上，不在格子里） */
function cols(
  entries: {
    height?: number;
    negativeSpec?: string;
    spec?: string;
    suffix: string;
    width?: number;
  }[],
): CharacterMatrix['viewColumns'] {
  return entries.map((e) => ({ label: e.suffix, ...e }));
}

describe('planViewsToGenerate —— 该给哪些视图发任务', () => {
  it('★ 已定稿的视图必须跳过（点"补齐"不能覆盖用户已选好的图）', () => {
    const plan = planViewsToGenerate(
      row([
        { requirementId: 1, suffix: 'face_front', approvedAssetId: 99 },
        { requirementId: 2, suffix: 'face_profile' },
      ]),
    );
    expect(plan.skippedFilled).toBe(1);
    expect(plan.todo.map((t) => t.suffix)).toEqual(['face_profile']);
  });

  it('★ 没有需求档案的视图跳过，且单独计数（发出去也挂不上产物）', () => {
    const plan = planViewsToGenerate(
      row([
        { label: '正脸特写', requirementId: null, suffix: 'face_front' },
        { requirementId: 2, suffix: 'face_profile' },
      ]),
    );
    expect(plan.skippedNoRequirement).toBe(1);
    expect(plan.todo.map((t) => t.suffix)).toEqual(['face_profile']);
  });

  it('7 个空格子 → 7 个待生成（这就是"补齐 7 张"）', () => {
    const suffixes = [
      'face_front',
      'face_three_quarter',
      'face_profile',
      'full_body_front',
      'full_body_side',
      'full_body_back',
      'arms_out',
    ];
    const plan = planViewsToGenerate(
      row(suffixes.map((s, i) => ({ requirementId: i + 1, suffix: s }))),
    );
    expect(plan.todo).toHaveLength(7);
    expect(plan.skippedFilled).toBe(0);
    expect(plan.skippedNoRequirement).toBe(0);
  });

  it('★ spec/反向/尺寸从列定义关联过来（不关联 → 提示词为空，产出与视图无关）', () => {
    const plan = planViewsToGenerate(
      row([{ requirementId: 1, suffix: 'full_body_front' }]),
      cols([
        {
          suffix: 'full_body_front',
          spec: 'full body front view, plain light gray background',
          negativeSpec: 'cropped feet, close-up',
          width: 320,
          height: 560,
        },
      ]),
    );
    expect(plan.todo[0]).toMatchObject({
      negativeSpec: 'cropped feet, close-up',
      spec: 'full body front view, plain light gray background',
      width: 320,
      height: 560,
    });
  });

  it('列定义里没有该 suffix → 不抛错，但 spec 为空（由调用方决定是否拦）', () => {
    // 后端将来新增视图而前端列定义没跟上时走这里。
    // 关键：不能抛异常把整个"一键生成"打挂 —— 其余视图仍应能生成。
    const plan = planViewsToGenerate(
      row([{ requirementId: 1, suffix: 'brand_new_view' }]),
      cols([{ suffix: 'face_front', spec: 'x' }]),
    );
    expect(plan.todo).toHaveLength(1);
    expect(plan.todo[0]?.spec).toBeUndefined();
  });

  it('全部有定稿 → todo 为空（弹窗据此显示"无需补齐"，而不是空跑）', () => {
    const plan = planViewsToGenerate(
      row([
        { requirementId: 1, suffix: 'face_front', approvedAssetId: 9 },
        { requirementId: 2, suffix: 'face_profile', approvedAssetId: 8 },
      ]),
    );
    expect(plan.todo).toEqual([]);
    expect(plan.skippedFilled).toBe(2);
  });

  it('approvedAssetId = 0 视为"没有定稿"（0 不是合法候选 id，但别当 falsy 撞上）', () => {
    // 用 `cell.approvedAssetId` 做真值判断时 0 会走进"空格子"分支 —— 这是**期望**行为
    // （0 不是有效候选 id）。这里显式锁住，避免将来有人改成 `!== undefined` 后语义漂移。
    const plan = planViewsToGenerate(
      row([{ requirementId: 1, suffix: 'face_front', approvedAssetId: 0 }]),
    );
    expect(plan.todo).toHaveLength(1);
  });
});

describe('firstCandidateId —— 自动定稿取哪一张', () => {
  it('★ 取 variantNo 最小的那张（不依赖数组顺序）', () => {
    expect(
      firstCandidateId([
        { id: 30, variantNo: 2 },
        { id: 10, variantNo: 0 },
        { id: 20, variantNo: 1 },
      ]),
    ).toBe(10);
  });

  it('空列表 / null → null（不能定稿一张不存在的图）', () => {
    expect(firstCandidateId([])).toBeNull();
    expect(firstCandidateId(null)).toBeNull();
    expect(firstCandidateId(undefined)).toBeNull();
  });

  it('缺 variantNo 时按 0 处理，仍能选出一张', () => {
    expect(firstCandidateId([{ id: 7 }])).toBe(7);
  });
});
