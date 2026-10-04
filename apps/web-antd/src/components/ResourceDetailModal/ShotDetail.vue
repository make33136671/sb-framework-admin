<script lang="ts" setup>
import type { ShotItem, TaskItem } from '#/api/core/dramafloow';

/**
 * 分镜详情（弹窗内容）：Shot/Get 补全全部字段 + 片段视频 + 关联素材需求 + 历史子任务
 *
 * 列表页只带了部分列，弹窗打开时按 id 重新拉一次 Shot/Get，
 * 拿到 assets（素材需求）与 tasks（子任务）等列表页没有的信息。
 * 不写配对 toast（拦截器已弹）。
 */
import { computed, ref, watch } from 'vue';

import {
  Button,
  Descriptions,
  Empty,
  Modal,
  Space,
  Spin,
  Table,
  Tag,
} from 'ant-design-vue';

import { shotGet, shotStaleReplay } from '#/api/core/dramafloow';
import { TimeTag } from '#/components/TimeTag';
import { enumText } from '#/composables/useEnumText';
import { toStorageUrl } from '#/utils/media';

import { EMPTY_TEXT, formatDuration, toStringList } from './utils';

interface ShotGetResult {
  shot: ShotItem;
  assets: {
    approvedAssetId?: number;
    id: number;
    key: string;
    kind: string;
    status: string;
  }[];
  tasks: TaskItem[];
}

const props = defineProps<{
  /** 要查看的分镜；null 表示弹窗关闭 */
  shot: null | ShotItem;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  /** 重跑后通知父组件刷新列表 */
  (e: 'changed'): void;
  /** 打开子任务详情抽屉 */
  (e: 'openTask', taskId: number): void;
}>();

const open = computed(() => props.shot !== null);
const loading = ref(false);
const detail = ref<null | ShotGetResult>(null);
const replaying = ref(false);

async function load(id: number) {
  loading.value = true;
  detail.value = null;
  try {
    detail.value = await shotGet(id);
  } catch {
    // 拦截器已提示：退化为展示列表行数据
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.shot?.id,
  (id) => {
    if (id !== undefined && id !== null) void load(id);
  },
  { immediate: true },
);

/** 优先用接口返回的完整分镜，失败时回退列表行 */
const row = computed<null | ShotItem>(
  () => detail.value?.shot ?? props.shot ?? null,
);

const subtitle = computed(() => {
  const s = row.value;
  if (!s) return '';
  return `第 ${s.episodeNo} 集 · 第 ${s.shotNo} 镜 · v${s.scriptVersion}`;
});

const characterRefs = computed(() => toStringList(row.value?.characterRefs));
const assetRefs = computed(() => toStringList(row.value?.assetIds));

const clipUrl = computed(() => toStorageUrl(row.value?.clip?.videoPath));

function shotStatusColor(s: string): string {
  if (s === 'done') return 'success';
  if (s === 'stale') return 'error';
  if (s === 'generating') return 'processing';
  return 'default';
}

function taskStatusColor(s: string): string {
  if (s === 'done' || s === 'approved') return 'success';
  if (s === 'failed' || s === 'rejected') return 'error';
  if (['collecting', 'generating', 'preparing'].includes(s))
    return 'processing';
  return 'default';
}

async function replay() {
  const s = row.value;
  if (!s) return;
  replaying.value = true;
  try {
    await shotStaleReplay(s.id);
    await load(s.id);
    emit('changed');
  } finally {
    replaying.value = false;
  }
}
</script>

<template>
  <Modal
    :footer="null"
    :open="open"
    :title="`分镜详情 · ${subtitle}`"
    :width="920"
    @cancel="emit('close')"
  >
    <Spin :spinning="loading">
      <template v-if="row">
        <div class="mb-3 flex flex-wrap items-center gap-3">
          <Tag :color="shotStatusColor(row.status)" class="!mr-0">
            {{ enumText.shotStatus(row.status) }}
          </Tag>
          <Tag class="!mr-0">{{ formatDuration(row.durationSec) }}</Tag>
          <span
            v-if="row.status === 'stale'"
            class="text-xs text-muted-foreground"
          >
            失效：上游素材/剧本已变更，需重跑后重新生成片段
          </span>
          <div class="flex-1"></div>
          <Button
            v-if="row.status === 'stale'"
            :loading="replaying"
            size="small"
            type="primary"
            @click="replay"
          >
            重跑
          </Button>
        </div>

        <Descriptions bordered class="mb-4" :column="3" size="small">
          <Descriptions.Item label="集">{{ row.episodeNo }}</Descriptions.Item>
          <Descriptions.Item label="镜">{{ row.shotNo }}</Descriptions.Item>
          <Descriptions.Item label="剧本版本">
            v{{ row.scriptVersion }}
          </Descriptions.Item>
          <Descriptions.Item label="时长">
            {{ formatDuration(row.durationSec) }}
          </Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag :color="shotStatusColor(row.status)" class="!mr-0">
              {{ enumText.shotStatus(row.status) }}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="片段">
            <Tag
              v-if="row.clip"
              :color="row.clip.status === 'done' ? 'success' : 'error'"
              class="!mr-0"
            >
              {{ enumText.clipStatus(row.clip.status) }}
            </Tag>
            <span v-else class="text-muted-foreground">未生成</span>
          </Descriptions.Item>
          <Descriptions.Item label="景别">
            {{ row.composition || EMPTY_TEXT }}
          </Descriptions.Item>
          <Descriptions.Item label="光影">
            {{ row.lighting || EMPTY_TEXT }}
          </Descriptions.Item>
          <Descriptions.Item label="氛围">
            {{ row.mood || EMPTY_TEXT }}
          </Descriptions.Item>
          <Descriptions.Item label="场景引用">
            {{ row.sceneRef || EMPTY_TEXT }}
          </Descriptions.Item>
          <Descriptions.Item label="角色引用">
            <Space v-if="characterRefs.length > 0" :size="[4, 4]" wrap>
              <Tag v-for="c in characterRefs" :key="c" class="!mr-0">
                {{ c }}
              </Tag>
            </Space>
            <span v-else class="text-muted-foreground">-</span>
          </Descriptions.Item>
          <Descriptions.Item label="素材引用">
            <Space v-if="assetRefs.length > 0" :size="[4, 4]" wrap>
              <Tag v-for="a in assetRefs" :key="a" class="!mr-0">{{ a }}</Tag>
            </Space>
            <span v-else class="text-muted-foreground">-</span>
          </Descriptions.Item>
          <Descriptions.Item label="创建">
            <TimeTag :time="row.createdAt" />
          </Descriptions.Item>
          <Descriptions.Item label="更新">
            <TimeTag :time="row.updatedAt" />
          </Descriptions.Item>
        </Descriptions>

        <div class="mb-4 grid grid-cols-2 gap-4">
          <div>
            <div class="mb-1 text-sm text-muted-foreground">画面描述</div>
            <div
              class="h-32 overflow-auto rounded border border-border p-3 text-sm whitespace-pre-wrap"
            >
              {{ row.description || '（无）' }}
            </div>
          </div>
          <div>
            <div class="mb-1 text-sm text-muted-foreground">对白 / 旁白</div>
            <div
              class="h-32 overflow-auto rounded border border-border p-3 text-sm whitespace-pre-wrap"
            >
              {{ row.dialogue || '（无）' }}
            </div>
          </div>
        </div>

        <div v-if="row.clip" class="mb-4">
          <div class="mb-2 text-sm font-medium">片段（i2v）</div>
          <div v-if="clipUrl" class="flex flex-col gap-2">
            <video
              class="w-full max-w-xl rounded-md bg-black"
              controls
              preload="metadata"
              :src="clipUrl"
            ></video>
            <div class="text-xs break-all text-muted-foreground">
              {{ row.clip.videoPath }}
            </div>
          </div>
          <div
            v-else
            class="rounded border border-border p-3 text-sm text-muted-foreground"
          >
            片段文件路径不可解析：{{ row.clip.videoPath || '-' }}
          </div>
          <div v-if="row.clip.error" class="mt-2">
            <div class="mb-1 text-sm text-muted-foreground">片段错误</div>
            <pre
              class="max-h-40 overflow-auto rounded border border-border p-3 text-xs whitespace-pre-wrap"
              >{{ row.clip.error }}</pre
            >
          </div>
        </div>

        <div class="mb-4">
          <div class="mb-2 text-sm font-medium">
            关联素材需求（{{ detail?.assets.length ?? 0 }}）
          </div>
          <Table
            v-if="detail && detail.assets.length > 0"
            :columns="[
              { title: 'Key', dataIndex: 'key' },
              { title: '种类', key: 'kind', width: 90 },
              { title: '状态', key: 'status', width: 110 },
              { title: '已通过素材', key: 'approved', width: 120 },
            ]"
            :data-source="detail.assets"
            :pagination="false"
            row-key="id"
            size="small"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'kind'">
                <Tag class="!mr-0">
                  {{ enumText.assetKind(record.kind) }}
                </Tag>
              </template>
              <template v-else-if="column.key === 'status'">
                <Tag class="!mr-0">
                  {{ enumText.requirementStatus(record.status) }}
                </Tag>
              </template>
              <template v-else-if="column.key === 'approved'">
                {{ record.approvedAssetId ? '已选定' : '未选定' }}
              </template>
            </template>
          </Table>
          <Empty
            v-else
            :description="detail ? '该分镜暂无关联素材需求' : '加载中…'"
          />
        </div>

        <div>
          <div class="mb-2 text-sm font-medium">
            子任务（{{ detail?.tasks.length ?? 0 }}）
          </div>
          <Table
            v-if="detail && detail.tasks.length > 0"
            :columns="[
              { title: '类型', key: 'type', width: 140 },
              { title: '状态', key: 'status', width: 110 },
              { title: '进度', dataIndex: 'progress', width: 80 },
              { title: '创建', key: 'createdAt', width: 170 },
              { title: '操作', key: 'action', width: 90 },
            ]"
            :data-source="detail.tasks"
            :pagination="false"
            row-key="id"
            size="small"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'type'">
                {{ enumText.taskType(record.type) }}
              </template>
              <template v-else-if="column.key === 'status'">
                <Tag :color="taskStatusColor(record.status)" class="!mr-0">
                  {{ enumText.taskStatus(record.status) }}
                </Tag>
              </template>
              <template v-else-if="column.key === 'createdAt'">
                <TimeTag :time="record.createdAt" />
              </template>
              <template v-else-if="column.key === 'action'">
                <Button size="small" @click="emit('openTask', record.id)">
                  详情
                </Button>
              </template>
            </template>
          </Table>
          <Empty v-else :description="detail ? '暂无子任务' : '加载中…'" />
        </div>
      </template>
      <Empty v-else description="未找到该分镜" />
    </Spin>
  </Modal>
</template>
