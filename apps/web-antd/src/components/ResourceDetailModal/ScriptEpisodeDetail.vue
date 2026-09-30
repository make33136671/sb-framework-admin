<script lang="ts" setup>
/**
 * 剧本集详情（弹窗内容）：洗稿结果中单集的全部场景
 *
 * 改写结果只存在 ScriptDetail.episodes（无单集接口），故直接用父组件的脚本数据。
 */
import { computed } from 'vue';

import { Empty, Modal, Space, Tag } from 'ant-design-vue';

import type { ScriptEpisode } from '#/api/core/dramafloow';

import { episodeTitle } from '#/components/TaskDrawer/taskDisplay';

import { formatDuration } from './utils';

const props = withDefaults(
  defineProps<{
    /** 要查看的集；null 表示弹窗关闭 */
    episode: null | ScriptEpisode;
    /** 该集的展示版本号（100 / 100.1） */
    version?: null | string;
    /** 该集的历史版本（可回退；空数组则隐藏回退区） */
    history?: {
      id: number;
      version: string;
      origin: string;
      isCurrent: boolean;
      createdAt: string;
    }[];
  }>(),
  { history: () => [], version: null },
);

const emit = defineEmits<{
  (e: 'close'): void;
  /** 单集回退到指定历史版本 id */
  (e: 'revert', id: number): void;
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
        <Tag
          v-if="episode.sourceConfidence === 'matched'"
          color="success"
          class="!mr-0"
        >
          原稿出处已定位
        </Tag>
        <Tag v-else color="warning" class="!mr-0">
          原稿出处为估算（未匹配到关键词，按集均分）
        </Tag>
      </div>

      <!-- 该集版本历史：可单独回退（不改其它集） -->
      <div v-if="history.length > 1" class="mb-3">
        <div class="mb-1 text-sm text-muted-foreground">
          该集历史版本（可单独回退，不影响其它集）
        </div>
        <Space :size="[4, 4]" wrap>
          <Tag
            v-for="h in history"
            :key="h.id"
            :color="h.isCurrent ? 'success' : 'default'"
            class="!mr-0 cursor-pointer"
            :title="h.origin === 'partial' ? '选区重洗产出' : '整本洗稿产出'"
            @click="emit('revert', h.id)"
          >
            v{{ h.version }}{{ h.isCurrent ? '（当前）' : '' }}
          </Tag>
        </Space>
      </div>

      <!-- 左右对照：左=本集改写内容，右=对应的原始稿片段 -->
      <div class="grid grid-cols-2 gap-3">
        <div>
          <div class="mb-1 text-sm text-muted-foreground">
            本集内容（改写后）
          </div>
          <div
            v-if="episode.scenes.length > 0"
            class="max-h-[58vh] overflow-auto rounded border border-border p-3"
          >
            <div v-for="(sc, i) in episode.scenes" :key="i" class="mb-3">
              <div class="mb-1 flex items-center gap-2">
                <span class="text-xs text-muted-foreground">
                  场景 {{ i + 1 }}
                </span>
                <Tag class="!mr-0">{{ formatDuration(sc.duration) }}</Tag>
              </div>
              <div class="text-sm whitespace-pre-wrap">{{ sc.text }}</div>
            </div>
          </div>
          <Empty v-else description="该集暂无场景" />
        </div>

        <div>
          <div
            class="mb-1 flex items-center gap-2 text-sm text-muted-foreground"
          >
            <span>原始稿出处</span>
            <span v-if="episode.sourceExcerpt" class="text-xs">
              第 {{ episode.sourceStart }}–{{ episode.sourceEnd }} 字
            </span>
          </div>
          <pre
            v-if="episode.sourceExcerpt"
            class="max-h-[58vh] overflow-auto rounded border border-border p-3 font-mono text-xs whitespace-pre-wrap"
            >{{ episode.sourceExcerpt }}</pre
          >
          <Empty v-else description="该剧本没有原始稿可对照" />
        </div>
      </div>
    </template>
  </Modal>
</template>
