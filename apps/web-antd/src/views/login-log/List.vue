<script lang="ts" setup>
import type { VxeGridProps } from '#/adapter/vxe-table';

import { Page } from '@vben/common-ui';

import { Tag } from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';

import { getList } from './api';

const userTypeMap: Record<number, { color: string; label: string; }> = {
  0: { label: 'H5会员', color: 'processing' },
  1: { label: '管理员', color: 'warning' },
};

const statusMap: Record<number, { color: string; label: string; }> = {
  0: { label: '成功', color: 'success' },
  1: { label: '失败', color: 'error' },
};

const fmtTime = (v: null | string | undefined) => {
  if (!v) return '-';
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

interface RowType {
  createTime?: string;
  status: number;
  userType: number;
}

const formOptions = {
  schema: [
    {
      label: '用户类型',
      fieldName: 'userType',
      component: 'Select',
      componentProps: {
        placeholder: '全部',
        allowClear: true,
        options: [
          { label: 'H5会员', value: 0 },
          { label: '管理员', value: 1 },
        ],
      },
    },
    {
      label: '用户名',
      fieldName: 'username',
      component: 'Input',
      componentProps: { placeholder: '请输入用户名' },
    },
    {
      label: '状态',
      fieldName: 'status',
      component: 'Select',
      componentProps: {
        placeholder: '全部',
        allowClear: true,
        options: [
          { label: '成功', value: 0 },
          { label: '失败', value: 1 },
        ],
      },
    },
  ],
  wrapperClass: 'grid-cols-4',
  showCollapseButton: false,
  submitOnChange: false,
  submitOnEnter: true,
};

const gridOptions: VxeGridProps<RowType> = {
  columns: [
    { field: 'id', title: 'ID', width: 80 },
    { field: 'username', title: '用户名', minWidth: 150 },
    {
      field: 'userType',
      title: '用户类型',
      width: 100,
      slots: { default: 'userType' },
    },
    { field: 'ipAddress', title: 'IP地址', width: 140 },
    { field: 'userAgent', title: 'User Agent', minWidth: 200 },
    { field: 'status', title: '状态', width: 80, slots: { default: 'status' } },
    {
      field: 'createTime',
      title: '登录时间',
      width: 180,
      slots: { default: 'createTime' },
    },
  ],
  height: 'auto',
  keepSource: true,
  pagerConfig: {},
  proxyConfig: {
    ajax: {
      query: async ({ page }, formValues) => {
        return await getList({
          page: page.currentPage,
          pageSize: page.pageSize,
          ...formValues,
        });
      },
    },
  },
  showOverflow: true,
  rowConfig: { isHover: true },
  toolbarConfig: { refresh: true },
};

const [Grid] = useVbenVxeGrid({ formOptions, gridOptions });
</script>

<template>
  <Page auto-content-height>
    <Grid>
      <template #userType="{ row }">
        <Tag :color="userTypeMap[row.userType]?.color">
          {{ userTypeMap[row.userType]?.label || '未知' }}
        </Tag>
      </template>

      <template #status="{ row }">
        <Tag :color="statusMap[row.status]?.color">
          {{ statusMap[row.status]?.label || '未知' }}
        </Tag>
      </template>

      <template #createTime="{ row }">
        {{ fmtTime(row.createTime) }}
      </template>
    </Grid>
  </Page>
</template>
