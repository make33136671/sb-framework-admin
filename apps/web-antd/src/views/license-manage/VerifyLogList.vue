<script lang="ts" setup>
import type { VxeGridProps } from '#/adapter/vxe-table';

import { Page } from '@vben/common-ui';

import { Tag } from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';

import { getVerifyLogList } from './api';

const fmtTime = (v: string) => {
  if (!v) return '-';
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const gridOptions: VxeGridProps = {
  columns: [
    { field: 'id', title: 'ID', width: 60 },
    { field: 'client.productCn', title: '客户', minWidth: 140, slots: { default: 'clientName' } },
    { field: 'domain', title: '声明域名', minWidth: 160 },
    { field: 'actualDomain', title: '实际访问', minWidth: 160, slots: { default: 'actualDomain' } },
    { field: 'serverIP', title: 'IP', width: 130 },
    { field: 'clientKey', title: 'ClientKey', width: 140, showOverflow: true },
    { field: 'hardwareId', title: 'HardwareId', width: 140, showOverflow: true },
    { field: 'licenseValid', title: '授权有效', width: 90, slots: { default: 'valid' } },
    { field: 'message', title: '消息', minWidth: 200, showOverflow: true },
    { field: 'createdTime', title: '验证时间', width: 170, slots: { default: 'createdTime' } },
  ],
  height: 'auto',
  keepSource: true,
  pagerConfig: {},
  proxyConfig: {
    ajax: {
      query: async ({ page }) => {
        return await getVerifyLogList({
          page: page.currentPage,
          pageSize: page.pageSize,
        });
      },
    },
  },
  showOverflow: true,
  rowConfig: { isHover: true },
  toolbarConfig: { refresh: true },
};

const [Grid] = useVbenVxeGrid({ gridOptions });
</script>

<template>
  <Page auto-content-height>
    <Grid>
      <template #clientName="{ row }">
        {{ row.client?.productCn ? `${row.client.productCn}（${row.client.productEn}）` : row.client?.productEn || '—' }}
        <Tag v-if="row.client?.isDeleted" color="default" style="margin-left: 4px">已删除</Tag>
      </template>
      <template #actualDomain="{ row }">
        <span
          v-if="row.actualDomain"
          :style="
            row.domain && row.actualDomain.toLowerCase() !== row.domain.toLowerCase()
              ? 'color: #faad14; font-weight: 500'
              : ''
          "
        >{{ row.actualDomain }}</span>
        <span v-else style="color: var(--ant-color-text-tertiary)">—</span>
      </template>
      <template #valid="{ row }">
        <Tag v-if="row.licenseValid" color="green">有效</Tag>
        <Tag v-else color="red">无效</Tag>
      </template>
      <template #createdTime="{ row }">
        {{ fmtTime(row.createdTime) }}
      </template>
    </Grid>
  </Page>
</template>
