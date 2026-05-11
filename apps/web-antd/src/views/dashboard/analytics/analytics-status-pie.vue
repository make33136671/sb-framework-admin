<script lang="ts" setup>
import type { EchartsUIType } from '@vben/plugins/echarts';

import { onMounted, ref } from 'vue';

import { EchartsUI, useEcharts } from '@vben/plugins/echarts';

import { getMemberDistribution } from '../api';

const chartRef = ref<EchartsUIType>();
const { renderEcharts } = useEcharts(chartRef);

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
        data: (res.status || []).map((item: any) => ({
          ...item,
          itemStyle: { color: item.name === '正常' ? '#52c41a' : '#ff4d4f' },
        })),
      },
    ],
  });
});
</script>

<template>
  <EchartsUI ref="chartRef" />
</template>
