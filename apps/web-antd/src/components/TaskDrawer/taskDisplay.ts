/**
 * 任务展示格式化（仪表盘看板 / 任务详情抽屉共用）
 *
 * 时间的「现在」由调用方传入（`now`）：看板每秒 tick 一次即可让耗时走字，
 * 组件里不要各自 `new Date()`，避免同一屏出现两个不一致的"现在"。
 *
 * ⚠️ 传入的 `now` **必须是墙上时间参照系**（用 `wallNow()` 取，不是 `Date.now()`），
 * 因为后端返回的任务时间戳是项目时区的墙上时间、不带时区后缀。
 * 详见 `#/utils/wallTime` 的模块注释 —— 两端不同口径会静默错一个时区。
 */

import { parseWallTime } from '#/utils/wallTime';

/** 耗时（中文明细）：45s / 3分12秒 / 1小时02分 / 2天3小时 */
export function formatElapsed(startSec: number, endSec: number): string {
  const sec = Math.max(0, Math.floor(endSec - startSec));
  if (sec < 60) return `${sec} 秒`;
  const min = Math.floor(sec / 60);
  if (min < 60) {
    const s = sec % 60;
    return s > 0 ? `${min} 分 ${s} 秒` : `${min} 分`;
  }
  const hour = Math.floor(min / 60);
  if (hour < 24) {
    const m = min % 60;
    return m > 0 ? `${hour} 小时 ${m} 分` : `${hour} 小时`;
  }
  const day = Math.floor(hour / 24);
  const h = hour % 24;
  return h > 0 ? `${day} 天 ${h} 小时` : `${day} 天`;
}

/** tokens 紧凑展示：980 → "980"；12345 → "1.23 万"；1350000 → "135.0 万" */
export function formatTokens(v: null | number = 0): string {
  const n = v ?? 0;
  if (n < 10_000) return n.toLocaleString('zh-CN');
  const wan = n / 10_000;
  return `${wan >= 100 ? wan.toFixed(0) : wan.toFixed(2)} 万`;
}

/**
 * 耗时（毫秒跳动版）：`01:23.456` / `1:02:03.789`
 *
 * 用户 2026-10-04 要求：
 * > 「生成中的已耗时 这里我希望改成 **持续跳动的毫秒数** 看起来舒服点」
 *
 * 与 {@link formatElapsed} 的分工：
 *   · `formatElapsed` 是**中文自然语言**（"3 分 12 秒"），适合"实际总耗时"这类
 *     一眼读懂的场景；
 *   · 本函数是**跑表样式**（等宽数字 + 毫秒），适合"还在跑的实时读秒" ——
 *     毫秒位每帧都在动，视觉上明确传达"它真的在跑"。
 *
 * ⚠️ 入参是**秒**（`elapsedSecondsOf` 的口径，带小数），不是毫秒 ——
 * 这里乘 1000 再格式化。改成毫秒会让所有调用点差 1000 倍，且不会报错。
 *
 * 时/分/秒**补零对齐**：等宽字体下 `01:23.456` 与 `1:02:03.789` 位数不同，
 * 但每段的宽度固定，跳动时不会左右抖。
 */
export function formatStopwatch(seconds: null | number): string {
  if (seconds === null || seconds === undefined) return '-';
  const totalMs = Math.max(0, Math.floor(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);

  const pad2 = (n: number) => String(n).padStart(2, '0');
  const pad3 = (n: number) => String(n).padStart(3, '0');

  const core = `${pad2(m)}:${pad2(s)}.${pad3(ms)}`;
  return h > 0 ? `${h}:${core}` : core;
}

/**
 * 从任务行取「已耗时」（秒）。
 *
 * 两个独立缺陷都在这里汇合，改动前请先读 `__tests__/taskDisplay.test.ts`：
 *
 * ① **时间参照系必须两端同口径**（用户报「任务已经完成了，读秒还在跑」的真正根因）：
 *    后端任务时间戳是**项目时区墙上时间、不带时区后缀**，旧实现却拿
 *    `Date.now()`（绝对时刻）去减 → 浏览器/容器跑在 UTC 时整整偏一个时区 ——
 *    刚开始的任务耗时算成负数被夹成 0；跨过那个虚假时点后又变成
 *    「从 8 小时前开始跑」并**每秒继续涨**。
 *    修法：`now` 必须由调用方用 `wallNow()` 取（见 `#/utils/wallTime`），
 *    解析任务时间戳统一走 `parseWallTime`。
 *
 * ② **不再推进的状态必须冻结**：只有 `isLiveStatus` 为真时才走字到「现在」；
 *    其余状态（含 `pending_review` 待审）冻结在 `finishedAt ?? updatedAt ?? start`。
 *    若只依赖 ① 而漏掉 ②，那些「已定型但没写 finishedAt」的任务仍会无限走字。
 */
export function elapsedSecondsOf(
  task: {
    createdAt?: null | string;
    finishedAt?: null | string;
    startedAt?: null | string;
    status?: string;
    updatedAt?: null | string;
  },
  now: number,
): null | number {
  const startRaw = task.startedAt ?? task.createdAt;
  const start = parseWallTime(startRaw);
  if (start === null) return null;

  // 仍在推进（排队 / 准备 / 生成 / 收集）→ 走字到「现在」
  let end = now;
  if (!isLiveStatus(task.status)) {
    // 不再推进 → 冻结。finishedAt 优先；缺失（如待审、人工取消）时用 updatedAt 兜底，
    // 最后才退回起点（耗时 0，而不是随 now 无限增长）。
    end = parseWallTime(task.finishedAt ?? task.updatedAt ?? startRaw) ?? start;
  }
  return Math.max(0, (end - start) / 1000);
}

/** 终态（不再走字）：与后端 TaskStatuses 的口径一致 */
export function isFinishedStatus(status?: string): boolean {
  return ['approved', 'done', 'failed', 'rejected'].includes(status ?? '');
}

/**
 * 是否仍会推进（读秒该走字）。
 *
 * 「会推进」= 后端 TaskStatuses.InFlight ∪ {queued}，与编排器实际会改库的状态**严格对齐**：
 * 只有这 4 个状态下的任务才会继续变更，其余（pending_review / approved / rejected / done / failed…）
 * 都已定型，读秒必须停下。
 *
 * 注意与 {@link isFinishedStatus} 的区别：`pending_review`（待人工审核）**不是** finished，
 * 但它同样**不会再推进**——旧代码把这两件事混为一谈，正是「读秒停不下来」的根因。
 */
export function isLiveStatus(status?: string): boolean {
  return ['collecting', 'generating', 'preparing', 'queued'].includes(
    status ?? '',
  );
}

/**
 * 剧本集标题规整：模型常把「第2集 ·」也写进 title，而 UI 又会拼一次「第 N 集」，
 * 于是出现「第 2 集 第2集 · xxx」这种重复。
 * 这里统一剥掉标题里重复的集号前缀（支持 第2集 / 第 2 集 / 第2集· / 第2集： / 2. 等写法）。
 */
export function episodeTitle(title?: null | string): string {
  const raw = (title ?? '').trim();
  if (!raw) return '';
  const stripped = raw
    // 「第2集」「第 2 集」后可跟 ·、-、—、:、：、. 或空白
    .replace(/^第\s*\d+\s*集\s*[·\-—:：.]?\s*/, '')
    // 「2.」「2、」这种纯序号前缀
    .replace(/^\d+\s*[.、)]\s*/, '')
    .trim();
  // 万一标题就等于集号（如「第2集」无正文），返回空以免只剩重复的集号
  return stripped;
}
