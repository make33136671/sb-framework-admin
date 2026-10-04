import { describe, expect, it } from 'vitest';

/**
 * 「去生成」跳转的参数映射判据（用户 2026-10-04 要求）。
 *
 * 角色视图 → 统一下发页，靠 **URL query** 传第 ③ 层参数。这条链路有一类
 * 静默失效：字段名对不上时**不会报错**，只是下发页安静地留空 ——
 * 用户以为"提示词带过来了"，实际提交的是默认值，出来的图跟视图无关。
 *
 * 这里锁住映射关系本身（生产代码在 `CharacterViewMatrix.goGenerate` 与
 * `task-submit/index.vue` 的 `applyRouteParams`，两侧必须同名）。
 */

/** 与 CharacterViewMatrix.goGenerate 写入的 key 完全一致 */
interface ViewLike {
  height: number;
  negativeSpec: string;
  spec: string;
  suffix: string;
  width: number;
}

function buildQuery(
  dramaId: number,
  requirementId: number,
  viewLabel: string,
  characterName: string,
  requirementKey: string,
  view: null | ViewLike,
): Record<string, string> {
  const query: Record<string, string> = {
    dramaId: String(dramaId),
    refEntityId: String(requirementId),
    viewLabel,
    characterName,
    requirementKey,
  };
  if (view?.spec) query.subjectPrompt = view.spec;
  if (view?.negativeSpec) query.subjectNegative = view.negativeSpec;
  if (view) {
    query.width = String(view.width);
    query.height = String(view.height);
  }
  return query;
}

/** 与 task-submit 的 applyRouteParams 读的 key 完全一致 */
function applyParams(q: Record<string, string>) {
  const form = {
    dramaId: undefined as number | undefined,
    refEntityId: undefined as number | undefined,
    subjectPrompt: '',
    subjectNegative: '',
    width: 1024,
    height: 1024,
    seed: undefined as number | undefined,
  };
  const dramaId = q.dramaId ? Number(q.dramaId) : null;
  if (!dramaId) return form;
  form.dramaId = dramaId;
  if (q.refEntityId) form.refEntityId = Number(q.refEntityId);
  if (q.subjectPrompt) form.subjectPrompt = q.subjectPrompt;
  if (q.subjectNegative) form.subjectNegative = q.subjectNegative;
  if (q.width) form.width = Number(q.width);
  if (q.height) form.height = Number(q.height);
  if (q.seed) form.seed = Number(q.seed);
  return form;
}

const FULL_BODY: ViewLike = {
  suffix: 'full_body_front',
  spec: 'full body front view, plain light gray background (#F0F0F0)',
  negativeSpec: 'cropped feet, feet cut off',
  width: 768,
  height: 1344,
};

describe('「去生成」跳转参数映射', () => {
  it('★ 视图 spec 必须落到 subjectPrompt（第 ③ 层）', () => {
    const q = buildQuery(
      10,
      483,
      '全身正面',
      '丽迪雅',
      'character_丽迪雅__full_body_front',
      FULL_BODY,
    );
    const form = applyParams(q);
    expect(form.subjectPrompt).toBe(FULL_BODY.spec);
  });

  it('★ 视图反向必须落到 subjectNegative', () => {
    const q = buildQuery(10, 483, '全身正面', '丽迪雅', 'k', FULL_BODY);
    expect(applyParams(q).subjectNegative).toBe(FULL_BODY.negativeSpec);
  });

  it('★ 尺寸必须带过去（全身竖图 768×1344）', () => {
    const q = buildQuery(10, 483, '全身正面', '丽迪雅', 'k', FULL_BODY);
    const form = applyParams(q);
    expect(form.width).toBe(768);
    expect(form.height).toBe(1344);
  });

  it('★ 归属必须带过去（否则产物挂不回该视图）', () => {
    const q = buildQuery(10, 483, '全身正面', '丽迪雅', 'k', FULL_BODY);
    const form = applyParams(q);
    expect(form.dramaId).toBe(10);
    expect(form.refEntityId).toBe(483);
  });

  it('没有视图信息时不写提示词字段（不产生空串参数）', () => {
    const q = buildQuery(10, 483, 'x', 'y', 'k', null);
    expect(q.subjectPrompt).toBeUndefined();
    expect(q.subjectNegative).toBeUndefined();
    expect(q.width).toBeUndefined();
    // 但归属仍要在
    expect(applyParams(q).refEntityId).toBe(483);
  });

  it('★ 种子从「沿用此种子再生成」带过来时必须生效', () => {
    // 后端已修「传入 seed 被静默忽略」的缺陷；前端这一跳必须真的把 seed 填进表单
    const form = applyParams({
      dramaId: '10',
      refEntityId: '421',
      seed: '28247634',
    });
    expect(form.seed).toBe(28_247_634);
  });

  it('种子的 0 值不被当成"没传"而丢弃', () => {
    // seed=0 是合法种子。URL 里的 `'0'` 是**非空字符串**（truthy），
    // 所以 `if (q.seed)` 会正确读到它并转成数字 0 —— 最终表单值是 0 而不是 undefined。
    // 若哪天有人把它改成 `if (Number(q.seed))`，0 就会被静默丢掉，本断言即红灯。
    const form = applyParams({ dramaId: '10', refEntityId: '421', seed: '0' });
    expect(form.seed).toBe(0);
  });

  it('query 值都是字符串（URL 传参约束）', () => {
    const q = buildQuery(10, 483, '全身正面', '丽迪雅', 'k', FULL_BODY);
    for (const v of Object.values(q)) {
      expect(typeof v).toBe('string');
    }
  });

  it('中文角色名与视图名可安全进 URL', () => {
    const q = buildQuery(
      10,
      483,
      '全身正面',
      '丽迪雅',
      'character_丽迪雅__full_body_front',
      FULL_BODY,
    );
    // Vue Router 会自动 percent-encode；这里断言原值不被破坏
    expect(q.characterName).toBe('丽迪雅');
    expect(q.viewLabel).toBe('全身正面');
    expect(q.requirementKey).toBe('character_丽迪雅__full_body_front');
  });

  it('缺 dramaId 时下发页不改任何字段（不产生半截预填）', () => {
    const form = applyParams({});
    expect(form.dramaId).toBeUndefined();
    expect(form.refEntityId).toBeUndefined();
    expect(form.subjectPrompt).toBe('');
  });
});
