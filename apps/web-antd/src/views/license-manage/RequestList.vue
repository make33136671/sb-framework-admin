<script lang="ts" setup>
import type { VxeGridProps } from '#/adapter/vxe-table';

import { ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Button,
  DatePicker,
  Form,
  FormItem,
  Input,
  message,
  Modal,
  Radio,
  RadioGroup,
  Space,
  Tag,
} from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';

import { approveRequest, getRequestList, rejectRequest } from './api';

const statusMap: Record<number, { label: string; color: string }> = {
  0: { label: '待审批', color: 'warning' },
  1: { label: '已批准', color: 'success' },
  2: { label: '已拒绝', color: 'error' },
};

const fmtTime = (v: string) => {
  if (!v) return '-';
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const formOptions = {
  schema: [
    {
      label: '状态',
      fieldName: 'status',
      component: 'Select',
      componentProps: {
        placeholder: '全部',
        allowClear: true,
        options: [
          { label: '待审批', value: 0 },
          { label: '已批准', value: 1 },
          { label: '已拒绝', value: 2 },
        ],
      },
    },
  ],
  wrapperClass: 'grid-cols-4',
  showCollapseButton: false,
  submitOnChange: false,
  submitOnEnter: true,
};

const gridOptions: VxeGridProps = {
  columns: [
    { field: 'id', title: 'ID', width: 60 },
    { field: 'client.productCn', title: '客户', minWidth: 120 },
    { field: 'domain', title: '域名', minWidth: 180 },
    { field: 'serverIP', title: 'IP', width: 130 },
    { field: 'clientKey', title: 'ClientKey', width: 140, showOverflow: true },
    { field: 'hardwareId', title: 'HardwareId', width: 140, showOverflow: true },
    { field: 'status', title: '状态', width: 90, slots: { default: 'status' } },
    { field: 'createdTime', title: '申请时间', width: 170, slots: { default: 'createdTime' } },
    { title: '操作', width: 150, slots: { default: 'action' }, fixed: 'right' },
  ],
  height: 'auto',
  keepSource: true,
  pagerConfig: {},
  proxyConfig: {
    ajax: {
      query: async ({ page }, formValues) => {
        return await getRequestList({
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

const [Grid, gridApi] = useVbenVxeGrid({ formOptions, gridOptions });

// 审批弹窗
const approveVisible = ref(false);
const approveLoading = ref(false);
const approveForm = ref({
  requestId: 0,
  expiresAt: null as any,
  verifyMode: 2,
  allowedRoutesStr: '',
});

function showApprove(row: any) {
  approveForm.value = {
    requestId: row.id,
    expiresAt: null,
    verifyMode: 2,
    allowedRoutesStr: '',
  };
  approveVisible.value = true;
}

async function handleApprove() {
  if (!approveForm.value.expiresAt) {
    message.warning('请选择到期时间');
    return;
  }
  approveLoading.value = true;
  try {
    const allowedRoutes = approveForm.value.allowedRoutesStr
      ? approveForm.value.allowedRoutesStr.split(',').map((s: string) => s.trim()).filter(Boolean)
      : [];
    await approveRequest({
      requestId: approveForm.value.requestId,
      expiresAt: approveForm.value.expiresAt.format('YYYY-MM-DD HH:mm:ss'),
      verifyMode: approveForm.value.verifyMode,
      allowedRoutes,
    });
    approveVisible.value = false;
    gridApi.reload();
    // 失败 toast 由 axios 拦截器统一弹
  } finally {
    approveLoading.value = false;
  }
}

async function handleReject(row: any) {
  // toast 由 axios 拦截器统一弹
  await rejectRequest({ requestId: row.id, reason: '管理员拒绝' });
  gridApi.reload();
}
</script>

<template>
  <Page auto-content-height>
    <Grid>
      <template #status="{ row }">
        <Tag :color="statusMap[row.status]?.color">
          {{ statusMap[row.status]?.label || '未知' }}
        </Tag>
      </template>
      <template #createdTime="{ row }">
        {{ fmtTime(row.createdTime) }}
      </template>
      <template #action="{ row }">
        <Space v-if="row.status === 0">
          <Button size="small" type="primary" @click="showApprove(row)">
            批准
          </Button>
          <Button danger size="small" @click="handleReject(row)">
            拒绝
          </Button>
        </Space>
        <span v-else style="color: #999">{{ statusMap[row.status]?.label }}</span>
      </template>
    </Grid>

    <!-- 审批弹窗 -->
    <Modal
      v-model:open="approveVisible"
      :confirm-loading="approveLoading"
      title="审批授权申请"
      @ok="handleApprove"
    >
      <Form layout="vertical">
        <FormItem label="到期时间" required>
          <DatePicker
            v-model:value="approveForm.expiresAt"
            show-time
            style="width: 100%"
          />
        </FormItem>
        <FormItem label="验证模式">
          <RadioGroup v-model:value="approveForm.verifyMode">
            <Radio :value="0">仅 ClientKey</Radio>
            <Radio :value="1">仅 HardwareId</Radio>
            <Radio :value="2">双验证</Radio>
          </RadioGroup>
        </FormItem>
        <FormItem label="到期后仍可访问的路由前缀">
          <Input
            v-model:value="approveForm.allowedRoutesStr"
            placeholder="逗号分隔，如 /admin/  留空表示全部拦截"
          />
          <div style="color: #999; font-size: 12px; margin-top: 4px">
            默认到期后 API 和 Admin 都不可访问。可输入如 /admin/ 表示到期后后台仍可访问
          </div>
        </FormItem>
      </Form>
    </Modal>
  </Page>
</template>
