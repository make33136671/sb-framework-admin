<script lang="ts" setup>
import type { EchartsUIType } from '@vben/plugins/echarts';

import { onMounted, ref } from 'vue';

import { EchartsUI, useEcharts } from '@vben/plugins/echarts';

import { getMemberTrend } from '../api';

const chartRef = ref<EchartsUIType>();
const { renderEcharts } = useEcharts(chartRef);

onMounted(async () => {
  const res: any = await getMemberTrend(30);
  if (!res) return;

  renderEcharts({
    grid: { bottom: 0, containLabel: true, left: '1%', right: '1%', top: '2%' },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: res.labels,
      axisTick: { show: false },
    },
    yAxis: { type: 'value', splitNumber: 4 },
    series: [
      {
        name: '新增会员',
        type: 'line',
        smooth: true,
        areaStyle: { opacity: 0.3 },
        itemStyle: { color: '#5ab1ef' },
        data: res.values,
      },
    ],
  });
});
</script>

<template>
  <EchartsUI ref="chartRef" />
</template>
