import type { CharacterMatrix } from '#/api/core/dramafloow';

import { describe, expect, it } from 'vitest';

import { planViewsToGenerate } from '../batchPlan';

/**
 * 「去生成」参数映射（用户 2026-10-04 要求，**已从跳页改为就地弹窗**）。
 *
 * ## 为什么要重写这个文件（而不是删掉）
 *
 * 旧版本锁的是「角色视图 → 下发页」的 **URL query 字段名**（`subjectPrompt` /
 * `subjectNegative` / `width` … 两侧必须同名）。用户随后要求：
 * > 「手动操作的时候 点击去生成 **直接在当前窗口 弹出 AI任务的执行窗口**」
 * 跳页没有了，query 也就没有了 —— 旧测试引用的生产代码（`goGenerate` 里拼 query、
 * `task-submit` 里读 query）**都已不存在**。
 *
 * 留着一个"引用了不存在代码"的测试比删掉更糟：它仍然全绿，让人以为这条链路受保护。
 *
 * 但**它要防的缺陷类型完全没变**：视图的 spec / 反向 / 尺寸在从矩阵流向生成表单的
 * 路上，字段名对不上时**不会报错**，只是安静地留空 —— 用户以为"提示词带过来了"，
 * 实际提交的是默认值，出来的图跟视图无关。
 *
 * 现在这条链路的形态是：`CharacterViewMatrix.goGenerate` 组装 `GenerateContext`
 * → `GenerateTaskModal` 用它初始化表单。本文件锁的就是这次**组装**：
 * 从矩阵行 + 列定义里取出正确的值（`planViewsToGenerate` 是同一套关联逻辑）。
 */

/** 造一个矩阵行 */
function row(views: { requirementId?: null | number; suffix: string }[]) {
  return {
    candidates: [],
    name: '丽迪雅',
    views: views.map((v) => ({
      label: v.suffix,
      status: 'pending',
      ...v,
    })),
  };
}

/** 造列定义（spec/反向/尺寸的唯一来源） */
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

const FULL_BODY_COL = {
  suffix: 'full_body_front',
  spec: 'full body front view, plain light gray background (#F0F0F0)',
  negativeSpec: 'cropped feet, feet cut off',
  width: 768,
  height: 1344,
};

describe('去生成 —— 视图参数到生成表单的映射', () => {
  it('★ 视图 spec 必须落到 subjectPrompt（第 ③ 层正向）', () => {
    const [todo] = planViewsToGenerate(
      row([{ requirementId: 483, suffix: 'full_body_front' }]),
      cols([FULL_BODY_COL]),
    ).todo;
    expect(todo?.spec).toBe(FULL_BODY_COL.spec);
  });

  it('★ 视图反向必须落到 subjectNegative', () => {
    const [todo] = planViewsToGenerate(
      row([{ requirementId: 483, suffix: 'full_body_front' }]),
      cols([FULL_BODY_COL]),
    ).todo;
    expect(todo?.negativeSpec).toBe(FULL_BODY_COL.negativeSpec);
  });

  it('★ 尺寸必须带过去（全身用竖图 768×1344，不是方形）', () => {
    const [todo] = planViewsToGenerate(
      row([{ requirementId: 483, suffix: 'full_body_front' }]),
      cols([FULL_BODY_COL]),
    ).todo;
    expect(todo?.width).toBe(768);
    expect(todo?.height).toBe(1344);
  });

  it('★ 归属（requirementId）必须在 —— 否则产物挂不回该视图', () => {
    const [todo] = planViewsToGenerate(
      row([{ requirementId: 483, suffix: 'full_body_front' }]),
      cols([FULL_BODY_COL]),
    ).todo;
    expect(todo?.requirementId).toBe(483);
  });

  it('★ 头部特写用方形尺寸，不能被全身的竖图串味', () => {
    // 视图各自的尺寸必须**逐视图**关联，不能"随便取一列的尺寸给所有视图用" ——
    // 那种写法在单视图时看不出问题，7 视图批量时会给特写发竖图尺寸。
    const plan = planViewsToGenerate(
      row([
        { requirementId: 1, suffix: 'face_front' },
        { requirementId: 2, suffix: 'full_body_front' },
      ]),
      cols([
        { suffix: 'face_front', spec: 'face', width: 320, height: 320 },
        FULL_BODY_COL,
      ]),
    );
    expect(plan.todo.map((t) => [t.suffix, t.width, t.height])).toEqual([
      ['face_front', 320, 320],
      ['full_body_front', 768, 1344],
    ]);
  });

  it('列定义缺失时不写 spec（不产生 undefined 之外的怪值）', () => {
    const [todo] = planViewsToGenerate(
      row([{ requirementId: 1, suffix: 'unknown_view' }]),
      [],
    ).todo;
    expect(todo?.spec).toBeUndefined();
    expect(todo?.negativeSpec).toBeUndefined();
    expect(todo?.width).toBeUndefined();
    // 但归属仍在 —— 至少能把产物挂对地方
    expect(todo?.requirementId).toBe(1);
  });
});
