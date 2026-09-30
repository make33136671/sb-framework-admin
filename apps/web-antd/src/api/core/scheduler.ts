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
  /** 不挂节点的独立服务（不占卡、可并行） */
  standalone: {
    id: number;
    name: string;
    providerType: string;
    capability: string;
    runStatus: string;
    isEnabled: boolean;
  }[];
  queue: {
    total: number;
    user: number;
    system: number;
    classes: SchedClassStat[];
  };
  inFlight: {
    id: number;
    type: string;
    status: string;
    source: string;
    priority: number;
    providerId: null | number;
    providerName: null | string;
    startedAt: null | string;
    heartbeatAt: null | string;
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
  mode?: string;
  afterDays?: number;
  afterHours?: number;
  afterMinutes?: number;
  deadline?: string;
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
  limit?: number;
  action?: string;
}) {
  return api.get<SchedDecisionItem[]>('/Scheduler/Decisions', {
    params: params ?? {},
  });
}
