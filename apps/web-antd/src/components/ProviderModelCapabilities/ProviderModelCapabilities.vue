<script lang="ts" setup>
/**
 * ProviderModelCapabilities —— 「生效能力 vs 厂商声明能力」对照徽标
 *
 * 这是二期功能的核心卖点（前端设计 §4.3 / R4）：用户能一眼看出
 * **「厂商支持但我没开」** —— 生效能力用实心 Tag，厂商声明但未启用用空心 Tag（虚线边框）
 * + 「厂商支持」灰字。
 *
 * 用法：
 *   <ProviderModelCapabilities :capabilities="row.capabilities" :shadow-capabilities="row.shadowCapabilities" />
 *
 * 说明：
 * - 未勾选（生效）的能力一律不显示实心 Tag —— 未勾选 = 系统不可调用，界面不得暗示可用；
 * - TTS/ASR/向量标「暂无任务使用」（诚实告知勾了也暂时没地方用）。
 */
import { computed } from 'vue';

import { Tag, Tooltip } from 'ant-design-vue';

import { AI_CAPABILITY_OPTIONS } from '#/api/core/aiProvider';

const props = withDefaults(
  defineProps<{
    /** 生效能力位掩码（用户勾选值） */
    capabilities?: null | number;
    /** 厂商声明能力位掩码（可选；缺省则不显示对照） */
    shadowCapabilities?: null | number;
    /** 紧凑模式（表格里用，字号更小） */
    size?: 'default' | 'small';
  }>(),
  { capabilities: 0, shadowCapabilities: 0, size: 'small' },
);

interface Item {
  label: string;
  note: string;
  value: number;
}

const active = computed<Item[]>(() =>
  AI_CAPABILITY_OPTIONS.filter(
    (o) => ((props.capabilities ?? 0) & o.value) !== 0,
  ),
);

/** 厂商声明但**未生效**（R4 落地：这是「厂商支持但我没开」） */
const shadowOnly = computed<Item[]>(() => {
  const shadow = props.shadowCapabilities ?? 0;
  if (!shadow) return [];
  const caps = props.capabilities ?? 0;
  return AI_CAPABILITY_OPTIONS.filter(
    (o) => (shadow & o.value) !== 0 && (caps & o.value) === 0,
  );
});

const hasAny = computed(
  () => active.value.length > 0 || shadowOnly.value.length > 0,
);
</script>

<template>
  <span v-if="hasAny" class="flex flex-wrap items-center gap-1">
    <!-- 生效能力：实心 -->
    <Tooltip
      v-for="c in active"
      :key="`a-${c.value}`"
      :title="c.note || c.label"
    >
      <Tag class="!mr-0" :color="c.note ? 'default' : 'blue'">
        {{ c.label }}
        <span v-if="c.note" class="ml-1 text-[10px] opacity-70">
          ({{ c.note }})
        </span>
      </Tag>
    </Tooltip>

    <!-- 厂商声明但未启用：空心 + 「厂商支持」 -->
    <Tooltip
      v-for="c in shadowOnly"
      :key="`s-${c.value}`"
      title="厂商接口声明支持该能力，但系统未启用（未勾选 = 不允许调用）"
    >
      <Tag class="!mr-0 border-dashed opacity-70">
        {{ c.label }}
        <span class="ml-1 text-[10px] text-muted-foreground">厂商支持</span>
      </Tag>
    </Tooltip>
  </span>

  <span v-else class="text-xs text-muted-foreground">（未勾选任何能力）</span>
</template>
