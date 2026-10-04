import { describe, expect, it } from 'vitest';

import { formatStopwatch } from '../taskDisplay';

/**
 * 「毫秒跳动」跑表格式化的判据测试（用户 2026-10-04 要求）。
 *
 * 用户原话：
 * > 「生成中的已耗时 这里我希望改成 **持续跳动的 毫秒数** 看起来舒服点
 * >  字体大一点 我希望他高度占满整行 这样跳动起来视觉冲击力更大」
 *
 * 这条需求有一类**静默失效**：格式写错不会报错，只是数字看起来"没在动"
 * 或"动得很怪"。最容易犯的两个错：
 *   ① 入参单位搞反（`elapsedSecondsOf` 给的是**秒**，这里必须 ×1000）；
 *      搞反的话毫秒永远显示 `.000` —— 视觉上就是"根本没跳"，而功能没报错。
 *   ② 位数不补零 → `1:2.3` 这种，等宽字体下跳动时左右抖。
 */

describe('formatStopwatch —— 跑表样式（分:秒.毫秒）', () => {
  it('★ 入参是「秒」，毫秒位必须真的变化（单位搞反会恒为 .000）', () => {
    expect(formatStopwatch(0)).toBe('00:00.000');
    expect(formatStopwatch(0.001)).toBe('00:00.001');
    expect(formatStopwatch(0.5)).toBe('00:00.500');
    // 这四条是核心断言：不同的亚秒输入产生**不同**的毫秒位。
    // 若误把入参当毫秒（不 ×1000），下面全会是 00:00.000 或 00:00.001，测试立刻失败。
    const seen = new Set(
      [0.05, 0.1, 0.25, 0.9].map((s) => formatStopwatch(s)),
    );
    expect(seen.size).toBe(4);
  });

  it('秒/分进位正确', () => {
    expect(formatStopwatch(59.999)).toBe('00:59.999');
    expect(formatStopwatch(60)).toBe('01:00.000');
    expect(formatStopwatch(61.234)).toBe('01:01.234');
    expect(formatStopwatch(599.5)).toBe('09:59.500');
  });

  it('超过 1 小时 → 给小时段（不折回分钟）', () => {
    expect(formatStopwatch(3600)).toBe('1:00:00.000');
    expect(formatStopwatch(3723.456)).toBe('1:02:03.456');
  });

  it('★ 每段宽度固定（等宽跳动不抖 —— 这是"看起来舒服"的前提）', () => {
    // 「分:秒.毫秒」在没有小时时恒为 9 个字符；有小时时恒为 11 个。
    const noHour = [0, 5.5, 59.999, 60, 3599.999].map((s) =>
      formatStopwatch(s),
    );
    for (const s of noHour) expect(s).toHaveLength(9);

    const withHour = [3600, 3723.456, 36_000].map((s) => formatStopwatch(s));
    for (const s of withHour) expect(s.length).toBeGreaterThanOrEqual(11);
  });

  it('负数/无效输入被夹成 0，不产生 "-01:-01" 这种乱码', () => {
    // 后端时钟与浏览器时钟可能极短时间不同步 → 出现负耗时。
    // 显示成 "-00:00.123" 会让用户以为任务时间是错的。
    expect(formatStopwatch(-1)).toBe('00:00.000');
    expect(formatStopwatch(-0.5)).toBe('00:00.000');
  });

  it('null / undefined → "-"（不显示 00:00.000 冒充"刚跑"）', () => {
    // 与 elapsedSecondsOf 的契约对齐：它用 null 表示"算不出耗时"。
    // 若这里把 null 当 0，用户会看到 00:00.000 并以为任务刚开始。
    expect(formatStopwatch(null)).toBe('-');
    expect(formatStopwatch(undefined as unknown as null)).toBe('-');
  });
});
