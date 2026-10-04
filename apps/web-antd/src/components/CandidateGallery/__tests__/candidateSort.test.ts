import { describe, expect, it } from 'vitest';

/**
 * 候选排序判据（用户要求：「要做个排序 待审核的候选图 排在最前面」）。
 *
 * 这是 `CandidateGallery` 里 `sortedCandidates` 的**判据复刻**。
 *
 * 为什么值得单测：排序本身很简单，但它和 `selectedIndex` **强耦合** ——
 * 索引现在指的是"排序后的数组"，一旦哪里混用了 props 原数组，
 * 就会出现「点第 3 张、选中的却是第 1 张」这种**错位**问题，
 * 而且不会报错（用户只会觉得"通过的不是我点的那张"）。
 * 下面既断言排序结果，也断言"排序键稳定、不丢项、不改内容"。
 */

interface C {
  id: number;
  status: string;
}

/** 取第 i 项，缺失即抛（替代 `list[i]!` —— 仓库 lint 禁止非空断言）。
 *  断言失败时报出「第几项缺失」，比 `undefined.status` 的 TypeError 更好定位。 */
function at<T>(list: T[], i: number): T {
  const v = list[i];
  if (v === undefined)
    throw new Error(`第 ${i} 项缺失（共 ${list.length} 项）`);
  return v;
}

/** 与组件内 `sortedCandidates` 的 rank 完全一致 */
function rank(s: string): number {
  return s === 'pending'
    ? 0
    : s === 'approved'
      ? 1
      : s === 'failed'
        ? 2
        : s === 'rejected'
          ? 3
          : 4;
}

function sortCandidates(list: C[]): C[] {
  return list.toSorted((a, b) => rank(a.status) - rank(b.status));
}

describe('候选排序 —— 待审核排最前', () => {
  it('★ 待审全部排在已通过/失败/丢弃之前', () => {
    const list: C[] = [
      { id: 1, status: 'rejected' },
      { id: 2, status: 'pending' },
      { id: 3, status: 'approved' },
      { id: 4, status: 'pending' },
      { id: 5, status: 'failed' },
    ];
    const got = sortCandidates(list);
    expect(got.map((c) => c.id)).toEqual([2, 4, 3, 5, 1]);
    // 断言业务语义：前 N 个必须全是 pending
    const pendingCount = list.filter((c) => c.status === 'pending').length;
    expect(
      got.slice(0, pendingCount).every((c) => c.status === 'pending'),
    ).toBe(true);
  });

  it('完整优先级：pending > approved > failed > rejected', () => {
    const list: C[] = [
      { id: 1, status: 'rejected' },
      { id: 2, status: 'failed' },
      { id: 3, status: 'approved' },
      { id: 4, status: 'pending' },
    ];
    expect(sortCandidates(list).map((c) => c.status)).toEqual([
      'pending',
      'approved',
      'failed',
      'rejected',
    ]);
  });

  it('同级保持原有相对顺序（稳定排序，不打乱同一批的变体次序）', () => {
    const list: C[] = [
      { id: 11, status: 'pending' },
      { id: 12, status: 'pending' },
      { id: 13, status: 'pending' },
    ];
    // 已按状态全同 → 顺序必须原样保持不变（toSorted 是稳定排序）
    expect(sortCandidates(list).map((c) => c.id)).toEqual([11, 12, 13]);
  });

  it('不丢项、不改内容（排序只换位置）', () => {
    const list: C[] = [
      { id: 1, status: 'rejected' },
      { id: 2, status: 'pending' },
      { id: 3, status: 'failed' },
      { id: 4, status: 'approved' },
    ];
    const got = sortCandidates(list);
    expect(got).toHaveLength(list.length);
    expect(new Set(got.map((c) => c.id))).toEqual(new Set([1, 2, 3, 4]));
    // 内容未被改动
    expect(
      at(
        got,
        got.findIndex((c) => c.id === 2),
      ).status,
    ).toBe('pending');
  });

  it('不修改入参（toSorted 返回新数组，props 不被就地改写）', () => {
    const list: C[] = [
      { id: 1, status: 'rejected' },
      { id: 2, status: 'pending' },
    ];
    const before = list.map((c) => c.id);
    sortCandidates(list);
    expect(list.map((c) => c.id)).toEqual(before);
  });

  it('未知状态排最后（不抢占待审位置）', () => {
    const list: C[] = [
      { id: 1, status: '某个新状态' },
      { id: 2, status: 'pending' },
      { id: 3, status: 'rejected' },
    ];
    const got = sortCandidates(list);
    expect(at(got, 0).status).toBe('pending');
    expect(at(got, got.length - 1).status).toBe('某个新状态');
  });

  it('空列表 / 全同状态不崩', () => {
    expect(sortCandidates([])).toEqual([]);
    const allPending: C[] = [
      { id: 1, status: 'pending' },
      { id: 2, status: 'pending' },
    ];
    expect(sortCandidates(allPending).map((c) => c.id)).toEqual([1, 2]);
  });
});

describe('排序后索引与选中项必须一致（防"点这张选中那张"）', () => {
  it('★ 按屏幕位置取到的，就是排序后那个位置的候选', () => {
    // 组件里 `selectedIndex` 索引的是**排序后**的数组（`sortedCandidates`），
    // 不是 props 原数组。混用会出现"点第 3 张、通过的却是第 1 张"的错位，
    // **且不会报错** —— 用户只会觉得"通过的不是我点的那张"。
    const list: C[] = [
      { id: 100, status: 'rejected' }, // 排序后落到最后
      { id: 200, status: 'pending' }, // 排序后落到最前
      { id: 300, status: 'approved' },
    ];
    const sorted = sortCandidates(list);

    // 屏幕上第 0 个位置显示的是 pending 那张（200）→ 选中它也应该是 200
    expect(at(sorted, 0).id).toBe(200);

    // ★ 反例对照：误用原数组按下标取会拿到 100（另一张图）——
    //   这正是"点这张、通过的却是那张"的错位，且不会报错。
    expect(at(list, 0).id).toBe(100);
    expect(at(list, 0).id).not.toBe(at(sorted, 0).id);
  });

  it('排序后待审数量 = 原列表里 pending 的数量', () => {
    const list: C[] = [
      { id: 1, status: 'pending' },
      { id: 2, status: 'rejected' },
      { id: 3, status: 'pending' },
      { id: 4, status: 'failed' },
    ];
    expect(
      sortCandidates(list).filter((c) => c.status === 'pending'),
    ).toHaveLength(2);
  });
});
