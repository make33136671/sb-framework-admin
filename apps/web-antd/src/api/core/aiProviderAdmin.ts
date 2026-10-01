/**
 * AI 提供商管理接口（二期新增，设计 §7.1 / 前端设计 §2）
 *
 * 二期把「一个模型 = 一条手填记录」升级为 **提供商 → 模型** 两层：
 *   - 「AI 提供商」页 = 管"怎么连厂商"（名字/地址/Key/测试连通/拉模型）← 本文件
 *   - 「AI 模型」页   = 管"系统能用哪些模型、它们有什么能力"（见 aiProvider.ts）
 *
 * 主流程（前端设计 §2.3）：
 *   Save 提供商 → TestConnection（拉模型 + 增量合并）→ 勾选 → SaveModels
 * 私有部署拉不到模型列表时走 AddModelManually；ComfyUI 无模型列表概念，只能手工添加，
 * 且其模型**必须绑定工作流模板**（bindWorkflowId）。
 *
 * 约定：
 * - **接入类型（providerKey）不再硬编码**，一律取自 AdapterTypes（动态）；
 * - `apiKey` 永不回显明文（列表只有 hasApiKey）；编辑时留空 = 不修改已存密钥；
 * - controller 全部 `[FromForm]` → 走 api 的 form-urlencoded 约定，无需 FormData；
 * - 不写配对 toast（拦截器已统一处理）。
 */
import { api } from '#/api/request';

// ─────────────────────────── 接入类型（适配器清单） ───────────────────────────

/** 适配器自述的能力勾选项（只含该适配器支持的能力） */
export interface AiAdapterCapabilityOption {
  value: number;
  label: string;
  /** 非空 → 渲染为灰字提示（如「暂无任务使用」） */
  note?: null | string;
}

export interface AiAdapterType {
  providerKey: string;
  displayName: string;
  defaultBaseUrl?: null | string;
  requiresApiKey: boolean;
  supportsModelList: boolean;
  /** 该适配器支持的能力位掩码 */
  supportedCapabilities: number;
  capabilityOptions: AiAdapterCapabilityOption[];
}

// ─────────────────────────── 提供商 ───────────────────────────

export interface AiProviderAdminItem {
  id: number;
  name: string;
  /** 接入类型标识（对应适配器 ProviderKey），如 deepseek / openai / comfyui / mock */
  providerKey: string;
  /** 适配器展示名；适配器缺失时为「（适配器缺失）」 */
  adapterDisplayName: string;
  /** 适配器缺失：行标红，其模型不参与调度（设计 §7.3） */
  adapterMissing: boolean;
  baseUrl?: null | string;
  /** 该适配器的默认地址（「恢复默认」用） */
  defaultBaseUrl?: null | string;
  /** 密钥已配置（**列表永不返回明文**） */
  hasApiKey: boolean;
  requiresApiKey: boolean;
  supportsModelList: boolean;
  supportedCapabilities: number;
  /** 适配器私有配置（JSON 字符串，如 comfyui 的 timeout / default_workflow_id） */
  adapterConfig?: null | string;
  /** unverified / ok / failed */
  verifyStatus: string;
  verifyMessage?: null | string;
  verifiedAt?: null | string;
  /** 其下模型总数 */
  modelCount: number;
  /** 其中已启用数 */
  enabledCount: number;
  isEnabled: boolean;
  sortNo: number;
  remark?: null | string;
  createdAt: string;
  updatedAt: string;
}

export interface AiProviderAdminSaveParams {
  name: string;
  providerKey: string;
  id?: number;
  baseUrl?: string;
  /** 留空 = 不修改已保存的密钥 */
  apiKey?: string;
  /** JSON **字符串**（不是对象）：后端 [FromForm] string 接收 */
  adapterConfig?: string;
  isEnabled?: boolean;
  sortNo?: number;
  remark?: string;
}

// ─────────────────────────── 测试连通性 ───────────────────────────

export interface DiscoveryModelItem {
  modelId: string;
  displayName?: null | string;
  /** 厂商声明能力位（元数据 / 探测所得） */
  shadowCapabilities: number;
  /** false → 接口没给元数据，界面显示「能力未探测」+【探测】按钮 */
  capabilitiesKnown: boolean;
  contextWindow?: null | number;
  maxOutputTokens?: null | number;
  /** 本地已存在该模型（重复测试时保留用户已有勾选） */
  existsLocally: boolean;
  /** **已存在行的当前启用状态；新模型恒为 false（默认不勾）** */
  isEnabled: boolean;
  /** **已存在行的当前生效能力；新模型为 0** */
  capabilities: number;
  /** metadata / probed / manual */
  capabilitiesSource?: null | string;
  /** 能力预填建议值 = shadow（已启用行则为其现有 capabilities） */
  suggestedCapabilities: number;
}

export interface TestConnectionResult {
  ok: boolean;
  message: string;
  httpStatus?: null | number;
  supportsModelList: boolean;
  remoteCount: number;
  models: DiscoveryModelItem[];
}

/**
 * 测试连通性 + 拉模型列表（**核心**）。
 * 入参二选一：已保存的 `providerId`，或未保存的临时配置（providerKey/baseUrl/apiKey/adapterConfig）。
 */
export async function aiProviderTestConnection(data: {
  providerId?: number;
  providerKey?: string;
  baseUrl?: string;
  apiKey?: string;
  adapterConfig?: string;
  name?: string;
}) {
  return api.post<TestConnectionResult>(
    '/AiProviderAdmin/TestConnection',
    data,
    { quiet: true },
  );
}

/** 能力探测（不落库）：predefined=null → 「模型未能自述能力，请手工勾选」 */
export async function aiProviderProbeCapabilities(data: {
  providerId: number;
  modelId: string;
}) {
  return api.post<{ predefined: null | number; raw?: number }>(
    '/AiProviderAdmin/ProbeCapabilities',
    data,
    { quiet: true },
  );
}

// ─────────────────────────── 模型保存 ───────────────────────────

/** SaveModels 的单项（itemsJson 里的元素） */
export interface SaveModelItem {
  modelId: string;
  displayName?: string;
  isEnabled: boolean;
  capabilities: number;
  defaultFor?: number;
  shadowCapabilities?: number;
  capabilitiesSource?: string;
  contextWindow?: null | number;
  maxOutputTokens?: null | number;
  bindWorkflowId?: null | number;
  nodeId?: null | number;
}

/**
 * 保存用户勾选结果（**增量 upsert**：只处理提交上来的模型，未提交的保持原样）。
 * `itemsJson` 是 JSON **字符串**。
 */
export async function aiProviderSaveModels(
  providerId: number,
  items: SaveModelItem[],
) {
  return api.post<{ inserted: number; updated: number }>(
    '/AiProviderAdmin/SaveModels',
    { providerId, itemsJson: JSON.stringify(items) },
  );
}

/** 手工添加模型（私有部署 / ComfyUI 虚拟模型；ComfyUI 应传 bindWorkflowId） */
export async function aiProviderAddModelManually(data: {
  providerId: number;
  modelId: string;
  displayName?: string;
  capabilities: number;
  bindWorkflowId?: null | number;
  nodeId?: null | number;
  sortNo?: number;
  remark?: string;
  isEnabled?: boolean;
}) {
  return api.post<{ id: number }>('/AiProviderAdmin/AddModelManually', data);
}

export async function aiProviderDeleteModel(id: number) {
  return api.post('/AiProviderAdmin/DeleteModel', { id });
}

/** 设默认模型（按**单一**能力位） */
export async function aiProviderAdminSetDefault(
  modelRowId: number,
  capability: number,
) {
  return api.post('/AiProviderAdmin/SetDefault', { modelRowId, capability });
}

// ─────────────────────────── 提供商 CRUD ───────────────────────────

/** 已注册适配器清单（渲染「接入类型」下拉，**动态**，不硬编码） */
export async function aiProviderAdapterTypes() {
  return api.get<AiAdapterType[]>('/AiProviderAdmin/AdapterTypes');
}

export async function aiProviderAdminList() {
  return api.get<AiProviderAdminItem[]>('/AiProviderAdmin/List');
}

export async function aiProviderAdminSave(data: AiProviderAdminSaveParams) {
  return api.post<{ id: number }>('/AiProviderAdmin/Save', data);
}

export async function aiProviderAdminDelete(id: number) {
  return api.post('/AiProviderAdmin/Delete', { id });
}

// ─────────────────────────── 计价（峰谷只读展示） ───────────────────────────

export interface AiProviderPricing {
  providerId: number;
  providerName: string;
  /** false → 该适配器无内置计价（成本感知调度不参与判定） */
  supported: boolean;
  currency: string;
  peakInputPrice?: null | number;
  peakOutputPrice?: null | number;
  offPeakInputPrice?: null | number;
  offPeakOutputPrice?: null | number;
  /** 此刻是否峰时（UTC 判定） */
  isPeak: boolean;
  /** peak / off_peak / unknown */
  period: string;
  note?: null | string;
  /** 计价规则版本时间；过旧 → 界面提示「计价规则可能过时」 */
  pricingUpdatedAt?: null | string;
  /** 服务端 UTC 当前时间（前端本地时钟不可信时的对照基准） */
  serverUtcNow?: null | string;
}

/** 计价规则 + 当前峰谷状态（**只读**：峰谷由服务商定义，用户改不了，D49） */
export async function aiProviderPricing(providerId: number) {
  return api.get<AiProviderPricing>('/AiProviderAdmin/Pricing', {
    params: { providerId },
  });
}
