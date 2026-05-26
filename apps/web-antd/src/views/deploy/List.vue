<script lang="ts" setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Button,
  Card,
  Collapse,
  CollapsePanel,
  Descriptions,
  Empty,
  message,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Tag,
  Timeline,
  TimelineItem,
  Tooltip,
} from 'ant-design-vue';

import { AppVersion } from '#/components/AppVersion';
import { RestartWaiter } from '#/components/RestartWaiter';
import { TimeTag } from '#/components/TimeTag';
import { TimezoneDisplay } from '#/components/TimezoneDisplay';
import { ChunkUpload, type UploadDetail } from '#/components/Upload';

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
  loadAllJobs();
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

// ============ 部署目标列表 ============
const deployTargets = ref<DeployTarget[]>([]);
const targetsLoading = ref(false);

const allTargets = computed<TargetItem[]>(() => [
  { key: 'api', name: 'API 程序', path: appInfo.value?.installPath || '', isApi: true },
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

// ============ 每个 target 的 DeployJob 历史 ============
const jobsByTarget = reactive<Record<string, DeployJob[]>>({});
const jobsLoading = reactive<Record<string, boolean>>({});

async function loadJobsForTarget(targetKey: string) {
  jobsLoading[targetKey] = true;
  try {
    const res: any = await getUploadRecords({ target: targetKey, page: 1, pageSize: 10 });
    jobsByTarget[targetKey] = res?.items ?? [];
  } catch {
    jobsByTarget[targetKey] = [];
  } finally {
    jobsLoading[targetKey] = false;
  }
}

async function loadAllJobs() {
  await Promise.all(allTargets.value.map((t) => loadJobsForTarget(t.key)));
}

// 当前活动的 job(每 target 最近 Deployed 一个)
function currentJob(targetKey: string): DeployJob | null {
  const list = jobsByTarget[targetKey] ?? [];
  return list.find((j) => j.status === 'Deployed') ?? null;
}

// 部署中标志
const deployingMap = reactive<Record<string, boolean>>({});

// ============ 上传 + 部署 ============
const uploadPaths = reactive<Record<string, string>>({});
const keepConfigOnDeploy = ref(true);
const clearCacheOnDeploy = ref(false);

const confirmVisible = ref(false);
const confirmLoading = ref(false);
const confirmDeploying = ref(false);
const confirmPreview = ref<DeployPreview | null>(null);
let pendingConfirmAction: (() => Promise<void>) | null = null;
let pendingFilePath: null | string = null;

async function openDeployConfirm(opts: {
  target: string;
  targetName: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  onConfirm: () => Promise<void>;
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
    /* 忽略,临时文件由后端 OnUploadStart 兜底清理 */
  }
}

function handleConfirmDeploy() {
  if (!pendingConfirmAction) return;
  confirmDeploying.value = true;
  pendingConfirmAction()
    .finally(() => {
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

async function onZipUploaded(targetKey: string, d: UploadDetail | UploadDetail[]) {
  const detail = Array.isArray(d) ? d[0] : d;
  if (!detail) return;
  const target = allTargets.value.find((t) => t.key === targetKey);
  if (!target) return;

  await openDeployConfirm({
    target: targetKey,
    targetName: target.name,
    filePath: detail.path,
    fileName: detail.name,
    fileSize: detail.size,
    onConfirm: async () => {
      deployingMap[targetKey] = true;
      try {
        if (target.isApi) {
          await postDeployApiByPath(
            detail.path,
            detail.name,
            detail.size,
            clearCacheOnDeploy.value,
            keepConfigOnDeploy.value,
          );
          // API 部署会触发 GracefulStop,弹重启等待
          uploadPaths[targetKey] = '';
          restartModalVisible.value = true;
        } else {
          await postDeployProjectByPath(
            targetKey,
            detail.path,
            detail.name,
            detail.size,
          );
          uploadPaths[targetKey] = '';
          message.success(`${target.name} 已部署`);
          await loadJobsForTarget(targetKey);
        }
      } catch {
        uploadPaths[targetKey] = '';
      } finally {
        deployingMap[targetKey] = false;
      }
    },
  });
}

// ============ 重试 / 回滚 ============
const operatingJobId = ref(0);

async function handleRetryDeploy(job: DeployJob) {
  operatingJobId.value = job.id;
  try {
    if (job.target === 'api') {
      await postDeploy(job.id, keepConfigOnDeploy.value, clearCacheOnDeploy.value);
      restartModalVisible.value = true;
    } else {
      await postDeploy(job.id);
      message.success(`${job.targetName} 已重新部署`);
      await loadJobsForTarget(job.target);
    }
  } finally {
    operatingJobId.value = 0;
  }
}

async function handleRollback(job: DeployJob) {
  operatingJobId.value = job.id;
  try {
    await postRollback(job.id);
    if (job.target === 'api') {
      restartModalVisible.value = true;
    } else {
      message.success(`${job.targetName} 已回滚到 #${job.id}`);
      await loadJobsForTarget(job.target);
    }
  } finally {
    operatingJobId.value = 0;
  }
}

// ============ 工具 ============
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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

const TIMELINE_COLOR: Record<string, string> = {
  Deployed: 'green',
  Deploying: 'blue',
  Failed: 'red',
  RolledBack: 'gray',
  Uploaded: 'orange',
};

function jobPrimaryTime(job: DeployJob): string {
  return (
    job.deployFinishedAt ||
    job.deployStartedAt ||
    job.uploadedAt
  );
}

onMounted(async () => {
  await loadInfo();
  await loadDeployTargets();
  await loadAllJobs();
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
          bordered
          size="small"
          class="api-info"
        >
          <Descriptions.Item label="版本">
            <AppVersion :version="appInfo.version" />
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
            <div v-if="currentJob(target.key)" class="deploy-card__current">
              <div class="deploy-card__row">
                <span class="deploy-card__label">当前版本</span>
                <Tag :color="STATUS_COLOR[currentJob(target.key)!.status]">
                  #{{ currentJob(target.key)!.id }}
                  {{ STATUS_LABEL[currentJob(target.key)!.status] }}
                </Tag>
              </div>
              <div class="deploy-card__row">
                <span class="deploy-card__label">文件</span>
                <Tooltip :title="currentJob(target.key)!.fileName">
                  <span class="deploy-card__file">
                    {{ currentJob(target.key)!.fileName }}
                    ({{ formatBytes(currentJob(target.key)!.fileSize) }})
                  </span>
                </Tooltip>
              </div>
              <div class="deploy-card__row">
                <span class="deploy-card__label">部署时间</span>
                <TimeTag
                  v-if="currentJob(target.key)!.deployFinishedAt"
                  :time="currentJob(target.key)!.deployFinishedAt!"
                  :timezone="appInfo?.timeZone"
                />
                <span v-else style="color: var(--ant-color-text-tertiary)">—</span>
              </div>
              <div class="deploy-card__row">
                <span class="deploy-card__label">部署人</span>
                <span>{{ currentJob(target.key)!.deployedBy || '—' }}</span>
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
                <span class="deploy-card__file">📁 {{ target.path || '—' }}</span>
              </Tooltip>
            </div>

            <!-- API 专用:keepConfig / clearCache 开关 -->
            <div v-if="target.isApi" style="margin: 10px 0">
              <Space size="middle">
                <label
                  style="
                    cursor: pointer;
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                  "
                >
                  <input
                    v-model="keepConfigOnDeploy"
                    type="checkbox"
                    :disabled="deployingMap[target.key]"
                  />
                  <span style="font-size: 13px">保留 appsettings</span>
                </label>
                <label
                  style="
                    cursor: pointer;
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                  "
                >
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
              <div
                v-if="deployingMap[target.key]"
                class="deploy-card__hint"
              >
                部署中,请稍候...
              </div>
            </div>

            <!-- 历史(折叠)-->
            <Collapse
              v-if="(jobsByTarget[target.key]?.length ?? 0) > 0"
              :bordered="false"
              ghost
              style="margin-top: 8px"
            >
              <CollapsePanel
                :key="target.key"
                :header="`历史 (${jobsByTarget[target.key]?.length ?? 0})`"
              >
                <Timeline mode="left">
                  <TimelineItem
                    v-for="job in jobsByTarget[target.key]"
                    :key="job.id"
                    :color="TIMELINE_COLOR[job.status]"
                  >
                    <template #label>
                      <TimeTag
                        :time="jobPrimaryTime(job)"
                        :timezone="appInfo?.timeZone"
                      />
                    </template>
                    <div style="display: flex; flex-direction: column; gap: 4px">
                      <div>
                        <Tag :color="STATUS_COLOR[job.status]">
                          #{{ job.id }} {{ STATUS_LABEL[job.status] }}
                        </Tag>
                        <Tag v-if="job.rollbackOfJobId">
                          回滚自 #{{ job.rollbackOfJobId }}
                        </Tag>
                      </div>
                      <Tooltip :title="job.fileName">
                        <span class="deploy-card__file" style="font-size: 12px">
                          {{ job.fileName }} ({{ formatBytes(job.fileSize) }})
                        </span>
                      </Tooltip>
                      <div
                        style="
                          font-size: 12px;
                          color: var(--ant-color-text-tertiary);
                        "
                      >
                        {{ job.uploadedBy }}
                        <span v-if="job.deployedBy && job.deployedBy !== job.uploadedBy">
                          / 部署:{{ job.deployedBy }}
                        </span>
                      </div>
                      <div
                        v-if="job.errorMessage"
                        style="
                          font-size: 12px;
                          color: var(--ant-color-error);
                          word-break: break-all;
                        "
                      >
                        错误: {{ job.errorMessage }}
                      </div>
                      <Space size="small">
                        <Popconfirm
                          v-if="job.status === 'Failed' || job.status === 'Uploaded'"
                          title="重新部署?"
                          @confirm="handleRetryDeploy(job)"
                        >
                          <Button
                            size="small"
                            type="primary"
                            :loading="operatingJobId === job.id"
                          >
                            重试部署
                          </Button>
                        </Popconfirm>
                        <Popconfirm
                          v-else-if="
                            job.status === 'Deployed' || job.status === 'RolledBack'
                          "
                          :title="
                            job.status === 'Deployed'
                              ? '回滚到上一个版本?'
                              : '恢复到该版本(部署该 job 的文件)?'
                          "
                          @confirm="handleRollback(job)"
                        >
                          <Button
                            size="small"
                            danger
                            :loading="operatingJobId === job.id"
                            :disabled="
                              job.status === 'Deployed' && !job.previousJobId
                            "
                          >
                            {{ job.status === 'Deployed' ? '回滚' : '恢复' }}
                          </Button>
                        </Popconfirm>
                      </Space>
                    </div>
                  </TimelineItem>
                </Timeline>
              </CollapsePanel>
            </Collapse>
          </Card>
        </div>
      </Spin>
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
              <span class="deploy-card__file">{{ confirmPreview.targetPath }}</span>
            </Descriptions.Item>
            <Descriptions.Item label="文件">
              {{ confirmPreview.fileName }}
              ({{ formatBytes(confirmPreview.fileSize) }})
            </Descriptions.Item>
            <Descriptions.Item label="zip 入口前 10 项">
              <div
                style="
                  font-family: monospace;
                  font-size: 12px;
                  max-height: 160px;
                  overflow: auto;
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
                {{ confirmPreview.target === 'api' ? '确认部署并重启' : '确认部署' }}
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
.api-info :deep(.ant-descriptions-view) > table {
  table-layout: fixed;
}

.api-info :deep(.ant-descriptions-item-content) {
  word-break: break-all;
}

.deploy-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.deploy-card {
  flex: 1 1 360px;
  min-width: 0;
  max-width: 560px;
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
  align-items: center;
  gap: 8px;
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
  white-space: nowrap;
  font-family: monospace;
  font-size: 12px;
}

.deploy-card__path {
  margin-top: 10px;
  padding: 6px 8px;
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
</style>
