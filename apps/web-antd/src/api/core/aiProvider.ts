/**
 * AI 线路（模型/提供商）接口
 *
 * 「线路」= 系统里配置的一个 AI 模型（OpenAI 兼容 / ComfyUI / mock），
 * 添加时勾选它具备的能力；任务按所需能力选线路，不具备该能力的线路在 UI 置灰。
 *
 * 约定：
 * - 能力/默认线路都是**位掩码**（见 AiCapabilities），前后端一致；
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
  /** 默认线路位掩码（该位命中 = 是某能力的默认线路） */
  defaultFor: number;
  isEnabled: boolean;
  sortNo: number;
  remark?: null | string;
  createdAt: string;
  updatedAt: string;
}

/** 任务选择器：按任务类型给出可选/置灰的线路 */
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
    /** false → 前端置灰不可选（不具备该任务所需能力） */
    selectable: boolean;
    isDefaultForTask: boolean;
  }[];
}

// ─────────────────────────── 接口 ───────────────────────────

export async function aiProviderList() {
  return api.get<AiProviderItem[]>('/AiProvider/List');
}

/** 按任务类型列出线路（含 selectable，用于下拉置灰） */
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
}) {
  return api.post<{ id: number }>('/AiProvider/Save', data);
}

export async function aiProviderSetEnabled(id: number, isEnabled: boolean) {
  return api.post('/AiProvider/SetEnabled', { id, isEnabled });
}

export async function aiProviderDelete(id: number) {
  return api.post('/AiProvider/Delete', { id });
}
