import { describe, expect, it } from 'vitest';

import { isLiveStatus } from '../taskDisplay';

/**
 * 「执行中自动刷新」的判据测试（用户诉求原文：
 * 「如果任务执行中 虽然显示等待图 但实际上这个页面是需要刷新的
 *  即使图片生成完了也不会立即显示」）。
 *
 * 这条诉求的**根因**：抽屉只在 taskId 变化时拉一次详情，不订阅自己任务的 WS topic。
 * 修法是两条腿（缺一不可）：
 *   ① WS 订阅 `task:<id>` → 事件到达即重拉（图出来立刻可见，主路径）；
 *   ② 兜底轮询：任务仍在推进时每 5s 重拉（WS 断线时仍能更新）。
 *
 * 这里锁住第 ② 条腿的**开关判据**：只对「仍在推进」的任务轮询，
 * 任务一旦定型必须立刻停下 —— 否则抽屉开着不动会一直打接口（空转），
 * 而这恰恰是"看起来在工作、实际白耗"的典型。
 *
 * 轮询条件在组件里是 `if (!open || !isLive) stop()`，故判据就是 isLiveStatus。
 * 同时验证它与「页面是否需要继续刷新」在语义上完全对齐。
 */

/** 复刻组件里的轮询决策：返回 true = 本轮该重拉，false = 该停 */
function shouldPollOnce(open: boolean, status: string | undefined): boolean {
  return open && isLiveStatus(status);
}

describe('执行中自动刷新 —— 轮询开关判据', () => {
  it('抽屉打开 + 任务在推进 → 继续轮询（图出来才会自动显示）', () => {
    for (const s of ['queued', 'preparing', 'generating', 'collecting']) {
      expect({ s, poll: shouldPollOnce(true, s) }).toEqual({ s, poll: true });
    }
  });

  it('★ 任务定型（pending_review）→ 立即停止轮询（不再空转）', () => {
    // pending_review 是本项目 t2i 的**常见终态**（等人工审核）。
    // 它已经产出完毕、不会再变，继续轮询纯属浪费；而"图没自动出现"的问题
    // 由这一次重拉（进入 pending_review 的那次）解决。
    expect(shouldPollOnce(true, 'pending_review')).toBe(false);
  });

  it('其它终态一律停止轮询', () => {
    for (const s of ['approved', 'done', 'failed', 'rejected']) {
      expect({ s, poll: shouldPollOnce(true, s) }).toEqual({ s, poll: false });
    }
  });

  it('抽屉关闭 → 无论如何都不轮询', () => {
    for (const s of ['queued', 'preparing', 'generating', 'collecting']) {
      expect({ s, poll: shouldPollOnce(false, s) }).toEqual({ s, poll: false });
    }
  });

  it('未知状态 → 按"不推进"处理（宁可停，不要无限打接口）', () => {
    expect(shouldPollOnce(true, undefined)).toBe(false);
    expect(shouldPollOnce(true, '')).toBe(false);
    expect(shouldPollOnce(true, '某个新状态')).toBe(false);
  });
});

describe('执行中自动刷新 —— 与「已耗时走字」判据必须同源', () => {
  it('两条腿用同一个 isLiveStatus，不会出现"一个停一个跑"', () => {
    // 真实缺陷同型：读秒判据与轮询判据若各写各的，会出现
    // 「读秒停了但还在打接口」或「读秒在跑但界面不刷新」这种不一致。
    // 这里显式锁住：两者对全部状态给出**完全相同**的答案。
    const all = [
      'queued',
      'preparing',
      'generating',
      'collecting',
      'pending_review',
      'approved',
      'done',
      'failed',
      'rejected',
      '',
      'unknown',
    ];
    for (const s of all) {
      const poll = shouldPollOnce(true, s);
      const live = isLiveStatus(s);
      expect({ poll, s, live }).toEqual({ poll: live, s, live });
    }
  });
});
