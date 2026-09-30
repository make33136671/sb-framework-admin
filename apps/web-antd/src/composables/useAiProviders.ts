/**
 * 能力位 ↔ 中文名（与后端 AiCapabilities 一致）
 *
 * 任务列表/详情用它说明「这类任务需要什么能力」，
 * 与「AI 服务」页的勾选项、后端校验提示保持同一套文案。
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
  return names.length > 0 ? names.join(' / ') : '无需服务';
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
      return '本地合并（无需服务）';
    }
    default: {
      return '未知';
    }
  }
}
