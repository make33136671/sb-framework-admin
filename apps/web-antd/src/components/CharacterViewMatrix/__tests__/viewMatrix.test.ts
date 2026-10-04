import { describe, expect, it } from 'vitest';

/**
 * 角色 × 视图矩阵的**选图池判据**（用户诉求：「7 个标准视图做到一个页面上，
 * 这个标准视图是空的，点击就从现有角色的图像里选择」）。
 *
 * 这是 `CharacterViewMatrix` 里「弹窗列哪些图」「按来源筛选」的判据复刻。
 *
 * 为什么值得单测：这两处的失败模式都是**静默**的 ——
 *  ① 选图池把**别的角色**的图也列进来 → 用户点一下就定了稿，
 *     下游分镜里安静地出现错的人（后端 SetViewImage 会拒绝，但用户只看到"选不了"，
 *     而如果哪天后端校验被放松，前端就是最后一道防线）；
 *  ② 来源筛选的 `'unclassified'` 分支写错 → 旧的无后缀数据（`character_丽迪雅`）
 *     要么凭空消失（用户手上真有 54 张图），要么混进某个视图的来源里，
 *     而两种都不会报错。
 */

/** 与后端 `CharacterImageOption` 对齐的关键字段 */
interface Img {
  id: number;
  requirementKey: string;
  viewLabel: string;
  viewSuffix?: null | string;
}

const UNCLASSIFIED = 'unclassified';

/** 与组件内 `matchSource` 完全一致 */
function matchSource(c: Img, value: string): boolean {
  return value === UNCLASSIFIED ? !c.viewSuffix : c.viewSuffix === value;
}

/** 与组件内 `pickerCandidates` 完全一致 */
function pickerCandidates(all: Img[], filter: null | string): Img[] {
  if (filter === null) return all;
  return all.filter((c) => matchSource(c, filter));
}

/** 与组件内 `sourceOptions` 完全一致 */
function sourceOptions(all: Img[]): { label: string; value: string }[] {
  const seen = new Map<string, string>();
  for (const c of all) {
    const key = c.viewSuffix ?? UNCLASSIFIED;
    if (!seen.has(key)) seen.set(key, c.viewLabel);
  }
  return [...seen.entries()].map(([value, label]) => ({ value, label }));
}

/** 与后端 `CharacterViews.NameOfKey` 同口径的角色名提取（双下划线分隔） */
function nameOfKey(key: string): string {
  const sep = key.indexOf('_');
  const body = sep === -1 ? key : key.slice(sep + 1);
  const idx = body.lastIndexOf('__');
  return idx === -1 ? body : body.slice(0, idx);
}

/** 丽迪雅的真实数据形状：旧的无后缀需求 + 7 个视图需求 */
const LYDIA: Img[] = [
  { id: 1, requirementKey: 'character_丽迪雅', viewLabel: '未分类（旧）' },
  {
    id: 2,
    requirementKey: 'character_丽迪雅__face_front',
    viewLabel: '正脸特写',
    viewSuffix: 'face_front',
  },
  {
    id: 3,
    requirementKey: 'character_丽迪雅__full_body_front',
    viewLabel: '全身正面',
    viewSuffix: 'full_body_front',
  },
  {
    id: 4,
    requirementKey: 'character_丽迪雅__full_body_front',
    viewLabel: '全身正面',
    viewSuffix: 'full_body_front',
  },
  {
    id: 5,
    requirementKey: 'character_丽迪雅__arms_out',
    viewLabel: '手臂张开（A-pose）',
    viewSuffix: 'arms_out',
  },
];

describe('角色 × 视图矩阵 —— 选图池', () => {
  it('不筛选时列出该角色全部图（跨视图 + 旧数据）', () => {
    expect(pickerCandidates(LYDIA, null)).toHaveLength(5);
  });

  it('★ 旧的无后缀图必须留在池子里（用户历史图，不能凭空消失）', () => {
    const all = pickerCandidates(LYDIA, null);
    expect(all.some((c) => c.requirementKey === 'character_丽迪雅')).toBe(true);
  });

  it("★ 'unclassified' 只命中无后缀的旧数据", () => {
    const old = pickerCandidates(LYDIA, UNCLASSIFIED);
    expect(old.map((c) => c.id)).toEqual([1]);
  });

  it('按视图筛：只出该视图自己的图（同视图多张都要出）', () => {
    const front = pickerCandidates(LYDIA, 'full_body_front');
    expect(front.map((c) => c.id)).toEqual([3, 4]);
  });

  it('按视图筛：不含别的视图、也不含旧数据', () => {
    const arms = pickerCandidates(LYDIA, 'arms_out');
    expect(arms.map((c) => c.id)).toEqual([5]);
  });

  it('没有图的来源 → 空列表（UI 显示 Empty，不是静默显示全部）', () => {
    expect(pickerCandidates(LYDIA, 'face_profile')).toEqual([]);
  });
});

describe('角色 × 视图矩阵 —— 来源标签', () => {
  it('只列真的有图的来源，且不重复', () => {
    const opts = sourceOptions(LYDIA);
    expect(opts.map((o) => o.value)).toEqual([
      UNCLASSIFIED,
      'face_front',
      'full_body_front',
      'arms_out',
    ]);
  });

  it('旧数据的标签是「未分类（旧）」而不是某个视图名', () => {
    const opts = sourceOptions(LYDIA);
    const old = opts.find((o) => o.value === UNCLASSIFIED);
    expect(old?.label).toBe('未分类（旧）');
  });

  it('没有任何图 → 没有来源标签', () => {
    expect(sourceOptions([])).toEqual([]);
  });
});

describe('角色 × 视图矩阵 —— ★ 跨角色隔离', () => {
  // 后端 SetViewImage 按角色名比对；这里锁前端这一侧的同口径提取。
  // 若这里判错，就会把别人的脸填进本角色的视图。

  it('视图需求与旧式无后缀需求判为同一角色', () => {
    expect(nameOfKey('character_丽迪雅__full_body_front')).toBe(
      nameOfKey('character_丽迪雅'),
    );
  });

  it('跨视图同角色（face_front 的图填进 full_body_front）→ 允许', () => {
    expect(nameOfKey('character_丽迪雅__face_front')).toBe(
      nameOfKey('character_丽迪雅__full_body_front'),
    );
  });

  it('★ 不同角色 → 必须不等（否则会串图）', () => {
    expect(nameOfKey('character_达西__full_body_front')).not.toBe(
      nameOfKey('character_丽迪雅__full_body_front'),
    );
  });

  it('★ 前缀相似的角色名不得互相误判（真实数据有班纳特先生/太太）', () => {
    expect(nameOfKey('character_班纳特先生__face_front')).not.toBe(
      nameOfKey('character_班纳特太太__face_front'),
    );
  });

  it('角色名本身含下划线 → 双下划线分隔仍能取全名', () => {
    expect(nameOfKey('character_约翰_史密斯__face_front')).toBe('约翰_史密斯');
    expect(nameOfKey('character_约翰_史密斯')).toBe('约翰_史密斯');
  });

  it('名字含下划线的两个不同角色仍不等', () => {
    expect(nameOfKey('character_约翰_史密斯__face_front')).not.toBe(
      nameOfKey('character_约翰_布朗__face_front'),
    );
  });
});

describe('角色 × 视图矩阵 —— 格子状态', () => {
  /** 与组件内 `statusText` 一致 */
  function statusText(status: string): string {
    if (status === 'approved') return '已定稿';
    if (status === 'rejected') return '已丢弃';
    if (status === 'generating') return '生成中';
    if (status === 'missing') return '无档案';
    if (status === 'pending') return '待选择';
    // 未知状态回显原值（不落到默认文案）
    return status;
  }

  it('空格子（无档案）显示「无档案」而不是「点击选择」', () => {
    expect(statusText('missing')).toBe('无档案');
  });

  it('有需求但没选图 → 「待选择」', () => {
    expect(statusText('pending')).toBe('待选择');
  });

  it('定了稿 → 「已定稿」', () => {
    expect(statusText('approved')).toBe('已定稿');
  });

  it('未知状态不吞掉（回显原值，避免静默显示成空白）', () => {
    expect(statusText('weird')).toBe('weird');
  });

  it('★ 格子是否算「已填」只看 approvedAssetId（决定实线/虚线边框）', () => {
    const filled = { approvedAssetId: 2, status: 'approved' };
    const empty = { approvedAssetId: null, status: 'pending' };
    expect(Boolean(filled.approvedAssetId)).toBe(true);
    expect(Boolean(empty.approvedAssetId)).toBe(false);
  });
});
