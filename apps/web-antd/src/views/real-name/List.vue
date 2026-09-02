<script lang="ts" setup>
import type { VxeGridProps } from '#/adapter/vxe-table';

import { ref } from 'vue';

import { Page } from '@vben/common-ui';

import { Button, Image, Input, Modal, Space, Tag } from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';

import { getList, postApprove, postReject } from './api';

const fmtTime = (v: string) => {
  if (!v) return '-';
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const statusMap: Record<number, { text: string; color: string }> = {
  0: { text: '未认证', color: 'default' },
  1: { text: '审核中', color: 'processing' },
  2: { text: '已通过', color: 'success' },
  3: { text: '已拒绝', color: 'error' },
};

interface RowType {}

const formOptions: VbenFormProps = {
  schema: [
    {
      label: '关键词',
      fieldName: 'keyword',
      component: 'Input',
      componentProps: { placeholder: '用户名/姓名/证件号' },
    },
    {
      label: '状态',
      fieldName: 'status',
      component: 'RadioGroup',
      componentProps: {
        options: [
          { label: '审核中', value: 1, key: '1' },
          { label: '已通过', value: 2, key: '2' },
          { label: '已拒绝', value: 3, key: '3' },
        ],
      },
    },
  ],
  wrapperClass: 'grid-cols-2',
  showCollapseButton: false,
  submitOnChange: false,
  submitOnEnter: true,
};

const gridOptions: VxeGridProps<RowType> = {
  columns: [
    { field: 'id', title: 'ID', width: 60 },
    {
      field: 'memberUsername',
      title: '会员信息',
      width: 160,
      slots: { default: 'member' },
    },
    {
      field: 'realName',
      title: '认证信息',
      minWidth: 180,
      slots: { default: 'certInfo' },
    },
    {
      field: 'idFrontImage',
      title: '证件照片',
      width: 200,
      slots: { default: 'images' },
    },
    {
      field: 'status',
      title: '状态',
      width: 100,
      slots: { default: 'status' },
    },
    {
      field: 'submitTime',
      title: '提交/审核时间',
      width: 170,
      slots: { default: 'time' },
    },
    {
      field: 'action',
      fixed: 'right',
      slots: { default: 'action' },
      title: '操作',
      width: 200,
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
  showOverflow: false,
  rowConfig: { isHover: true },
  toolbarConfig: { refresh: true, custom: true },
};

const [Grid, gridApi] = useVbenVxeGrid({ formOptions, gridOptions });

const handleApprove = async (id: number) => {
  await postApprove(id);
  gridApi.query();
};

const rejectVisible = ref(false);
const rejectId = ref(0);
const rejectReason = ref('');

const showReject = (id: number) => {
  rejectId.value = id;
  rejectReason.value = '';
  rejectVisible.value = true;
};

const handleReject = async () => {
  await postReject(rejectId.value, rejectReason.value);
  rejectVisible.value = false;
  gridApi.query();
};
</script>

<template>
  <Page auto-content-height>
    <Grid>
      <template #member="{ row }">
        <div style="font-size: 12px; line-height: 1.4">
          <div>{{ row.memberUsername }}</div>
          <div style="color: #999">{{ row.memberName }}</div>
        </div>
      </template>

      <template #certInfo="{ row }">
        <div style="font-size: 12px; line-height: 1.4">
          <div>姓名: {{ row.realName }}</div>
          <div style="color: #999">证件号: {{ row.idNumber }}</div>
          <div v-if="row.rejectReason" style="margin-top: 2px; color: #ff4d4f">
            拒绝原因: {{ row.rejectReason }}
          </div>
        </div>
      </template>

      <template #images="{ row }">
        <Space>
          <Image
            v-if="row.idFrontImage"
            :src="row.idFrontImage"
            :width="60"
            :height="40"
            style="object-fit: cover; border-radius: 4px"
          />
          <Image
            v-if="row.idBackImage"
            :src="row.idBackImage"
            :width="60"
            :height="40"
            style="object-fit: cover; border-radius: 4px"
          />
        </Space>
      </template>

      <template #status="{ row }">
        <Tag :color="statusMap[row.status]?.color">{{
          statusMap[row.status]?.text
        }}</Tag>
      </template>

      <template #time="{ row }">
        <div style="font-size: 12px; line-height: 1.4">
          <div>提交: {{ fmtTime(row.submitTime) }}</div>
          <div v-if="row.reviewTime" style="color: #999">
            审核: {{ fmtTime(row.reviewTime) }}
          </div>
        </div>
      </template>

      <template #action="{ row }">
        <Space v-if="row.status === 1">
          <Button type="primary" size="small" @click="handleApprove(row.id)"
            >通过</Button
          >
          <Button danger size="small" @click="showReject(row.id)">拒绝</Button>
        </Space>
        <span v-else style="font-size: 12px; color: #999">已处理</span>
      </template>
    </Grid>

    <Modal
      v-model:open="rejectVisible"
      title="拒绝实名认证"
      @ok="handleReject"
      ok-text="确认拒绝"
    >
      <div style="padding: 16px 0">
        <Input
          v-model:value="rejectReason"
          placeholder="请输入拒绝原因（选填）"
          allow-clear
        />
      </div>
    </Modal>
  </Page>
</template>
