<script lang="ts" setup>
/**
 * 成片详情（弹窗内容）：单集成片播放 + 版本/时长/大小/发布状态，并可直接上下架
 *
 * 播放复用 EpisodePlayer（成片 + 封面，路径走 /storage）。不写配对 toast（拦截器已弹）。
 */
import { computed, ref } from 'vue';

import { Button, Descriptions, Modal, Tag } from 'ant-design-vue';

import type { ProductEpisodeItem } from '#/api/core/dramafloow';

import { productPublish, productUnpublish } from '#/api/core/dramafloow';
import { EpisodePlayer } from '#/components/EpisodePlayer';
import { TimeTag } from '#/components/TimeTag';

import { formatDuration, formatSize } from './utils';

const props = defineProps<{
  /** 要查看的成片集；null 表示弹窗关闭 */
  episode: null | ProductEpisodeItem;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'changed'): void;
}>();

const open = computed(() => props.episode !== null);
const acting = ref(false);

function statusColor(s: string): string {
  if (s === 'done') return 'success';
  if (s === 'failed') return 'error';
  return 'processing';
}

async function togglePublish() {
  const e = props.episode;
  if (!e) return;
  acting.value = true;
  try {
    if (e.publishedAt) {
      await productUnpublish(e.id);
    } else {
      await productPublish(e.id);
    }
    emit('changed');
    emit('close');
  } finally {
    acting.value = false;
  }
}
</script>

<template>
  <Modal
    :footer="null"
    :open="open"
    :title="`成片详情 · 第 ${episode?.episodeNo ?? ''} 集`"
    :width="880"
    @cancel="emit('close')"
  >
    <template v-if="episode">
      <div class="mb-3 flex flex-wrap items-center gap-3">
        <Tag :color="statusColor(episode.status)" class="!mr-0">
          {{ episode.status }}
        </Tag>
        <Tag class="!mr-0">v{{ episode.version }}</Tag>
        <span
          v-if="episode.historyVersions.length > 0"
          class="text-xs text-muted-foreground"
        >
          历史版本：{{
            episode.historyVersions.map((v) => `v${v}`).join(' / ')
          }}
        </span>
        <div class="flex-1" />
        <Button
          :loading="acting"
          size="small"
          :type="episode.publishedAt ? 'default' : 'primary'"
          @click="togglePublish"
        >
          {{ episode.publishedAt ? '下架' : '发布' }}
        </Button>
      </div>

      <div class="mb-4">
        <EpisodePlayer
          :cover-path="episode.coverPath"
          :duration-sec="episode.durationSec"
          :episode-no="episode.episodeNo"
          :size-bytes="episode.sizeBytes"
          :status="episode.status"
          :video-path="episode.videoPath"
        />
      </div>

      <Descriptions bordered :column="2" size="small">
        <Descriptions.Item label="集">
          {{ episode.episodeNo }}
        </Descriptions.Item>
        <Descriptions.Item label="版本">
          v{{ episode.version }}
        </Descriptions.Item>
        <Descriptions.Item label="状态">
          <Tag :color="statusColor(episode.status)" class="!mr-0">
            {{ episode.status }}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="时长">
          {{ formatDuration(episode.durationSec) }}
        </Descriptions.Item>
        <Descriptions.Item label="文件大小">
          {{ formatSize(episode.sizeBytes) }}
        </Descriptions.Item>
        <Descriptions.Item label="发布状态">
          <template v-if="episode.publishedAt">
            已发布 ·
            <TimeTag :time="episode.publishedAt" />
          </template>
          <span v-else class="text-muted-foreground">未发布</span>
        </Descriptions.Item>
        <Descriptions.Item label="成片路径" :span="2">
          <span class="text-xs break-all">{{ episode.videoPath || '-' }}</span>
        </Descriptions.Item>
        <Descriptions.Item label="封面路径" :span="2">
          <span class="text-xs break-all">{{ episode.coverPath || '-' }}</span>
        </Descriptions.Item>
        <Descriptions.Item label="创建">
          <TimeTag :time="episode.createdAt" />
        </Descriptions.Item>
        <Descriptions.Item label="更新">
          <TimeTag :time="episode.updatedAt" />
        </Descriptions.Item>
      </Descriptions>
    </template>
  </Modal>
</template>
