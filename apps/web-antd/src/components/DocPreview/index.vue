<script lang="ts" setup>
import { ref } from 'vue';

import {
  Button,
  Drawer,
  message,
  Modal,
  Popconfirm,
  Space,
  Tag,
  Timeline,
} from 'ant-design-vue';

import DocRenderer from './DocRenderer.vue';

/**
 * 文档预览组件(基座通用)
 *
 * 提供 markdown 文档"查看 / 下载 / 版本历史 / 回档"四种能力,后端 API 通过 `api`
 * prop 由派生项目注入(不绑死任何 endpoint)。本组件只负责 UI + 命令式触发。
 *
 * 派生项目使用方式:
 * ```ts
 * import { getDocLatest, getDocVersions, getDocDetail, postDocRollback } from '#/views/.../docApi';
 * const docApi: DocPreviewApi = {
 *   fetchLatest: (id) => getDocLatest('TaskItem', id),
 *   fetchVersions: (id) => getDocVersions('TaskItem', id),
 *   fetchDetail: (id) => getDocDetail(id),
 *   rollback: (payload) => postDocRollback(payload),
 * };
 * ```
 * ```vue
 * <DocPreview ref="docRef" source-type="TaskItem" desc-label="任务描述" :api="docApi" />
 * <!-- 父组件命令式触发 -->
 * docRef.value?.openPreview(taskId, taskTitle)
 * ```
 *
 * `sourceType` 用于:
 *   - copyLink 生成的公开链接 URL 段(`/api/doc/<sourceType>/<sourceId>`)
 *   - rollback payload 透传给后端
 *
 * `descLabel` 透传给 DocRenderer,用于 markdown 内 `## <descLabel>` 段提取(默认 "描述")
 */
export interface DocVersionItem {
  id: number;
  version: number;
  createdTime?: string;
  changeNote?: string;
  operator?: string;
  [key: string]: any;
}

export interface DocLatest {
  content: string;
  [key: string]: any;
}

export interface DocPreviewApi {
  /** 拿最新版文档 */
  fetchLatest: (sourceId: number) => Promise<DocLatest>;
  /** 拿版本列表(降序) */
  fetchVersions: (sourceId: number) => Promise<DocVersionItem[]>;
  /** 拿指定版本完整内容 */
  fetchDetail: (versionId: number) => Promise<DocLatest>;
  /** 回档到某版本 */
  rollback: (payload: {
    sourceId: number;
    sourceType: string;
    versionId: number;
  }) => Promise<void>;
}

const props = withDefaults(
  defineProps<{
    api: DocPreviewApi;
    descLabel?: string;
    sourceType: string;
  }>(),
  {
    descLabel: '描述',
  },
);

// 预览
const previewVisible = ref(false);
const previewRawContent = ref('');
const previewTitle = ref('');
const previewSourceId = ref(0);

async function openPreview(sourceId: number, title: string) {
  previewTitle.value = title;
  previewSourceId.value = sourceId;
  try {
    const doc = await props.api.fetchLatest(sourceId);
    previewRawContent.value = doc?.content || '';
    previewVisible.value = true;
  } catch {
    message.warning('暂无文档');
  }
}

// 公开链接
function copyLink(sourceId: number) {
  const url = `${window.location.origin}/api/doc/${props.sourceType}/${sourceId}`;
  navigator.clipboard
    .writeText(url)
    .then(() => {
      message.success('文档链接已复制');
    })
    .catch(() => {
      const input = document.createElement('input');
      input.value = url;
      document.body.append(input);
      input.select();
      document.execCommand('copy');
      input.remove();
      message.success('文档链接已复制');
    });
}

// 下载
function doDownload(content: string, title: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

async function downloadDirect(sourceId: number, title: string) {
  try {
    const doc = await props.api.fetchLatest(sourceId);
    doDownload(doc?.content || '暂无内容', title);
  } catch {
    message.warning('暂无文档');
  }
}

// 版本历史
const historyVisible = ref(false);
const historyList = ref<DocVersionItem[]>([]);
const historySourceId = ref(0);
const historyTitle = ref('');
const versionContent = ref('');
const versionViewVisible = ref(false);
const versionViewTitle = ref('');

async function openHistory(sourceId: number, title: string) {
  historySourceId.value = sourceId;
  historyTitle.value = title;
  const list = await props.api.fetchVersions(sourceId);
  historyList.value = Array.isArray(list) ? list : [];
  historyVisible.value = true;
}

async function viewVersion(id: number, version: number) {
  const doc = await props.api.fetchDetail(id);
  versionContent.value = doc?.content || '';
  versionViewTitle.value = `v${version}`;
  versionViewVisible.value = true;
}

async function rollback(versionId: number) {
  await props.api.rollback({
    sourceType: props.sourceType,
    sourceId: historySourceId.value,
    versionId,
  });
  message.success('回档成功');
  historyVisible.value = false;
}

defineExpose({ openPreview, download: downloadDirect, openHistory, copyLink });
</script>

<template>
  <!-- 预览弹窗 -->
  <Modal
    v-model:open="previewVisible"
    :title="previewTitle"
    width="820px"
    :footer="null"
  >
    <div style="max-height: 70vh; padding: 4px 0; overflow-y: auto">
      <DocRenderer :content="previewRawContent" :desc-label="descLabel" />
    </div>
    <div
      style="
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        margin-top: 14px;
      "
    >
      <Button @click="copyLink(previewSourceId)">复制链接</Button>
      <Button @click="doDownload(previewRawContent, previewTitle)">
        下载 MD
      </Button>
      <Button @click="previewVisible = false">关闭</Button>
    </div>
  </Modal>

  <!-- 版本历史抽屉 -->
  <Drawer
    v-model:open="historyVisible"
    :title="`${historyTitle} - 历史版本`"
    :width="480"
    placement="right"
  >
    <Timeline>
      <Timeline.Item v-for="v in historyList" :key="v.id">
        <div
          style="
            display: flex;
            gap: 8px;
            align-items: center;
            justify-content: space-between;
          "
        >
          <div>
            <Tag color="blue">v{{ v.version }}</Tag>
            <span class="doc-preview-time">{{ v.createdTime }}</span>
          </div>
          <Space size="small">
            <Button size="small" @click="viewVersion(v.id, v.version)">
              查看
            </Button>
            <Popconfirm title="确定回档到此版本？" @confirm="rollback(v.id)">
              <Button size="small" type="primary" ghost>回档</Button>
            </Popconfirm>
          </Space>
        </div>
        <div class="doc-preview-meta">
          {{ v.changeNote || '-' }} · {{ v.operator || '-' }}
        </div>
      </Timeline.Item>
    </Timeline>
    <div v-if="historyList.length === 0" class="doc-preview-empty">
      暂无版本记录
    </div>
  </Drawer>

  <!-- 版本内容查看 — 和预览用同一个 DocRenderer -->
  <Modal
    v-model:open="versionViewVisible"
    :title="versionViewTitle"
    width="820px"
    :footer="null"
  >
    <div style="max-height: 70vh; padding: 4px 0; overflow-y: auto">
      <DocRenderer :content="versionContent" :desc-label="descLabel" />
    </div>
  </Modal>
</template>

<style scoped>
.doc-preview-time {
  font-size: 12px;
  color: var(--ant-color-text-tertiary);
}

.doc-preview-meta {
  margin-top: 2px;
  font-size: 12px;
  color: var(--ant-color-text-secondary);
}

.doc-preview-empty {
  padding: 40px 0;
  color: var(--ant-color-text-tertiary);
  text-align: center;
}
</style>
