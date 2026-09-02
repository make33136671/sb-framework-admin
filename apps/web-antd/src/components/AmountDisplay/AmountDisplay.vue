<script lang="ts" setup>
import { computed } from 'vue';

import { IconifyIcon } from '@vben/icons';
import { useI18n } from '@vben/locales';

interface Props {
  amount: number;
  /** 货币文字标识 (如 'USDT', '$', '¥') */
  currency?: string;
  /** Iconify 图标名称 */
  currencyIcon?: string;
  /** icon 显示图标, text 显示文字符号 */
  mode?: 'icon' | 'text';
  /** 小数位数 */
  decimals?: number;
}

const props = withDefaults(defineProps<Props>(), {
  currency: 'USDT',
  currencyIcon: 'cryptocurrency-color:usdt',
  mode: 'icon',
  decimals: 2,
});

// 单位标签 (中/英)
const ZH_UNITS = [
  '厘',
  '分',
  '角',
  '元',
  '十',
  '百',
  '千',
  '万',
  '十万',
  '百万',
  '千万',
  '亿',
  '十亿',
  '百亿',
];
const EN_UNITS = [
  'Mill',
  'Cent',
  'Dime',
  '1',
  '10',
  '100',
  '1K',
  '10K',
  '100K',
  '1M',
  '10M',
  '100M',
  '1B',
  '10B',
];

// 渐进色阶: 从冷色浅调到暖色深调, 视觉重量逐级递增
const LEVEL_STYLES = [
  // 厘 (sub-fen): 中性灰 — 可忽略金额
  { bg: '#f1f5f9', text: '#94a3b8', border: '#e2e8f0' },
  // 分: 淡绿
  { bg: '#ecfdf5', text: '#059669', border: '#a7f3d0' },
  // 角: 青蓝
  { bg: '#e0f2fe', text: '#0891b2', border: '#67e8f9' },
  // 元: 浅蓝
  { bg: '#dbeafe', text: '#2563eb', border: '#93c5fd' },
  // 十: 蓝
  { bg: '#bfdbfe', text: '#1d4ed8', border: '#60a5fa' },
  // 百: 实心蓝
  { bg: '#3b82f6', text: '#ffffff', border: '#2563eb' },
  // 千: 深蓝
  { bg: '#1d4ed8', text: '#ffffff', border: '#1e40af' },
  // 万: 靛青
  { bg: '#4f46e5', text: '#ffffff', border: '#4338ca' },
  // 十万: 深靛青
  { bg: '#3730a3', text: '#ffffff', border: '#312e81' },
  // 百万: 紫
  { bg: '#7c3aed', text: '#ffffff', border: '#6d28d9' },
  // 千万: 深紫
  { bg: '#6d28d9', text: '#ffffff', border: '#5b21b6' },
  // 亿: 品红
  { bg: '#c026d3', text: '#ffffff', border: '#a21caf' },
  // 十亿: 玫红
  { bg: '#e11d48', text: '#ffffff', border: '#be123c' },
  // 百亿: 深红 — 最重
  { bg: '#9f1239', text: '#ffffff', border: '#881337' },
];

const { locale } = useI18n();

/** 计算数量级 (0=厘, 1=分, ..., 13=百亿) */
const level = computed(() => {
  const abs = Math.abs(props.amount);
  if (abs < 0.01) return 0;
  if (abs < 0.1) return 1;
  if (abs < 1) return 2;
  if (abs < 10) return 3;
  if (abs < 100) return 4;
  if (abs < 1_000) return 5;
  if (abs < 10_000) return 6;
  if (abs < 100_000) return 7;
  if (abs < 1_000_000) return 8;
  if (abs < 10_000_000) return 9;
  if (abs < 100_000_000) return 10;
  if (abs < 1_000_000_000) return 11;
  if (abs < 10_000_000_000) return 12;
  return 13;
});

const unitLabel = computed(() => {
  const units = locale.value.startsWith('en') ? EN_UNITS : ZH_UNITS;
  return units[level.value]!;
});

const tagStyle = computed(() => {
  const s = LEVEL_STYLES[level.value]!;
  return {
    backgroundColor: s.bg,
    color: s.text,
    borderColor: s.border,
  };
});

const formattedAmount = computed(() => {
  const abs = Math.abs(props.amount);
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: props.decimals,
    maximumFractionDigits: props.decimals,
  });
  return props.amount < 0 ? `-${formatted}` : formatted;
});
</script>

<template>
  <span class="amount-display" :style="tagStyle">
    <span class="amount-display__unit">{{ unitLabel }}</span>
    <span class="amount-display__sep"></span>
    <span class="amount-display__value">{{ formattedAmount }}</span>
    <span class="amount-display__currency">
      <IconifyIcon
        v-if="mode === 'icon'"
        :icon="currencyIcon"
        class="amount-display__icon"
      />
      <template v-else>{{ currency }}</template>
    </span>
  </span>
</template>

<style scoped>
.amount-display {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  padding: 1px 8px;
  font-size: 12px;
  line-height: 22px;
  white-space: nowrap;
  border: 1px solid;
  border-radius: 4px;
}

.amount-display__unit {
  font-size: 11px;
  font-weight: 500;
  opacity: 0.85;
}

.amount-display__sep {
  width: 1px;
  height: 12px;
  background: currentcolor;
  opacity: 0.25;
}

.amount-display__value {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.amount-display__currency {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  opacity: 0.85;
}

.amount-display__icon {
  width: 14px;
  height: 14px;
}
</style>
