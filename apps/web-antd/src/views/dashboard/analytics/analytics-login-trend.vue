<script lang="ts" setup>
import type { EchartsUIType } from '@vben/plugins/echarts';

import { onMounted, ref } from 'vue';

import { EchartsUI, useEcharts } from '@vben/plugins/echarts';

import { getLoginTrend } from '../api';

const chartRef = ref<EchartsUIType>();
const { renderEcharts } = useEcharts(chartRef);

onMounted(async () => {
  const res: any = await getLoginTrend(7);
  if (!res) return;

  renderEcharts({
    grid: { bottom: 0, containLabel: true, left: '1%', right: '1%', top: '2%' },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: res.labels,
    },
    yAxis: { type: 'value', splitNumber: 4 },
    series: [
      {
        name: '活跃用户',
        type: 'bar',
        barMaxWidth: 40,
        itemStyle: { color: '#019680', borderRadius: [4, 4, 0, 0] },
        data: res.values,
      },
    ],
  });
});
</script>

<template>
  <EchartsUI ref="chartRef" />
</template>
