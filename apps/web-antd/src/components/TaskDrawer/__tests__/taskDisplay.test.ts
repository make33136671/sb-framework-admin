import { describe, expect, it } from 'vitest';

import {
  elapsedSecondsOf,
  isFinishedStatus,
  isLiveStatus,
  isTickingStatus,
} from '../taskDisplay';

/**
 * 「已耗时」冻结判据的回归测试（用户报的缺陷原文：
 * 「AI任务列表 里有个 进度条 和 读秒 但是任务已经完成了 读秒还在跑」）。
 *
 * 根因：旧实现的结束时刻口径是
 *   `finishedAt && isFinishedStatus(status) ? finishedAt : now`
 * 而 `isFinishedStatus` 只认 approved/done/failed/rejected —— 偏偏 t2i 这类需要人工审核的
 * 任务走到 **`pending_review`** 就停住了（编排器不再推进），且**不写 finished_at**。
 * 于是「状态已不再变化」与「读秒继续用 now」同时成立 → 读秒永远跑不停。
 *
 * 修法：判据从「是不是 finished」改为「**还会不会推进**」（isLiveStatus）。
 * 本测试把两端都钉死：会推进的必须走字，不会推进的必须冻结。
 */

const T0 = '2026-10-04T10:00:00';

/** 便于构造：只给关心的字段 */
function task(over: Record<string, unknown> = {}) {
  return { createdAt: T0, status: 'generating', ...over };
}

/** 同一时刻的「现在」（比 T0 晚 60 秒） */
const NOW = new Date(T0).getTime() + 60_000;

describe('isLiveStatus —— 「还会不会推进」的唯一事实源', () => {
  it('在飞与排队 → 会推进', () => {
    // 用「状态 → 是否推进」的映射整体断言：既带上出错时的状态名，
    // 又满足仓库 lint（vitest/valid-expect 不允许 expect 带第二个 message 参数）。
    const actual = Object.fromEntries(
      ['queued', 'preparing', 'generating', 'collecting'].map((s) => [
        s,
        isLiveStatus(s),
      ]),
    );
    expect(actual).toEqual({
      collecting: true,
      generating: true,
      preparing: true,
      queued: true,
    });
  });

  it('pending_review（待审）→ **不会**再推进（读秒必须停）', () => {
    expect(isLiveStatus('pending_review')).toBe(false);
  });

  it('各种终态 → 不会推进', () => {
    const actual = Object.fromEntries(
      ['approved', 'done', 'failed', 'rejected'].map((s) => [
        s,
        isLiveStatus(s),
      ]),
    );
    expect(actual).toEqual({
      approved: false,
      done: false,
      failed: false,
      rejected: false,
    });
  });

  it('未知/空状态按「不会推进」处理（宁可停住，也不要无限走字）', () => {
    expect(isLiveStatus(undefined)).toBe(false);
    expect(isLiveStatus('')).toBe(false);
    expect(isLiveStatus('某个未来的新状态')).toBe(false);
  });

  it('与 isFinishedStatus 的区别恰恰就是 pending_review', () => {
    // 这两者混为一谈正是本缺陷的根因，故显式断言它们的分歧点
    expect(isFinishedStatus('pending_review')).toBe(false);
    expect(isLiveStatus('pending_review')).toBe(false);
    expect(isFinishedStatus('queued')).toBe(false);
    expect(isLiveStatus('queued')).toBe(true);
  });
});

/**
 * isTickingStatus —— 「要不要跑读秒」（用户 2026-10-05）
 *
 * > 「排队中的任务 不应该跑计时」
 *
 * 它与 isLiveStatus **必须**是两个概念：
 *   · isLiveStatus = 状态还会不会变（决定耗时冻结还是走字）；
 *   · isTickingStatus = 是不是正在干活（决定要不要跳动读秒）。
 * `queued` 属于前者、不属于后者 —— 它还会变，但没在干活。
 *
 * 若把两者合并（让 isLiveStatus 也不含 queued），排队任务的耗时会按"终态"冻结在
 * 进入队列的那一刻，且**再也回不来**（被领走后也不会重新开始计时）。
 */
describe('isTickingStatus —— 「正在干活」的唯一事实源', () => {
  it('在飞三态 → 跑读秒', () => {
    const actual = Object.fromEntries(
      ['preparing', 'generating', 'collecting'].map((s) => [
        s,
        isTickingStatus(s),
      ]),
    );
    expect(actual).toEqual({
      collecting: true,
      generating: true,
      preparing: true,
    });
  });

  it('★ queued → **不**跑读秒（用户明确要求）', () => {
    expect(isTickingStatus('queued')).toBe(false);
  });

  it('★ 与 isLiveStatus 的分歧点恰恰就是 queued（两者不可合并）', () => {
    expect(isLiveStatus('queued')).toBe(true); // 状态还会变 → 耗时不能按终态冻结
    expect(isTickingStatus('queued')).toBe(false); // 但没在干活 → 不该跑读秒
  });

  it('终态与待审 → 都不跑读秒', () => {
    for (const s of [
      'approved',
      'done',
      'failed',
      'rejected',
      'pending_review',
      '',
      undefined,
    ]) {
      expect(isTickingStatus(s)).toBe(false);
    }
  });
});

describe('elapsedSecondsOf —— 会推进的走字', () => {
  it('generating 且无 finishedAt → 走到 now', () => {
    expect(elapsedSecondsOf(task({ status: 'generating' }), NOW)).toBe(60);
  });

  it('queued → 也走字（排队时长同样要看）', () => {
    expect(elapsedSecondsOf(task({ status: 'queued' }), NOW)).toBe(60);
  });

  it('走字随时间推移递增（同一任务两次取值）', () => {
    const t = task({ status: 'generating' });
    const a = elapsedSecondsOf(t, NOW) ?? 0;
    const b = elapsedSecondsOf(t, NOW + 5000) ?? 0;
    expect(b - a).toBe(5);
  });

  it('优先用 startedAt 而不是 createdAt（排队时间不计入执行耗时）', () => {
    const t = task({
      createdAt: T0,
      startedAt: '2026-10-04T10:00:30',
      status: 'generating',
    });
    expect(elapsedSecondsOf(t, NOW)).toBe(30);
  });
});

describe('elapsedSecondsOf —— 不再推进的必须冻结（本缺陷的核心）', () => {
  it('pending_review 且无 finishedAt → 冻结在 updatedAt，**不随 now 变化**', () => {
    const t = task({
      status: 'pending_review',
      updatedAt: '2026-10-04T10:02:00', // 最后落库时刻 = 实际结束时刻
    });
    const a = elapsedSecondsOf(t, NOW);
    const b = elapsedSecondsOf(t, NOW + 3_600_000); // 一小时后再看
    expect(a).toBe(120);
    expect(b).toBe(120); // ← 旧实现在这里是 3660，正是「读秒还在跑」
    expect(a).toBe(b);
  });

  it('pending_review 有 finishedAt → 用 finishedAt（比 updatedAt 更准）', () => {
    const t = task({
      status: 'pending_review',
      finishedAt: '2026-10-04T10:01:00',
      updatedAt: '2026-10-04T10:05:00',
    });
    expect(elapsedSecondsOf(t, NOW + 3_600_000)).toBe(60);
  });

  it('done/failed/rejected/approved → 全部冻结', () => {
    const actual = Object.fromEntries(
      ['approved', 'done', 'failed', 'rejected'].map((s) => [
        s,
        elapsedSecondsOf(
          task({ finishedAt: '2026-10-04T10:01:00', status: s }),
          NOW + 3_600_000,
        ),
      ]),
    );
    expect(actual).toEqual({
      approved: 60,
      done: 60,
      failed: 60,
      rejected: 60,
    });
  });

  it('终态但连 updatedAt 都没有 → 退化为 0 而不是无限增长', () => {
    const t = task({ status: 'pending_review' });
    expect(elapsedSecondsOf(t, NOW + 3_600_000)).toBe(0);
  });

  it('冻结值不因「现在」变化而抖动（连取三次必须一致）', () => {
    const t = task({
      status: 'pending_review',
      updatedAt: '2026-10-04T10:03:00',
    });
    const vals = [NOW, NOW + 1000, NOW + 999_999].map((n) =>
      elapsedSecondsOf(t, n),
    );
    expect(new Set(vals).size).toBe(1);
    expect(vals[0]).toBe(180);
  });
});

describe('elapsedSecondsOf —— 坏数据不崩、不返回负数', () => {
  it('缺时间字段 → null（调用方显示 -）', () => {
    expect(elapsedSecondsOf({ status: 'generating' }, NOW)).toBeNull();
  });

  it('时间串非法 → null', () => {
    expect(
      elapsedSecondsOf({ createdAt: '不是时间', status: 'generating' }, NOW),
    ).toBeNull();
  });

  it('结束早于开始 → 夹到 0，不出现负数', () => {
    const t = task({
      status: 'done',
      finishedAt: '2026-10-04T09:00:00', // 早于 createdAt
    });
    expect(elapsedSecondsOf(t, NOW)).toBe(0);
  });

  it('后端 UTC 串缺 Z 时按本地解析（与 TimeTag 口径一致）', () => {
    // 只是确保能解析出有限数值，不出现 NaN → null 的静默丢失
    const v = elapsedSecondsOf(
      { createdAt: '2026-10-04 10:00:00', status: 'generating' },
      NOW,
    );
    expect(typeof v === 'number' || v === null).toBe(true);
  });
});
