<script lang="ts" setup>
/**
 * 素材需求详情（弹窗内容）：Asset/RequirementGet 补全 spec/来源/候选/驳回原因/子任务
 *
 * 列表页只带 key/kind/version/计数，弹窗按 id 重新拉一次，展开：
 *   - 需求本体：spec（生成规格）、description、来源、版本与当前标记
 *   - 候选图：缩略图 + 变体号 + 状态（点击看大图，antd Image 自带预览）
 *   - 子任务：可直接跳 TaskDrawer
 * 不写配对 toast（拦截器已弹）。
 */
import { computed, ref, watch } from 'vue';

import {
  Button,
  Descriptions,
  Empty,
  Image,
  Modal,
  Spin,
  Table,
  Tag,
} from 'ant-design-vue';

import type {
  AssetCandidateItem,
  AssetRequirementItem,
  ReasonItem,
  TaskItem,
} from '#/api/core/dramafloow';

import { assetGenerate, assetRequirementGet } from '#/api/core/dramafloow';
import { TimeTag } from '#/components/TimeTag';
import { toStorageUrl } from '#/utils/media';

import { sourceText } from './utils';

interface RequirementGetResult {
  requirement: AssetRequirementItem;
  candidates: AssetCandidateItem[];
  reasons: ReasonItem[];
  tasks: TaskItem[];
}

const props = defineProps<{
  /** 要查看的素材需求；null 表示弹窗关闭 */
  requirement: null | AssetRequirementItem;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  /** 生成/状态变化后通知父组件刷新列表 */
  (e: 'changed'): void;
  (e: 'open-task', taskId: number): void;
}>();

const open = computed(() => props.requirement !== null);
const loading = ref(false);
const detail = ref<null | RequirementGetResult>(null);
const generating = ref(false);

async function load(id: number) {
  loading.value = true;
  detail.value = null;
  try {
    detail.value = await assetRequirementGet(id);
  } catch {
    // 拦截器已提示：退化为展示列表行数据
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.requirement?.id,
  (id) => {
    if (id !== undefined && id !== null) void load(id);
  },
  { immediate: true },
);

const row = computed<null | AssetRequirementItem>(
  () => detail.value?.requirement ?? props.requirement ?? null,
);

const kindText: Record<string, string> = {
  character: '角色',
  scene: '场景',
  prop: '道具',
};

/** 候选：图片优先，无图的（失败/待生成）单独标注 */
const candidates = computed(() => detail.value?.candidates ?? []);

/** 驳回原因 id → 名称，用于展示候选被驳回的原因 */
const reasonName = computed(() => {
  const map = new Map<number, string>();
  for (const r of detail.value?.reasons ?? []) map.set(r.id, r.name);
  return map;
});

function candidateStatusColor(s: string): string {
  if (s === 'approved' || s === 'done') return 'success';
  if (s === 'rejected' || s === 'failed') return 'error';
  return 'processing';
}

function taskStatusColor(s: string): string {
  if (s === 'done' || s === 'approved') return 'success';
  if (s === 'failed' || s === 'rejected') return 'error';
  if (['preparing', 'generating', 'collecting'].includes(s))
    return 'processing';
  return 'default';
}

async function generate() {
  const r = row.value;
  if (!r) return;
  generating.value = true;
  try {
    await assetGenerate(r.id);
    await load(r.id);
    emit('changed');
  } finally {
    generating.value = false;
  }
}
</script>

<template>
  <Modal
    :footer="null"
    :open="open"
    :title="`素材需求详情 · ${row?.key ?? ''}`"
    :width="960"
    @cancel="emit('close')"
  >
    <Spin :spinning="loading">
      <template v-if="row">
        <div class="mb-3 flex flex-wrap items-center gap-3">
          <Tag class="!mr-0">{{ kindText[row.kind] ?? row.kind }}</Tag>
          <Tag class="!mr-0">v{{ row.version }}</Tag>
          <Tag v-if="row.isCurrent" class="!mr-0" color="success">当前版本</Tag>
          <Tag v-if="row.status" class="!mr-0">{{ row.status }}</Tag>
          <div class="flex-1" />
          <Button
            :loading="generating"
            size="small"
            type="primary"
            @click="generate"
          >
            生成候选
          </Button>
        </div>

        <Descriptions bordered class="mb-4" :column="3" size="small">
          <Descriptions.Item label="Key">{{ row.key }}</Descriptions.Item>
          <Descriptions.Item label="种类">
            {{ kindText[row.kind] ?? row.kind }}
          </Descriptions.Item>
          <Descriptions.Item label="来源">
            {{ sourceText(row.source) }}
          </Descriptions.Item>
          <Descriptions.Item label="版本">
            v{{ row.version }} / 共 {{ row.versionCount ?? 1 }} 版
          </Descriptions.Item>
          <Descriptions.Item label="候选">
            {{ row.candidateCount }} 个（通过 {{ row.approvedCount }} / 待审
            {{ row.pendingCount }}）
          </Descriptions.Item>
          <Descriptions.Item label="状态">{{ row.status }}</Descriptions.Item>
          <Descriptions.Item label="创建">
            <TimeTag :time="row.createdAt" />
          </Descriptions.Item>
          <Descriptions.Item label="更新">
            <TimeTag :time="row.updatedAt" />
          </Descriptions.Item>
          <Descriptions.Item label="已选定素材">
            {{ row.approvedAssetId ? '已选定' : '未选定' }}
          </Descriptions.Item>
        </Descriptions>

        <div class="mb-4">
          <div class="mb-1 text-sm text-muted-foreground">描述</div>
          <div
            class="max-h-32 overflow-auto rounded border border-border p-3 text-sm whitespace-pre-wrap"
          >
            {{ row.description || '（无）' }}
          </div>
        </div>

        <div class="mb-4">
          <div class="mb-1 text-sm text-muted-foreground">
            生成规格 spec（注入到出图提示词）
          </div>
          <pre
            class="max-h-48 overflow-auto rounded border border-border p-3 text-xs whitespace-pre-wrap"
            >{{ row.spec || '（无）' }}</pre
          >
        </div>

        <div class="mb-4">
          <div class="mb-2 text-sm font-medium">
            候选图（{{ candidates.length }}）
          </div>
          <div v-if="candidates.length > 0" class="flex flex-wrap gap-3">
            <div
              v-for="c in candidates"
              :key="c.id"
              class="w-40 rounded border border-border p-2"
            >
              <Image
                v-if="toStorageUrl(c.filePath)"
                class="rounded"
                :height="120"
                :src="toStorageUrl(c.filePath)"
                :width="144"
              />
              <div
                v-else
                class="flex h-[120px] w-36 items-center justify-center rounded text-xs text-muted-foreground"
              >
                无图
              </div>
              <div class="mt-2 flex items-center gap-1">
                <Tag :color="candidateStatusColor(c.status)" class="!mr-0">
                  {{ c.status }}
                </Tag>
                <span class="text-xs text-muted-foreground">
                  #{{ c.variantNo }}
                </span>
              </div>
              <div class="mt-1 text-xs text-muted-foreground">
                seed {{ c.seed }}
                <template v-if="c.width && c.height">
                  · {{ c.width }}×{{ c.height }}
                </template>
              </div>
              <div
                v-if="c.rejectReasonId"
                class="mt-1 text-xs text-muted-foreground"
              >
                驳回：{{ reasonName.get(c.rejectReasonId) ?? '未知原因' }}
              </div>
              <div
                v-if="c.rejectNote"
                class="mt-1 text-xs text-muted-foreground"
              >
                备注：{{ c.rejectNote }}
              </div>
              <div class="mt-1">
                <TimeTag :time="c.createdAt" />
              </div>
            </div>
          </div>
          <Empty v-else :description="detail ? '暂无候选图' : '加载中…'" />
        </div>

        <div>
          <div class="mb-2 text-sm font-medium">
            子任务（{{ detail?.tasks.length ?? 0 }}）
          </div>
          <Table
            v-if="detail && detail.tasks.length > 0"
            :columns="[
              { title: '类型', dataIndex: 'type', width: 140 },
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
              <template v-if="column.key === 'status'">
                <Tag :color="taskStatusColor(record.status)" class="!mr-0">
                  {{ record.status }}
                </Tag>
              </template>
              <template v-else-if="column.key === 'createdAt'">
                <TimeTag :time="record.createdAt" />
              </template>
              <template v-else-if="column.key === 'action'">
                <Button size="small" @click="emit('open-task', record.id)">
                  详情
                </Button>
              </template>
            </template>
          </Table>
          <Empty v-else :description="detail ? '暂无子任务' : '加载中…'" />
        </div>
      </template>
      <Empty v-else description="未找到该素材需求" />
    </Spin>
  </Modal>
</template>
