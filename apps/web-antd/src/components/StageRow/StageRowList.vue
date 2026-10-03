<script lang="ts" setup>
import type { StageKey, StageRowsResult } from '#/api/core/dramafloow';

/**
 * StageRowList —— 剧目详情的「五行横向」（横向结构 P5）
 *
 * 替代旧的 PhaseStepper 五阶段条。区别（docs/横向结构设计.md §6.1）：
 *   旧 PhaseStepper：5 个**步骤**，语义是"走到第几步了"，且把洗稿放在第一格
 *   本组件：5 个**横向**，每个都可独立执行、有明确产物、可展开子项
 *
 * 数据来自后端 `GET /admin/Stage/Rows`（判定全在后端纯函数 StageRowCore）；
 * 状态不在此重算 —— 避免"后端算的"与"前端理解的"不一致。
 */
import { computed, onMounted, ref, watch } from 'vue';

import { Empty, Spin } from 'ant-design-vue';

import { stageRows } from '#/api/core/dramafloow';
import { ArtifactTrace, StageRow } from '#/components/StageRow';

const props = defineProps<{
  dramaId: number;
  /**
   * 外部触发刷新用的版本号（父组件在收到 WS drama 事件后 +1）。
   * 用 watch 监听而非 expose 方法，保持单向数据流。
   */
  refreshKey?: number;
}>();

const emit = defineEmits<{
  /** 用户点了某个横向的「开始/重跑」——父组件负责调对应端点 */
  (e: 'run', key: StageKey): void;
}>();

const data = ref<null | StageRowsResult>(null);
const loading = ref(false);
const expanded = ref<StageKey[]>([]);

async function load() {
  if (!props.dramaId) return;
  loading.value = true;
  try {
    data.value = await stageRows(props.dramaId);
  } finally {
    loading.value = false;
  }
}

function toggle(key: StageKey) {
  expanded.value = expanded.value.includes(key)
    ? expanded.value.filter((k) => k !== key)
    : [...expanded.value, key];
}

onMounted(load);
watch(
  () => [props.dramaId, props.refreshKey],
  () => load(),
);

/** 后端给出的「建议下一步」；用于在对应行上打标 */
const nextKey = computed(() => data.value?.nextRunnable ?? null);

/** 便于父组件在操作后立即刷新 */
defineExpose({ reload: load });
</script>

<template>
  <Spin :spinning="loading">
    <div v-if="!data" class="py-4 text-center text-xs text-muted-foreground">
      暂无横向数据
    </div>

    <Empty
      v-else-if="data.rows.length === 0"
      :image="Empty.PRESENTED_IMAGE_SIMPLE"
      description="该剧目还没有横向数据"
    />

    <div v-else class="space-y-2">
      <StageRow
        v-for="(row, i) in data.rows"
        :key="row.key"
        :row="row"
        :index="i"
        :is-next="row.key === nextKey"
        :expandable="true"
        :expanded="expanded.includes(row.key)"
        @run="emit('run', row.key)"
        @toggle="toggle(row.key)"
      >
        <template #items>
          <!-- 分集 / 成片的子项由父组件用插槽覆盖（它们需要预览与单集操作） -->
          <slot :name="row.key" :row="row">
            <!-- 默认渲染：执行历史 + 关键词留档（溯源） -->
            <ArtifactTrace :versions="row.versions" />
          </slot>
        </template>
      </StageRow>
    </div>
  </Spin>
</template>
