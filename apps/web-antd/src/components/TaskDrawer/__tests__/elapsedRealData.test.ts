import { describe, expect, it } from 'vitest';

import { parseWallTime, setProjectTimeZone, wallNow } from '#/utils/wallTime';

import { elapsedSecondsOf, formatElapsed } from '../taskDisplay';

/**
 * 「已耗时」端到端回归（真实 110 部署数据）。
 *
 * 复现用户报的缺陷：「AI任务列表 里有个 进度条 和 读秒 但是任务已经完成了 读秒还在跑」。
 *
 * 根因有两层，本文件两层都压住：
 *  ① **时间参照系混用**：后端返回项目时区**墙上时间**（无时区后缀，如
 *     `2026-10-04T12:27:43.285907`），旧实现拿 `Date.now()`（绝对时刻）去减。
 *     在东八区浏览器里 → 凭空多出「现在 − 结束时刻」这段，读数一路涨到几小时；
 *     在 UTC 浏览器里 → 差值为负被 `Math.max(0,…)` 夹成 0。**同一缺陷两种表现**。
 *  ② **不再推进的状态仍走字**：`pending_review`（待审）不是 finished 却已定型，
 *     旧判断让它继续用 `now` 当结束时刻。
 *
 * 下面用真实样本断言：两种时区下都必须得到「finished − started」这个正确值。
 */

setProjectTimeZone('Asia/Shanghai');

/** 真实样本（110 实例 Task/List；started→finished 实际耗时见 expectStarted/Finished） */
const REAL = [
  {
    createdAt: '2026-10-04T12:27:05.10248',
    finishedAt: '2026-10-04T12:27:43.285907',
    id: 667,
    startedAt: '2026-10-04T12:27:07.446037',
    status: 'pending_review',
    updatedAt: '2026-10-04T12:27:43.285907',
  },
  {
    createdAt: '2026-10-04T12:23:44.1',
    finishedAt: '2026-10-04T12:24:20.591446',
    id: 666,
    startedAt: '2026-10-04T12:23:47.071432',
    status: 'pending_review',
    updatedAt: '2026-10-04T12:24:20.591446',
  },
];

/** 取第 n 个真实样本（用具名函数避免 `REAL[n]!` 的非空断言 —— 仓库 lint 禁止该写法） */
function sample(n: number) {
  const item = REAL.at(n);
  if (!item) throw new Error(`样本缺失：#${n}`);
  return item;
}

describe('elapsedSecondsOf —— 真实生产数据 + 任意运行环境时区都必须正确', () => {
  it('已完成（pending_review）任务的耗时 = finished − started，且**不随 now 变化**', () => {
    for (const t of REAL) {
      const expected =
        ((parseWallTime(t.finishedAt) as number) -
          (parseWallTime(t.startedAt) as number)) /
        1000;

      // 用「墙上时间」口径的现在
      const nowWall = wallNow(Date.now());
      const got = elapsedSecondsOf(t, nowWall);
      expect(got).not.toBeNull();
      // 允许 1s 内误差（样本带微秒）
      expect(Math.abs((got as number) - expected)).toBeLessThan(1);

      // 关键：一小时后重算必须**一模一样**（旧实现会一直涨）
      const later = elapsedSecondsOf(t, nowWall + 3_600_000);
      expect(later).toBe(got);

      // 真实样本的耗时量级是几十秒 —— 若出现几千秒说明参照系又混了
      expect(got as number).toBeLessThan(120);
    }
  });

  it('★ 参照系一致性的机器可检判据：wallNow 与 Date.now 的关系可被观测', () => {
    const t = sample(0);
    const correct =
      ((parseWallTime(t.finishedAt) as number) -
        (parseWallTime(t.startedAt) as number)) /
      1000;

    // 无论运行环境时区如何，用 wallNow 当「现在」都必须得到正确耗时
    const rightNow = elapsedSecondsOf(t, wallNow(Date.now())) as number;
    expect(Math.abs(rightNow - correct)).toBeLessThan(1);

    // 两个参照系的偏差 = 环境时区相对项目时区的偏移（UTC 下为 +8h，东八区下为 0）。
    // 这里把它显式量出来：只要偏差非 0，就证明「用哪种 now」是**有区别**的，
    // 也就证明修复是必要的（不是恰好蒙对）。
    const absNow = Date.now();
    const skewMs = wallNow(absNow) - absNow;
    // 偏移必在 ±14h 内（时区偏移的物理上限）
    expect(Math.abs(skewMs)).toBeLessThan(15 * 60 * 60 * 1000);
    // 且要么为 0（环境时区 == 项目时区），要么是**整刻钟**量级 ——
    // 不可能是几分钟这种"小误差"（后者说明算法在瞎补偏移）。
    // 写成无条件断言，避免 vitest/no-conditional-expect。
    const remainder = Math.abs(skewMs) % 900_000;
    expect(skewMs === 0 || remainder === 0).toBe(true);
  });

  it('在飞任务：耗时是小正数并随时间线性增长（不会恒为 0）', () => {
    const startWall = parseWallTime('2026-10-04T12:27:07.446') as number;
    const live = {
      createdAt: '2026-10-04T12:27:07.446',
      startedAt: '2026-10-04T12:27:07.446',
      status: 'generating',
    };
    // 构造「开始 5 秒后」的墙上现在
    const now5 = startWall + 5000;
    expect(Math.round(elapsedSecondsOf(live, now5) as number)).toBe(5);
    // 再 +60 秒 → 应变成 65 秒（+1/秒）
    expect(Math.round(elapsedSecondsOf(live, now5 + 60_000) as number)).toBe(
      65,
    );
  });

  it('展示文案：几十秒的任务显示为「N 秒」，不会出现「几小时」', () => {
    const t = sample(0);
    const sec = elapsedSecondsOf(t, wallNow(Date.now())) as number;
    const text = formatElapsed(0, sec);
    expect(text).toMatch(/秒$/);
    expect(text).not.toContain('小时');
  });

  it('未知状态一律冻结（宁可停住也不无限走字）', () => {
    const t = { ...sample(0), status: '某个未来的新状态' };
    const a = elapsedSecondsOf(t, wallNow(Date.now()));
    const b = elapsedSecondsOf(t, wallNow(Date.now()) + 7_200_000);
    expect(a).toBe(b);
  });
});
