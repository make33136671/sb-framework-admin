<script lang="ts" setup>
/**
 * PeakOffPeakBadge —— 峰谷状态徽标（成本感知调度界面 §6.1）
 *
 * 让用户**看得见**"现在是谷时、半价"——这是成本感知调度的前提：
 *   🌙 谷时 · 半价   /   ☀️ 峰时 · 原价（距谷时还有 X）
 *
 * 关键约定：
 * - **价格一律不可编辑**（D49：服务商定义，用户改了也不影响真实账单）→ 只读 tooltip；
 * - 峰谷按 **UTC** 判定，因此 tooltip 里必须给**本地时间对照**（避免用户误读）；
 * - `pricingUpdatedAt` 超过 ~90 天 → 提示「计价规则可能过时，建议核对官网」。
 * - 适配器无内置计价（supported=false）→ 不渲染（成本感知调度对它不参与判定）。
 *
 * 用法：<PeakOffPeakBadge :provider-id="row.id" />
 */
import { computed, onMounted, ref } from 'vue';

import { Tag, Tooltip } from 'ant-design-vue';

import type { AiProviderPricing } from '#/api/core/aiProviderAdmin';

import { aiProviderPricing } from '#/api/core/aiProviderAdmin';

const props = defineProps<{
  providerId: number;
}>();

const data = ref<AiProviderPricing | null>(null);
const loading = ref(false);

async function load() {
  if (!props.providerId) return;
  loading.value = true;
  try {
    data.value = await aiProviderPricing(props.providerId);
  } catch {
    // 计价接口失败不影响主列表（静默降级为不显示徽标）
    data.value = null;
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());

/** 无内置计价 / 请求失败 → 不显示（诚实：不显示比显示错的强） */
const show = computed(() => Boolean(data.value?.supported));

/** 币种符号（后端目前只有 CNY） */
const currencySymbol = computed(() =>
  (data.value?.currency ?? 'CNY').toUpperCase() === 'CNY' ? '¥' : '$',
);

/** 计价规则过时（> 90 天）→ 提示核对官网 */
const stale = computed(() => {
  const t = data.value?.pricingUpdatedAt;
  if (!t) return false;
  const ts = new Date(t).getTime();
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts > 90 * 24 * 60 * 60 * 1000;
});

/** 已过时天数（展示用） */
const staleDays = computed(() => {
  const t = data.value?.pricingUpdatedAt;
  if (!t) return 0;
  const ts = new Date(t).getTime();
  if (Number.isNaN(ts)) return 0;
  return Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000));
});

/** 当前生效单价（展示用） */
const currentPrice = computed(() => {
  const d = data.value;
  if (!d) return { input: null, output: null };
  return d.isPeak
    ? { input: d.peakInputPrice, output: d.peakOutputPrice }
    : { input: d.offPeakInputPrice, output: d.offPeakOutputPrice };
});

/** 服务端 UTC 时间（本地时钟不可信时的基准；缺省用浏览器时间兜底） */
const serverUtc = computed(() => {
  const t = data.value?.serverUtcNow;
  const d = t ? new Date(t) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
});

/** UTC 对照本地：显示本地时区名 + 本地时间（峰谷按 UTC 算，必须给对照） */
const localNow = computed(() => {
  const d = serverUtc.value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
});

const localZone = computed(
  () => Intl.DateTimeFormat().resolvedOptions().timeZone || '本地时区',
);

const utcText = computed(() => {
  const d = serverUtc.value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(
    d.getUTCDate(),
  )} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
});

/** tooltip 正文：完整规则（**只读**）+ UTC/本地对照 + 过时提醒 */
const tooltipLines = computed(() => {
  const d = data.value;
  if (!d) return [];
  const lines = [
    '峰时：周一至周五 01:00–04:00、06:00–10:00 (UTC)',
    '谷时：其余全部时段（含周末与中国大陆节假日）',
    '谷时单价 = 峰时的一半',
    '',
    `当前：${d.isPeak ? '峰时 · 原价' : '谷时 · 半价'} · 输入 ${currencySymbol.value}${currentPrice.value.input ?? '-'} / 1M · 输出 ${currencySymbol.value}${currentPrice.value.output ?? '-'} / 1M`,
    `规则来源：适配器内置，以厂商官网为准（界面不可编辑）`,
    d.note ? `说明：${d.note}` : '',
    '',
    `UTC 基准：${utcText.value}`,
    `本地对照：${localNow.value}（${localZone.value}）`,
  ];
  if (stale.value) {
    lines.push(`⚠️ 已 ${staleDays.value} 天未更新，建议核对官网`);
  }
  return lines.filter((l) => l !== null);
});
</script>

<template>
  <Tooltip v-if="show" :title="tooltipLines.join('\n')">
    <Tag
      class="!mr-0 cursor-help"
      :color="data?.isPeak ? 'default' : 'success'"
    >
      {{ data?.isPeak ? '☀️ 峰时 · 原价' : '🌙 谷时 · 半价' }}
      <span v-if="stale" class="ml-1 text-[10px] opacity-70">· 规则待核对</span>
    </Tag>
  </Tooltip>
</template>
