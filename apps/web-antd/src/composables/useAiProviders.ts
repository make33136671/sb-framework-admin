/**
 * 能力位 ↔ 中文名（与后端 AiCapabilities 一致，二期扩到 7 位）
 *
 * 任务列表/详情用它说明「这类任务需要什么能力」，
 * 与「AI 模型」页的勾选项、后端校验提示保持同一套文案。
 *
 * 二期的语义变化（前端设计 §7）：
 *   - 「服务」→「模型」：下拉展示为 `提供商 / 模型名`，同名模型不再混淆；
 *   - 能力从 4 种扩到 7 种（新增向量 / 语音合成 / 语音识别，**暂无任务使用**）。
 */
import { AI_CAPABILITY, AI_CAPABILITY_OPTIONS } from '#/api/core/aiProvider';

/** 位掩码 → 中文名数组 */
export function capabilityNames(bits?: null | number): string[] {
  if (!bits) return [];
  return AI_CAPABILITY_OPTIONS.filter((o) => (bits & o.value) !== 0).map(
    (o) => o.label,
  );
}

/** 位掩码 → 「文本处理」这样的单串（多个能力用 / 连接） */
export function capabilityText(bits?: null | number): string {
  const names = capabilityNames(bits);
  return names.length > 0 ? names.join(' / ') : '无需模型';
}

/** 单一能力位 → 中文名（未命中返回空串） */
export function singleCapabilityText(bit?: null | number): string {
  if (!bit) return '';
  return AI_CAPABILITY_OPTIONS.find((o) => o.value === bit)?.label ?? '';
}

/** 任务类型 → 所需能力中文名（与后端 TaskCapabilityMap 一一对应） */
export function requiredCapabilityText(taskType: string): string {
  switch (taskType) {
    case 'rewrite':
    case 'storyboard':
    case 'asset_extract': {
      return capabilityText(AI_CAPABILITY.text);
    }
    case 't2i': {
      return capabilityText(AI_CAPABILITY.imageGen);
    }
    case 'i2v': {
      return capabilityText(AI_CAPABILITY.videoGen);
    }
    case 'concat': {
      return '本地合并（无需模型）';
    }
    default: {
      return '未知';
    }
  }
}

/** 任务类型 → 所需能力位掩码（与后端 TaskCapabilityMap.RequiredFor 一致） */
export function requiredCapabilityBits(taskType: string): number {
  switch (taskType) {
    case 'rewrite':
    case 'storyboard':
    case 'asset_extract': {
      return AI_CAPABILITY.text;
    }
    case 't2i': {
      return AI_CAPABILITY.imageGen;
    }
    case 'i2v': {
      return AI_CAPABILITY.videoGen;
    }
    default: {
      return 0;
    }
  }
}
