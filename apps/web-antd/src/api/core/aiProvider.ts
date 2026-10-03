/**
 * AI 模型接口（二期改造，设计 §7.2 / 前端设计 §3）
 *
 * 语义升级：「AI 服务」页（一行一个模型，地址/Key 混填）→ 「AI 模型」页。
 * 模型归属**提供商**（provider），能力由用户在提供商页的发现流程中勾选；
 * 本页主要用于**事后调整**：改能力、设默认、挂节点、启停。
 *
 * ⚠️ **模型不再手填创建**：`/AiProvider/Save` 已移除（后端保留端点但直接报错引导）。
 * 新建走「AI 提供商」页的 测试连通性 → 勾选 → 保存（`aiProviderAdmin.ts`）。
 *
 * 关键规则（与后端一致）：
 *   - `List` / `Available` 现在返回**模型**（不是提供商），字段名兼容一期以降低改动面，
 *     并新增 providerId / providerName / modelId / displayName / shadowCapabilities 等；
 *   - 能力/默认都是**位掩码**（见 AiCapabilities，7 位）；
 *   - 停用即撤销默认（后端行为）；默认位只能落在已勾选的能力上；
 *   - 不挂节点 = 独立外部 API（独立算力，不占卡）；
 *   - 不写配对 toast（拦截器已统一处理）。
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
  /** 向量：**暂无任务使用**（二期新增位，勾了也暂时没有任务会调它） */
  embedding: 16,
  /** 语音合成：**暂无任务使用** */
  tts: 32,
  /** 语音识别：**暂无任务使用** */
  asr: 64,
} as const;

/**
 * 「暂无任务使用」的能力位（二期新增的 3 位目前没有任务消费者）。
 * 勾了也暂时没地方用 —— 界面必须**诚实标注**，不让用户以为勾了就生效。
 */
const AI_CAPABILITY_UNUSED = new Set<number>([
  AI_CAPABILITY.asr,
  AI_CAPABILITY.embedding,
  AI_CAPABILITY.tts,
]);

/**
 * 能力勾选项（前后端必须一致，共 **7** 项）。
 * 顺序按"常用程度"排（文本 / 图片理解 / 生图 / 生视频 在前），不按位值排。
 * `note` 非空 → 渲染时追加灰字（诚实告知勾了也暂时没地方用）。
 */
export const AI_CAPABILITY_OPTIONS = [
  { label: '文本处理', value: AI_CAPABILITY.text },
  { label: '图片理解', value: AI_CAPABILITY.imageUnderstand },
  { label: '图片生成', value: AI_CAPABILITY.imageGen },
  { label: '视频生成', value: AI_CAPABILITY.videoGen },
  { label: '向量', value: AI_CAPABILITY.embedding },
  { label: '语音合成', value: AI_CAPABILITY.tts },
  { label: '语音识别', value: AI_CAPABILITY.asr },
].map((o) => ({
  ...o,
  note: AI_CAPABILITY_UNUSED.has(o.value) ? '暂无任务使用' : '',
}));

/** 能力中文名（单个位值 → 文案；未命中返回空串） */
export function aiCapabilityLabel(bit: number): string {
  return AI_CAPABILITY_OPTIONS.find((o) => o.value === bit)?.label ?? '';
}

/** 位掩码 → 能力中文名数组 */
export function aiCapabilityNames(bits?: null | number): string[] {
  if (!bits) return [];
  return AI_CAPABILITY_OPTIONS.filter((o) => (bits & o.value) !== 0).map(
    (o) => o.label,
  );
}

/** 能力来源（设计 §6.3 三级降级）：metadata → probed → manual */
export const AI_CAPABILITY_SOURCE = {
  metadata: '厂商接口元数据',
  probed: '模型自述探测',
  manual: '手工勾选',
} as const;

/** 提供商连通性状态（与后端 VerifyStatus 一致） */
export const AI_VERIFY_STATUS = {
  unverified: { color: 'default', label: '未验证' },
  ok: { color: 'success', label: '正常' },
  failed: { color: 'error', label: '失败' },
} as const;

/** 模型运行态（与后端 ServiceRunStatus 一致；由调度器/心跳维护） */
export const AI_RUN_STATUS = {
  idle: { label: '空闲', color: 'default' },
  busy: { label: '执行中', color: 'processing' },
  offline: { label: '离线', color: 'error' },
} as const;

// ─────────────────────────── 类型 ───────────────────────────

/** 模型列表项（字段名兼容一期，语义为**模型**） */
export interface AiProviderItem {
  id: number;
  /** 「提供商 / 模型名」（后端拼好，直接展示） */
  name: string;
  /** = 提供商的 provider_key（接入类型），如 deepseek / openai / comfyui / mock */
  providerType: string;
  providerId: number;
  providerName: string;
  /** 厂商侧的模型标识（如 deepseek-flash） */
  modelId: string;
  /** = modelId（兼容一期字段名） */
  model?: null | string;
  displayName?: null | string;
  /** 生效能力位掩码（**用户勾选值**） */
  capabilities: number;
  /** 厂商声明能力位掩码（对照展示「厂商支持但我没开」） */
  shadowCapabilities: number;
  /** metadata / probed / manual */
  capabilitiesSource?: null | string;
  contextWindow?: null | number;
  maxOutputTokens?: null | number;
  /** ComfyUI：绑定的工作流模板 id */
  bindWorkflowId?: null | number;
  /** 默认模型位掩码（该位命中 = 是某能力的默认模型） */
  defaultFor: number;
  isEnabled: boolean;
  sortNo: number;
  remark?: null | string;
  /** 归属算力节点（null = 独立外部 API，不占卡） */
  nodeId: null | number;
  nodeName: null | string;
  nodeOnline: boolean | null;
  nodeSwitching: boolean | null;
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

/** 任务选择器：按任务类型给出可选/置灰的**模型** */
export interface AiProviderAvailable {
  taskType: string;
  requiredCapabilities: number;
  needsProvider: boolean;
  autoProviderId?: null | number;
  autoProviderName?: null | string;
  items: {
    capabilities: number;
    defaultFor: number;
    displayName?: null | string;
    id: number;
    isDefaultForTask: boolean;
    isEnabled: boolean;
    model?: null | string;
    /** 「提供商 / 模型名」 */
    name: string;
    nodeId: null | number;
    nodeName: null | string;
    nodeOnline: boolean | null;
    nodeSwitching: boolean | null;
    paused: boolean;
    providerId: number;
    providerName: string;
    /** 提供商的 provider_key */
    providerType: string;
    runStatus: string;
    /** false → 前端置灰不可选（不具备该任务所需能力） */
    selectable: boolean;
    /** 「暂不可用」原因（节点离线/切换中/熔断）；null = 可正常选 */
    unavailableReason: null | string;
  }[];
}

// ─────────────────────────── 接口 ───────────────────────────

/** 模型列表 */
export async function aiProviderList() {
  return api.get<AiProviderItem[]>('/AiProvider/List');
}

/** 按任务类型列出模型（含 selectable，用于下拉置灰） */
export async function aiProviderAvailable(taskType: string, dramaId?: number) {
  return api.get<AiProviderAvailable>('/AiProvider/Available', {
    params: dramaId ? { taskType, dramaId } : { taskType },
  });
}

/** 启用/停用（= 用户勾选；停用即撤销默认，后端行为） */
export async function aiProviderSetEnabled(id: number, isEnabled: boolean) {
  return api.post('/AiProvider/SetEnabled', { id, isEnabled });
}

/**
 * 改生效能力（用户勾选值）+ 默认位。
 * ⚠️ 只能勾选适配器支持的能力（后端会拒绝并回显具体能力名）；默认位只能是已勾选能力的子集。
 */
export async function aiProviderSetCapabilities(
  id: number,
  capabilities: number,
  defaultFor = 0,
) {
  return api.post('/AiProvider/SetCapabilities', {
    id,
    capabilities,
    defaultFor,
  });
}

/** 追加设某能力位的默认模型（capability 必须是**单一**能力位） */
export async function aiProviderSetDefault(id: number, capability: number) {
  return api.post('/AiProvider/SetDefault', { id, capability });
}

/** 改归属算力节点（null = 独立外部 API，不占卡） */
export async function aiProviderSetNode(id: number, nodeId: null | number) {
  return api.post('/AiProvider/SetNode', { id, nodeId: nodeId ?? undefined });
}

export async function aiProviderDelete(id: number) {
  return api.post('/AiProvider/Delete', { id });
}
