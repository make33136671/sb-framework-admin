<script lang="ts" setup>
/**
 * 剧本集详情（弹窗内容）：洗稿结果中单集的全部场景
 *
 * 改写结果只存在 ScriptDetail.episodes（无单集接口），故直接用父组件的脚本数据。
 */
import { computed } from 'vue';

import { Empty, Modal, Tag } from 'ant-design-vue';

import type { ScriptEpisode } from '#/api/core/dramafloow';

import { episodeTitle } from '#/components/TaskDrawer/taskDisplay';

import { formatDuration } from './utils';

const props = defineProps<{
  /** 要查看的集；null 表示弹窗关闭 */
  episode: null | ScriptEpisode;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const open = computed(() => props.episode !== null);

/** 该集总时长（场景 duration 合计，单位秒） */
const totalSec = computed(() =>
  (props.episode?.scenes ?? []).reduce(
    (sum, sc) => sum + (Number(sc.duration) || 0),
    0,
  ),
);
</script>

<template>
  <Modal
    :footer="null"
    :open="open"
    :title="
      `第 ${episode?.no ?? ''} 集` +
      (episodeTitle(episode?.title) ? ` · ${episodeTitle(episode?.title)}` : '')
    "
    :width="820"
    @cancel="emit('close')"
  >
    <template v-if="episode">
      <div class="mb-3 flex flex-wrap items-center gap-3">
        <Tag class="!mr-0">{{ episode.scenes.length }} 个场景</Tag>
        <Tag class="!mr-0">合计 {{ formatDuration(totalSec) }}</Tag>
      </div>

      <div
        v-if="episode.scenes.length > 0"
        class="max-h-[60vh] overflow-auto pr-1"
      >
        <div
          v-for="(sc, i) in episode.scenes"
          :key="i"
          class="mb-3 rounded border border-border p-3"
        >
          <div class="mb-1 flex items-center gap-2">
            <span class="text-xs text-muted-foreground">场景 {{ i + 1 }}</span>
            <Tag class="!mr-0">{{ formatDuration(sc.duration) }}</Tag>
          </div>
          <div class="text-sm whitespace-pre-wrap">{{ sc.text }}</div>
        </div>
      </div>
      <Empty v-else description="该集暂无场景" />
    </template>
  </Modal>
</template>
