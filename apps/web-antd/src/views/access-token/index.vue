<script lang="ts" setup>
import type { VbenFormProps } from '#/adapter/form';
import type { VxeGridProps } from '#/adapter/vxe-table';

import { computed, ref } from 'vue';

import { Page } from '@vben/common-ui';

import { useClipboard } from '@vueuse/core';
import {
  Alert,
  Button,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'ant-design-vue';
import dayjs from 'dayjs';

import { useVbenVxeGrid } from '#/adapter/vxe-table';

import { getAudit, getList, postCreate, postRevoke, postUpdate } from './api';

// ---- 列表 ------------------------------------------------------

const formOptions: VbenFormProps = {
  schema: [
    {
      label: '关键字',
      fieldName: 'keyword',
      component: 'Input',
      componentProps: { placeholder: '名称 / 前缀' },
    },
  ],
  wrapperClass: 'grid-cols-2',
  showCollapseButton: false,
  submitOnChange: false,
  submitOnEnter: true,
};

const gridOptions: VxeGridProps = {
  columns: [
    { field: 'id', title: 'Id', width: 60 },
    { field: 'name', title: '名称', minWidth: 140 },
    {
      field: 'tokenPrefix',
      title: '前缀',
      width: 120,
      slots: { default: 'prefix' },
    },
    {
      field: 'fullAccess',
      title: '权限',
      width: 110,
      slots: { default: 'access' },
    },
    {
      field: 'scopes',
      title: 'Scopes',
      minWidth: 200,
      slots: { default: 'scopes' },
    },
    {
      field: 'rateLimitPerMinute',
      title: '速率/分',
      width: 80,
      slots: { default: 'rate' },
    },
    {
      field: 'expiresAt',
      title: '过期',
      width: 120,
      slots: { default: 'expires' },
    },
    {
      field: 'lastUsedAt',
      title: '最近使用',
      width: 150,
      slots: { default: 'lastUsed' },
    },
    { field: 'createdBy', title: '创建者', width: 100 },
    {
      field: 'isDeleted',
      title: '状态',
      width: 80,
      slots: { default: 'status' },
    },
    {
      field: 'action',
      fixed: 'right',
      slots: { default: 'action' },
      title: '操作',
      width: 220,
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
          keyword: formValues?.keyword,
        });
      },
    },
  },
  showOverflow: false,
  rowConfig: { isHover: true },
  toolbarConfig: { refresh: true, custom: true },
};

const [Grid, gridApi] = useVbenVxeGrid({ formOptions, gridOptions });

// ---- Create / Update ----

const editModalVisible = ref(false);
const isEditMode = computed(() => Boolean(editForm.value.id));
const editForm = ref<any>({});
const expiresPickerValue = ref<any>(null);

function handleAdd() {
  editForm.value = {
    name: '',
    serviceAccount: '',
    scopes: 'read:*',
    fullAccess: false,
    rateLimitPerMinute: 60,
    ipAllowlist: '',
    notes: '',
  };
  expiresPickerValue.value = null;
  editModalVisible.value = true;
}

function handleEdit(row: any) {
  editForm.value = { ...row };
  expiresPickerValue.value = row.expiresAt ? dayjs(row.expiresAt) : null;
  editModalVisible.value = true;
}

async function handleSave() {
  if (!editForm.value.name?.trim()) {
    message.warning('请填写名称');
    return;
  }

  const expiresAt = expiresPickerValue.value
    ? dayjs(expiresPickerValue.value).format('YYYY-MM-DD')
    : undefined;

  if (editForm.value.fullAccess && !expiresAt) {
    message.warning('FullAccess(god)令牌必须设置过期时间');
    return;
  }

  if (isEditMode.value) {
    await postUpdate({
      id: editForm.value.id,
      name: editForm.value.name,
      scopes: editForm.value.scopes,
      expiresAt,
      rateLimitPerMinute: editForm.value.rateLimitPerMinute || undefined,
      ipAllowlist: editForm.value.ipAllowlist || undefined,
      notes: editForm.value.notes,
    });
    editModalVisible.value = false;
    gridApi.query();
  } else {
    const res: any = await postCreate({
      name: editForm.value.name,
      serviceAccount:
        editForm.value.serviceAccount?.trim() || editForm.value.name.trim(),
      scopes: editForm.value.fullAccess ? undefined : editForm.value.scopes,
      fullAccess: editForm.value.fullAccess,
      expiresAt,
      rateLimitPerMinute: editForm.value.rateLimitPerMinute || undefined,
      ipAllowlist: editForm.value.ipAllowlist || undefined,
      notes: editForm.value.notes,
    });
    editModalVisible.value = false;
    showSecret(res);
    gridApi.query();
  }
}

// ---- 一次性 secret ----

const secretModalVisible = ref(false);
const secretInfo = ref<any>({});
const { copy: copyToClipboard } = useClipboard();

function showSecret(res: any) {
  secretInfo.value = res || {};
  secretModalVisible.value = true;
}

async function copySecret() {
  await copyToClipboard(secretInfo.value.token);
  message.success('已复制到剪贴板');
}

// ---- Revoke ----

const revokeModalVisible = ref(false);
const revokeTarget = ref<any>(null);
const revokeReason = ref('');

function handleRevokeAsk(row: any) {
  revokeTarget.value = row;
  revokeReason.value = '';
  revokeModalVisible.value = true;
}

async function handleRevokeConfirm() {
  await postRevoke(revokeTarget.value.id, revokeReason.value || undefined);
  revokeModalVisible.value = false;
  gridApi.query();
}

// ---- 审计抽屉 ----

const auditDrawerVisible = ref(false);
const auditLoading = ref(false);
const auditList = ref<any[]>([]);
const auditTotal = ref(0);
const auditKeyId = ref<number | undefined>(undefined);
const auditPagination = ref({ current: 1, pageSize: 50 });

async function openAudit(row: any) {
  auditKeyId.value = row.id;
  auditList.value = [];
  auditPagination.value = { current: 1, pageSize: 50 };
  auditDrawerVisible.value = true;
  await fetchAudit();
}

async function fetchAudit() {
  auditLoading.value = true;
  try {
    const res: any = await getAudit({
      keyId: auditKeyId.value,
      page: auditPagination.value.current,
      pageSize: auditPagination.value.pageSize,
    });
    auditList.value = res?.items || res?.list || res || [];
    auditTotal.value = res?.total || auditList.value.length;
  } finally {
    auditLoading.value = false;
  }
}

const auditColumns = [
  { title: '时间', dataIndex: 'createdTime', width: 160 },
  { title: '动作', dataIndex: 'action', width: 110 },
  { title: '结果', dataIndex: 'result', width: 90 },
  { title: 'IP', dataIndex: 'ipAddress', width: 130 },
  { title: '路径', dataIndex: 'requestPath' },
  { title: '操作者', dataIndex: 'operator', width: 100 },
  { title: '拒绝原因', dataIndex: 'denyReason' },
];

function actionColor(a: string) {
  return (
    {
      Created: 'blue',
      Updated: 'cyan',
      Revoked: 'orange',
      AuthFailed: 'red',
      Denied: 'red',
      RateLimited: 'red',
      Throttled: 'red',
      Expired: 'red',
    }[a] || 'default'
  );
}

// ---- helpers ----

function fmtTime(t?: string) {
  return t ? dayjs(t).format('YYYY-MM-DD HH:mm') : '-';
}

function fmtDate(t?: string) {
  return t ? dayjs(t).format('YYYY-MM-DD') : '-';
}

function scopeBadges(scopes?: string) {
  if (!scopes) return [{ key: '*', label: '不收窄', color: 'orange' }];
  return scopes
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ({
      key: s,
      label: s,
      color: s === '*' ? 'orange' : (s.startsWith('read:') ? 'blue' : 'green'),
    }));
}
</script>

<template>
  <Page auto-content-height>
    <Grid>
      <template #toolbar-tools>
        <Button type="primary" @click="handleAdd">新建令牌</Button>
      </template>

      <template #prefix="{ row }">
        <Typography.Text code copyable>{{ row.tokenPrefix }}</Typography.Text>
      </template>

      <template #access="{ row }">
        <Tag v-if="row.fullAccess" color="red">FullAccess</Tag>
        <Tag v-else color="default">受限</Tag>
      </template>

      <template #scopes="{ row }">
        <Typography.Text v-if="row.fullAccess" type="secondary">
—
</Typography.Text>
        <Space v-else :size="4" wrap>
          <Tag
            v-for="s in scopeBadges(row.scopes)"
            :key="s.key"
            :color="s.color"
          >
            {{ s.label }}
          </Tag>
        </Space>
      </template>

      <template #rate="{ row }">
        <span v-if="row.rateLimitPerMinute">{{ row.rateLimitPerMinute }}</span>
        <Typography.Text v-else type="secondary">-</Typography.Text>
      </template>

      <template #expires="{ row }">
        <Tag
          v-if="row.expiresAt"
          :color="dayjs(row.expiresAt).isBefore(dayjs()) ? 'red' : 'default'"
        >
          {{ fmtDate(row.expiresAt) }}
        </Tag>
        <Typography.Text v-else type="secondary">永久</Typography.Text>
      </template>

      <template #lastUsed="{ row }">{{ fmtTime(row.lastUsedAt) }}</template>

      <template #status="{ row }">
        <Tag v-if="row.isDeleted" color="red">已吊销</Tag>
        <Tag
          v-else-if="row.expiresAt && dayjs(row.expiresAt).isBefore(dayjs())"
          color="red"
          >
已过期
</Tag>
        <Tag v-else color="green">活跃</Tag>
      </template>

      <template #action="{ row }">
        <Space>
          <Button type="primary" size="small" @click="openAudit(row)">
审计
</Button>
          <Button v-if="!row.isDeleted" size="small" @click="handleEdit(row)">
编辑
</Button>
          <Button
            v-if="!row.isDeleted"
            type="primary"
            danger
            size="small"
            @click="handleRevokeAsk(row)"
            >
吊销
</Button>
        </Space>
      </template>
    </Grid>

    <!-- 创建 / 编辑 -->
    <Modal
      v-model:open="editModalVisible"
      :title="isEditMode ? '编辑令牌' : '新建令牌'"
      :ok-text="isEditMode ? '保存' : '创建'"
      width="600px"
      @ok="handleSave"
    >
      <Form layout="vertical" style="margin-top: 12px">
        <Form.Item label="名称" required>
          <Input
            v-model:value="editForm.name"
            :disabled="isEditMode"
            placeholder="如:hermes-agent / ci-deploy"
          />
        </Form.Item>
        <Form.Item v-if="!isEditMode" label="服务账号(留空 = 用名称)">
          <Input
            v-model:value="editForm.serviceAccount"
            placeholder="key 以该服务账号身份访问;不存在则自动创建"
          />
        </Form.Item>
        <Form.Item v-if="!isEditMode">
          <template #label>
            FullAccess(god)
            <Tooltip
              title="全权穿透所有接口并旁路 License,取代原 MasterKey。仅超级管理员可签发,必须设过期。慎用!"
            >
              <span style="margin-left: 4px; cursor: help">ⓘ</span>
            </Tooltip>
          </template>
          <Switch v-model:checked="editForm.fullAccess" />
        </Form.Item>
        <Alert
          v-if="!isEditMode && editForm.fullAccess"
          type="error"
          show-icon
          message="FullAccess 令牌等同超级管理员 + 绕过授权校验,泄漏即灾难。请设短有效期、配 IP 白名单,并尽量改用受限 scope。"
          style="margin-bottom: 12px"
        />
        <Form.Item v-if="!editForm.fullAccess">
          <template #label>
            Scopes
            <Tooltip
              title="RBAC 逗号分隔。* 全部 / read:* 全部读 / read:task / write:requirement。留空=该 key 在所有已开放 [Scope] 端点放行。受限 key 不能访问未声明 [Scope] 的端点。"
            >
              <span style="margin-left: 4px; cursor: help">ⓘ</span>
            </Tooltip>
          </template>
          <Input
            v-model:value="editForm.scopes"
            placeholder="read:*,write:requirement,write:task"
          />
        </Form.Item>
        <Form.Item label="过期时间(FullAccess 必填)">
          <DatePicker
            v-model:value="expiresPickerValue"
            style="width: 100%"
            value-format="YYYY-MM-DD"
          />
        </Form.Item>
        <Form.Item label="IP 白名单(逗号分隔,留空=不限;支持 192.168.10. 前缀)">
          <Input
            v-model:value="editForm.ipAllowlist"
            placeholder="如:192.168.10.65,10.0.0."
          />
        </Form.Item>
        <Form.Item>
          <template #label>
            速率限制(每分钟)
            <Tooltip title="超出后 1 分钟内自动拒绝并写审计;留空 = 不限">
              <span style="margin-left: 4px; cursor: help">ⓘ</span>
            </Tooltip>
          </template>
          <InputNumber
            v-model:value="editForm.rateLimitPerMinute"
            :min="0"
            placeholder="0 / 留空 = 不限"
            style="width: 100%"
          />
        </Form.Item>
        <Form.Item label="备注">
          <Input.TextArea
            v-model:value="editForm.notes"
            :rows="2"
            placeholder="可选"
          />
        </Form.Item>
      </Form>
    </Modal>

    <!-- 一次性明文 -->
    <Modal
      v-model:open="secretModalVisible"
      title="令牌已创建"
      :footer="null"
      :mask-closable="false"
      :keyboard="false"
      width="600px"
    >
      <Alert
        type="warning"
        show-icon
        message="明文只显示这一次,关闭后无法再次查看。请立即复制并妥善保存。"
        style="margin-bottom: 16px"
      />
      <Form layout="vertical">
        <Form.Item label="名称">
          <Input :value="secretInfo.name" readonly />
        </Form.Item>
        <Form.Item label="Token (Bearer)">
          <Input.TextArea
            :value="secretInfo.token"
            readonly
            :rows="2"
            style="font-family: monospace"
          />
        </Form.Item>
      </Form>
      <Space>
        <Button type="primary" @click="copySecret">复制 Token</Button>
        <Button @click="secretModalVisible = false">我已保存</Button>
      </Space>
    </Modal>

    <!-- 吊销 -->
    <Modal
      v-model:open="revokeModalVisible"
      title="吊销令牌"
      ok-text="确认吊销"
      ok-type="danger"
      width="500px"
      @ok="handleRevokeConfirm"
    >
      <Alert
        type="error"
        show-icon
        :message="`即将吊销:${revokeTarget?.name} (#${revokeTarget?.id})`"
        description="吊销不可撤销。该令牌下次调用将立即被拒绝。"
        style="margin-bottom: 16px"
      />
      <Form layout="vertical">
        <Form.Item label="吊销原因(可选,写入审计)">
          <Input.TextArea
            v-model:value="revokeReason"
            :rows="2"
            placeholder="如:泄漏 / 不再使用 / 替换"
          />
        </Form.Item>
      </Form>
    </Modal>

    <!-- 审计抽屉 -->
    <Drawer
      v-model:open="auditDrawerVisible"
      :title="`审计日志 — 令牌 #${auditKeyId}`"
      width="900px"
      placement="right"
    >
      <Table
        :columns="auditColumns"
        :data-source="auditList"
        :loading="auditLoading"
        :pagination="{
          current: auditPagination.current,
          pageSize: auditPagination.pageSize,
          total: auditTotal,
          showSizeChanger: true,
          showTotal: (t: number) => `共 ${t} 条`,
        }"
        size="small"
        row-key="id"
        @change="
          (p: any) => {
            auditPagination.current = p.current;
            auditPagination.pageSize = p.pageSize;
            fetchAudit();
          }
        "
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.dataIndex === 'createdTime'">
            {{ fmtTime(record.createdTime) }}
          </template>
          <template v-else-if="column.dataIndex === 'action'">
            <Tag :color="actionColor(record.action)">{{ record.action }}</Tag>
          </template>
          <template v-else-if="column.dataIndex === 'result'">
            <Tag :color="record.result === 'Success' ? 'green' : 'red'">
{{
              record.result
            }}
</Tag>
          </template>
          <template v-else-if="column.dataIndex === 'requestPath'">
            <Typography.Text
              v-if="record.requestPath"
              code
              style="font-size: 12px"
              >
{{ record.requestPath }}
</Typography.Text>
            <Typography.Text v-else type="secondary">-</Typography.Text>
          </template>
          <template v-else-if="column.dataIndex === 'denyReason'">
            <Typography.Text v-if="record.denyReason" type="danger">
{{
              record.denyReason
            }}
</Typography.Text>
            <Typography.Text v-else type="secondary">-</Typography.Text>
          </template>
        </template>
      </Table>
    </Drawer>
  </Page>
</template>
