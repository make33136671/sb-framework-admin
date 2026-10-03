<script lang="ts" setup>
import type { AiProviderAvailable } from '#/api/core/aiProvider';

/**
 * AiProviderSelect —— 「用哪个服务跑」选择器
 *
 * 能力不匹配的服务**置灰不可选**（后端 Available 已给出 selectable，前端只负责渲染规则）。
 * 默认选中「自动（默认服务）」：不指定服务，执行时按该能力的默认服务走 —— 与后端解析顺序一致。
 *
 * 算力调度（P2）：服务可能归属算力节点，选项上标注节点离线 / 切换中 / 熔断（仅标注，不禁选 ——
 * 节点离线时任务照常提交，排队等节点恢复）。
 *
 * 用法：<AiProviderSelect v-model:value="providerId" task-type="t2i" />
 */
import { computed, onMounted, ref, watch } from 'vue';

import { Select, Tag, Tooltip } from 'ant-design-vue';

import { AI_CAPABILITY, aiProviderAvailable } from '#/api/core/aiProvider';

const props = withDefaults(
  defineProps<{
    disabled?: boolean;
    /** 任务类型（决定所需能力：t2i → 图片生成，i2v → 视频生成，rewrite → 文本…） */
    taskType: string;
    /** 当前选中的服务 id；null = 自动（默认服务） */
    value?: null | number;
  }>(),
  { disabled: false, value: null },
);

const emit = defineEmits<{
  (e: 'update:value', id: null | number): void;
}>();

const data = ref<AiProviderAvailable | null>(null);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    data.value = await aiProviderAvailable(props.taskType);
  } catch {
    // 拦截器已提示
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());
watch(
  () => props.taskType,
  () => void load(),
);

/** 该任务需要的能力中文名（用于提示「为什么有些服务是灰的」） */
const capabilityText = computed(() => {
  const c = data.value?.requiredCapabilities ?? 0;
  if (c & AI_CAPABILITY.text) return '文本处理';
  if (c & AI_CAPABILITY.imageGen) return '图片生成';
  if (c & AI_CAPABILITY.imageUnderstand) return '图片理解';
  if (c & AI_CAPABILITY.videoGen) return '视频生成';
  return '—';
});

/** 可选服务数 / 灰掉的服务数 */
const selectableCount = computed(
  () => data.value?.items.filter((i) => i.selectable).length ?? 0,
);
const blockedCount = computed(
  () => data.value?.items.filter((i) => !i.selectable).length ?? 0,
);

interface Option {
  disabled: boolean;
  label: string;
  value: number | undefined;
}

/** 节点侧状态标注（离线 / 切换中 / 熔断）：只标注，不禁选 */
function nodeNote(item: AiProviderAvailable['items'][number]): string {
  if (item.unavailableReason) return `（${item.unavailableReason}）`;
  if (item.paused) return '（熔断暂停中）';
  return '';
}

const options = computed<Option[]>(() => {
  const list: Option[] = [
    {
      value: undefined,
      disabled: false,
      label: data.value?.autoProviderName
        ? `自动（默认服务：${data.value.autoProviderName}）`
        : '自动（默认服务）',
    },
  ];
  for (const p of data.value?.items ?? []) {
    const suffix = p.selectable
      ? nodeNote(p)
      : `（不具备${capabilityText.value}能力）`;
    list.push({
      value: p.id,
      disabled: !p.selectable,
      label: `${p.name}${p.model ? ` · ${p.model}` : ''}${suffix}`,
    });
  }
  return list;
});

function onChange(v: unknown) {
  emit('update:value', typeof v === 'number' ? v : null);
}

/** 未指定服务时的实际去向（提示用） */
const autoName = computed(() => data.value?.autoProviderName ?? null);
</script>

<template>
  <div class="flex flex-wrap items-center gap-1">
    <Select
      :disabled="disabled || !data?.needsProvider || selectableCount === 0"
      :loading="loading"
      :options="options"
      :value="value ?? undefined"
      class="min-w-[220px]"
      placeholder="选择服务"
      @change="onChange"
    >
      <template #option="{ label, disabled: optionDisabled }">
        <span :class="optionDisabled ? 'text-muted-foreground' : ''">
          {{ label }}
        </span>
      </template>
    </Select>

    <Tooltip
      v-if="!data?.needsProvider"
      title="该任务类型为本地处理（如成片合并），不需要 AI 服务"
    >
      <Tag class="!mr-0">无需服务</Tag>
    </Tooltip>
    <Tag v-else-if="selectableCount === 0" color="error" class="!mr-0">
      没有服务具备「{{ capabilityText }}」能力，请到 AI 服务页添加
    </Tag>
    <Tooltip
      v-else
      :title="
        blockedCount > 0
          ? `已置灰 ${blockedCount} 个不具备「${capabilityText}」能力的服务`
          : `当前有 ${selectableCount} 个服务可用于「${capabilityText}」`
      "
    >
      <span class="text-xs text-muted-foreground">
        {{ capabilityText }} · 可用 {{ selectableCount }}
        <template v-if="blockedCount > 0"> · 置灰 {{ blockedCount }}</template>
        <template v-if="value === null && autoName">
          · 实际用「{{ autoName }}」
        </template>
      </span>
    </Tooltip>
  </div>
</template>
