<script lang="ts" setup>
import type { EchartsUIType } from '@vben/plugins/echarts';

import { onMounted, ref } from 'vue';

import { EchartsUI, useEcharts } from '@vben/plugins/echarts';

import { getMemberDistribution } from '../api';

const chartRef = ref<EchartsUIType>();
const { renderEcharts } = useEcharts(chartRef);

const colorMap: Record<string, string> = {
  '未认证': '#d9d9d9',
  '审核中': '#1890ff',
  '已认证': '#52c41a',
  '已拒绝': '#ff4d4f',
};

onMounted(async () => {
  const res: any = await getMemberDistribution();
  if (!res) return;

  renderEcharts({
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0 },
    series: [
      {
        type: 'pie',
        radius: ['40%', '65%'],
        center: ['50%', '45%'],
        itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
        label: { show: true, formatter: '{b}\n{c}人' },
        data: (res.realName || []).map((item: any) => ({
          ...item,
          itemStyle: { color: colorMap[item.name] || '#999' },
        })),
      },
    ],
  });
});
</script>

<template>
  <EchartsUI ref="chartRef" />
</template>
