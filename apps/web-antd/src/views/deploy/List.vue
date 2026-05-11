<script lang="ts" setup>
import { onMounted, onUnmounted, reactive, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Alert,
  Button,
  Card,
  Checkbox,
  Descriptions,
  message,
  Modal,
  Popconfirm,
  Progress,
  Space,
  Spin,
  Table,
  Tag,
} from 'ant-design-vue';

import { TimeTag } from '#/components/TimeTag';
import { TimezoneDisplay } from '#/components/TimezoneDisplay';
import { ChunkUpload, type UploadDetail } from '#/components/Upload';

import {
  getDeployRecords,
  getDeployTargets,
  getInfo,
  getPreviewDeploy,
  postCancelUpload,
  postDeployApiByPath,
  postDeployProjectByPath,
  postRestart,
  postRollback,
} from './api';

// ============ 应用信息 ============
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

const appInfo = ref<AppInfo | null>(null);
const infoLoading = ref(false);
const liveUptime = ref('');
const liveServerTime = ref('');

let uptimeBaseMs = 0;
let serverTimeBase = 0;
let uptimeLoadedAt = 0;
let uptimeTimer: ReturnType<typeof setInterval> | null = null;
let serverTimeTimer: ReturnType<typeof setInterval> | null = null;

function parseUptimeToMs(uptime: string): number {
  const match = /^(?:(\d+)\.)?(\d{2}):(\d{2}):(\d{2})$/.exec(uptime);
  if (!match) return 0;
  const [, days, hours, minutes, seconds] = match;
  return (
    (Number(days || 0) * 86400 + Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) *
    1000
  );
}

function formatUptimeLive(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const centis = Math.floor((ms % 1000) / 10);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  let result = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(centis)}`;
  if (days > 0) result = `${days}天 ${result}`;
  return result;
}

function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function resetTimers(info: AppInfo) {
  uptimeBaseMs = parseUptimeToMs(info.uptime);
  serverTimeBase = new Date(info.serverTime.replace(' ', 'T')).getTime();
  uptimeLoadedAt = Date.now();
  stopTimers();
  uptimeTimer = setInterval(() => {
    const elapsed = Date.now() - uptimeLoadedAt;
    liveUptime.value = formatUptimeLive(uptimeBaseMs + elapsed);
  }, 43);
  serverTimeTimer = setInterval(() => {
    const elapsed = Date.now() - uptimeLoadedAt;
    liveServerTime.value = formatDateTime(serverTimeBase + elapsed);
  }, 1000);
}

function stopTimers() {
  if (uptimeTimer) { clearInterval(uptimeTimer); uptimeTimer = null; }
  if (serverTimeTimer) { clearInterval(serverTimeTimer); serverTimeTimer = null; }
}

async function loadInfo() {
  infoLoading.value = true;
  try {
    appInfo.value = await getInfo();
    if (appInfo.value) {
      resetTimers(appInfo.value);
    }
  } catch {
    appInfo.value = null;
  } finally {
    infoLoading.value = false;
  }
}

// ============ 重启等待 ============
const restartModalVisible = ref(false);
const restartStatus = ref<'error' | 'polling' | 'success'>('polling');

let pollingTimer: ReturnType<typeof setInterval> | null = null;
let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

function startRestartPolling() {
  restartModalVisible.value = true;
  restartStatus.value = 'polling';

  const maxWait = 60000;
  const interval = 2000;

  pollingTimer = setInterval(async () => {
    try {
      const info: any = await getInfo({ silent: true });
      if (info) {
        clearTimers();
        restartStatus.value = 'success';
        appInfo.value = info;
        resetTimers(info);
        // getInfo 走 silent 不弹 toast，这里轮询确认重启完成是真业务事件，保留 message
        message.success('程序重启成功');
        loadDeployRecords();
        setTimeout(() => {
          restartModalVisible.value = false;
        }, 1500);
      }
    } catch {
      // 还在重启中，继续轮询
    }
  }, interval);

  timeoutTimer = setTimeout(() => {
    clearTimers();
    restartStatus.value = 'error';
  }, maxWait);
}

function clearTimers() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
  if (timeoutTimer) {
    clearTimeout(timeoutTimer);
    timeoutTimer = null;
  }
}

// ============ 重启操作 ============
async function handleRestart() {
  Modal.confirm({
    title: '确认重启',
    content: '确定要重启 API 程序吗？重启期间服务将短暂不可用。',
    okText: '确定',
    cancelText: '取消',
    async onOk() {
      try {
        await postRestart();
        startRestartPolling();
      } catch {
        message.error('发送重启指令失败');
      }
    },
  });
}

// ============ 切片上传：API 程序 zip ============
const apiUploadPath = ref<string>('');
const apiDeploying = ref(false);

/** API 部署可选项：勾选后部署成功时一并清空缓存 */
const clearCacheOnDeploy = ref(false);

/** API zip 上传成功 → 走确认弹窗（防呆） */
async function onApiZipUploaded(d: UploadDetail | UploadDetail[]) {
  const detail = Array.isArray(d) ? d[0] : d;
  if (!detail) return;
  clearCacheOnDeploy.value = false;
  await openDeployConfirm({
    target: 'api',
    detail,
    onConfirm: async () => {
      await postDeployApiByPath(
        detail.fileName,
        detail.name,
        detail.size,
        clearCacheOnDeploy.value,
      );
      // toast 由 axios 拦截器弹后端 message（后端 Result.Success 文案带"重启"信息更准）
      apiUploadPath.value = '';
      startRestartPolling();
    },
    onCancel: () => {
      apiUploadPath.value = '';
    },
    setBusy: (v) => (apiDeploying.value = v),
  });
}

// ============ 部署确认弹窗（防呆） ============
interface DeployPreview {
  valid: boolean;
  error?: string;
  target: string;
  targetName: string;
  targetPath: string;
  requiredMarker: string;
  fileName: string;
  fileSize: number;
  entries: string[];
}

const confirmVisible = ref(false);
const confirmLoading = ref(false);
const confirmDeploying = ref(false);
const confirmPreview = ref<DeployPreview | null>(null);
let pendingConfirm: (() => Promise<void>) | null = null;
let pendingCancel: (() => void) | null = null;
let pendingFilePath: string = '';

/**
 * 拉 PreviewDeploy → 展示弹窗 → 等用户确认 / 取消
 */
async function openDeployConfirm(opts: {
  target: string;
  detail: UploadDetail;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  setBusy: (v: boolean) => void;
}) {
  opts.setBusy(true);
  confirmLoading.value = true;
  confirmVisible.value = true;
  confirmPreview.value = null;
  pendingFilePath = opts.detail.fileName;

  try {
    const preview = (await getPreviewDeploy(
      opts.target,
      opts.detail.fileName,
      opts.detail.name,
    )) as DeployPreview;
    confirmPreview.value = preview;
  } catch {
    // 失败 toast 由 axios 拦截器统一弹
    confirmVisible.value = false;
    opts.setBusy(false);
    opts.onCancel();
    await silentCancelUpload(pendingFilePath);
    return;
  } finally {
    confirmLoading.value = false;
  }

  pendingConfirm = async () => {
    confirmDeploying.value = true;
    try {
      // 失败 toast 由 axios 拦截器统一弹
      await opts.onConfirm();
      confirmVisible.value = false;
    } finally {
      confirmDeploying.value = false;
      opts.setBusy(false);
    }
  };

  pendingCancel = () => {
    confirmVisible.value = false;
    opts.setBusy(false);
    opts.onCancel();
    silentCancelUpload(pendingFilePath);
  };
}

async function silentCancelUpload(filePath: string) {
  if (!filePath) return;
  try {
    await postCancelUpload(filePath);
  } catch {
    /* 取消失败也无所谓，文件由系统过期清理 */
  }
}

function handleConfirmDeploy() {
  if (pendingConfirm) pendingConfirm();
}

function handleCancelDeploy() {
  if (pendingCancel) pendingCancel();
}

// ============ 前端项目部署 ============
interface DeployTarget {
  name: string;
  key: string;
  path: string;
}

const deployTargets = ref<DeployTarget[]>([]);
const targetsLoading = ref(false);

/** 每个 target 独立的 v-model 与 deploying 状态 */
const projectUploadPaths = reactive<Record<string, string>>({});
const projectDeployingMap = reactive<Record<string, boolean>>({});

async function loadDeployTargets() {
  targetsLoading.value = true;
  try {
    deployTargets.value = (await getDeployTargets()) || [];
  } catch {
    deployTargets.value = [];
  } finally {
    targetsLoading.value = false;
  }
}

/** 项目 zip 上传成功 → 走确认弹窗（防呆） */
async function onProjectZipUploaded(
  key: string,
  d: UploadDetail | UploadDetail[],
) {
  const detail = Array.isArray(d) ? d[0] : d;
  if (!detail) return;
  await openDeployConfirm({
    target: key,
    detail,
    onConfirm: async () => {
      await postDeployProjectByPath(
        key,
        detail.fileName,
        detail.name,
        detail.size,
      );
      // toast 由 axios 拦截器弹后端 message
      projectUploadPaths[key] = '';
      loadDeployRecords();
    },
    onCancel: () => {
      projectUploadPaths[key] = '';
    },
    setBusy: (v) => (projectDeployingMap[key] = v),
  });
}

// ============ 部署记录 ============
const recordsLoading = ref(false);
const recordsData = ref<any[]>([]);
const recordsTotal = ref(0);
const recordsPage = ref(1);
const recordsPageSize = ref(10);
const recordsFilter = ref<string | undefined>(undefined);
const rollingBackId = ref(0);

const recordColumns = [
  { title: 'Id', dataIndex: 'id', width: 60 },
  { title: '目标', dataIndex: 'targetName', width: 140 },
  { title: '文件名', dataIndex: 'fileName', width: 200 },
  { title: '文件大小', dataIndex: 'fileSize', width: 100, customRender: ({ text }: any) => formatSize(text) },
  { title: '操作人', dataIndex: 'operator', width: 100 },
  { title: '上传时间', dataIndex: 'createdTime', width: 180 },
  { title: '操作', key: 'action', width: 100 },
];

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

async function loadDeployRecords() {
  recordsLoading.value = true;
  try {
    const res: any = await getDeployRecords({
      target: recordsFilter.value,
      page: recordsPage.value,
      pageSize: recordsPageSize.value,
    });
    recordsData.value = res?.items || [];
    recordsTotal.value = res?.total || 0;
  } catch {
    recordsData.value = [];
  } finally {
    recordsLoading.value = false;
  }
}

function handleRecordsPageChange(page: number, pageSize: number) {
  recordsPage.value = page;
  recordsPageSize.value = pageSize;
  loadDeployRecords();
}

function handleFilterChange(target?: string) {
  recordsFilter.value = target;
  recordsPage.value = 1;
  loadDeployRecords();
}

async function handleRollback(record: any) {
  rollingBackId.value = record.id;
  try {
    await postRollback(record.id);
    // toast 由 axios 拦截器弹后端 message
    if (record.target === 'api') {
      startRestartPolling();
    } else {
      loadDeployRecords();
    }
  } finally {
    rollingBackId.value = 0;
  }
}

// ============ 生命周期 ============
onMounted(() => {
  loadInfo();
  loadDeployTargets();
  loadDeployRecords();
});

onUnmounted(() => {
  clearTimers();
  stopTimers();
});
</script>

<template>
  <Page auto-content-height>
    <div style="display: flex; flex-direction: column; gap: 16px">
      <!-- API 程序管理 -->
      <Card title="API 程序管理" :loading="infoLoading">
        <Descriptions
          v-if="appInfo"
          class="api-info"
          :column="{ xs: 1, sm: 2, md: 2, lg: 2, xl: 3, xxl: 3 }"
          :label-style="{ width: '110px' }"
          bordered
          size="small"
        >
          <Descriptions.Item label="版本">
            {{ appInfo.version }}
          </Descriptions.Item>
          <Descriptions.Item label="环境">
            {{ appInfo.environment }}
          </Descriptions.Item>
          <Descriptions.Item label="编译时间">
            <TimeTag
              color="blue"
              :time="appInfo.buildTime"
              :timezone="appInfo.timeZone"
            />
          </Descriptions.Item>
          <Descriptions.Item label="启动时间">
            <TimeTag
              color="cyan"
              :time="appInfo.startTime"
              :timezone="appInfo.timeZone"
            />
          </Descriptions.Item>
          <Descriptions.Item label="运行时长">
            <TimeTag color="green" :time="liveUptime" />
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
          <Descriptions.Item label="服务器时间">
            <TimeTag
              color="purple"
              :time="liveServerTime"
              :timezone="appInfo.timeZone"
            />
          </Descriptions.Item>
        </Descriptions>

        <div
          v-else
          style="text-align: center; padding: 16px; color: #999"
        >
          无法获取应用信息
        </div>

        <!-- API 程序更新：与前端项目卡片样式一致 -->
        <Card size="small" style="margin-top: 16px">
          <div class="deploy-row">
            <div class="deploy-row__info">
              <div class="deploy-row__title">API 程序</div>
              <div class="deploy-row__meta">
                <span class="deploy-row__meta-key">标识: api</span>
                <span>路径: {{ appInfo?.installPath || '--' }}</span>
              </div>
              <div
                v-if="apiDeploying"
                class="deploy-row__hint"
              >
                部署中，请稍候...
              </div>
            </div>
            <div class="deploy-row__upload">
              <ChunkUpload
                type="file"
                v-model:value="apiUploadPath"
                accept=".zip"
                :disabled="apiDeploying"
                @success="onApiZipUploaded"
              />
            </div>
          </div>
        </Card>

        <div style="margin-top: 16px; display: flex; gap: 12px">
          <Button danger @click="handleRestart">重启程序</Button>
          <Button @click="loadInfo">刷新信息</Button>
        </div>
      </Card>

      <!-- 前端项目部署 -->
      <Card
        title="前端项目部署"
        :loading="targetsLoading"
      >
        <div
          v-if="deployTargets.length === 0"
          style="text-align: center; padding: 16px; color: #999"
        >
          暂无部署项目配置，请在 appsettings.json 的 DeployConfig.Projects 中添加
        </div>

        <div
          v-else
          style="display: flex; flex-direction: column; gap: 12px"
        >
          <Card
            v-for="target in deployTargets"
            :key="target.key"
            size="small"
          >
            <div class="deploy-row">
              <div class="deploy-row__info">
                <div class="deploy-row__title">{{ target.name }}</div>
                <div class="deploy-row__meta">
                  <span class="deploy-row__meta-key">
                    标识: {{ target.key }}
                  </span>
                  <span>路径: {{ target.path }}</span>
                </div>
                <div
                  v-if="projectDeployingMap[target.key]"
                  class="deploy-row__hint"
                >
                  部署中，请稍候...
                </div>
              </div>
              <div class="deploy-row__upload">
                <ChunkUpload
                  type="file"
                  :value="projectUploadPaths[target.key] ?? ''"
                  accept=".zip"
                  :disabled="projectDeployingMap[target.key]"
                  @update:value="(v: any) => (projectUploadPaths[target.key] = v)"
                  @success="(d: any) => onProjectZipUploaded(target.key, d)"
                />
              </div>
            </div>
          </Card>
        </div>
      </Card>

      <!-- 部署记录 -->
      <Card title="部署记录">
        <div style="margin-bottom: 12px; display: flex; gap: 8px;">
          <Button :type="!recordsFilter ? 'primary' : 'default'" size="small" @click="handleFilterChange(undefined)">全部</Button>
          <Button :type="recordsFilter === 'api' ? 'primary' : 'default'" size="small" @click="handleFilterChange('api')">API</Button>
          <Button
            v-for="target in deployTargets"
            :key="target.key"
            :type="recordsFilter === target.key ? 'primary' : 'default'"
            size="small"
            @click="handleFilterChange(target.key)"
          >
            {{ target.name }}
          </Button>
        </div>

        <Table
          :columns="recordColumns"
          :data-source="recordsData"
          :loading="recordsLoading"
          :pagination="{
            current: recordsPage,
            pageSize: recordsPageSize,
            total: recordsTotal,
            showSizeChanger: true,
            showTotal: (total: number) => `共 ${total} 条`,
            onChange: handleRecordsPageChange,
          }"
          row-key="id"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'action'">
              <Popconfirm
                :title="`确定回滚到此版本吗？${record.target === 'api' ? '（API将自动重启）' : ''}`"
                @confirm="handleRollback(record)"
              >
                <Button size="small" type="primary" ghost :loading="rollingBackId === record.id">
                  回滚
                </Button>
              </Popconfirm>
            </template>
          </template>
        </Table>
      </Card>
    </div>

    <!-- 部署确认弹窗（防呆：传错文件不让过） -->
    <Modal
      v-model:open="confirmVisible"
      :title="
        confirmPreview?.target === 'api' ? '部署 API 程序确认' : '部署项目确认'
      "
      :closable="!confirmDeploying"
      :mask-closable="false"
      :footer="null"
      width="540px"
      destroy-on-close
    >
      <Spin :spinning="confirmLoading || confirmDeploying" tip="处理中...">
        <div v-if="confirmPreview" class="deploy-confirm">
          <Alert
            v-if="!confirmPreview.valid"
            type="error"
            show-icon
            :message="`文件校验未通过：${confirmPreview.error}`"
            :description="`目标 ${confirmPreview.targetName} 的 zip 包需包含 ${confirmPreview.requiredMarker}，请检查上传的文件`"
            style="margin-bottom: 16px"
          />
          <Alert
            v-else-if="confirmPreview.target === 'api'"
            type="warning"
            show-icon
            message="确认后将立即重启 API"
            description="重启期间 API 服务短暂不可用，重启失败需登录服务器排查"
            style="margin-bottom: 16px"
          />

          <Descriptions
            :column="1"
            size="small"
            bordered
            :label-style="{ width: '90px' }"
            style="margin-bottom: 12px"
          >
            <Descriptions.Item label="部署目标">
              <span class="confirm-target">{{
                confirmPreview.targetName
              }}</span>
              <Tag style="margin-left: 8px">{{ confirmPreview.target }}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="部署路径">
              <code class="confirm-path">{{ confirmPreview.targetPath }}</code>
            </Descriptions.Item>
            <Descriptions.Item label="文件名">
              {{ confirmPreview.fileName }}
            </Descriptions.Item>
            <Descriptions.Item label="文件大小">
              {{ formatSize(confirmPreview.fileSize) }}
            </Descriptions.Item>
            <Descriptions.Item label="zip 内容">
              <div class="confirm-entries">
                <div
                  v-for="(e, i) in confirmPreview.entries"
                  :key="i"
                  class="confirm-entries__row"
                >
                  {{ e }}
                </div>
                <div
                  v-if="confirmPreview.entries.length === 0"
                  class="confirm-entries__row confirm-entries__row--empty"
                >
                  （空）
                </div>
              </div>
            </Descriptions.Item>
          </Descriptions>

          <!-- API 部署专属选项：清空缓存 -->
          <div
            v-if="confirmPreview.target === 'api' && confirmPreview.valid"
            class="confirm-options"
          >
            <Checkbox v-model:checked="clearCacheOnDeploy">
              部署后清空所有缓存
            </Checkbox>
            <div class="confirm-options__hint">
              新代码可能引入了缓存结构变化，勾选可避免读到旧缓存
            </div>
          </div>
        </div>

        <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px">
          <Button :disabled="confirmDeploying" @click="handleCancelDeploy">
            取消
          </Button>
          <Button
            type="primary"
            :danger="confirmPreview?.target === 'api'"
            :disabled="!confirmPreview?.valid"
            :loading="confirmDeploying"
            @click="handleConfirmDeploy"
          >
            {{ confirmPreview?.target === 'api' ? '确认部署并重启' : '确认部署' }}
          </Button>
        </div>
      </Spin>
    </Modal>

    <!-- 重启等待弹窗 -->
    <Modal
      v-model:open="restartModalVisible"
      :closable="restartStatus !== 'polling'"
      :mask-closable="false"
      :footer="null"
      title="程序重启"
      width="420px"
    >
      <div style="text-align: center; padding: 24px 0">
        <div v-if="restartStatus === 'polling'">
          <div class="restart-pulse">
            <div class="restart-pulse-ring" />
            <div class="restart-pulse-icon">
              <Spin size="large" />
            </div>
          </div>
          <div style="margin-top: 20px; color: #666; font-size: 15px">
            程序正在重启<span class="restart-dots" />
          </div>
          <div style="margin-top: 8px; color: #999; font-size: 13px">
            服务恢复后将自动刷新
          </div>
        </div>

        <div v-else-if="restartStatus === 'success'">
          <Progress type="circle" :percent="100" status="success" />
          <div style="margin-top: 16px; color: #52c41a">重启成功</div>
        </div>

        <div v-else>
          <Progress type="circle" :percent="100" status="exception" />
          <div style="margin-top: 16px; color: #ff4d4f">
            重启超时，请登录服务器查看错误日志
          </div>
          <Space style="margin-top: 16px">
            <Button @click="restartModalVisible = false">关闭</Button>
            <Button type="primary" @click="startRestartPolling">
              重试
            </Button>
          </Space>
        </div>
      </div>
    </Modal>
  </Page>
</template>

<style scoped>
/* 应用信息表格：强制各列等宽，避免 label/value 两边宽度不一致看着别扭 */
.api-info :deep(.ant-descriptions-view) > table {
  table-layout: fixed;
}

.api-info :deep(.ant-descriptions-item-content) {
  word-break: break-all;
}

/* 部署上传行：左侧标识/路径，右侧上传区（API 与前端项目共用） */
.deploy-row {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  justify-content: space-between;
}

.deploy-row__info {
  flex: 1;
  min-width: 0;
}

.deploy-row__title {
  font-size: 15px;
  font-weight: 500;
  color: var(--ant-color-text);
}

.deploy-row__meta {
  margin-top: 4px;
  font-size: 13px;
  color: var(--ant-color-text-secondary);
  word-break: break-all;
}

.deploy-row__meta-key {
  margin-right: 16px;
}

.deploy-row__hint {
  margin-top: 8px;
  font-size: 12px;
  color: var(--ant-color-text-tertiary);
}

.deploy-row__upload {
  flex: 0 0 360px;
  max-width: 360px;
}

@media (max-width: 768px) {
  .deploy-row {
    flex-direction: column;
  }

  .deploy-row__upload {
    flex: 1 1 auto;
    width: 100%;
    max-width: none;
  }
}

/* 部署确认弹窗 */
.deploy-confirm .confirm-target {
  font-weight: 500;
}

.deploy-confirm .confirm-path {
  display: inline-block;
  padding: 2px 6px;
  font-family:
    ui-monospace, 'SF Mono', 'Cascadia Mono', 'Roboto Mono', Menlo, Consolas,
    monospace;
  font-size: 12px;
  background: var(--ant-color-fill-tertiary);
  border-radius: 4px;
  word-break: break-all;
}

.deploy-confirm .confirm-entries {
  max-height: 140px;
  padding: 6px 8px;
  overflow-y: auto;
  font-family:
    ui-monospace, 'SF Mono', 'Cascadia Mono', 'Roboto Mono', Menlo, Consolas,
    monospace;
  font-size: 12px;
  line-height: 1.7;
  background: var(--ant-color-fill-tertiary);
  border-radius: 4px;
}

.deploy-confirm .confirm-entries__row {
  color: var(--ant-color-text-secondary);
  word-break: break-all;
}

.deploy-confirm .confirm-entries__row--empty {
  color: var(--ant-color-text-tertiary);
  font-style: italic;
}

.deploy-confirm .confirm-options {
  padding: 10px 12px;
  background: var(--ant-color-fill-tertiary);
  border-radius: 4px;
}

.deploy-confirm .confirm-options__hint {
  margin-top: 4px;
  margin-left: 22px;
  font-size: 12px;
  color: var(--ant-color-text-tertiary);
  line-height: 1.5;
}

.restart-pulse {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 80px;
  height: 80px;
}

.restart-pulse-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px solid #1890ff;
  animation: restart-ripple 1.8s ease-out infinite;
}

.restart-pulse-ring::after {
  content: '';
  position: absolute;
  inset: -8px;
  border-radius: 50%;
  border: 1px solid #1890ff;
  animation: restart-ripple 1.8s ease-out 0.6s infinite;
}

.restart-pulse-icon {
  position: relative;
  z-index: 1;
}

@keyframes restart-ripple {
  0% {
    transform: scale(0.8);
    opacity: 0.6;
  }
  100% {
    transform: scale(1.6);
    opacity: 0;
  }
}

.restart-dots::after {
  content: '';
  animation: restart-dots-anim 1.5s steps(3, end) infinite;
}

@keyframes restart-dots-anim {
  0%   { content: ''; }
  33%  { content: '.'; }
  66%  { content: '..'; }
  100% { content: '...'; }
}
</style>
