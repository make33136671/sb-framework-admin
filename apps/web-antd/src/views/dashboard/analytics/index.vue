<script lang="ts" setup>
import type { AnalysisOverviewItem } from '@vben/common-ui';

import { computed, onMounted, ref } from 'vue';

import {
  AnalysisChartCard,
  AnalysisChartsTabs,
  AnalysisOverview,
} from '@vben/common-ui';
import {
  SvgBellIcon,
  SvgCakeIcon,
  SvgCardIcon,
  SvgDownloadIcon,
} from '@vben/icons';

import { getOverview } from '../api';
import AnalyticsLoginTrend from './analytics-login-trend.vue';
import AnalyticsMemberTrend from './analytics-member-trend.vue';
import AnalyticsRealNamePie from './analytics-realname-pie.vue';
import AnalyticsStatusPie from './analytics-status-pie.vue';

const overview = ref<any>({});

onMounted(async () => {
  const res: any = await getOverview();
  overview.value = res || {};
});

const overviewItems = computed<AnalysisOverviewItem[]>(() => {
  const o = overview.value;
  return [
    {
      icon: SvgCardIcon,
      title: '今日新增',
      totalTitle: '总会员数',
      totalValue: o.totalMembers ?? 0,
      value: o.todayNewMembers ?? 0,
    },
    {
      icon: SvgCakeIcon,
      title: '今日活跃',
      totalTitle: '昨日活跃',
      totalValue: o.yesterdayLogins ?? 0,
      value: o.todayLogins ?? 0,
    },
    {
      icon: SvgDownloadIcon,
      title: '已实名认证',
      totalTitle: '待审核',
      totalValue: o.pendingReviewCount ?? 0,
      value: o.verifiedCount ?? 0,
    },
    {
      icon: SvgBellIcon,
      title: '封禁会员',
      totalTitle: '昨日新增',
      totalValue: o.yesterdayNewMembers ?? 0,
      value: o.bannedCount ?? 0,
    },
  ];
});

const chartTabs = [
  { label: '注册趋势 (30天)', value: 'memberTrend' },
  { label: '活跃趋势 (7天)', value: 'loginTrend' },
];
</script>

<template>
  <div class="p-5">
    <AnalysisOverview :items="overviewItems" />
    <AnalysisChartsTabs :tabs="chartTabs" class="mt-5">
      <template #memberTrend>
        <AnalyticsMemberTrend />
      </template>
      <template #loginTrend>
        <AnalyticsLoginTrend />
      </template>
    </AnalysisChartsTabs>

    <div class="mt-5 w-full md:flex">
      <AnalysisChartCard
        class="mt-5 md:mr-4 md:mt-0 md:w-1/2"
        title="会员状态分布"
      >
        <AnalyticsStatusPie />
      </AnalysisChartCard>
      <AnalysisChartCard class="mt-5 md:mt-0 md:w-1/2" title="实名认证分布">
        <AnalyticsRealNamePie />
      </AnalysisChartCard>
    </div>
  </div>
</template>
