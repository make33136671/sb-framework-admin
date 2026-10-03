<script lang="ts" setup>
import type { UploadDetail } from '#/components/Upload';

import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Button,
  Card,
  Descriptions,
  Empty,
  message,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Tooltip,
} from 'ant-design-vue';

import { AppVersion } from '#/components/AppVersion';
import { RestartWaiter } from '#/components/RestartWaiter';
import { TimeTag } from '#/components/TimeTag';
import { TimezoneDisplay } from '#/components/TimezoneDisplay';
import { ChunkUpload } from '#/components/Upload';

import {
  getDeployTargets,
  getInfo,
  getPreviewDeploy,
  getUploadRecords,
  postCancelUpload,
  postDeploy,
  postDeployApiByPath,
  postDeployProjectByPath,
  postRestart,
  postRollback,
} from './api';

// ============ 类型 ============
interface AppInfo {
  version: string;
  environment: string;
  startTime: string;
  uptime: string;
  machineName: string;
  dotnetVersion: string;
  buildTime: string;
  timeZone: string;
  serverTime: string;
  installPath: string;
}

interface DeployTarget {
  key: string;
  name: string;
  path: string;
}

interface DeployJob {
  id: number;
  target: string;
  targetName: string;
  fileName: string;
  fileSize: number;
  storagePath: string;
  status: 'Deployed' | 'Deploying' | 'Failed' | 'RolledBack' | 'Uploaded';
  errorMessage?: string;
  uploadedBy: string;
  uploadedAt: string;
  deployedBy?: string;
  deployStartedAt?: string;
  deployFinishedAt?: string;
  previousJobId?: null | number;
  rollbackOfJobId?: null | number;
  rolledBackBy?: string;
  rolledBackAt?: string;
  remark?: string;
}

interface TargetItem extends DeployTarget {
  isApi: boolean;
}

interface DeployPreview {
  target: string;
  targetName: string;
  targetPath: string;
  fileName: string;
  fileSize: number;
  filePath: string;
  entries: string[];
}

// ============ 应用信息 ============
const appInfo = ref<AppInfo | null>(null);
const infoLoading = ref(false);
const liveUptime = ref('');
const liveServerTime = ref('');

let uptimeBaseMs = 0;
let serverTimeBase = 0;
let uptimeLoadedAt = 0;
let uptimeTimer: null | ReturnType<typeof setInterval> = null;
let serverTimeTimer: null | ReturnType<typeof setInterval> = null;

function parseUptimeToMs(uptime: string): number {
  const match = /^(?:(\d+)\.)?(\d{2}):(\d{2}):(\d{2})$/.exec(uptime);
  if (!match) return 0;
  const [, days, hours, minutes, seconds] = match;
  return (
    (Number(days || 0) * 86_400 +
      Number(hours) * 3600 +
      Number(minutes) * 60 +
      Number(seconds)) *
    1000
  );
}

function formatUptimeLive(ms: number): string {
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}天 ${h}小时 ${m}分 ${s}秒`;
  if (h > 0) return `${h}小时 ${m}分 ${s}秒`;
  if (m > 0) return `${m}分 ${s}秒`;
  return `${s}秒`;
}

function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function resetTimers(info: AppInfo) {
  stopTimers();
  uptimeBaseMs = parseUptimeToMs(info.uptime);
  uptimeLoadedAt = Date.now();
  serverTimeBase = new Date(info.serverTime).getTime();
  liveUptime.value = formatUptimeLive(uptimeBaseMs);
  liveServerTime.value = formatDateTime(serverTimeBase);
  uptimeTimer = setInterval(() => {
    liveUptime.value = formatUptimeLive(
      uptimeBaseMs + (Date.now() - uptimeLoadedAt),
    );
  }, 1000);
  serverTimeTimer = setInterval(() => {
    serverTimeBase += 1000;
    liveServerTime.value = formatDateTime(serverTimeBase);
  }, 1000);
}

function stopTimers() {
  if (uptimeTimer) clearInterval(uptimeTimer);
  if (serverTimeTimer) clearInterval(serverTimeTimer);
  uptimeTimer = null;
  serverTimeTimer = null;
}

async function loadInfo() {
  infoLoading.value = true;
  try {
    const data: any = await getInfo();
    appInfo.value = data;
    if (data) resetTimers(data);
  } finally {
    infoLoading.value = false;
  }
}

// ============ 重启 ============
const restartModalVisible = ref(false);
function onRestartSuccess(info: any) {
  appInfo.value = info;
  resetTimers(info);
  message.success('程序重启成功');
  loadCurrentJobs();
  loadUploadRecords();
  loadDeployRecords();
}

async function handleRestart() {
  Modal.confirm({
    title: '确认重启',
    content: '确定要重启 API 程序吗?重启期间服务将短暂不可用。',
    okText: '确定',
    cancelText: '取消',
    async onOk() {
      try {
        await postRestart();
        restartModalVisible.value = true;
      } catch {
        message.error('发送重启指令失败');
      }
    },
  });
}

// ============ 部署目标列表 + 当前活动版本 ============
const deployTargets = ref<DeployTarget[]>([]);
const targetsLoading = ref(false);

const allTargets = computed<TargetItem[]>(() => [
  {
    key: 'api',
    name: 'API 程序',
    path: appInfo.value?.installPath || '',
    isApi: true,
  },
  ...deployTargets.value.map((t) => ({ ...t, isApi: false })),
]);

async function loadDeployTargets() {
  targetsLoading.value = true;
  try {
    deployTargets.value = (await getDeployTargets()) || [];
  } finally {
    targetsLoading.value = false;
  }
}

// 每个 target 的"当前活动版本"(最近一条 Deployed)
const currentByTarget = reactive<Record<string, DeployJob | null>>({});

async function loadCurrentForTarget(targetKey: string) {
  try {
    const res: any = await getUploadRecords({
      target: targetKey,
      status: 'Deployed',
      page: 1,
      pageSize: 1,
    });
    currentByTarget[targetKey] = (res?.items ?? [])[0] ?? null;
  } catch {
    currentByTarget[targetKey] = null;
  }
}

async function loadCurrentJobs() {
  await Promise.all(allTargets.value.map((t) => loadCurrentForTarget(t.key)));
}

// 部署中标志
const deployingMap = reactive<Record<string, boolean>>({});

// ============ 上传 + 部署 ============
const uploadPaths = reactive<Record<string, string>>({});
const keepConfigOnDeploy = ref(true);
const keepLockOnDeploy = ref(true);
const clearCacheOnDeploy = ref(false);

const confirmVisible = ref(false);
const confirmLoading = ref(false);
const confirmDeploying = ref(false);
const confirmPreview = ref<DeployPreview | null>(null);
let pendingConfirmAction: (() => Promise<void>) | null = null;
let pendingFilePath: null | string = null;

async function openDeployConfirm(opts: {
  fileName: string;
  filePath: string;
  fileSize: number;
  onConfirm: () => Promise<void>;
  target: string;
  targetName: string;
}) {
  confirmLoading.value = true;
  confirmVisible.value = true;
  pendingFilePath = opts.filePath;
  try {
    const preview = (await getPreviewDeploy(
      opts.target,
      opts.filePath,
      opts.fileName,
    )) as DeployPreview | null;
    confirmPreview.value = preview;
    pendingConfirmAction = opts.onConfirm;
  } catch {
    message.error('预览部署失败');
    confirmVisible.value = false;
    pendingFilePath = null;
  } finally {
    confirmLoading.value = false;
  }
}

async function silentCancelUpload(filePath: string) {
  try {
    await postCancelUpload(filePath);
  } catch {
    /* 后端 OnUploadStart 兜底清理,失败忽略 */
  }
}

function handleConfirmDeploy() {
  if (!pendingConfirmAction) return;
  confirmDeploying.value = true;
  pendingConfirmAction().finally(() => {
    confirmDeploying.value = false;
    confirmVisible.value = false;
    pendingConfirmAction = null;
    pendingFilePath = null;
  });
}

function handleCancelDeploy() {
  if (pendingFilePath) silentCancelUpload(pendingFilePath);
  confirmVisible.value = false;
  pendingConfirmAction = null;
  pendingFilePath = null;
  confirmPreview.value = null;
}

async function onZipUploaded(
  targetKey: string,
  d: UploadDetail | UploadDetail[],
) {
  const detail = Array.isArray(d) ? d[0] : d;
  if (!detail) return;
  const target = allTargets.value.find((t) => t.key === targetKey);
  if (!target) return;

  await openDeployConfirm({
    target: targetKey,
    targetName: target.name,
    filePath: detail.fileName,
    fileName: detail.name,
    fileSize: detail.size,
    onConfirm: async () => {
      deployingMap[targetKey] = true;
      try {
        if (target.isApi) {
          await postDeployApiByPath(
            detail.fileName,
            detail.name,
            detail.size,
            clearCacheOnDeploy.value,
            keepConfigOnDeploy.value,
            keepLockOnDeploy.value,
          );
          uploadPaths[targetKey] = '';
          restartModalVisible.value = true;
        } else {
          await postDeployProjectByPath(
            targetKey,
            detail.fileName,
            detail.name,
            detail.size,
          );
          uploadPaths[targetKey] = '';
          message.success(`${target.name} 已部署`);
          await loadCurrentForTarget(targetKey);
          await loadDeployRecords();
        }
      } catch {
        uploadPaths[targetKey] = '';
      } finally {
        deployingMap[targetKey] = false;
      }
    },
  });
}

// ============ 上传记录表(底部 Tab 1) — Uploaded / Failed ============
const uploadRecordsLoading = ref(false);
const uploadRecordsData = ref<DeployJob[]>([]);
const uploadRecordsTotal = ref(0);
const uploadRecordsPage = ref(1);
const uploadRecordsPageSize = ref(10);
const uploadRecordsTargetFilter = ref<string | undefined>(undefined);

async function loadUploadRecords() {
  uploadRecordsLoading.value = true;
  try {
    // 顺序拉 Uploaded + Failed 两类(等待或失败 — 可重试)
    const res1: any = await getUploadRecords({
      target: uploadRecordsTargetFilter.value,
      status: 'Uploaded',
      page: 1,
      pageSize: 100,
    });
    const res2: any = await getUploadRecords({
      target: uploadRecordsTargetFilter.value,
      status: 'Failed',
      page: 1,
      pageSize: 100,
    });
    const merged: DeployJob[] = [
      ...((res1?.items ?? []) as DeployJob[]),
      ...((res2?.items ?? []) as DeployJob[]),
    ].toSorted((a, b) => b.id - a.id);
    uploadRecordsTotal.value = merged.length;
    const from = (uploadRecordsPage.value - 1) * uploadRecordsPageSize.value;
    uploadRecordsData.value = merged.slice(
      from,
      from + uploadRecordsPageSize.value,
    );
  } finally {
    uploadRecordsLoading.value = false;
  }
}

const retryingId = ref(0);
async function handleRetryDeploy(job: DeployJob) {
  retryingId.value = job.id;
  try {
    if (job.target === 'api') {
      await postDeploy(
        job.id,
        keepConfigOnDeploy.value,
        clearCacheOnDeploy.value,
        keepLockOnDeploy.value,
      );
      restartModalVisible.value = true;
    } else {
      await postDeploy(job.id);
      message.success(`${job.targetName} 已部署`);
    }
    await loadUploadRecords();
    await loadDeployRecords();
    await loadCurrentForTarget(job.target);
  } finally {
    retryingId.value = 0;
  }
}

// ============ 部署记录表(底部 Tab 2) — Deployed / RolledBack ============
const deployRecordsLoading = ref(false);
const deployRecordsData = ref<DeployJob[]>([]);
const deployRecordsTotal = ref(0);
const deployRecordsPage = ref(1);
const deployRecordsPageSize = ref(10);
const deployRecordsTargetFilter = ref<string | undefined>(undefined);

async function loadDeployRecords() {
  deployRecordsLoading.value = true;
  try {
    const res1: any = await getUploadRecords({
      target: deployRecordsTargetFilter.value,
      status: 'Deployed',
      page: 1,
      pageSize: 100,
    });
    const res2: any = await getUploadRecords({
      target: deployRecordsTargetFilter.value,
      status: 'RolledBack',
      page: 1,
      pageSize: 100,
    });
    const merged: DeployJob[] = [
      ...((res1?.items ?? []) as DeployJob[]),
      ...((res2?.items ?? []) as DeployJob[]),
    ].toSorted((a, b) => b.id - a.id);
    deployRecordsTotal.value = merged.length;
    const from = (deployRecordsPage.value - 1) * deployRecordsPageSize.value;
    deployRecordsData.value = merged.slice(
      from,
      from + deployRecordsPageSize.value,
    );
  } finally {
    deployRecordsLoading.value = false;
  }
}

const rollingBackId = ref(0);
async function handleRollback(job: DeployJob) {
  rollingBackId.value = job.id;
  try {
    await postRollback(job.id);
    if (job.target === 'api') {
      restartModalVisible.value = true;
    } else {
      message.success(`${job.targetName} 已回滚到 #${job.id}`);
    }
    await loadDeployRecords();
    await loadCurrentForTarget(job.target);
  } finally {
    rollingBackId.value = 0;
  }
}

// ============ 工具 ============
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const STATUS_COLOR: Record<string, string> = {
  Deployed: 'success',
  Deploying: 'processing',
  Failed: 'error',
  RolledBack: 'default',
  Uploaded: 'warning',
};

const STATUS_LABEL: Record<string, string> = {
  Deployed: '已部署',
  Deploying: '部署中',
  Failed: '失败',
  RolledBack: '已回滚',
  Uploaded: '等待部署',
};

// ============ 表格列 ============
// table-layout:fixed 下,未写 width 的两列按比例分剩余宽度，内容靠 CSS 换行
// 不撑爆容器；操作列给固定窄宽。整体随容器自适应，窄屏不溢出。
const uploadColumns = [
  { title: '目标 / 文件 / 大小', dataIndex: 'fileInfo' },
  { title: '状态 / 上传时间 / 上传人', dataIndex: 'meta' },
  { title: '操作', dataIndex: 'op', width: 88 },
];

const deployColumns = [
  { title: '目标 / 文件 / 大小', dataIndex: 'fileInfo' },
  { title: '状态 / 部署时间 / 部署人', dataIndex: 'meta' },
  { title: '操作', dataIndex: 'op', width: 88 },
];

const targetFilterOptions = computed(() =>
  allTargets.value.map((t) => ({ label: t.name, value: t.key })),
);

const activeBottomTab = ref('upload');

onMounted(async () => {
  await loadInfo();
  await loadDeployTargets();
  await Promise.all([
    loadCurrentJobs(),
    loadUploadRecords(),
    loadDeployRecords(),
  ]);
});

onUnmounted(stopTimers);
</script>

<template>
  <Page auto-content-height>
    <div style="display: flex; flex-direction: column; gap: 16px">
      <!-- 应用信息 -->
      <Card title="应用信息" :loading="infoLoading">
        <template #extra>
          <Space>
            <Button @click="loadInfo">刷新</Button>
            <Button danger @click="handleRestart">重启程序</Button>
          </Space>
        </template>
        <Descriptions
          v-if="appInfo"
          :column="{ xs: 1, sm: 2, lg: 3, xl: 4 }"
          :label-style="{ width: '80px' }"
          bordered
          size="small"
          class="api-info"
        >
          <Descriptions.Item label="版本">
            <AppVersion :value="appInfo.version" />
          </Descriptions.Item>
          <Descriptions.Item label="环境">
            <Tag :color="appInfo.environment === 'Production' ? 'red' : 'blue'">
              {{ appInfo.environment }}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="启动时间">
            <TimeTag :time="appInfo.startTime" :timezone="appInfo.timeZone" />
          </Descriptions.Item>
          <Descriptions.Item label="运行时长">
            <Tag color="green">{{ liveUptime }}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="构建时间">
            <TimeTag :time="appInfo.buildTime" :timezone="appInfo.timeZone" />
          </Descriptions.Item>
          <Descriptions.Item label="服务器">
            {{ appInfo.machineName }}
          </Descriptions.Item>
          <Descriptions.Item label=".NET 版本">
            {{ appInfo.dotnetVersion }}
          </Descriptions.Item>
          <Descriptions.Item label="时区">
            <TimezoneDisplay :timezone="appInfo.timeZone" />
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <!-- 部署目标卡片网格 -->
      <Spin :spinning="targetsLoading">
        <div class="deploy-grid">
          <Card
            v-for="target in allTargets"
            :key="target.key"
            class="deploy-card"
            :title="target.name"
          >
            <template #extra>
              <Tag :color="target.isApi ? 'volcano' : 'cyan'">
                {{ target.key }}
              </Tag>
            </template>

            <!-- 当前活动版本 -->
            <div
              v-if="currentByTarget[target.key]"
              class="deploy-card__current"
            >
              <div class="deploy-card__row">
                <span class="deploy-card__label">当前版本</span>
                <Tag :color="STATUS_COLOR[currentByTarget[target.key]!.status]">
                  #{{ currentByTarget[target.key]!.id }}
                  {{ STATUS_LABEL[currentByTarget[target.key]!.status] }}
                </Tag>
              </div>
              <div class="deploy-card__row">
                <span class="deploy-card__label">文件</span>
                <Tooltip :title="currentByTarget[target.key]!.fileName">
                  <span class="deploy-card__file">
                    {{ currentByTarget[target.key]!.fileName }}
                    ({{ formatBytes(currentByTarget[target.key]!.fileSize) }})
                  </span>
                </Tooltip>
              </div>
              <div class="deploy-card__row">
                <span class="deploy-card__label">部署时间</span>
                <TimeTag
                  v-if="currentByTarget[target.key]!.deployFinishedAt"
                  :time="currentByTarget[target.key]!.deployFinishedAt!"
                  :timezone="appInfo?.timeZone"
                />
                <span v-else style="color: var(--ant-color-text-tertiary)"
                  >—</span
                >
              </div>
              <div class="deploy-card__row">
                <span class="deploy-card__label">部署人</span>
                <span>{{
                  currentByTarget[target.key]!.deployedBy || '—'
                }}</span>
              </div>
            </div>
            <Empty
              v-else
              description="还未部署"
              :image="undefined"
              style="padding: 12px 0"
            />

            <!-- 路径 -->
            <div class="deploy-card__path">
              <Tooltip :title="target.path">
                <span class="deploy-card__file"
                  >📁 {{ target.path || '—' }}</span
                >
              </Tooltip>
            </div>

            <!-- API 专用:keepConfig / keepLock / clearCache 开关 -->
            <div v-if="target.isApi" style="margin: 10px 0">
              <Space size="middle" wrap>
                <label class="checkbox-label">
                  <input
                    v-model="keepConfigOnDeploy"
                    type="checkbox"
                    :disabled="deployingMap[target.key]"
                  />
                  <span style="font-size: 13px">不更新 appsettings</span>
                </label>
                <label class="checkbox-label">
                  <input
                    v-model="keepLockOnDeploy"
                    type="checkbox"
                    :disabled="deployingMap[target.key]"
                  />
                  <span style="font-size: 13px">不删除 installed.lock</span>
                </label>
                <label class="checkbox-label">
                  <input
                    v-model="clearCacheOnDeploy"
                    type="checkbox"
                    :disabled="deployingMap[target.key]"
                  />
                  <span style="font-size: 13px">清空缓存</span>
                </label>
              </Space>
            </div>

            <!-- 上传 -->
            <div class="deploy-card__upload">
              <ChunkUpload
                type="file"
                :value="uploadPaths[target.key] ?? ''"
                accept=".zip"
                :disabled="deployingMap[target.key]"
                @update:value="(v: any) => (uploadPaths[target.key] = v)"
                @success="(d: any) => onZipUploaded(target.key, d)"
              />
              <div v-if="deployingMap[target.key]" class="deploy-card__hint">
                部署中,请稍候...
              </div>
            </div>
          </Card>
        </div>
      </Spin>

      <!-- 底部:上传记录 / 部署记录 表格 Tabs -->
      <Card>
        <Tabs v-model:active-key="activeBottomTab">
          <Tabs.TabPane key="upload" tab="上传记录">
            <div style="display: flex; gap: 8px; margin-bottom: 12px">
              <select
                v-model="uploadRecordsTargetFilter"
                class="filter-select"
                @change="loadUploadRecords"
              >
                <option :value="undefined">全部目标</option>
                <option
                  v-for="opt in targetFilterOptions"
                  :key="opt.value"
                  :value="opt.value"
                >
                  {{ opt.label }}
                </option>
              </select>
              <Button size="small" @click="loadUploadRecords">刷新</Button>
            </div>
            <Table
              class="records-table"
              :columns="uploadColumns"
              :data-source="uploadRecordsData"
              :loading="uploadRecordsLoading"
              :pagination="{
                current: uploadRecordsPage,
                pageSize: uploadRecordsPageSize,
                total: uploadRecordsTotal,
                showSizeChanger: true,
                onChange: (p: number, ps: number) => {
                  uploadRecordsPage = p;
                  uploadRecordsPageSize = ps;
                  loadUploadRecords();
                },
              }"
              size="small"
              row-key="id"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.dataIndex === 'fileInfo'">
                  <div class="cell-stack">
                    <div class="cell-stack__line">
                      <Tag color="blue">{{ record.targetName }}</Tag>
                    </div>
                    <div class="cell-stack__line">
                      <Tooltip :title="record.fileName">
                        <span class="deploy-card__file">{{
                          record.fileName
                        }}</span>
                      </Tooltip>
                    </div>
                    <div class="cell-stack__line cell-stack__sub">
                      {{ formatBytes(record.fileSize) }}
                    </div>
                  </div>
                </template>
                <template v-else-if="column.dataIndex === 'meta'">
                  <div class="cell-stack">
                    <div class="cell-stack__line">
                      <Tag :color="STATUS_COLOR[record.status]">
                        {{ STATUS_LABEL[record.status] }}
                      </Tag>
                      <Tooltip
                        v-if="record.errorMessage"
                        :title="record.errorMessage"
                      >
                        <Tag color="red" style="cursor: help">!</Tag>
                      </Tooltip>
                    </div>
                    <div class="cell-stack__line cell-stack__sub">
                      <TimeTag
                        :time="record.uploadedAt"
                        :timezone="appInfo?.timeZone"
                      />
                    </div>
                    <div class="cell-stack__line cell-stack__sub">
                      <span class="cell-stack__by">
                        上传人：{{ record.uploadedBy || '—' }}
                      </span>
                    </div>
                  </div>
                </template>
                <template v-else-if="column.dataIndex === 'op'">
                  <Space wrap>
                    <Popconfirm
                      :title="`重新部署 #${record.id}?`"
                      @confirm="handleRetryDeploy(record as DeployJob)"
                    >
                      <Button
                        type="primary"
                        :loading="retryingId === record.id"
                      >
                        {{ record.status === 'Failed' ? '重试' : '部署' }}
                      </Button>
                    </Popconfirm>
                  </Space>
                </template>
              </template>
            </Table>
          </Tabs.TabPane>

          <Tabs.TabPane key="deploy" tab="部署记录">
            <div style="display: flex; gap: 8px; margin-bottom: 12px">
              <select
                v-model="deployRecordsTargetFilter"
                class="filter-select"
                @change="loadDeployRecords"
              >
                <option :value="undefined">全部目标</option>
                <option
                  v-for="opt in targetFilterOptions"
                  :key="opt.value"
                  :value="opt.value"
                >
                  {{ opt.label }}
                </option>
              </select>
              <Button size="small" @click="loadDeployRecords">刷新</Button>
            </div>
            <Table
              class="records-table"
              :columns="deployColumns"
              :data-source="deployRecordsData"
              :loading="deployRecordsLoading"
              :pagination="{
                current: deployRecordsPage,
                pageSize: deployRecordsPageSize,
                total: deployRecordsTotal,
                showSizeChanger: true,
                onChange: (p: number, ps: number) => {
                  deployRecordsPage = p;
                  deployRecordsPageSize = ps;
                  loadDeployRecords();
                },
              }"
              size="small"
              row-key="id"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.dataIndex === 'fileInfo'">
                  <div class="cell-stack">
                    <div class="cell-stack__line">
                      <Tag color="blue">{{ record.targetName }}</Tag>
                    </div>
                    <div class="cell-stack__line">
                      <Tooltip :title="record.fileName">
                        <span class="deploy-card__file">{{
                          record.fileName
                        }}</span>
                      </Tooltip>
                    </div>
                    <div class="cell-stack__line cell-stack__sub">
                      {{ formatBytes(record.fileSize) }}
                    </div>
                  </div>
                </template>
                <template v-else-if="column.dataIndex === 'meta'">
                  <div class="cell-stack">
                    <div class="cell-stack__line">
                      <Tag :color="STATUS_COLOR[record.status]">
                        {{ STATUS_LABEL[record.status] }}
                      </Tag>
                    </div>
                    <div v-if="record.rollbackOfJobId" class="cell-stack__line">
                      <Tag>回滚自 #{{ record.rollbackOfJobId }}</Tag>
                    </div>
                    <div class="cell-stack__line cell-stack__sub">
                      <TimeTag
                        v-if="record.deployFinishedAt"
                        :time="record.deployFinishedAt"
                        :timezone="appInfo?.timeZone"
                      />
                      <span
                        v-else
                        style="color: var(--ant-color-text-tertiary)"
                      >
                        —
                      </span>
                    </div>
                    <div class="cell-stack__line cell-stack__sub">
                      <span class="cell-stack__by">
                        部署人：{{ record.deployedBy || '—' }}
                      </span>
                    </div>
                  </div>
                </template>
                <template v-else-if="column.dataIndex === 'op'">
                  <Space wrap>
                    <Popconfirm
                      :title="
                        record.status === 'Deployed'
                          ? '回滚到上一个版本?'
                          : '恢复到该版本(再次部署该 job 的文件)?'
                      "
                      @confirm="handleRollback(record as DeployJob)"
                    >
                      <Button
                        danger
                        :loading="rollingBackId === record.id"
                        :disabled="
                          record.status === 'Deployed' && !record.previousJobId
                        "
                      >
                        {{ record.status === 'Deployed' ? '回滚' : '恢复' }}
                      </Button>
                    </Popconfirm>
                  </Space>
                </template>
              </template>
            </Table>
          </Tabs.TabPane>
        </Tabs>
      </Card>
    </div>

    <!-- 部署确认弹窗 -->
    <Modal
      v-model:open="confirmVisible"
      :footer="null"
      :closable="!confirmDeploying"
      :mask-closable="false"
      title="确认部署"
      width="520px"
      @cancel="handleCancelDeploy"
    >
      <Spin :spinning="confirmLoading || confirmDeploying">
        <div v-if="confirmPreview">
          <Descriptions :column="1" size="small" bordered>
            <Descriptions.Item label="目标">
              {{ confirmPreview.targetName }}
              <Tag style="margin-left: 8px">{{ confirmPreview.target }}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="路径">
              <span class="deploy-card__file">{{
                confirmPreview.targetPath
              }}</span>
            </Descriptions.Item>
            <Descriptions.Item label="文件">
              {{ confirmPreview.fileName }}
              ({{ formatBytes(confirmPreview.fileSize) }})
            </Descriptions.Item>
            <Descriptions.Item label="zip 入口前 10 项">
              <div
                style="
                  max-height: 160px;
                  overflow: auto;
                  font-family: monospace;
                  font-size: 12px;
                "
              >
                <div v-for="e in confirmPreview.entries" :key="e">{{ e }}</div>
              </div>
            </Descriptions.Item>
          </Descriptions>

          <div style="margin-top: 16px; text-align: right">
            <Space>
              <Button :disabled="confirmDeploying" @click="handleCancelDeploy">
                取消
              </Button>
              <Button
                type="primary"
                danger
                :loading="confirmDeploying"
                @click="handleConfirmDeploy"
              >
                {{
                  confirmPreview.target === 'api'
                    ? '确认部署并重启'
                    : '确认部署'
                }}
              </Button>
            </Space>
          </div>
        </div>
      </Spin>
    </Modal>

    <!-- 重启等待 -->
    <RestartWaiter
      v-model:open="restartModalVisible"
      @success="onRestartSuccess"
    />
  </Page>
</template>

<style scoped>
/* 应用信息:antd Descriptions。label 固定窄宽,长值(版本号 64 位 / 时区全名)
 * 在内容格内自然换行,不溢出、不顶到相邻项。 */
.api-info :deep(.ant-descriptions-item-label) {
  width: 80px;
  white-space: nowrap;
}

.api-info :deep(.ant-descriptions-item-content) {
  word-break: break-all;
}

/* 记录表:table-layout:fixed 让列宽按容器分配而非被内容撑宽,
 * 配合单元格内容换行,任何窄屏都不会横向溢出、操作列不会被挤出边界。 */
.records-table :deep(.ant-table) {
  width: 100%;
}

.records-table :deep(.ant-table table) {
  width: 100%;
  table-layout: fixed;
}

/* 文件名在记录表内允许换行(组件默认 nowrap+ellipsis 会撑宽) */
.records-table :deep(.deploy-card__file) {
  word-break: break-all;
  white-space: normal;
}

.records-table :deep(.ant-table-thead > tr > th),
.records-table :deep(.ant-table-tbody > tr > td) {
  word-break: break-all;
  overflow-wrap: anywhere;
  white-space: normal;
}

/* 时间标签(TimeTag 的 antd Tag)默认 inline-block 不换行会撑宽,
 * 这里强制其在窄格内整体换行、内部长串也能断行 */
.records-table :deep(.time-tag) {
  display: inline-block;
  max-width: 100%;
  word-break: break-all;
  white-space: normal;
}

.deploy-grid {
  /* CSS Grid 自适应等宽多列(推翻旧 flex 死宽方案)。
   * auto-fill + minmax(min(320px,100%), 1fr):
   *   - 列数随容器宽自动增减、不锁死(屏越宽列越多):5 张卡 + 4K 宽屏就排 5 列一行 → 需求 #4;
   *   - 所有列严格等宽(1fr 平分),普通屏列在 320 以上拉伸铺满,无右侧留白 → 需求 #1 #2 #3;
   *   - 列宽下限 320px 决定挤几列:768→2 列、1024→3 列、1440→4 列;
   *   - min(320px,100%) 让容器 <320px(375 屏)时单列不溢出 → 需求 #5。
   * 不设 max-width:列数必须跟得上卡片数与屏宽。用 max-width 钳网格会人为锁死列数,
   * 导致卡片被迫换行而右侧大片留白(已踩坑:1600 把 4K 锁成 4 列、第 5 张换行)。
   * 超宽屏"卡片不被拉超宽 + 排满后右侧留白"改由 .deploy-card 的 max-width:480 实现 —— 见下。 */
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr));
  gap: 16px;
}

.deploy-card {
  /* Grid 子项默认撑满所在列(等宽由 grid-template-columns 的 1fr 保证),无需 flex 死宽。
   * max-width:480 给卡片宽度封顶:超宽屏下列想拉超 480 时,卡片停在 480 不被拉超宽,
   * 列数仍由 auto-fill 按 320 算(能排几列排几列),全部排完后右侧自然留白 → 需求 #4 #5。
   * 普通屏列宽 ≤480,封顶不触发,卡片随列宽拉伸铺满(满足 #1~#3)。
   * min-width:0 防止内容长的卡(如 API 卡信息行)撑破列宽。 */
  min-width: 0;
  max-width: 480px;
}

/* 记录表合并列:每一项各占一行,上下堆叠 */
.cell-stack {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

/* 单项行:左对齐,内部若有多个元素(如状态 Tag)横向排列 */
.cell-stack__line {
  display: flex;
  gap: 6px;
  align-items: center;
  min-width: 0;
}

.cell-stack__sub {
  font-size: 12px;
  color: var(--ant-color-text-tertiary);
}

.cell-stack__by {
  color: var(--ant-color-text-secondary);
}

.deploy-card__current {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  background: var(--ant-color-fill-quaternary);
  border-radius: 4px;
}

.deploy-card__row {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 13px;
}

.deploy-card__label {
  flex: 0 0 64px;
  color: var(--ant-color-text-tertiary);
}

.deploy-card__file {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: monospace;
  font-size: 12px;
  white-space: nowrap;
}

/* 卡片内的安装路径 / 当前版本文件名是重要信息,必须完整显示:
 * 用更具体的选择器只覆盖卡片内的 .deploy-card__file,改成换行完整展示,
 * 不动全局基础规则(记录表 .records-table / 预览弹窗仍走 nowrap+ellipsis 紧凑显示)。 */
.deploy-card__path .deploy-card__file,
.deploy-card__current .deploy-card__file {
  overflow: visible;
  text-overflow: clip;
  word-break: break-all;
  white-space: normal;
}

.deploy-card__path {
  padding: 6px 8px;
  margin-top: 10px;
  background: var(--ant-color-fill-tertiary);
  border-radius: 4px;
}

.deploy-card__upload {
  margin-top: 12px;
}

.deploy-card__hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--ant-color-warning);
}

.checkbox-label {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  cursor: pointer;
}

.filter-select {
  height: 28px;
  padding: 0 8px;
  color: var(--ant-color-text);
  background: var(--ant-color-bg-container);
  border: 1px solid var(--ant-color-border);
  border-radius: 4px;
}
</style>
