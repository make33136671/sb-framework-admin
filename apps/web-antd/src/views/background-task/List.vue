<script lang="ts" setup>
import type { VxeGridProps } from '#/adapter/vxe-table';

import { ref } from 'vue';

import { Page } from '@vben/common-ui';

import { Button, message, Modal, Space, Tabs, Tag, Timeline } from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';

import { getLogs, getLogList, getList, postReloadParameters, postRestart, postRunOnce, postStart, postStop } from './api';

const activeTab = ref('task');

// ==================== 任务列表 ====================

const statusMap: Record<number, { label: string; color: string }> = {
  0: { label: '运行中', color: 'success' },
  1: { label: '已停止', color: 'default' },
  2: { label: '已失败', color: 'error' },
};

interface RowType {}

const gridOptions: VxeGridProps<RowType> = {
  columns: [
    { field: 'displayName', title: '任务名称', minWidth: 180, slots: { default: 'displayName' } },
    {
      field: 'status',
      title: '状态',
      width: 100,
      slots: { default: 'status' },
    },
    {
      field: 'lastExecution',
      title: '最近执行时间',
      width: 170,
      slots: { default: 'lastExecution' },
    },
    {
      field: 'nextRunTime',
      title: '下次执行时间',
      width: 170,
      slots: { default: 'nextRunTime' },
    },
    {
      field: 'lastDuration',
      title: '执行耗时',
      width: 120,
      slots: { default: 'lastDuration' },
    },
    {
      field: 'lastError',
      title: '最近错误',
      minWidth: 200,
      slots: { default: 'lastError' },
    },
    {
      field: 'action',
      fixed: 'right',
      slots: { default: 'action' },
      title: '操作',
      width: 380,
    },
  ],
  height: 'auto',
  keepSource: true,
  proxyConfig: {
    ajax: {
      query: async () => {
        const data: any = await getList();
        return { items: data, total: data?.length ?? 0 };
      },
    },
  },
  showOverflow: true,
  rowConfig: { isHover: true },
  toolbarConfig: { refresh: true },
};

const [Grid, gridApi] = useVbenVxeGrid({ gridOptions });

function getLastRecord(row: any) {
  const records = row.executionRecords;
  if (!records || records.length === 0) return null;
  return records[records.length - 1];
}

function formatDuration(duration: string | null) {
  if (!duration) return '-';
  const match = /(?:(\d+)\.)?(\d{2}):(\d{2}):(\d{2})/.exec(duration);
  if (!match) return duration;
  const [, days, hours, minutes, seconds] = match;
  const parts: string[] = [];
  if (days && Number(days) > 0) parts.push(`${days}天`);
  if (Number(hours) > 0) parts.push(`${hours}时`);
  if (Number(minutes) > 0) parts.push(`${minutes}分`);
  parts.push(`${seconds}秒`);
  return parts.join('');
}

function doAction(fn: () => Promise<any>) {
  fn().then(() => gridApi.query());
}

// 单任务日志弹窗
const logVisible = ref(false);
const logTaskName = ref('');
const logList = ref<any[]>([]);
const logLoading = ref(false);

const logLevelMap: Record<number, { label: string; color: string }> = {
  0: { label: 'Error', color: 'red' },
  1: { label: 'Warning', color: 'orange' },
  2: { label: 'Info', color: 'blue' },
};

async function showLogs(name: string) {
  logTaskName.value = name;
  logVisible.value = true;
  logLoading.value = true;
  try {
    const data: any = await getLogs(name);
    logList.value = data ?? [];
  } finally {
    logLoading.value = false;
  }
}

// ==================== 系统日志 ====================

const sourceMap: Record<number, { label: string; color: string }> = {
  0: { label: '定时任务', color: 'processing' },
  1: { label: '系统异常', color: 'error' },
};

const fmtTime = (v: string) => {
  if (!v) return '-';
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const logFormOptions = {
  schema: [
    {
      label: '日志来源',
      fieldName: 'source',
      component: 'Select',
      componentProps: {
        placeholder: '全部',
        allowClear: true,
        options: [
          { label: '定时任务', value: 0 },
          { label: '系统异常', value: 1 },
        ],
      },
    },
    {
      label: '日志级别',
      fieldName: 'logLevel',
      component: 'Select',
      componentProps: {
        placeholder: '全部',
        allowClear: true,
        options: [
          { label: 'Error', value: 0 },
          { label: 'Warning', value: 1 },
          { label: 'Info', value: 2 },
        ],
      },
    },
    {
      label: '关键词',
      fieldName: 'taskName',
      component: 'Input',
      componentProps: { placeholder: '来源名称' },
    },
  ],
  wrapperClass: 'grid-cols-3',
  showCollapseButton: false,
  submitOnChange: false,
  submitOnEnter: true,
};

const logGridOptions: VxeGridProps<RowType> = {
  columns: [
    { field: 'source', title: '来源/级别/名称', width: 220, slots: { default: 'log_source' } },
    { field: 'message', title: '消息/异常', minWidth: 300, slots: { default: 'log_message' } },
    { field: 'createdTime', title: '时间', width: 180, slots: { default: 'log_createdTime' } },
    { field: 'action', title: '操作', width: 80, fixed: 'right', slots: { default: 'log_action' } },
  ],
  height: 'auto',
  keepSource: true,
  pagerConfig: {},
  proxyConfig: {
    ajax: {
      query: async ({ page }, formValues) => {
        return await getLogList({
          page: page.currentPage,
          pageSize: page.pageSize,
          ...formValues,
        });
      },
    },
  },
  showOverflow: false,
  rowConfig: { isHover: true },
  toolbarConfig: { refresh: true },
};

const [LogGrid] = useVbenVxeGrid({ formOptions: logFormOptions, gridOptions: logGridOptions });

// 日志详情弹窗
const detailVisible = ref(false);
const detailRow = ref<any>(null);
const detailInfo = ref('');
const detailStack = ref('');

const showDetail = (row: any) => {
  detailRow.value = row;
  const ex = row.exception || '';
  const stackIdx = ex.indexOf('堆栈信息:');
  if (stackIdx > -1) {
    detailInfo.value = ex.substring(0, stackIdx).trim();
    detailStack.value = ex.substring(stackIdx + '堆栈信息:'.length).trim();
  } else {
    detailInfo.value = ex;
    detailStack.value = '';
  }
  detailVisible.value = true;
};

const copy = (text: string) => {
  navigator.clipboard.writeText(text).then(() => message.success('已复制'));
};
</script>

<template>
  <Page auto-content-height>
    <Tabs v-model:activeKey="activeTab" class="h-full" :class="$style.tabs">
      <Tabs.TabPane key="task" tab="任务列表" class="h-full">
        <Grid>
          <template #displayName="{ row }">
            <div style="font-weight: 500">{{ row.displayName || row.name }}</div>
            <div style="font-size: 11px; color: var(--ant-color-text-tertiary); font-family: monospace">
              {{ row.name }}
            </div>
          </template>

          <template #status="{ row }">
            <Tag :color="statusMap[row.status]?.color">
              {{ statusMap[row.status]?.label || '未知' }}
            </Tag>
          </template>

          <template #lastExecution="{ row }">
            <span v-if="getLastRecord(row)">
              {{ new Date(getLastRecord(row).startTime).toLocaleString('zh-CN') }}
            </span>
            <span v-else style="color: #999">-</span>
          </template>

          <template #nextRunTime="{ row }">
            <span v-if="row.nextRunTime">
              {{ new Date(row.nextRunTime).toLocaleString('zh-CN') }}
            </span>
            <span v-else style="color: #999">-</span>
          </template>

          <template #lastDuration="{ row }">
            <span v-if="getLastRecord(row)">
              {{ formatDuration(getLastRecord(row).duration) }}
            </span>
            <span v-else style="color: #999">-</span>
          </template>

          <template #lastError="{ row }">
            <span
              v-if="getLastRecord(row) && !getLastRecord(row).success"
              style="color: #ff4d4f"
            >
              {{ getLastRecord(row).errorMessage }}
            </span>
            <Tag v-else-if="getLastRecord(row)" color="success">成功</Tag>
            <span v-else style="color: #999">-</span>
          </template>

          <template #action="{ row }">
            <Space>
              <Button
                v-if="row.status !== 0"
                type="primary"
                size="small"
                @click="doAction(() => postStart(row.name))"
              >
                启动
              </Button>
              <Button
                v-if="row.status === 0"
                size="small"
                danger
                @click="doAction(() => postStop(row.name))"
              >
                停止
              </Button>
              <Button
                size="small"
                @click="doAction(() => postRestart(row.name))"
              >
                重启
              </Button>
              <Button
                size="small"
                @click="doAction(() => postReloadParameters(row.name))"
              >
                重载参数
              </Button>
              <Button
                type="primary"
                size="small"
                ghost
                @click="doAction(() => postRunOnce(row.name))"
              >
                立即执行
              </Button>
              <Button size="small" @click="showLogs(row.name)">
                日志
              </Button>
            </Space>
          </template>
        </Grid>
      </Tabs.TabPane>

      <Tabs.TabPane key="log" tab="任务日志" class="h-full">
        <LogGrid>
          <template #log_source="{ row }">
            <div style="line-height: 1.5; font-size: 12px;">
              <div>
                <Tag :color="sourceMap[row.source]?.color" style="margin: 0;">{{ sourceMap[row.source]?.label || '未知' }}</Tag>
                <Tag :color="logLevelMap[row.logLevel]?.color" style="margin: 0 0 0 4px;">{{ logLevelMap[row.logLevel]?.label }}</Tag>
              </div>
              <div style="color: #666; margin-top: 2px;">{{ row.taskName }}</div>
            </div>
          </template>

          <template #log_message="{ row }">
            <div style="line-height: 1.5; font-size: 12px;">
              <div>{{ row.message }}</div>
              <div v-if="row.exception" style="color: #ff4d4f; margin-top: 2px;">
                {{ row.exception.length > 80 ? row.exception.substring(0, 80) + '...' : row.exception }}
              </div>
            </div>
          </template>

          <template #log_createdTime="{ row }">
            {{ fmtTime(row.createdTime) }}
          </template>

          <template #log_action="{ row }">
            <Button size="small" @click="showDetail(row)">详情</Button>
          </template>
        </LogGrid>
      </Tabs.TabPane>
    </Tabs>

    <!-- 单任务日志弹窗 -->
    <Modal
      v-model:open="logVisible"
      :title="`任务日志 - ${logTaskName}`"
      width="700px"
      :footer="null"
    >
      <div v-if="logLoading" style="text-align: center; padding: 24px">
        加载中...
      </div>
      <div
        v-else-if="logList.length === 0"
        style="text-align: center; padding: 24px; color: #999"
      >
        暂无日志
      </div>
      <div v-else style="max-height: 500px; overflow-y: auto; padding: 8px 0">
        <Timeline>
          <Timeline.Item
            v-for="log in logList"
            :key="log.id"
            :color="logLevelMap[log.logLevel]?.color || 'blue'"
          >
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px">
              <Tag :color="logLevelMap[log.logLevel]?.color" size="small">
                {{ logLevelMap[log.logLevel]?.label || 'Unknown' }}
              </Tag>
              <span style="color: #999; font-size: 12px">
                {{ new Date(log.createdTime).toLocaleString('zh-CN') }}
              </span>
            </div>
            <div>{{ log.message }}</div>
            <div
              v-if="log.exception"
              style="
                margin-top: 4px;
                padding: 8px;
                background: #fff2f0;
                border-radius: 4px;
                font-size: 12px;
                color: #ff4d4f;
                white-space: pre-wrap;
                word-break: break-all;
              "
            >
              {{ log.exception }}
            </div>
          </Timeline.Item>
        </Timeline>
      </div>
    </Modal>

    <!-- 日志详情弹窗 -->
    <Modal
      v-model:open="detailVisible"
      title="日志详情"
      width="750px"
      :footer="null"
    >
      <div v-if="detailRow" style="font-size: 13px; line-height: 1.8;">
        <div style="margin-bottom: 12px;">
          <Tag :color="sourceMap[detailRow.source]?.color">{{ sourceMap[detailRow.source]?.label }}</Tag>
          <Tag :color="logLevelMap[detailRow.logLevel]?.color">{{ logLevelMap[detailRow.logLevel]?.label }}</Tag>
          <span style="color: #999; margin-left: 8px;">{{ fmtTime(detailRow.createdTime) }}</span>
        </div>

        <div style="margin-bottom: 8px; display: flex; align-items: center; gap: 4px;">
          <strong>来源名称：</strong>{{ detailRow.taskName }}
          <Button size="small" @click="copy(detailRow.taskName)">复制</Button>
        </div>

        <div style="margin-bottom: 8px; display: flex; align-items: center; gap: 4px;">
          <strong>消息：</strong>{{ detailRow.message }}
          <Button size="small" @click="copy(detailRow.message)">复制</Button>
        </div>

        <div v-if="detailInfo" style="margin-bottom: 8px;">
          <div style="display: flex; align-items: center; gap: 4px;">
            <strong>异常信息：</strong>
            <Button size="small" @click="copy(detailInfo)">复制</Button>
          </div>
          <pre style="margin-top: 4px; padding: 12px; background: #1e1e1e; color: #d4d4d4; border-radius: 6px; font-size: 12px; white-space: pre-wrap; word-break: break-all; max-height: 200px; overflow-y: auto;">{{ detailInfo }}</pre>
        </div>

        <div v-if="detailStack">
          <div style="display: flex; align-items: center; gap: 4px;">
            <strong>堆栈信息：</strong>
            <Button size="small" @click="copy(detailStack)">复制</Button>
          </div>
          <pre style="margin-top: 4px; padding: 12px; background: #1e1e1e; color: #d4d4d4; border-radius: 6px; font-size: 12px; white-space: pre-wrap; word-break: break-all; max-height: 300px; overflow-y: auto;">{{ detailStack }}</pre>
        </div>
      </div>
    </Modal>
  </Page>
</template>

<style module>
.tabs :global(.ant-tabs-content) {
  height: 100%;
}
</style>
