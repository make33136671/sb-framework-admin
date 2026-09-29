<script lang="ts" setup>
/**
 * 片段详情（弹窗内容）：分镜 i2v 产物 —— 视频播放 + 时长 + 失效错误
 *
 * 片段没有独立接口（挂在 Shot/List 的 clip 字段上），因此直接用列表行数据，
 * 只有重跑才回写：重跑走 Shot/StaleReplay。
 */
import { computed, ref } from 'vue';

import { Button, Descriptions, Modal, Tag } from 'ant-design-vue';

import type { ShotItem } from '#/api/core/dramafloow';

import { shotStaleReplay } from '#/api/core/dramafloow';
import { TimeTag } from '#/components/TimeTag';
import { toStorageUrl } from '#/utils/media';

import { formatDuration } from './utils';

const props = defineProps<{
  /** 要查看的分镜（其 clip 即片段）；null 表示弹窗关闭 */
  shot: null | ShotItem;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'changed'): void;
}>();

const open = computed(() => props.shot !== null);
const replaying = ref(false);

const clip = computed(() => props.shot?.clip ?? null);
const clipUrl = computed(() => toStorageUrl(clip.value?.videoPath));

const subtitle = computed(() => {
  const s = props.shot;
  if (!s) return '';
  return `第 ${s.episodeNo} 集 · 第 ${s.shotNo} 镜`;
});

function shotStatusColor(s: string): string {
  if (s === 'done') return 'success';
  if (s === 'stale') return 'error';
  if (s === 'generating') return 'processing';
  return 'default';
}

async function replay() {
  const s = props.shot;
  if (!s) return;
  replaying.value = true;
  try {
    await shotStaleReplay(s.id);
    emit('changed');
    emit('close');
  } finally {
    replaying.value = false;
  }
}
</script>

<template>
  <Modal
    :footer="null"
    :open="open"
    :title="`片段详情 · ${subtitle}`"
    :width="880"
    @cancel="emit('close')"
  >
    <template v-if="shot && clip">
      <div class="mb-3 flex flex-wrap items-center gap-3">
        <Tag
          :color="clip.status === 'done' ? 'success' : 'error'"
          class="!mr-0"
        >
          {{ clip.status }}
        </Tag>
        <span class="text-xs text-muted-foreground">
          分镜状态 {{ shot.status }}
        </span>
        <div class="flex-1" />
        <Button
          v-if="shot.status === 'stale'"
          :loading="replaying"
          size="small"
          type="primary"
          @click="replay"
        >
          重跑分镜
        </Button>
      </div>

      <div v-if="clipUrl" class="mb-4">
        <video
          class="w-full max-w-2xl rounded-md bg-black"
          controls
          preload="metadata"
          :src="clipUrl"
        />
      </div>
      <div
        v-else
        class="mb-4 rounded border border-border p-3 text-sm text-muted-foreground"
      >
        视频文件路径不可解析：{{ clip.videoPath || '-' }}
      </div>

      <Descriptions bordered class="mb-4" :column="2" size="small">
        <Descriptions.Item label="集">{{ shot.episodeNo }}</Descriptions.Item>
        <Descriptions.Item label="镜">{{ shot.shotNo }}</Descriptions.Item>
        <Descriptions.Item label="片段状态">
          {{ clip.status }}
        </Descriptions.Item>
        <Descriptions.Item label="片段时长">
          {{ formatDuration(clip.durationSec) }}
        </Descriptions.Item>
        <Descriptions.Item label="分镜状态">
          <Tag :color="shotStatusColor(shot.status)" class="!mr-0">
            {{ shot.status }}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="分镜时长">
          {{ formatDuration(shot.durationSec) }}
        </Descriptions.Item>
        <Descriptions.Item label="分镜更新">
          <TimeTag :time="shot.updatedAt" />
        </Descriptions.Item>
        <Descriptions.Item label="分镜创建">
          <TimeTag :time="shot.createdAt" />
        </Descriptions.Item>
        <Descriptions.Item label="视频路径" :span="2">
          <span class="text-xs break-all">{{ clip.videoPath || '-' }}</span>
        </Descriptions.Item>
      </Descriptions>

      <div class="mb-1 text-sm font-medium">画面描述</div>
      <div
        class="mb-4 rounded border border-border p-3 text-sm whitespace-pre-wrap"
      >
        {{ shot.description || '（无）' }}
      </div>

      <div v-if="clip.error">
        <div class="mb-1 text-sm font-medium text-muted-foreground">
          片段错误
        </div>
        <pre
          class="max-h-60 overflow-auto rounded border border-border p-3 text-xs whitespace-pre-wrap"
          >{{ clip.error }}</pre
        >
      </div>
    </template>
    <template v-else>
      <div
        class="rounded border border-border p-3 text-sm text-muted-foreground"
      >
        该分镜尚未生成片段（需先完成分镜、素材选定后触发 i2v）。
      </div>
    </template>
  </Modal>
</template>
