/**
 * 任务展示格式化（仪表盘看板 / 任务详情抽屉共用）
 *
 * 时间的「现在」由调用方传入（`now`）：看板每秒 tick 一次即可让耗时走字，
 * 组件里不要各自 new Date()，避免同一屏出现两个不一致的"现在"。
 */

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
 * 从任务行取「已耗时」。
 * 在飞/排队：startedAt ?? createdAt → now；已结束：startedAt ?? createdAt → finishedAt。
 */
export function elapsedSecondsOf(
  task: {
    createdAt?: null | string;
    finishedAt?: null | string;
    startedAt?: null | string;
    status?: string;
  },
  now: number,
): null | number {
  const startRaw = task.startedAt ?? task.createdAt;
  if (!startRaw) return null;
  const start = new Date(startRaw).getTime();
  if (Number.isNaN(start)) return null;
  const end =
    task.finishedAt && isFinishedStatus(task.status)
      ? new Date(task.finishedAt).getTime()
      : now;
  return Math.max(0, (end - start) / 1000);
}

/** 终态（不再走字）：与后端 TaskStatuses 的口径一致 */
export function isFinishedStatus(status?: string): boolean {
  return ['approved', 'done', 'failed', 'rejected'].includes(status ?? '');
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
