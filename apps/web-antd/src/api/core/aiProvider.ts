/**
 * AI 服务（模型/提供商）接口
 *
 * 「服务」= 系统里配置的一个 AI 模型（OpenAI 兼容 / ComfyUI / mock），
 * 添加时勾选它具备的能力；任务按所需能力选服务，不具备该能力的服务在 UI 置灰。
 *
 * 算力调度（P2）：服务可归属一个「算力节点」（nodeId），同节点服务争同一张卡
 * （受互斥/软攒批/切换经济学约束）；不挂节点 = 旧路径（无调度约束）。
 * List/Available 额外返回节点归属与运行状态（idle/busy/offline + 熔断暂停）。
 *
 * 约定：
 * - 能力/默认服务都是**位掩码**（见 AiCapabilities），前后端一致；
 * - List 返回的 apiKey 已脱敏（只有 hasApiKey），保存时留空 = 不修改密钥；
 * - 不写配对 toast（拦截器已统一处理）。
 */
import { api } from '#/api/request';

// ─────────────────────────── 能力（位掩码，与后端 AiCapabilities 一致） ───────────────────────────

export const AI_CAPABILITY = {
  /** 文本处理：洗稿 / 分镜 / 素材提取 / 提示词生成 */
  text: 1,
  /** 图片生成：素材出图（t2i） */
  imageGen: 2,
  /** 图片理解：看图（参考图解析、素材一致性检查） */
  imageUnderstand: 4,
  /** 视频生成：片段 i2v */
  videoGen: 8,
} as const;

export const AI_CAPABILITY_OPTIONS = [
  { label: '文本处理', value: AI_CAPABILITY.text },
  { label: '图片生成', value: AI_CAPABILITY.imageGen },
  { label: '图片理解', value: AI_CAPABILITY.imageUnderstand },
  { label: '视频生成', value: AI_CAPABILITY.videoGen },
];

export const AI_PROVIDER_TYPES = [
  { label: 'OpenAI 兼容（文本/视觉）', value: 'openai' },
  { label: 'ComfyUI（出图工作流）', value: 'comfyui' },
  { label: 'ComfyUI（视频工作流 i2v）', value: 'comfyui_i2v' },
  { label: 'Mock（本地确定性，离线自测）', value: 'mock' },
];

/** 服务运行态（与后端 ServiceRunStatus 一致；由调度器/心跳维护） */
export const AI_RUN_STATUS = {
  idle: { label: '空闲', color: 'default' },
  busy: { label: '执行中', color: 'processing' },
  offline: { label: '离线', color: 'error' },
} as const;

export interface AiProviderItem {
  id: number;
  name: string;
  providerType: string;
  baseUrl?: null | string;
  model?: null | string;
  /** 密钥已配置（列表不返回明文） */
  hasApiKey: boolean;
  /** 能力位掩码 */
  capabilities: number;
  /** 默认服务位掩码（该位命中 = 是某能力的默认服务） */
  defaultFor: number;
  isEnabled: boolean;
  sortNo: number;
  remark?: null | string;
  /** 归属算力节点（null = 不挂节点，走旧路径） */
  nodeId: null | number;
  nodeName: null | string;
  nodeOnline: null | boolean;
  nodeSwitching: null | boolean;
  /** 运行态：idle / busy / offline（ServiceRunStatus） */
  runStatus: string;
  /** 当前占用的任务（busy 时非空） */
  currentTaskId: null | number;
  /** 失败熔断暂停截止（UTC）；null = 未熔断 */
  pausedUntil: null | string;
  /** 是否处于熔断暂停中 */
  paused: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 任务选择器：按任务类型给出可选/置灰的服务 */
export interface AiProviderAvailable {
  taskType: string;
  requiredCapabilities: number;
  needsProvider: boolean;
  autoProviderId?: null | number;
  autoProviderName?: null | string;
  items: {
    id: number;
    name: string;
    providerType: string;
    model?: null | string;
    capabilities: number;
    defaultFor: number;
    isEnabled: boolean;
    nodeId: null | number;
    nodeName: null | string;
    nodeOnline: null | boolean;
    nodeSwitching: null | boolean;
    runStatus: string;
    paused: boolean;
    /** false → 前端置灰不可选（不具备该任务所需能力） */
    selectable: boolean;
    isDefaultForTask: boolean;
    /** 「暂不可用」原因（节点离线/切换中/熔断）；null = 可正常选 */
    unavailableReason: null | string;
  }[];
}

// ─────────────────────────── 接口 ───────────────────────────

export async function aiProviderList() {
  return api.get<AiProviderItem[]>('/AiProvider/List');
}

/** 按任务类型列出服务（含 selectable，用于下拉置灰） */
export async function aiProviderAvailable(taskType: string, dramaId?: number) {
  return api.get<AiProviderAvailable>('/AiProvider/Available', {
    params: dramaId ? { taskType, dramaId } : { taskType },
  });
}

export async function aiProviderSave(data: {
  id?: number;
  name: string;
  providerType: string;
  capabilities: number;
  baseUrl?: string;
  /** 留空 = 不修改已保存的密钥 */
  apiKey?: string;
  model?: string;
  defaultFor?: number;
  isEnabled?: boolean;
  sortNo?: number;
  remark?: string;
  /** 归属算力节点；0/null = 不挂节点（旧路径） */
  nodeId?: null | number;
}) {
  return api.post<{ id: number }>('/AiProvider/Save', data);
}

export async function aiProviderSetEnabled(id: number, isEnabled: boolean) {
  return api.post('/AiProvider/SetEnabled', { id, isEnabled });
}

export async function aiProviderDelete(id: number) {
  return api.post('/AiProvider/Delete', { id });
}
