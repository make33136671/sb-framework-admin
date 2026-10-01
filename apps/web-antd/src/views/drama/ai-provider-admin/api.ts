/**
 * 成本与调度设置 / 上云决策回看 的接口封装（前端设计 §6.2 / §6.3）
 *
 * 设置项都落在框架的**系统设置**里（后端 DramaModuleInitializer 已注册定义，
 * 前端复用既有 `/SystemSetting/*` 端点，遵循仓库既有读写约定）：
 *   sched_cloud_cost_aware_enabled  总开关（**默认 false**：会主动花钱）
 *   sched_cloud_value_ratio         性价比阈值（分钟/元），默认 30
 *   sched_cloud_max_cost_per_task   单任务上限（元），默认 2.0
 *   sched_cloud_max_cost_per_day    单日上限（元），默认 20.0
 *   sched_cloud_prefer_offpeak      只在优惠时段上云，默认 true
 *   sched_cloud_estimate_fallback_tokens  token 预估回退值，默认 2000
 *
 * 上云决策回看走 `GET /Scheduler/CloudDecisions`：它**同时**返回
 *   - 已上云（`decision=CloudUpshift`，`route=cloud`）
 *   - **未上云**（`decision=CloudHold`，`route=local`，带 `reasonText` 中文原因）
 * 两类行的完整计算过程都在 `items[].detail`（JSON 字符串）。
 *
 * ⚠️ 未上云行在服务端**按「任务 × 原因」节流**（30 分钟至多一条），
 * 因此列表天然稀疏 —— 空列表是正常状态，不是故障（UI 文案已如实说明）。
 *
 * 约定：不写配对 toast（拦截器已统一处理）。
 */
import { api } from '#/api/request';

// ─────────────────────────── 系统设置读写 ───────────────────────────

export interface SystemSettingRow {
  id: number;
  key: string;
  name: string;
  displayType?: number;
  dataContent?: null | string;
  sort?: number;
}

/** 按 key 读单条系统设置（不存在 → 抛错，调用方给默认值兜底） */
export async function getSystemSettingByKey(key: string) {
  return api.get<SystemSettingRow>('/SystemSetting/GetByKey', {
    params: { key },
  });
}

/**
 * 批量保存系统设置（框架端点，`settings` 是 JSON 字符串）。
 * ⚠️ SaveList 走的是**整行更新**，因此必须回传 GetByKey 拿到的完整行（含 id/name）。
 */
export async function saveSystemSettings(rows: SystemSettingRow[]) {
  return api.post('/SystemSetting/SaveList', {
    settings: JSON.stringify(rows),
  });
}

// ─────────────────────────── 上云决策回看 ───────────────────────────

/** `/Scheduler/CloudDecisions` 的一行（`detail` 是 JSON 字符串，见 CloudDecisionSnapshot） */
export interface CloudDecisionItem {
  id: number;
  /** 决策关联的任务 id（写审计时 entityType=task） */
  entityId?: null | number;
  /** 完整计算过程 JSON（decision / reason / model / estimate / gates / task / route） */
  detail?: null | string;
  actor?: null | string;
  createdAt: string;
}

/** 「此刻闸门状态」快照（解释当前为什么没上云，与逐条历史互补） */
export interface CloudGateState {
  costAwareEnabled?: boolean;
  preferOffpeak?: boolean;
  valueRatio?: null | string;
  maxCostPerTask?: null | string;
  maxCostPerDay?: null | string;
}

export interface CloudDecisionsView {
  items: CloudDecisionItem[];
  /** 今日已花费（元）—— 后端直接给出，不再由前端从审计行推算 */
  todaySpent?: null | number;
  gates?: null | CloudGateState;
  serverUtcNow?: null | string;
  /** 后端说明文案（如节流规则），有则展示 */
  note?: null | string;
}

/**
 * 拉取成本感知上云决策（已上云 + 未上云）。
 * ⚠️ 不要把返回值当纯数组用 —— 这里是 `{ items, todaySpent, gates, note, serverUtcNow }`。
 */
export async function cloudDecisions(limit = 50) {
  return api.get<CloudDecisionsView>('/Scheduler/CloudDecisions', {
    params: { limit },
  });
}

// ─────────────────────────── detail JSON 的形状（防御式解析） ───────────────────────────

/** 后端写审计的 detail 快照（§8.7）；**全部字段可选**，缺字段要能优雅降级 */
export interface CloudDecisionSnapshot {
  /** CloudUpshift（已上云）/ CloudHold（未上云） */
  decision?: string;
  reason?: string;
  /** 后端拼好的中文原因（CloudHold 行有；CloudUpshift 行通常没有）——优先展示 */
  reasonText?: string;
  model?: { id?: number; name?: string; provider?: string };
  pricing?: {
    period?: string;
    inputPrice?: number;
    outputPrice?: number;
    currency?: string;
  };
  estimate?: {
    saveMin?: number;
    costYuan?: number;
    ratio?: number;
    threshold?: number;
    /** ⚠️ 只有未上云（CloudHold）行才有这两个字段 */
    localFinishMin?: number;
    cloudFinishMin?: number;
  };
  gates?: {
    costAwareEnabled?: boolean;
    offPeak?: boolean;
    ratioOk?: boolean;
    perTaskCap?: number;
    dailyCap?: number;
    dailySpent?: number;
  };
  task?: {
    id?: number;
    type?: string;
    priority?: number;
    queuedWaitMin?: number;
  };
  /** cloud（已上云）/ local（未上云，留在本地） */
  route?: string;
}

/**
 * 解析决策行的 `detail` JSON。**绝不抛异常**：坏 JSON / 空值 / 非对象 → null。
 * 理由：审计行由后端异步写，形状随写审计方演进（CloudUpshift / CloudHold 字段就不同）。
 */
export function parseCloudSnapshot(
  detail?: null | string,
): CloudDecisionSnapshot | null {
  if (!detail) return null;
  try {
    const v = JSON.parse(detail);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    return v as CloudDecisionSnapshot;
  } catch {
    return null;
  }
}

/**
 * 判定某条决策是否"已上云"。
 * **以 `detail.decision` 为准**（后端显式写了 CloudUpshift / CloudHold），
 * 而不是靠 reason 猜 —— reason 只用于兜底（老行可能没有 decision 字段）。
 */
export function isUpshiftSnapshot(snap: CloudDecisionSnapshot | null): boolean {
  if (!snap) return false;
  const d = (snap.decision ?? '').toLowerCase();
  if (d === 'cloudupshift') return true;
  if (d === 'cloudhold') return false;
  // 兜底：按路由 / 原因判定
  if ((snap.route ?? '').toLowerCase() === 'cloud') return true;
  if ((snap.route ?? '').toLowerCase() === 'local') return false;
  return snap.reason === 'cloud_cost_benefit' || snap.reason === 'free_ride';
}

/**
 * 原因码 → 中文文案（**兜底表**；后端 `reasonText` 存在时优先用后端的）。
 * 与后端 `CloudBenefit.Reasons` / `CloudSkipReasonText` 一一对应。
 */
export const CLOUD_REASON_TEXT: Record<string, string> = {
  cloud_cost_benefit: '优惠时段内性价比达标，自动上云执行',
  cost_aware_disabled: '成本感知调度未开启（默认关闭）',
  peak_hours: '峰时不上云（只在优惠时段利用）',
  shares_local_gpu: '该模型与本地争同一张卡（会真抢卡，非并行）',
  not_faster: '上云并不更快（无收益不花钱）',
  ratio_below_threshold: '性价比不足（省下的时间对不起花的钱）',
  per_task_cap: '超单任务花费上限',
  daily_cap: '已达当日花费上限（次日恢复）',
  free_ride: '免费（额度内 / 订阅制）',
  cloud_manual: '手动指定云端模型',
  cloud_emergency: '紧急通道云端兜底（系统不卡壳优先）',
};

/** 取原因的中文说明：优先后端 reasonText，其次本地映射，最后原样回显原因码 */
export function cloudReasonTextOf(snap: CloudDecisionSnapshot | null): string {
  if (!snap) return '（无决策快照）';
  if (snap.reasonText) return snap.reasonText;
  const r = snap.reason;
  if (!r) return '（无原因）';
  return CLOUD_REASON_TEXT[r] ?? r;
}
