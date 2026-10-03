<script lang="ts" setup>
/**
 * TaskRouteBadge —— 任务路由徽标（成本感知调度 §8.7 / T14.11）
 *
 * 展示任务跑在哪里 + **为什么** + 花了多少：
 *   `route === 'cloud'` → ☁ 云端 · ¥0.42（谷时 / 峰时标注）
 *   `route == null`     → **不渲染任何徽标**（= 无上云决策记录）
 *
 * **上云原因 tooltip**（这是成本感知调度的信任基础，与「上云决策回看」互补）：
 *   优先用后端拼好的 `routeReasonText`（如「优惠时段内性价比达标，自动上云执行」），
 *   缺失时才回退本地原因码映射表。
 *
 * ⚠️ 后端契约（TaskController.ToView / TaskDetailView）**只发 `cloud` 或 null**：
 * 不存在 `local` / `cloud_manual` 取值。因此"无徽标"就等于"没有上云决策记录"，
 * 不要把它渲染成「🏠 本地」——那是后端没有做的断言（后端若哪天真发 local，
 * 这里加一个分支即可，但绝不预先假设）。
 */
import { computed } from 'vue';

import { Tag, Tooltip } from 'ant-design-vue';

const props = withDefaults(
  defineProps<{
    /** 该次上云花费（元） */
    costYuan?: null | number;
    /** 是否谷时上云 */
    offPeak?: boolean | null;
    /** 上云原因码（cloud_cost_benefit…）；仅作兜底，优先用 reasonText */
    reason?: null | string;
    /** 后端拼好的中文原因说明（routeReasonText）——优先展示 */
    reasonText?: null | string;
    /** `cloud` = 有上云决策；null/undefined = 无记录（不渲染） */
    route?: null | string;
  }>(),
  {
    route: null,
    reason: null,
    reasonText: null,
    costYuan: null,
    offPeak: null,
  },
);

/** 上云原因码 → 中文（后端 routeReasonText 缺失时的兜底） */
const REASON_TEXT: Record<string, string> = {
  cloud_cost_benefit: '优惠时段内性价比达标，自动上云执行',
  cloud_manual: '手动指定云端模型',
  cloud_emergency: '紧急通道云端兜底（系统不卡壳优先）',
};

/** 仅 `cloud` 渲染徽标；null / 未知值一律不渲染（不猜） */
const isCloud = computed(
  () => (props.route ?? '').toLowerCase().trim() === 'cloud',
);

const label = computed(() =>
  props.offPeak === false ? '☁ 云端·峰时' : '☁ 云端·谷时',
);

/** 金额文案（云端任务才有） */
const money = computed(() => {
  const c = props.costYuan;
  if (c === null || c === undefined) return '';
  return `¥${Number(c).toFixed(2)}`;
});

const tip = computed(() => {
  const lines: string[] = ['路由：成本感知自动上云'];
  // 优先后端拼好的中文；缺失才回退本地映射
  const humanized =
    props.reasonText ||
    (props.reason ? (REASON_TEXT[props.reason] ?? props.reason) : '');
  if (humanized) lines.push(`上云原因：${humanized}`);
  if (props.offPeak !== null && props.offPeak !== undefined) {
    lines.push(
      `计价时段：${props.offPeak ? '谷时（优惠价）' : '峰时（原价）'}`,
    );
  }
  if (money.value) lines.push(`花费：${money.value}`);
  return lines.join('\n');
});
</script>

<template>
  <Tooltip v-if="isCloud" :title="tip">
    <span class="inline-flex items-center gap-1 whitespace-nowrap">
      <Tag color="blue" class="!mr-0 cursor-help">{{ label }}</Tag>
      <span v-if="money" class="text-xs tabular-nums text-muted-foreground">
        {{ money }}
      </span>
    </span>
  </Tooltip>
</template>
