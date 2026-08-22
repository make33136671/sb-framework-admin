<script lang="ts" setup>
import type { UploadProps } from 'ant-design-vue';

import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';

import {
  Alert,
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Drawer,
  Empty,
  FloatButton,
  message,
  Modal,
  RadioButton,
  RadioGroup,
  Space,
  Spin,
  Switch,
  Tag,
  Upload,
} from 'ant-design-vue';

import { usePreferences } from '@vben/preferences';

import { JsonEditor } from '#/components/JsonEditor';
import { JsonFieldEditor } from '#/components/JsonFieldEditor';
import { RestartWaiter } from '#/components/RestartWaiter';

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

// 已知枚举字段 — key 是 path,数组项不带 index(详见 JsonFieldEditor 注释)
// 末尾 '.*' 通配:'Logging.LogLevel.*' 覆盖 LogLevel 下所有任意命名空间字段
const APP_SETTINGS_ENUMS: Record<string, string[]> = {
  // === framework AppSettings.cs 字段 ===
  'CacheConfig.Provider': ['Memory', 'Redis'],
  'DbConfig.DbType': ['MySql', 'PostgreSql'],
  'PasswordConfig.StorageMode': ['Encrypted', 'PlainText'],

  // === .NET 标准 Logging.LogLevel(枚举 Microsoft.Extensions.Logging.LogLevel) ===
  'Logging.LogLevel.*': [
    'Trace',
    'Debug',
    'Information',
    'Warning',
    'Error',
    'Critical',
    'None',
  ],

  // === Serilog MinimumLevel(枚举 Serilog.Events.LogEventLevel)===
  'Serilog.MinimumLevel.Default': [
    'Verbose',
    'Debug',
    'Information',
    'Warning',
    'Error',
    'Fatal',
  ],
  'Serilog.MinimumLevel.Override.*': [
    'Verbose',
    'Debug',
    'Information',
    'Warning',
    'Error',
    'Fatal',
  ],

  // === 常见 IANA 时区(用户可在 Select 里搜索)===
  TimeZone: [
    'UTC',
    'Asia/Shanghai',
    'Asia/Ho_Chi_Minh',
    'Asia/Phnom_Penh',
    'Asia/Tokyo',
    'Asia/Hong_Kong',
    'Asia/Singapore',
    'Asia/Bangkok',
    'Asia/Seoul',
    'Asia/Dubai',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'America/New_York',
    'America/Los_Angeles',
    'Australia/Sydney',
  ],
};

// ---- 响应式:移动端编辑器全宽,按钮区收进抽屉按需拉出 ----
const { isMobile } = usePreferences();
// 移动端的"操作"抽屉开关(桌面端不用,按钮区常驻右侧)
const actionDrawerOpen = ref(false);

// ---- 服务器信息(抽屉) ----
const serverInfoOpen = ref(false);
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

// ---- 编辑器模式切换 ----
// 'editor' = Monaco JSON 文本编辑
// 'visual' = 字段递归编辑(antd 组件:Switch / InputNumber / Input)
type EditorMode = 'editor' | 'visual';
const editorMode = ref<EditorMode>('editor');
// 可视化模式下的解析对象。editor 模式下不读,只在切到 visual 时从 editText 解析。
const parsedObject = ref<any>(null);
const jsonEditorRef = ref<{ format: () => void } | null>(null);

// 高度方案(两段配合):
//  1) 布局用纯 flex 撑满:content → wrap → settings-layout → editor-card → card-body
//     → editor-body 每环 flex/stretch + min-height:0,两栏容器自然撑到内容区底部。
//  2) Monaco 必须拿确定 px 才渲染(height:100% 在 flex 撑出的容器里解析不稳会塌 0、
//     空白),所以 ResizeObserver 实测 editor-body 撑满后的真实像素高,传给编辑器。
const editorBodyRef = ref<HTMLElement | null>(null);
const editorPxHeight = ref(600);
let editorRO: ResizeObserver | null = null;

onMounted(() => {
  if (editorBodyRef.value) {
    editorRO = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? 0;
      if (h > 0) editorPxHeight.value = Math.floor(h);
    });
    editorRO.observe(editorBodyRef.value);
  }
});

onBeforeUnmount(() => {
  editorRO?.disconnect();
  editorRO = null;
});

// visual 模式下,parsedObject 改 → 序列化回 editText(让保存逻辑统一走 editText)
watch(
  parsedObject,
  (newVal) => {
    if (editorMode.value !== 'visual') return;
    if (newVal === null || newVal === undefined) return;
    editText.value = JSON.stringify(newVal, null, 2);
  },
  { deep: true },
);

// 切换模式 — RadioGroup v-model 直接改 editorMode,在 watch 里做 round-trip
// (不能用 @change handler — antd RadioGroup 的 @change 在 v-model 更新之后才触发,
//  handler 里检查 target===editorMode 会直接 return,parsedObject 不会被更新)
watch(editorMode, (newMode, oldMode) => {
  if (newMode === 'visual' && oldMode === 'editor') {
    try {
      parsedObject.value = JSON.parse(editText.value);
    } catch (err: any) {
      message.error(`JSON 格式错误,无法切换可视化模式: ${err.message}`);
      // 回滚 mode(nextTick 避免 watch 内部同步改自己触发的副作用)
      nextTick(() => {
        editorMode.value = 'editor';
      });
    }
  }
  // visual → editor:无需处理(editText 已经被 watch(parsedObject) 同步)
});

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
    // 如果当前在 visual 模式,同步刷新 parsedObject
    if (editorMode.value === 'visual') {
      try {
        parsedObject.value = JSON.parse(editText.value);
      } catch {
        // 解析失败时退回 editor 模式让用户手动修
        editorMode.value = 'editor';
        message.warning('配置文件不是合法 JSON,已切回编辑器模式');
      }
    }
  } finally {
    loading.value = false;
  }
}

function resetChanges() {
  editText.value = originalText.value;
  if (editorMode.value === 'visual') {
    try {
      parsedObject.value = JSON.parse(originalText.value);
    } catch {
      /* 原内容非法 JSON 时无视 */
    }
  }
  message.info('已还原');
}

function beautify() {
  // editor 模式优先用 Monaco 内置 formatter(快捷键 Shift+Alt+F 也能触发)
  if (editorMode.value === 'editor' && jsonEditorRef.value) {
    jsonEditorRef.value.format();
    return;
  }
  // 兜底:本地 JSON.parse + stringify
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
const restartBaseline = ref('');

function waitForRestart() {
  restartBaseline.value = serverInfo.value.startTime || '';
  restartWaiting.value = true;
}

async function onRestartSuccess(info: any) {
  serverInfo.value = info;
  await loadAppSettings();
  message.success('应用已重启，配置生效');
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
  <!-- 不用 Vben <Page>(它的 min-h-full / h-full p-4 / header 占位 / auto-content
       -height calc 这套结构和"编辑器精确撑满全高"天生冲突)。直接用普通 div 作根,
       它是 ops-tools tabpane 的直接子(已被父级 flex:1+min-height:0 撑满全高),
       内部纯 flex 两栏,编辑器自然撑到底。 -->
  <div class="app-settings-page">
    <!-- 左编辑器 + 右操作栏 -->
    <div class="settings-layout">
        <!-- 左:JSON 编辑器,占满两栏高度 -->
        <Card class="editor-card" :body-style="{ padding: 0, height: '100%' }">
          <template #title>
            <Space>
              <span>appsettings.json</span>
              <RadioGroup
                v-model:value="editorMode"
                button-style="solid"
                size="small"
              >
                <RadioButton value="editor">编辑器模式</RadioButton>
                <RadioButton value="visual">可视化模式</RadioButton>
              </RadioGroup>
            </Space>
          </template>
          <div ref="editorBodyRef" class="editor-body">
            <Spin
              class="editor-spin"
              :spinning="loading || restartWaiting"
              :tip="restartWaiting ? '等待应用重启...' : '加载中...'"
            >
              <JsonEditor
                v-if="editorMode === 'editor'"
                ref="jsonEditorRef"
                v-model="editText"
                language="json"
                :height="editorPxHeight"
              />
              <div
                v-else
                class="visual-scroll"
                :style="{ height: `${editorPxHeight}px` }"
              >
                <JsonFieldEditor
                  v-model="parsedObject"
                  :enum-options="APP_SETTINGS_ENUMS"
                />
              </div>
            </Spin>
          </div>
        </Card>

      <!-- 操作按钮区:DOM 只写一份,始终在 layout 里。桌面端常驻右栏;移动端靠 CSS
           变成固定在底部、由 actionDrawerOpen 控制滑入滑出的面板(纯 transform,
           不用 Teleport/antd Drawer,避开 DOM 挂载时序导致的 __vnode null 报错)。 -->
      <div
        class="action-panel"
        :class="{
          'action-panel--mobile': isMobile,
          'action-panel--open': actionDrawerOpen,
        }"
      >
        <div v-if="isMobile" class="action-panel__handle">
          <span>操作</span>
          <Button size="small" @click="actionDrawerOpen = false">收起</Button>
        </div>
        <Button
          type="primary"
          block
          :disabled="!isDirty"
          :loading="saving"
          @click="previewSave"
        >
          保存（预览差异）
        </Button>
        <div class="panel-auto-restart">
          <span class="hint">保存后自动重启</span>
          <Switch v-model:checked="autoRestart" size="small" />
        </div>

        <div class="panel-divider"></div>

        <Button block @click="loadAppSettings" :loading="loading">刷新</Button>
        <Button block @click="beautify">JSON 格式化</Button>
        <Button block @click="resetChanges" :disabled="!isDirty">还原</Button>
        <Button block @click="downloadFile">下载备份</Button>
        <Upload
          :before-upload="beforeUpload"
          :show-upload-list="false"
          accept=".json"
          class="panel-upload"
        >
          <Button block :loading="uploading">上传替换</Button>
        </Upload>
        <Button block @click="openHistory">历史版本</Button>
        <Button block @click="serverInfoOpen = true">服务器信息</Button>

        <div class="panel-divider"></div>

        <Button block danger @click="manualRestart">立即重启</Button>

        <div class="panel-meta">
          <Tag v-if="isDirty" color="warning">已修改未保存</Tag>
          <div class="panel-meta__item" :title="meta.path">
            路径：<code>{{ meta.path || '-' }}</code>
          </div>
          <div class="panel-meta__item">大小：{{ fmtSize(meta.size) }}</div>
          <div class="panel-meta__item">
            最后修改：{{ fmtTime(meta.lastModified) }}
          </div>
        </div>
      </div>
      <!-- /action-panel -->
    </div>
    <!-- /settings-layout -->

    <!-- 移动端:浮动按钮拉出操作面板;遮罩点击收起 -->
    <template v-if="isMobile">
      <div
        v-if="actionDrawerOpen"
        class="action-mask"
        @click="actionDrawerOpen = false"
      ></div>
      <FloatButton
        type="primary"
        tooltip="操作"
        @click="actionDrawerOpen = true"
      >
        <template #icon>
          <span style="font-size: 18px">⚙</span>
        </template>
      </FloatButton>
    </template>

    <!-- 服务器信息抽屉 -->
    <Drawer v-model:open="serverInfoOpen" title="服务器信息" :width="560">
      <Descriptions :column="2" size="small" bordered>
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
        <DescriptionsItem label="安装路径" :span="2">
          <code>{{ serverInfo.installPath || '-' }}</code>
        </DescriptionsItem>
        <DescriptionsItem label="监听地址" :span="2">
          <Tag color="success">{{ serverInfo.listeningUrls || '(未识别)' }}</Tag>
          <span class="hint">由 appsettings.json 的 <code>Urls</code> 字段决定（启动命令不传 --urls 时）</span>
        </DescriptionsItem>
      </Descriptions>
    </Drawer>

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

    <RestartWaiter
      v-model:open="restartWaiting"
      :baseline-start-time="restartBaseline"
      @success="onRestartSuccess"
    />
  </div>
</template>

<style scoped>
/* 根:作为 ops-tools tabpane 的直接子,被父级 flex:1+min-height:0 撑满全高。
 * 自身 flex column 占满,内部纯 flex 布局,无 Vben Page 的额外结构开销。 */
.app-settings-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 12px;
  overflow: hidden;
}

/* 两栏容器:flex:1 撑满根的剩余高度(根无 header,即全高);两栏并排 */
.settings-layout {
  display: flex;
  flex: 1;
  gap: 12px;
  min-height: 0;
}

/* 左:编辑器卡片,flex 行容器 align-items:stretch 默认垂直撑满 layout 高度 */
.editor-card {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

/* card-body flex 撑满 editor-card,position:relative 作为 editor-body 的定位锚 */
.editor-card :deep(.ant-card-body) {
  position: relative;
  flex: 1;
  min-height: 0;
}

/* editor-body 用 absolute inset:0 填满 card-body:高度完全由 card-body 决定,
 * 与 Monaco 内容彻底解耦 → 内容再多也不会反撑 editor-body,
 * ResizeObserver 测到的是稳定的 card-body 高度,不会反馈放大导致编辑器超出。 */
.editor-body {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.editor-spin,
.editor-spin :deep(.ant-spin-nested-loading),
.editor-spin :deep(.ant-spin-container) {
  height: 100%;
}

/* 可视化模式内容较长时,滚动条落在这里(编辑器卡片内部),不外溢成整页滚动 */
.visual-scroll {
  height: 100%;
  padding: 12px;
  overflow: auto;
}

/* 右:操作按钮竖排面板,固定窄宽。
 * 不强制等高、不自带滚动条:内容(一列按钮 + 几行元数据)本就不多,按内容自然
 * 展开并顶部对齐。这样全页只有编辑器一个滚动区,鼠标滚轮不会在两个滚动条间冲突,
 * 右栏底部的路径/大小/修改时间也永远完整可见,不会被裁掉。 */
.action-panel {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 8px;
  align-self: flex-start;
  width: 136px;
  min-width: 0;
}

/* 移动端:固定在屏幕底部的滑出面板。默认 translateY(100%) 藏在屏幕外,
 * --open 时滑入。纯 CSS transform,无 Teleport/Drawer 的 DOM 时序坑。 */
.action-panel--mobile {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1001;
  width: auto;
  max-height: 80vh;
  padding: 12px 16px calc(16px + env(safe-area-inset-bottom));
  overflow-y: auto;

  /* 用 shadcn 的 :root token(挂在根元素,fixed 元素也能继承到;antd 的 --ant-* 变量
   * 在这个脱离 ConfigProvider 容器的 fixed 面板上解析为空,会透明) */
  background: hsl(var(--background));
  border-top-left-radius: 12px;
  border-top-right-radius: 12px;
  box-shadow: 0 -4px 16px rgb(0 0 0 / 20%);
  transform: translateY(100%);
  transition: transform 0.25s ease;
}

.action-panel--mobile.action-panel--open {
  transform: translateY(0);
}

/* 面板顶部把手:标题 + 收起按钮 */
.action-panel__handle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
  font-weight: 500;
  color: var(--ant-color-text);
}

/* 遮罩:点击收起 */
.action-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgb(0 0 0 / 45%);
}

.panel-auto-restart {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  padding: 0 2px;
}

.panel-upload,
.panel-upload :deep(.ant-upload) {
  display: block;
  width: 100%;
}

.panel-divider {
  height: 1px;
  margin: 4px 0;
  background: var(--ant-color-split);
}

.panel-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--ant-color-text-secondary);
}

.panel-meta__item {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hint {
  font-size: 12px;
  color: var(--ant-color-text-tertiary);
}

.json-editor {
  font-family: SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.5;
}

.diff-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.diff-title {
  margin-bottom: 6px;
  font-weight: 500;
  color: var(--ant-color-text-secondary);
}

.diff-pre {
  max-height: 60vh;
  padding: 8px 12px;
  overflow: auto;
  font-family: SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.4;
  word-break: break-all;
  white-space: pre-wrap;
  background: var(--ant-color-fill-tertiary);
  border: 1px solid var(--ant-color-border);
  border-radius: 4px;
}

.history-list {
  padding: 0;
  margin: 0;
  list-style: none;
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
  padding: 2px 6px;
  font-family: SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  background: var(--ant-color-fill-tertiary);
  border-radius: 3px;
}
</style>
