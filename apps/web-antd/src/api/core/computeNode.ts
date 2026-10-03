/**
 * 算力节点接口
 *
 * 「算力节点」= 一台物理/虚拟机器（一期：本地 GPU，独占一张卡）。
 * AI 服务（provider）经 nodeId 挂到节点上：同节点的服务争同一张卡，
 * 受「节点互斥 + 软攒批 + 切换经济学」约束（见《算力调度设计》§5）。
 *
 * 一期规则：
 * - 节点在线/离线由心跳探测维护（3 次连续失败 → offline）；
 * - 停用节点（isEnabled=false）视同未配置：调度整体回退旧路径；
 * - 云/边缘/超算类型是二期预留（计费/折扣窗/配额字段一期只留位、不启用）。
 *
 * 约定：不写配对 toast（拦截器已统一处理）。
 */
import { api } from '#/api/request';

// ─────────────────────────── 节点类型（与后端 NodeTypes 一致） ───────────────────────────

export const NODE_TYPES = [
  { label: '本地 GPU（独占）', value: 'local_gpu' },
  { label: '云端（二期）', value: 'cloud' },
  { label: '边缘设备（二期）', value: 'edge' },
  { label: '超算（二期）', value: 'super' },
] as const;

export const NODE_TYPE_TEXT: Record<string, string> = {
  local_gpu: '本地 GPU',
  cloud: '云端（二期）',
  edge: '边缘（二期）',
  super: '超算（二期）',
};

/** 一期是否可配置（云/边缘/超算是二期类型） */
export function isPhase2NodeType(type: string): boolean {
  return type === 'cloud' || type === 'edge' || type === 'super';
}

// ─────────────────────────── 视图 ───────────────────────────

export interface ComputeNodeItem {
  id: number;
  name: string;
  nodeType: string;
  /** 并发槽位数（一期恒为 1：一张卡只服务一个服务） */
  slotCount: number;
  /** 是否允许换服务（false = 固定绑定，永不换） */
  canSwitch: boolean;
  /** 一次切换的耗时（分钟），切换经济学用 */
  switchCostMin: number;
  /** 人工启停开关（停用 = 调度回退旧路径） */
  isEnabled: boolean;
  /** 心跳探活：在线与否 */
  isOnline: boolean;
  /** 最近心跳（UTC） */
  heartbeatAt: null | string;
  /** 切换中（换服务需要时间） */
  switching: boolean;
  switchingUntil: null | string;
  /** 切换剩余秒数（switching 时 > 0） */
  switchingRemainSec: number;
  currentServiceId: null | number;
  currentServiceName: null | string;
  /** 挂在该节点上的服务数 */
  serviceCount: number;
  sortNo: number;
  remark: null | string;
  createdAt: string;
  updatedAt: string;
}

/** 节点详情的服务视图（Status） */
export interface ComputeNodeServiceView {
  id: number;
  name: string;
  providerType: string;
  capabilities: number;
  isEnabled: boolean;
  /** idle / busy / offline */
  runStatus: string;
  currentTaskId: null | number;
  /** 熔断暂停中 */
  paused: boolean;
  /** 当前占用任务（busy 时非空） */
  currentTask: null | {
    id: number;
    priority: number;
    source: string;
    startedAt: null | string;
    status: string;
    type: string;
  };
}

export interface ComputeNodeStatusView {
  node: Omit<ComputeNodeItem, 'createdAt' | 'updatedAt'>;
  services: ComputeNodeServiceView[];
  /** 每类用户队列深度（排队任务数） */
  queues: { image: number; text: number; video: number };
  /** 系统任务（source=system，二期应急通道）队列/在途 */
  system: { inFlight: number; queued: number };
}

// ─────────────────────────── 接口 ───────────────────────────

export async function computeNodeList() {
  return api.get<ComputeNodeItem[]>('/ComputeNode/List');
}

/** 节点 + 挂载服务 + 队列分布（id 缺省 = 第一个启用节点） */
export async function computeNodeStatus(id?: number) {
  return api.get<ComputeNodeStatusView>('/ComputeNode/Status', {
    params: id ? { id } : {},
  });
}

export async function computeNodeSave(data: {
  canSwitch?: boolean;
  id?: number;
  isEnabled?: boolean;
  name: string;
  nodeType?: string;
  remark?: string;
  slotCount?: number;
  sortNo?: number;
  switchCostMin?: number;
}) {
  return api.post<{ id: number }>('/ComputeNode/Save', data);
}

export async function computeNodeSetEnabled(id: number, isEnabled: boolean) {
  return api.post('/ComputeNode/SetEnabled', { id, isEnabled });
}

export async function computeNodeDelete(id: number) {
  return api.post('/ComputeNode/Delete', { id });
}
