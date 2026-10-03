<script lang="ts" setup>
import type { VbenFormProps } from '#/adapter/form';
import type { VxeGridProps } from '#/adapter/vxe-table';

import { ref } from 'vue';
import { useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';

import { Button, Input, message, Modal, Space, Tag } from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';

import { getList, postDel, postResetPassword } from './api';

const router = useRouter();

const fmtTime = (v: null | string | undefined) => {
  if (!v) return '-';
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

interface RowType {
  avatar?: string;
  creditScore?: number;
  createTime?: string;
  directInviteCount?: number;
  id: number;
  invitationCode?: string;
  lastOnlineTime?: string;
  name?: string;
  parentName?: string;
  realNameStatus: number;
  status: number;
  username?: string;
}

const formOptions: VbenFormProps = {
  schema: [
    {
      label: '关键词',
      fieldName: 'keyword',
      component: 'Input',
      componentProps: { placeholder: '用户名/名称' },
    },
    {
      label: '账户状态',
      fieldName: 'status',
      component: 'RadioGroup',
      componentProps: {
        options: [
          { label: '正常', value: 0, key: '0' },
          { label: '封禁', value: 1, key: '1' },
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
    { field: 'id', title: 'Id', width: 60, visible: false },
    {
      field: 'username',
      title: '会员信息',
      width: 180,
      slots: { default: 'username' },
    },
    {
      field: 'status',
      title: '状态/认证',
      width: 100,
      slots: { default: 'status' },
    },
    {
      field: 'invitationCode',
      title: '邀请/推荐',
      width: 160,
      slots: { default: 'invitationCode' },
    },
    {
      field: 'createTime',
      title: '注册/最后在线',
      minWidth: 170,
      slots: { default: 'createTime' },
    },
    {
      field: 'action',
      fixed: 'right',
      slots: { default: 'action' },
      title: '操作',
      width: 320,
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
  rowConfig: {
    isHover: true,
  },
  toolbarConfig: {
    refresh: true,
    custom: true,
  },
};

const [Grid, gridApi] = useVbenVxeGrid({
  formOptions,
  gridOptions,
});

const delMember = (id: number) => {
  postDel(id).then(() => gridApi.query());
};

// 重置密码弹窗
const resetPwdVisible = ref(false);
const resetPwdMemberId = ref(0);
const resetPwdMemberName = ref('');
const resetPwdValue = ref('');

const showResetPassword = (row: any) => {
  resetPwdMemberId.value = row.id;
  resetPwdMemberName.value = row.username || row.name || `#${row.id}`;
  resetPwdValue.value = '';
  resetPwdVisible.value = true;
};

const handleResetPassword = async () => {
  if (!resetPwdValue.value) {
    message.warning('请输入新密码');
    return;
  }
  await postResetPassword(resetPwdMemberId.value, resetPwdValue.value);
  resetPwdVisible.value = false;
};

const realNameLabels: Record<number, { color: string; text: string }> = {
  0: { text: '未认证', color: 'default' },
  1: { text: '审核中', color: 'processing' },
  2: { text: '已认证', color: 'success' },
  3: { text: '已拒绝', color: 'error' },
};
</script>

<template>
  <Page auto-content-height>
    <Grid>
      <!-- 会员信息: 头像+用户名+名称 -->
      <template #username="{ row }">
        <div style="display: flex; gap: 8px; align-items: center">
          <img
            v-if="row.avatar"
            :src="row.avatar"
            style="
              flex-shrink: 0;
              width: 32px;
              height: 32px;
              object-fit: cover;
              border-radius: 50%;
            "
          />
          <div style="min-width: 0; font-size: 12px; line-height: 1.4">
            <div
              style="
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
              "
            >
              {{ row.username }}
            </div>
            <div style="color: #999">{{ row.name }}</div>
          </div>
        </div>
      </template>

      <!-- 状态/认证: 账户状态+实名+信用分 -->
      <template #status="{ row }">
        <div style="font-size: 12px; line-height: 1.6">
          <div>
            <Tag
              :color="row.status === 0 ? 'success' : 'error'"
              style="margin: 0"
            >
              {{ row.status === 0 ? '正常' : '封禁' }}
            </Tag>
          </div>
          <div style="margin-top: 4px">
            <Tag
              :color="realNameLabels[row.realNameStatus]?.color"
              style="margin: 0"
            >
              {{ realNameLabels[row.realNameStatus]?.text }}
            </Tag>
          </div>
          <div style="margin-top: 4px; color: #999">
            信用: {{ row.creditScore }}
          </div>
        </div>
      </template>

      <!-- 邀请/推荐: 邀请码+直推人数+上级 -->
      <template #invitationCode="{ row }">
        <div style="font-size: 12px; line-height: 1.4">
          <div v-if="row.invitationCode">邀请码: {{ row.invitationCode }}</div>
          <div>
            直推:
            <span style="color: #1890ff">{{ row.directInviteCount ?? 0 }}</span>
            人
          </div>
          <div v-if="row.parentName" style="color: #999">
            上级: {{ row.parentName }}
          </div>
        </div>
      </template>

      <!-- 注册/最后在线 -->
      <template #createTime="{ row }">
        <div style="font-size: 12px; line-height: 1.4">
          <div>注册: {{ fmtTime(row.createTime) }}</div>
          <div style="color: #999">在线: {{ fmtTime(row.lastOnlineTime) }}</div>
        </div>
      </template>

      <template #action="{ row }">
        <Space>
          <Button
            type="primary"
            @click="
              router.push({
                name: 'MemberForm',
                query: { id: row.id },
              })
            "
          >
            编辑
          </Button>

          <Button
            @click="
              router.push({
                name: 'MemberTree',
                query: { id: row.id },
              })
            "
          >
            架构
          </Button>

          <Button @click="showResetPassword(row)"> 重置密码 </Button>

          <Button type="primary" danger @click="delMember(row.id)">
            删除
          </Button>
        </Space>
      </template>
    </Grid>

    <!-- 重置密码弹窗 -->
    <Modal
      v-model:open="resetPwdVisible"
      :title="`重置密码 - ${resetPwdMemberName}`"
      @ok="handleResetPassword"
      ok-text="确定"
    >
      <div style="padding: 16px 0">
        <Input
          v-model:value="resetPwdValue"
          placeholder="请输入新密码"
          type="password"
          allow-clear
        />
      </div>
    </Modal>
  </Page>
</template>
