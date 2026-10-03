<script lang="ts" setup>
/**
 * ResourceDetailModal —— 剧目详情页「查看详情」统一入口
 *
 * 用一个组件按 type 分发到 5 个居中 Modal：
 *   - shot       分镜（Shot/Get 补全字段 + 片段视频 + 关联素材 + 子任务）
 *   - asset      素材需求（RequirementGet：spec/候选/驳回原因/子任务）
 *   - clip       片段（i2v 视频 + 失效错误）
 *   - product    成片（EpisodePlayer 播放 + 上下架）
 *   - script-ep  剧本集（洗稿结果的整集场景）
 *
 * 各子组件只负责渲染，开闭与数据由父组件（剧目详情页）控制。
 */
import type {
  AssetRequirementItem,
  ProductEpisodeItem,
  ScriptEpisode,
  ShotItem,
} from '#/api/core/dramafloow';

import AssetDetail from './AssetDetail.vue';
import ClipDetail from './ClipDetail.vue';
import ProductDetail from './ProductDetail.vue';
import ScriptEpisodeDetail from './ScriptEpisodeDetail.vue';
import ShotDetail from './ShotDetail.vue';

export type ResourceDetailType =
  | 'asset'
  | 'clip'
  | 'product'
  | 'script-ep'
  | 'shot';

defineProps<{
  productEpisode?: null | ProductEpisodeItem;
  requirement?: AssetRequirementItem | null;
  scriptEpisode?: null | ScriptEpisode;
  /** 剧本集：该集展示版本号与历史版本（可回退） */
  scriptEpisodeHistory?: {
    createdAt: string;
    id: number;
    isCurrent: boolean;
    origin: string;
    version: string;
  }[];
  scriptEpisodeVersion?: null | string;
  shot?: null | ShotItem;
  /** 当前打开的详情类型；null 表示全部关闭 */
  type: null | ResourceDetailType;
}>();

const emit = defineEmits<{
  (e: 'changed'): void;
  (e: 'close'): void;
  (e: 'openTask', taskId: number): void;
  /** 剧本集单集回退 */
  (e: 'revertEpisode', id: number): void;
}>();
</script>

<template>
  <!-- 分镜 / 片段都由分镜行触发，父组件按 type 传入对应那份行数据 -->
  <ShotDetail
    v-if="type === 'shot'"
    :shot="shot ?? null"
    @changed="emit('changed')"
    @close="emit('close')"
    @open-task="(id) => emit('openTask', id)"
  />
  <ClipDetail
    v-else-if="type === 'clip'"
    :shot="shot ?? null"
    @changed="emit('changed')"
    @close="emit('close')"
  />
  <AssetDetail
    v-else-if="type === 'asset'"
    :requirement="requirement ?? null"
    @changed="emit('changed')"
    @close="emit('close')"
    @open-task="(id) => emit('openTask', id)"
  />
  <ProductDetail
    v-else-if="type === 'product'"
    :episode="productEpisode ?? null"
    @changed="emit('changed')"
    @close="emit('close')"
  />
  <ScriptEpisodeDetail
    v-else-if="type === 'script-ep'"
    :episode="scriptEpisode ?? null"
    :history="scriptEpisodeHistory ?? []"
    :version="scriptEpisodeVersion ?? null"
    @close="emit('close')"
    @revert="(id) => emit('revertEpisode', id)"
  />
</template>
