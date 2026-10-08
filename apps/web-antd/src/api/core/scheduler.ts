/**
 * 调度看板接口（算力调度设计 §6.3 / §7；实施计划 T3.4–T3.7）
 *
 * 看板回答四个问题：
 * - 现在节点在跑什么？（Status.nodes：当前服务 / 切换倒计时 / 在线）
 * - 队列里还堆着多少活？（Status.queue：按类别 image/video/text 与来源 user/system）
 * - 什么时候能跑完？（Predict：p50/p90 + 队列 ETA + 切换成本折算）
 * - 我睡前想让它跑到几点？（SetWindow：绝对时间 / 相对时长两路输入）
 *
 * 窗口语义：`sched_window_deadline` 为空 = 未设定；到点**只告警不打断**在跑任务
 * （设计 §9 风险 8：默认站内提示，不做强提醒）。
 *
 * 约定：不写配对 toast（拦截器已统一处理）。
 */
import { api } from '#/api/request';

// ─────────────────────────── Status ───────────────────────────

export interface SchedNodeService {
  id: number;
  name: string;
  providerType: string;
  /** image / video / text */
  capability: string;
  /** idle / busy / offline */
  runStatus: string;
  currentTaskId: null | number;
  pausedUntil: null | string;
  paused: boolean;
  sortNo: number;
}

export interface SchedNodeCard {
  id: number;
  name: string;
  nodeType: string;
  slotCount: number;
  canSwitch: boolean;
  switchCostMin: number;
  isEnabled: boolean;
  isOnline: boolean;
  heartbeatAt: null | string;
  currentServiceId: null | number;
  currentServiceName: null | string;
  /** 当前服务承担的类别（image/video/text） */
  currentClass: null | string;
  switchingUntil: null | string;
  switching: boolean;
  switchingRemainSec: number;
  mounted: SchedNodeService[];
}

export interface SchedClassStat {
  class: string;
  label: string;
  queued: number;
  oldestWaitMin: number;
  workloadMin: number;
  p50Min: number;
  p90Min: number;
  etaMin: number;
  /** 样本不足：数值为估算（前端须标注，不可当精确值展示） */
  estimated: boolean;
  /** 该类当前是否可跑（video 受 GPU 时间窗约束） */
  eligible: boolean;
}

export interface SchedWindowState {
  deadline: null | string;
  isSet: boolean;
  expired: boolean;
  remainMin: null | number;
}

export interface SchedStatusView {
  now: string;
  nodeCount: number;
  nodes: SchedNodeCard[];
  /** 不挂节点的独立服务（独立算力，不占卡） */
  standalone: {
    capability: string;
    id: number;
    isEnabled: boolean;
    name: string;
    providerType: string;
    runStatus: string;
  }[];
  queue: {
    classes: SchedClassStat[];
    system: number;
    total: number;
    user: number;
  };
  inFlight: {
    heartbeatAt: null | string;
    id: number;
    priority: number;
    providerId: null | number;
    providerName: null | string;
    source: string;
    startedAt: null | string;
    status: string;
    type: string;
  }[];
  window: SchedWindowState;
}

// ─────────────────────────── Predict ───────────────────────────

export interface SchedPredictClass {
  class: string;
  label: string;
  queued: number;
  workloadMin: number;
  p50Min: number;
  p90Min: number;
  samples: number;
  estimated: boolean;
  etaMin: number;
  etaWithSwitchMin: number;
  switchPenaltyMin: number;
  needSwitch: boolean;
}

export interface SchedPredictView {
  now: string;
  inFlight: number;
  switchFactor: number;
  switchCostMin: number;
  currentClass: null | string;
  classes: SchedPredictClass[];
  note: string;
}

// ─────────────────────────── Decisions ───────────────────────────

export interface SchedDecisionItem {
  id: number;
  action: string;
  entityType: null | string;
  entityId: null | number;
  before: null | string;
  after: null | string;
  actor: null | string;
  createdAt: string;
}

// ─────────────────────────── 接口 ───────────────────────────

/** 看板快照：节点 + 队列分布 + 预测条 + 窗口状态（一次拉全） */
export async function schedulerStatus() {
  return api.get<SchedStatusView>('/Scheduler/Status');
}

/**
 * **调度实时状态**（2026-10-07 新增）—— AI 任务页的「调度器状态」面板用它。
 *
 * ## 为什么它能 2 秒刷新而不加压数据库
 *
 * 数据来自后端的**状态缓存**（编排器每 5 秒写入），本接口**不查业务表**。
 * 与数据库 10 分钟一条的审计节奏完全解耦：
 *   · 缓存 → "现在什么样"（本接口，UI 2 秒读）
 *   · 审计 → "历史发生过什么"（10 分钟/条，不变）
 *
 * ## staleSec 是它的灵魂
 *
 * 表示"缓存写入至今的秒数"。界面据此：
 *   · 显示「更新于 N 秒前」
 *   · 驱动卡片滚动边框（**刷新即归零**，一直向前滚）
 * 编排器若停了，它只增不减 → 一眼看出数据僵死，
 * 而不是误以为"没变化 = 没问题"。
 */
export async function schedulerLive() {
  return api.get<SchedLiveView>('/Scheduler/Live');
}

// ─────────────── 运行时手动操作（2026-10-07，用户要求）───────────────
//
// > 「在任务调度器 内的ComfyUI 内 加入 一个 清除按钮 执行/free
// >   一个Select 选择支持的模型 一个载入按钮 载入选择的模型」

/** ComfyUI 磁盘上可用的模型（按类别）—— "载入模型"下拉的数据源。 */
export interface ComfyUiModelsView {
  categories: {
    type: string;
    files: string[];
  }[];
}

/** 列出 ComfyUI 支持的模型（只列磁盘上真实存在的，避免手填错名字）。 */
export async function schedulerComfyUiModels() {
  return api.get<ComfyUiModelsView>('/Scheduler/ComfyUiModels');
}

/**
 * **清除显存**：执行 ComfyUI `POST /free`（卸载模型 + 释放显存）。
 *
 * 同时会清空后端的"装载记账" —— 显存都释放了，记账必须跟着失效，
 * 否则调度器会以为模型还在（跳过装载）而直接执行失败。
 */
export async function schedulerComfyUiFree(
  runtimeId: number,
  unloadModels = true,
) {
  return api.post<{
    runtimeId: number;
    vramFreeMb: number;
    vramTotalMb: number;
  }>('/Scheduler/ComfyUiFree', { runtimeId, unloadModels });
}

/**
 * **载入模型**：把指定模型主动装进 ComfyUI 显存（预热）。
 *
 * 返回里的 `usedDeltaMb` 是**实测**的显存占用增量 —— 用来证明"真的装进去了"。
 * 实测教训：只提交 CLIPLoader 而无下游消费者时 ComfyUI 会立即释放，
 * 看着"成功"其实没装，必须用显存差值识破。
 */
export async function schedulerComfyUiLoad(
  runtimeId: number,
  clipName: string,
) {
  return api.post<{
    clipName: string;
    promptId: string;
    usedDeltaMb: number;
    vramFreeAfterMb: number;
    vramFreeBeforeMb: number;
  }>('/Scheduler/ComfyUiLoad', { runtimeId, clipName });
}

/** 调度实时状态视图（对应后端 Scheduler/Live 的返回结构）。 */
export interface SchedLiveView {
  ready: boolean;
  updatedAt: null | string;
  /** 缓存写入至今的秒数（null = 缓存未就绪） */
  staleSec: null | number;
  /** 是否陈旧（> 30 秒，编排器可能已停） */
  stale: boolean;
  scheduler: null | {
    decision: string;
    reason: string;
    /** 中文原因 —— 界面**直接显示这个**，用户据此判断卡在哪 */
    reasonText: string;
    at: string;
    benefitMin: null | number;
    costMin: null | number;
    thresholdMin: null | number;
    gpuWindowOpen: boolean;
    gpuWindow: string;
    totalQueued: number;
  };
  machines: {
    crossRuntimeCostMin: number;
    machineId: number;
    machineName: string;
    online: boolean;
    queued: {
      functionKey: string;
      functionName: string;
      queued: number;
      oldestWaitMin: number;
    }[];
    runtimes: {
      enabled: boolean;
      endpoint: null | string;
      internalSwitchCostMin: number;
      kind: string;
      loaded: {
        evidenceTaskId: null | number;
        modelId: number;
        modelName: string;
        /** recorded = 我们记的（确知）；inferred = 显存推断（存疑） */
        source: string;
        since: string;
        vramMb: null | number;
      }[];
      loadedVramMb: number;
      name: string;
      online: boolean;
      runtimeId: number;
      switchingUntil: null | string;
      vramReservedMb: number;
    }[];
    vramTotalMb: number;
  }[];
}

/** 预测：p50/p90 + 队列 ETA（含切换成本折算） */
export async function schedulerPredict() {
  return api.get<SchedPredictView>('/Scheduler/Predict');
}

/**
 * 设定无人值守窗口（两种输入，后端统一转绝对截止时间）
 * - 相对：`{ mode: 'relative', afterHours: 8 }`
 * - 绝对：`{ mode: 'absolute', deadline: '2026-09-30 07:00' }`（本地时间）
 */
export async function schedulerSetWindow(data: {
  afterDays?: number;
  afterHours?: number;
  afterMinutes?: number;
  deadline?: string;
  mode?: string;
}) {
  return api.post<{ deadline: string; isSet: boolean; remainMin: number }>(
    '/Scheduler/SetWindow',
    data,
  );
}

export async function schedulerClearWindow() {
  return api.post('/Scheduler/ClearWindow');
}

/** 决策审计回溯（sched_decision / sched_alert / sched_window_set|clear） */
export async function schedulerDecisions(params?: {
  action?: string;
  limit?: number;
}) {
  return api.get<SchedDecisionItem[]>('/Scheduler/Decisions', {
    params: params ?? {},
  });
}
