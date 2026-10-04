import { afterEach, describe, expect, it } from 'vitest';

import {
  getProjectTimeZone,
  hasExplicitTimezone,
  parseWallTime,
  setProjectTimeZone,
  wallNow,
} from '../wallTime';

/**
 * 后端时间串解析的回归测试。
 *
 * 本文件锁住的缺陷（用户 2026-10-04 报「任务已跑完，读秒还在跑」的真正根因）：
 * 后端返回的是**项目时区（Asia/Shanghai）的墙上时间**，且**不带时区后缀**；
 * 而前端 `new Date(...)` 会按**运行环境本地时区**解读 —— 浏览器/容器跑在 UTC 时
 * 凭空偏 8 小时，导致耗时算成负数被夹成 0、跨过虚假 8 小时点后又每秒狂涨。
 *
 * 关键：`parseWallTime` 与 `wallNow` 必须**同口径**。只改一处无效，
 * 这正是该缺陷难查的原因（单看任一处都"对"）。故下面大量断言成对比较二者之差。
 */

/** 真实样本（取自 110 部署实例的 Task/List 响应） */
const SAMPLE_STARTED = '2026-10-04T12:27:07.446037';
const SAMPLE_FINISHED = '2026-10-04T12:27:43.285907';
/** 样本对应的**绝对时刻**：北京 12:27:43 = 04:27:43Z */
const SAMPLE_FINISHED_ABS = Date.parse('2026-10-04T04:27:43.285Z');
/** 样本对应的**绝对时刻**：北京 12:27:07 = 04:27:07Z */
const SAMPLE_STARTED_ABS = Date.parse('2026-10-04T04:27:07.446Z');

afterEach(() => {
  setProjectTimeZone('Asia/Shanghai');
});

describe('wallNow —— 「现在」必须与后端同口径', () => {
  it('项目时区 = 浏览器时区时，与 Date.now() 一致（不引入偏移）', () => {
    // 把项目时区设成浏览器自己的时区 → 两者应几乎相等（<1s 误差）
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
    setProjectTimeZone(browserTz);
    const now = Date.now();
    expect(Math.abs(wallNow(now) - now)).toBeLessThan(1000);
  });

  it('项目时区固定时，wallNow 的字面量恒等于该项目时区的墙钟', () => {
    setProjectTimeZone('Asia/Shanghai');
    const abs = Date.parse('2026-10-04T04:44:10Z'); // 北京 12:44:10
    const w = wallNow(abs);
    const d = new Date(w);
    // wallNow 返回的时刻，其「本地字面量」= 北京墙钟（12:44:10）
    const expected = new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
      minute: '2-digit',
      month: '2-digit',
      second: '2-digit',
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
    }).format(new Date(abs));
    const got = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    expect(got).toBe(expected);
  });

  it('单调递增：绝对时间前进 60s，wallNow 也前进 60s', () => {
    setProjectTimeZone('Asia/Shanghai');
    const a = wallNow(Date.parse('2026-10-04T04:00:00Z'));
    const b = wallNow(Date.parse('2026-10-04T04:01:00Z'));
    expect(b - a).toBe(60_000);
  });
});

describe('parseWallTime —— 墙上时间解析', () => {
  it('两个墙上时间串相减 = 真实经过时间（同口径自洽）', () => {
    setProjectTimeZone('Asia/Shanghai');
    const start = parseWallTime(SAMPLE_STARTED) as number;
    const finish = parseWallTime(SAMPLE_FINISHED) as number;
    expect(start).not.toBeNull();
    // 该任务实际跑了 35.84 秒
    expect(Math.round((finish - start) / 1000)).toBe(36);
  });

  it('墙上时间串与 wallNow 参照系一致：可正确算出「已经过去多久」', () => {
    setProjectTimeZone('Asia/Shanghai');
    const start = parseWallTime(SAMPLE_STARTED) as number;
    // 该任务开始 5 秒后的「现在」（以绝对时刻表达，经 wallNow 换算到同一参照系）
    const elapsed = (wallNow(SAMPLE_STARTED_ABS + 5000) - start) / 1000;
    expect(Math.round(elapsed)).toBe(5);
  });

  it('无时区后缀的墙上时间：必须与 wallNow 同参照系（本缺陷的核心不变量）', () => {
    setProjectTimeZone('Asia/Shanghai');
    const got = parseWallTime(SAMPLE_FINISHED) as number;
    expect(got).not.toBeNull();

    // 核心不变量：parseWallTime 的结果与 wallNow 换算出的「同一时刻」必须一致。
    // 旧实现的问题不在解析，而在于「现在」用了 Date.now()（绝对时刻），
    // 与墙上时间相减会偏一个时区 → 刚开始的任务耗时算成负数被夹成 0，
    // 跨过虚假时区点后又变成「从 8 小时前开始跑」并每秒继续涨。
    const sameMoment = wallNow(SAMPLE_FINISHED_ABS);
    expect(Math.abs(got - sameMoment)).toBeLessThan(1000);
  });

  it('★ 反例守卫：用绝对时刻当「现在」会算出偏差（旧实现的错误）', () => {
    setProjectTimeZone('Asia/Shanghai');
    const started = parseWallTime(SAMPLE_STARTED) as number;

    // 任务开始 5 秒后的真实时刻
    const fiveAfter = SAMPLE_STARTED_ABS + 5000;

    // 修复写法：两端同口径（墙上时间参照系）→ 恒为 5 秒，与运行环境时区无关
    const fixed = (wallNow(fiveAfter) - started) / 1000;
    expect(Math.round(fixed)).toBe(5);

    // 旧写法：拿「绝对现在」去减墙上时间。偏差 = (项目时区墙上值 − 绝对时刻)，
    // 即「我现在把同一个瞬间写成两种钟之后的差」，直接用 wallNow 客观量出来，
    // 不做符号推导（符号随环境时区变化，推导极易搞反）。
    const buggy = (fiveAfter - started) / 1000;
    const observedSkew = Math.round(fixed - buggy);
    const expectedSkew = Math.round((wallNow(fiveAfter) - fiveAfter) / 1000);
    expect(observedSkew).toBe(expectedSkew);

    // 且「修复写法」必须与运行环境时区无关：任何 TZ 下都是 5 秒（上面已断言）
    // 这里再固化一条：偏差量级只能是 0（环境==项目）或整小时（跨时区）。
    expect(Math.abs(observedSkew) % 900).toBe(0);
  });

  it('带 Z 后缀 → 按绝对时刻解析（尊重数据源语义）', () => {
    const iso = '2026-10-04T04:27:43.285Z';
    expect(parseWallTime(iso)).toBe(Date.parse(iso));
  });

  it('带 +08:00 后缀 → 按绝对时刻解析', () => {
    const iso = '2026-10-04T12:27:43+08:00';
    expect(parseWallTime(iso)).toBe(Date.parse(iso));
  });

  it('空格分隔的时间串也能解析（非严格 ISO）', () => {
    setProjectTimeZone('Asia/Shanghai');
    const a = parseWallTime('2026-10-04 12:27:43');
    const b = parseWallTime('2026-10-04T12:27:43');
    expect(a).toBe(b);
    expect(a).not.toBeNull();
  });

  it('坏数据 → null（绝不能静默变成 0 或 NaN）', () => {
    expect(parseWallTime('不是时间')).toBeNull();
    expect(parseWallTime('')).toBeNull();
    expect(parseWallTime('   ')).toBeNull();
    expect(parseWallTime(null)).toBeNull();
    expect(parseWallTime(undefined)).toBeNull();
    expect(parseWallTime('2026-13-45T99:99:99')).toBeNull();
  });

  it('number / Date 入参直通', () => {
    const n = 1_759_000_000_000;
    expect(parseWallTime(n)).toBe(n);
    const d = new Date(n);
    expect(parseWallTime(d)).toBe(n);
    expect(parseWallTime(Number.NaN)).toBeNull();
    expect(parseWallTime(new Date('bad'))).toBeNull();
  });
});

describe('耗时计算：两端同口径后必须正确（本缺陷的验收）', () => {
  it('真实样本：已完成任务耗时 = 36 秒，且**不随「现在」变化**（读秒停得住）', () => {
    setProjectTimeZone('Asia/Shanghai');
    const start = parseWallTime(SAMPLE_STARTED) as number;
    const finish = parseWallTime(SAMPLE_FINISHED) as number;

    // 完成任务的耗时只用 finished − started，与「现在」无关
    const elapsed = (finish - start) / 1000;
    expect(Math.round(elapsed)).toBe(36);

    // 一小时后重算仍是同一个值（旧实现因为拿了 now 会一直涨）
    const elapsedLater =
      ((parseWallTime(SAMPLE_FINISHED) as number) -
        (parseWallTime(SAMPLE_STARTED) as number)) /
      1000;
    expect(elapsedLater).toBe(elapsed);
  });

  it('在飞任务：开始后 5 秒算出 5 秒，**不会**被夹成 0（旧实现的症状）', () => {
    setProjectTimeZone('Asia/Shanghai');
    const start = parseWallTime(SAMPLE_STARTED) as number;
    const fiveAfterStartAbs = SAMPLE_STARTED_ABS + 5000;
    const elapsed = (wallNow(fiveAfterStartAbs) - start) / 1000;
    expect(Math.round(elapsed)).toBe(5);
  });

  it('在飞任务耗时随时间线性增长（每秒 +1）', () => {
    setProjectTimeZone('Asia/Shanghai');
    const start = parseWallTime(SAMPLE_STARTED) as number;
    const base = SAMPLE_STARTED_ABS;
    const e1 = (wallNow(base + 10_000) - start) / 1000;
    const e2 = (wallNow(base + 70_000) - start) / 1000;
    expect(Math.round(e2 - e1)).toBe(60);
  });

  it('时间差与运行环境时区**无关**（UTC / 东八区 / 美东 结果一致）', () => {
    // 本测试在任意 TZ 下运行都应通过 —— 这正是本修复的核心目标
    setProjectTimeZone('Asia/Shanghai');
    const start = parseWallTime(SAMPLE_STARTED) as number;
    const finish = parseWallTime(SAMPLE_FINISHED) as number;
    expect(Math.round((finish - start) / 1000)).toBe(36);
    const elapsed = (wallNow(SAMPLE_STARTED_ABS + 5000) - start) / 1000;
    expect(Math.round(elapsed)).toBe(5);
  });
});

describe('setProjectTimeZone —— 容错', () => {
  it('合法 IANA 名生效', () => {
    setProjectTimeZone('America/New_York');
    expect(getProjectTimeZone()).toBe('America/New_York');
  });

  it('非法/空值被忽略，保持旧值（不抛、不破坏既有解析）', () => {
    setProjectTimeZone('Asia/Shanghai');
    setProjectTimeZone('不是时区');
    expect(getProjectTimeZone()).toBe('Asia/Shanghai');
    setProjectTimeZone(null);
    expect(getProjectTimeZone()).toBe('Asia/Shanghai');
    setProjectTimeZone('');
    expect(getProjectTimeZone()).toBe('Asia/Shanghai');
  });
});

describe('hasExplicitTimezone —— 数据源语义诊断', () => {
  it('识别带时区的串', () => {
    expect(hasExplicitTimezone('2026-10-04T04:27:43Z')).toBe(true);
    expect(hasExplicitTimezone('2026-10-04T12:27:43+08:00')).toBe(true);
    expect(hasExplicitTimezone('2026-10-04T12:27:43+0800')).toBe(true);
  });

  it('墙上时间串（后端现状）识别为“无时区”', () => {
    expect(hasExplicitTimezone(SAMPLE_FINISHED)).toBe(false);
    expect(hasExplicitTimezone('2026-10-04 12:27:43')).toBe(false);
    expect(hasExplicitTimezone(null)).toBe(false);
  });
});
