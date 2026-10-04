/**
 * 后端时间串解析（**项目时区墙上时间**语义，全站唯一事实源）
 *
 * ⚠️ 这是本项目最容易出「静默错 8 小时」的一处，务必读完再改。
 *
 * ## 现实：后端返回的时间**不带时区语义**
 *
 * `api` 侧 `ApiTime.ToUtc()` 名为 ToUtc，实际是**原样透出 DB 里的墙上时间**
 * （全仓写入用 `AppTime.Now` = 项目时区的墙上时间，不是 UTC）。
 * 见 `api/.../Controllers/ApiContracts.cs` 的 `ApiTime` 类注释。
 * 实测（2026-10-04）：本机 12:44 CST 时，`Task/List` 对一个 17 分钟前创建的任务返回 `12:27`
 * —— 即**项目时区字面量**，且**不带 `Z` 也不带 `+08:00`**。
 *
 * 项目时区取后端 `/Verification/Status` 的 `appTimeZone`（本项目 = `Asia/Shanghai`），
 * 见 {@link setProjectTimeZone}。
 *
 * ## 坑：`new Date(墙上时间)` 会凭空偏一个时区
 *
 * `new Date('2026-10-04T12:27:05')` 在**无时区后缀**时按**运行环境本地时区**解析。
 * 浏览器/容器跑在 UTC（本项目部署常见）时它被当成 UTC，与「现在」差了 8 小时。
 * 后果**不报错，只是静默算错**：
 *   · 刚开始的任务 → end − start 为负 → 被 `Math.max(0, …)` 夹成 **0 秒**；
 *   · 一旦跨过那个虚假的 8 小时点 → 耗时变成「从 8 小时前开始跑」并**每秒继续涨**。
 * 后者正是用户报的「任务已经完成了，读秒还在跑」（2026-10-04）。
 *
 * ## 解法：**两端同口径**，绝不混用
 *
 * 墙钟语义下「现在」与「DB 时间」必须用**同一个钟**：
 *   · 时间串 → {@link parseWallTime}（无后缀时按**项目时区**解读）；
 *   · 「现在」→ {@link wallNow}（把绝对现在换算成**项目时区**的墙上时刻）。
 *
 * 只改一处是**无效**的 —— 这正是本缺陷难查之处：单看任一处都"对"。
 */

/**
 * 项目时区（IANA 名）。默认 `Asia/Shanghai` 与后端 appsettings.TimeZone 一致；
 * 启动时由 app 拉取 `/Verification/Status` 后用 {@link setProjectTimeZone} 覆盖。
 */
let projectTimeZone = 'Asia/Shanghai';

/** 设置项目时区（各页首屏拉到 appTimeZone 后调用；失败保持默认，不抛） */
export function setProjectTimeZone(tz?: null | string): void {
  if (!tz || typeof tz !== 'string') return;
  try {
    // 校验 IANA 名合法（非法名会让 Intl 抛错，宁可保持旧值）。
    // 赋值给变量是必要的：`no-new` 规则禁止仅为副作用的 `new`。
    const probe = new Intl.DateTimeFormat('en-US', { timeZone: tz });
    if (!probe) return;
    projectTimeZone = tz;
  } catch {
    // 非法时区名 → 忽略（保持默认）
  }
}

/** 当前项目时区 */
export function getProjectTimeZone(): string {
  return projectTimeZone;
}

/** 时区后缀探测：`Z` / `z` / `+08:00` / `+0800` / `-07:00` */
const TZ_SUFFIX = /(?:[Zz]|[+-]\d\d:?\d\d)$/;

/**
 * 某个绝对时刻（ms）在项目时区下的**墙上时间字面量**（ms）。
 *
 * 做法：用 Intl 取该时刻在项目时区的各字段，再当作**本地时间**构造出来。
 * 结果的「字面量」与后端 DB 中存的值同口径，可直接相减。
 *
 * 例（项目时区 Asia/Shanghai，浏览器 UTC）：
 *   绝对时刻 2026-10-04T04:44Z → 项目时区字面量 2026-10-04T12:44
 *   DB 里此刻写的也是 12:44 → 相减为 0，正确。
 */
function wallLiteralOf(now: number): number {
  const d = new Date(now);
  // 取项目时区下的年月日时分秒（这些「字面量」就是要与 DB 比较的值）
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone: projectTimeZone,
    year: 'numeric',
  }).formatToParts(d);

  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const year = get('year');
  const month = get('month');
  const day = get('day');
  // hour12:false 在部分引擎对 0 点返回 '24'，规整回 0
  const hour = get('hour') % 24;
  const minute = get('minute');
  const second = get('second');
  const ms = d.getMilliseconds();

  // 用「本地时间」构造 → 得到的时刻其**本地字面量** = 项目时区字面量
  return new Date(year, month - 1, day, hour, minute, second, ms).getTime();
}

/**
 * 「现在的墙上时间」（毫秒，与后端 DB 同口径）。
 *
 * **不是** `Date.now()`：后者是 UTC 绝对时刻，与 DB 里的项目时区墙上时间相减会偏一个时区。
 * 必须与 {@link parseWallTime} 成对使用。
 */
export function wallNow(now: number = Date.now()): number {
  return wallLiteralOf(now);
}

/**
 * 把后端返回的**项目时区墙上时间**串解析成毫秒时间戳（与 {@link wallNow} 同口径）。
 *
 * 实现要点（已由 `__tests__/wallTime.test.ts` 逐条压住，改前请先读测试）：
 *
 * `new Date('2026-10-04T12:27:05')`（无后缀）按**本地时区**构造，得到的绝对时刻
 * 其「本地字面量」恰好就是 `12:27:05`。而 `wallNow` 也是用
 * `new Date(y, m, d, h, mi, s)`（本地构造）产出 —— **两者天然同处「本地字面量」参照系**，
 * 相减即得真实时间差。因此这里**不做任何时区补偿**（补偿反而引入一个时区偏移）。
 *
 * - 带显式时区后缀（`Z` / `+08:00`）→ 按标准 ISO 解析（数据源已明确语义，尊重它）；
 * - 不带后缀 → 直接 `new Date` 的本地解读结果（即与 `wallNow` 同参照系）。
 *
 * 返回 `null` 表示无法解析（坏数据），调用方据此显示 `-` 而**不是**当成 0。
 */
export function parseWallTime(
  v?: Date | null | number | string,
): null | number {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;

  const raw = v.trim();
  if (!raw) return null;

  // 'YYYY-MM-DD HH:mm:ss'（空格分隔，非严格 ISO）→ 换 T，避免部分引擎判 Invalid Date
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw)
    ? raw.replace(' ', 'T')
    : raw;

  const t = new Date(normalized).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * 判断后端时间串**是否带显式时区语义**。
 * 用于诊断与守卫（项目回归断言据此区分「墙上时间」与「真 UTC」两种数据源）。
 */
export function hasExplicitTimezone(v?: null | string): boolean {
  if (typeof v !== 'string') return false;
  return TZ_SUFFIX.test(v.trim());
}
