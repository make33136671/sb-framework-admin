<script lang="ts" setup>
import type { UploadProps } from 'ant-design-vue';

import { computed, onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Alert,
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Drawer,
  Empty,
  message,
  Modal,
  Space,
  Spin,
  Switch,
  Tag,
  Textarea,
  Upload,
} from 'ant-design-vue';

import {
  diffAppSettings,
  downloadAppSettingsUrl,
  getAppInfo,
  getAppSettings,
  historyAppSettings,
  historyContentAppSettings,
  restartApp,
  rollbackAppSettings,
  saveAppSettings,
  uploadAppSettings,
  type AppSettingsHistoryItem,
} from './api';

defineOptions({ name: 'AppSettings' });

// ---- 服务器信息卡片 ----
const serverInfo = ref<Record<string, any>>({});
async function loadServerInfo() {
  try {
    const res = await getAppInfo();
    serverInfo.value = res || {};
  } catch {}
}

// ---- 配置文件主体 ----
const loading = ref(false);
const saving = ref(false);
const originalText = ref('');
const editText = ref('');
const meta = ref<{ path?: string; size?: number; lastModified?: string }>({});
const autoRestart = ref(true);

const isDirty = computed(() => editText.value.trim() !== originalText.value.trim());

async function loadAppSettings() {
  loading.value = true;
  try {
    const res = await getAppSettings();
    originalText.value = res?.rawText || '';
    editText.value = originalText.value;
    meta.value = {
      path: res?.path,
      size: res?.size,
      lastModified: res?.lastModified,
    };
  } finally {
    loading.value = false;
  }
}

function resetChanges() {
  editText.value = originalText.value;
  message.info('已还原');
}

function beautify() {
  try {
    const parsed = JSON.parse(editText.value);
    editText.value = JSON.stringify(parsed, null, 2);
    message.success('已格式化');
  } catch (err: any) {
    message.error(`JSON 解析失败: ${err.message}`);
  }
}

// ---- 保存（Diff 预览 + 自动重启）----
const diffModalOpen = ref(false);
const diffOld = ref('');
const diffNew = ref('');

async function previewSave() {
  // 本地先 JSON.parse 校验
  try {
    JSON.parse(editText.value);
  } catch (err: any) {
    message.error(`JSON 格式错误: ${err.message}`);
    return;
  }

  try {
    const res = await diffAppSettings(editText.value);
    diffOld.value = res?.oldText || '';
    diffNew.value = res?.newText || '';
    diffModalOpen.value = true;
  } catch {}
}

async function confirmSave() {
  saving.value = true;
  try {
    await saveAppSettings(editText.value, autoRestart.value);
    diffModalOpen.value = false;
    if (autoRestart.value) {
      message.success('已保存，应用 1.5 秒后优雅重启');
      waitForRestart();
    } else {
      message.success('已保存，未自动重启（改动重启后生效）');
      await loadAppSettings();
    }
  } finally {
    saving.value = false;
  }
}

const restartWaiting = ref(false);
async function waitForRestart() {
  restartWaiting.value = true;
  // 等 service 优雅退出 + systemd 拉起（最多 30s）
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    try {
      const info = await getAppInfo();
      // startTime 变了说明已经是新进程
      if (info?.startTime && info.startTime !== serverInfo.value.startTime) {
        serverInfo.value = info;
        await loadAppSettings();
        message.success('应用已重启，配置生效');
        break;
      }
    } catch {}
  }
  restartWaiting.value = false;
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- 立即重启（不改文件，纯触发 GracefulStop）----
async function manualRestart() {
  Modal.confirm({
    title: '确认立即重启应用？',
    content: '将触发 GracefulStop，systemd 自动拉起新进程。运行中请求会被中断。',
    okText: '重启',
    okType: 'danger',
    onOk: async () => {
      await restartApp();
      message.success('重启信号已发送');
      waitForRestart();
    },
  });
}

// ---- 下载 ----
function downloadFile() {
  window.open(downloadAppSettingsUrl(), '_blank');
}

// ---- 上传整文件 ----
const uploading = ref(false);
const beforeUpload: UploadProps['beforeUpload'] = async (file) => {
  if (!file.name.endsWith('.json')) {
    message.error('仅支持 .json 文件');
    return false;
  }
  Modal.confirm({
    title: `确认用 ${file.name} 覆盖当前配置？`,
    content: '当前 appsettings.json 会先备份到 history。重启后新配置生效。',
    okText: '上传并重启',
    okType: 'danger',
    onOk: async () => {
      uploading.value = true;
      try {
        await uploadAppSettings(file as any, autoRestart.value);
        message.success('已上传，应用即将重启');
        waitForRestart();
      } finally {
        uploading.value = false;
      }
    },
  });
  return false; // 阻止 antd 自动上传
};

// ---- 历史版本侧栏 ----
const historyOpen = ref(false);
const historyList = ref<AppSettingsHistoryItem[]>([]);
const historyLoading = ref(false);
const previewingHistory = ref<{ fileName: string; rawText: string } | null>(null);

async function openHistory() {
  historyOpen.value = true;
  historyLoading.value = true;
  try {
    historyList.value = (await historyAppSettings()) || [];
  } finally {
    historyLoading.value = false;
  }
}

async function previewHistory(item: AppSettingsHistoryItem) {
  previewingHistory.value = await historyContentAppSettings(item.fileName);
}

async function doRollback(item: AppSettingsHistoryItem) {
  Modal.confirm({
    title: `确认回滚到 ${item.fileName}？`,
    content: '当前 appsettings.json 会先备份，然后用历史版本覆盖。应用自动重启。',
    okText: '回滚并重启',
    okType: 'danger',
    onOk: async () => {
      await rollbackAppSettings(item.fileName, autoRestart.value);
      historyOpen.value = false;
      previewingHistory.value = null;
      message.success('已回滚，应用即将重启');
      waitForRestart();
    },
  });
}

// ---- 文件大小 / 时间格式化 ----
function fmtSize(n?: number) {
  if (!n) return '-';
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}
function fmtTime(s?: string) {
  if (!s) return '-';
  return s.replace('T', ' ').slice(0, 19);
}

onMounted(() => {
  loadServerInfo();
  loadAppSettings();
});
</script>

<template>
  <Page>
    <!-- 顶部服务器信息 -->
    <Card title="服务器信息" :body-style="{ padding: '16px 20px' }" class="info-card">
      <Descriptions :column="4" size="small">
        <DescriptionsItem label="版本">{{ serverInfo.version || '-' }}</DescriptionsItem>
        <DescriptionsItem label="环境">{{ serverInfo.environment || '-' }}</DescriptionsItem>
        <DescriptionsItem label=".NET">{{ serverInfo.dotnetVersion || '-' }}</DescriptionsItem>
        <DescriptionsItem label="时区">{{ serverInfo.timeZone || '-' }}</DescriptionsItem>
        <DescriptionsItem label="启动时间">{{ serverInfo.startTime || '-' }}</DescriptionsItem>
        <DescriptionsItem label="运行时长">{{ serverInfo.uptime || '-' }}</DescriptionsItem>
        <DescriptionsItem label="服务器时间">{{ serverInfo.serverTime || '-' }}</DescriptionsItem>
        <DescriptionsItem label="主机">{{ serverInfo.machineName || '-' }}</DescriptionsItem>
        <DescriptionsItem label="进程 ID">{{ serverInfo.processId ?? '-' }}</DescriptionsItem>
        <DescriptionsItem label="线程数">{{ serverInfo.threadCount ?? '-' }}</DescriptionsItem>
        <DescriptionsItem label="工作集 (RSS)">
          {{ serverInfo.workingSetMb != null ? `${serverInfo.workingSetMb} MB` : '-' }}
        </DescriptionsItem>
        <DescriptionsItem label="GC 已分配">
          {{ serverInfo.gcTotalMb != null ? `${serverInfo.gcTotalMb} MB` : '-' }}
        </DescriptionsItem>
        <DescriptionsItem label="CPU 核心">{{ serverInfo.processorCount ?? '-' }}</DescriptionsItem>
        <DescriptionsItem label="操作系统" :span="2">{{ serverInfo.osVersion || '-' }}</DescriptionsItem>
        <DescriptionsItem label="安装路径" :span="4">
          <code>{{ serverInfo.installPath || '-' }}</code>
        </DescriptionsItem>
        <DescriptionsItem label="监听地址" :span="4">
          <Tag color="success">{{ serverInfo.listeningUrls || '(未识别)' }}</Tag>
          <span class="hint">由 appsettings.json 的 <code>Urls</code> 字段决定（启动命令不传 --urls 时）</span>
        </DescriptionsItem>
      </Descriptions>
    </Card>

    <!-- 操作栏 -->
    <Card class="action-card" :body-style="{ padding: '12px 20px' }">
      <Space>
        <Button @click="loadAppSettings" :loading="loading">刷新</Button>
        <Button @click="beautify">JSON 格式化</Button>
        <Button @click="resetChanges" :disabled="!isDirty">还原</Button>
        <Button @click="downloadFile">下载备份</Button>
        <Upload :before-upload="beforeUpload" :show-upload-list="false" accept=".json">
          <Button :loading="uploading">上传替换</Button>
        </Upload>
        <Button @click="openHistory">历史版本</Button>
        <Button danger @click="manualRestart">立即重启</Button>
      </Space>
      <div class="save-row">
        <span class="hint">
          保存后自动重启
          <Switch v-model:checked="autoRestart" size="small" />
        </span>
        <Button
          type="primary"
          :disabled="!isDirty"
          :loading="saving"
          @click="previewSave"
        >
          保存（预览差异）
        </Button>
      </div>
    </Card>

    <!-- 元数据 -->
    <Card class="meta-card" :body-style="{ padding: '8px 20px' }">
      <Space size="large">
        <span>路径：<code>{{ meta.path || '-' }}</code></span>
        <span>大小：{{ fmtSize(meta.size) }}</span>
        <span>最后修改：{{ fmtTime(meta.lastModified) }}</span>
        <Tag v-if="isDirty" color="warning">已修改未保存</Tag>
      </Space>
    </Card>

    <!-- JSON 编辑器 -->
    <Card title="appsettings.json" class="editor-card">
      <Spin :spinning="loading || restartWaiting" :tip="restartWaiting ? '等待应用重启...' : '加载中...'">
        <Textarea
          v-model:value="editText"
          :rows="28"
          spellcheck="false"
          class="json-editor"
        />
      </Spin>
    </Card>

    <!-- Diff 预览弹窗 -->
    <Modal
      v-model:open="diffModalOpen"
      title="保存前预览差异"
      width="80%"
      :ok-text="autoRestart ? '保存并重启' : '保存（不重启）'"
      :ok-button-props="{ danger: autoRestart, loading: saving }"
      @ok="confirmSave"
    >
      <Alert
        v-if="autoRestart"
        type="warning"
        show-icon
        message="保存后应用立即优雅重启，运行中的请求会被中断"
        style="margin-bottom: 12px"
      />
      <div class="diff-grid">
        <div class="diff-col">
          <div class="diff-title">当前（line {{ diffOld.split('\n').length }}）</div>
          <pre class="diff-pre">{{ diffOld }}</pre>
        </div>
        <div class="diff-col">
          <div class="diff-title">即将保存（line {{ diffNew.split('\n').length }}）</div>
          <pre class="diff-pre">{{ diffNew }}</pre>
        </div>
      </div>
    </Modal>

    <!-- 历史版本侧栏 -->
    <Drawer
      v-model:open="historyOpen"
      title="历史版本"
      :width="720"
      @close="previewingHistory = null"
    >
      <Spin :spinning="historyLoading">
        <Empty v-if="historyList.length === 0" description="暂无历史版本" />
        <ul v-else class="history-list">
          <li v-for="item in historyList" :key="item.fileName">
            <div class="hist-row">
              <div>
                <code>{{ item.fileName }}</code>
                <span class="hint" style="margin-left: 12px">
                  {{ fmtTime(item.backupAt) }} · {{ fmtSize(item.size) }}
                </span>
              </div>
              <Space>
                <Button size="small" @click="previewHistory(item)">查看</Button>
                <Button size="small" danger @click="doRollback(item)">回滚</Button>
              </Space>
            </div>
          </li>
        </ul>
      </Spin>

      <Modal
        v-if="previewingHistory"
        :open="true"
        :title="previewingHistory.fileName"
        :footer="null"
        width="80%"
        @cancel="previewingHistory = null"
      >
        <pre class="diff-pre">{{ previewingHistory.rawText }}</pre>
      </Modal>
    </Drawer>
  </Page>
</template>

<style scoped>
.info-card,
.action-card,
.meta-card,
.editor-card {
  margin-bottom: 12px;
}

.action-card :deep(.ant-card-body) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.save-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.hint {
  font-size: 12px;
  color: var(--ant-color-text-tertiary);
}

.json-editor {
  font-family: 'SFMono-Regular', 'Menlo', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.5;
}

.diff-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.diff-title {
  font-weight: 500;
  margin-bottom: 6px;
  color: var(--ant-color-text-secondary);
}

.diff-pre {
  max-height: 60vh;
  overflow: auto;
  padding: 8px 12px;
  font-family: 'SFMono-Regular', 'Menlo', monospace;
  font-size: 12px;
  line-height: 1.4;
  background: var(--ant-color-fill-tertiary);
  border: 1px solid var(--ant-color-border);
  border-radius: 4px;
  white-space: pre-wrap;
  word-break: break-all;
}

.history-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.history-list li {
  padding: 12px 0;
  border-bottom: 1px solid var(--ant-color-split);
}

.hist-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

code {
  font-family: 'SFMono-Regular', 'Menlo', monospace;
  font-size: 12px;
  padding: 2px 6px;
  background: var(--ant-color-fill-tertiary);
  border-radius: 3px;
}
</style>
