<script lang="ts" setup>
/**
 * 审核队列（契约 §5.1 Review / §8）
 *
 * 三类：图（t2i 候选）/ 剧（待发布成集）。片段无人工审核，仅异常复核入口。
 * 键盘流：1/2/3 选候选，A 通过，R 驳回（由 CandidateGallery 提供）。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Button,
  Card,
  Empty,
  List,
  Segmented,
  Space,
  Spin,
  Tag,
} from 'ant-design-vue';

import type { ReasonItem, ReviewQueueItem } from '#/api/core/dramafloow';
import {
  assetCandidateList,
  assetRequirementGet,
  reviewApprove,
  reviewQueue,
  reviewReject,
  templateReasonList,
} from '#/api/core/dramafloow';
import { CandidateGallery } from '#/components/CandidateGallery';
import { TimeTag } from '#/components/TimeTag';
import { useTaskStream } from '#/composables/useTaskStream';

const stream = useTaskStream();

const target = ref<'candidate' | 'clip' | 'drama'>('candidate');
const items = ref<ReviewQueueItem[]>([]);
const total = ref(0);
const loading = ref(false);
const currentIndex = ref(0);
const reasons = ref<ReasonItem[]>([]);
/** 当前分组：同一素材需求下的候选（图审核按需求聚合） */
const currentCandidates = ref<
  {
    id: number;
    taskId: number;
    variantNo: number;
    seed: number;
    prompt: string;
    filePath?: string;
    width?: number;
    height?: number;
    status: string;
    rejectReasonId?: number;
    rejectNote?: string;
    createdAt: string;
  }[]
>([]);

const current = computed(() => items.value[currentIndex.value]);

async function load() {
  loading.value = true;
  try {
    const res = await reviewQueue({
      target: target.value,
      page: 1,
      pageSize: 100,
    });
    items.value = res.items;
    total.value = res.total;
    if (currentIndex.value >= items.value.length) currentIndex.value = 0;
    await loadCurrentCandidates();
  } catch {
    // 拦截器已提示
  } finally {
    loading.value = false;
  }
}

/** 图：拉取该需求下全部候选，便于同屏对比 */
async function loadCurrentCandidates() {
  currentCandidates.value = [];
  const c = current.value;
  if (!c || target.value !== 'candidate' || !c.requirementId) return;
  try {
    const detail = await assetRequirementGet(c.requirementId);
    currentCandidates.value = detail.candidates;
    if (reasons.value.length === 0) reasons.value = detail.reasons;
  } catch {
    // 忽略：仍可显示单条
    const list = await assetCandidateList(c.requirementId);
    currentCandidates.value = list;
  }
}

watch(currentIndex, () => void loadCurrentCandidates());
watch(target, () => {
  currentIndex.value = 0;
  void load();
});

/** 轮询定时器（卸载时必须清理，否则离开页面后仍在请求） */
let refreshTimer: null | ReturnType<typeof setInterval> = null;

onMounted(async () => {
  reasons.value = await templateReasonList('image').catch(() => []);
  await load();
  // 兜底轮询：WS 队列事件驱动为主，这里每 60s 拉一次防止事件丢失导致队列陈旧
  refreshTimer = setInterval(() => void load(), 60_000);
});

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
});

// WS 队列深度变化时即时刷新（比轮询更及时；不销毁轮询，避免「活动一次后就不再刷新」）
watch(
  () => stream.queue.value?.depth,
  () => {
    void load();
  },
);

async function approveCurrent() {
  const c = current.value;
  if (!c) return;
  if (c.target === 'candidate') {
    // 候选审核在 CandidateGallery 内完成（按候选 id），这里兜底转到该候选
    await reviewApprove(c.target, c.id);
  } else {
    await reviewApprove(c.target, c.id);
  }
  next();
}

async function rejectCurrent() {
  const c = current.value;
  if (!c) return;
  await reviewReject(c.target, c.id, reasons.value[0]?.id, undefined);
  next();
}

function next() {
  if (currentIndex.value < items.value.length - 1) {
    currentIndex.value += 1;
  } else {
    void load();
  }
}
</script>

<template>
  <Page title="审核队列" description="图（候选）与剧（成集）人工审核门">
    <Card class="mb-4" size="small">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <Space>
          <Segmented
            v-model:value="target"
            :options="[
              { label: '图片候选', value: 'candidate' },
              { label: '成片成集', value: 'drama' },
              { label: '片段复核', value: 'clip' },
            ]"
          />
          <Button size="small" @click="load">刷新</Button>
        </Space>
        <Space>
          <span class="text-sm text-muted-foreground">
            共 {{ total }} 项 · 当前
            {{ items.length === 0 ? 0 : currentIndex + 1 }}/{{ items.length }}
          </span>
          <Button
            size="small"
            :disabled="currentIndex === 0"
            @click="currentIndex -= 1"
          >
            上一项
          </Button>
          <Button
            size="small"
            :disabled="currentIndex >= items.length - 1"
            @click="currentIndex += 1"
          >
            下一项
          </Button>
        </Space>
      </div>
    </Card>

    <Spin :spinning="loading">
      <div v-if="!current">
        <Empty description="当前没有待审项 🎉" />
      </div>

      <div v-else class="grid grid-cols-3 gap-4">
        <!-- 左：队列列表 -->
        <Card size="small" title="队列" class="col-span-1">
          <List :data-source="items" size="small">
            <template #renderItem="{ item, index }">
              <List.Item
                class="cursor-pointer"
                :class="index === currentIndex ? 'bg-primary/10' : ''"
                @click="currentIndex = index"
              >
                <div class="flex w-full items-center justify-between gap-2">
                  <span class="truncate text-sm">
                    <template v-if="item.target === 'candidate'">
                      {{ item.requirementKey || `候选 #${item.id}` }}
                    </template>
                    <template v-else-if="item.target === 'drama'">
                      {{ item.dramaName }} 第 {{ item.episodeNo }} 集
                    </template>
                    <template v-else>片段 #{{ item.id }}</template>
                  </span>
                  <Tag
                    :color="
                      item.target === 'candidate' ? 'warning' : 'processing'
                    "
                    class="!mr-0"
                  >
                    {{
                      item.target === 'candidate'
                        ? '图'
                        : item.target === 'drama'
                          ? '剧'
                          : '片'
                    }}
                  </Tag>
                </div>
              </List.Item>
            </template>
          </List>
        </Card>

        <!-- 右：审核区 -->
        <Card
          size="small"
          class="col-span-2"
          :title="current.dramaName || '审核'"
        >
          <!-- 图：候选对比 -->
          <template
            v-if="
              current.target === 'candidate' && currentCandidates.length > 0
            "
          >
            <CandidateGallery
              :candidates="currentCandidates"
              :reasons="reasons"
              @changed="load"
            />
          </template>

          <!-- 剧：成集预览 -->
          <template v-else-if="current.target === 'drama'">
            <div class="flex flex-col gap-2">
              <div class="text-sm">
                第 {{ current.episodeNo }} 集 · v{{ current.version }} · 时长
                {{ current.durationSec ?? '-' }}s
              </div>
              <div class="break-all text-xs text-muted-foreground">
                {{ current.videoPath }}
              </div>
              <Space class="mt-2">
                <Button type="primary" @click="approveCurrent"
                  >通过并发布</Button
                >
                <Button danger @click="rejectCurrent">驳回（重新渲染）</Button>
              </Space>
            </div>
          </template>

          <!-- 片段复核 -->
          <template v-else-if="current.target === 'clip'">
            <div class="flex flex-col gap-2 text-sm">
              <div>
                片段 #{{ current.id }} · 分镜 {{ current.shotId }} · 状态
                {{ current.status }}
              </div>
              <div class="break-all text-xs text-muted-foreground">
                {{ current.videoPath }}
              </div>
              <div v-if="current.error" class="text-xs">
                错误：{{ current.error }}
              </div>
              <div class="text-xs text-muted-foreground">
                失效片段请在剧目详情「分镜」页手动重跑（StaleReplay）。
              </div>
              <div>
                <TimeTag v-if="current.updatedAt" :time="current.updatedAt" />
              </div>
            </div>
          </template>

          <template v-else>
            <Empty description="该项无可显示内容" />
          </template>
        </Card>
      </div>
    </Spin>
  </Page>
</template>
