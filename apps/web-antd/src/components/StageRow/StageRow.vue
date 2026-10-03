<script lang="ts" setup>
/**
 * StageRow —— 单个「横向」（横向结构 P5）
 *
 * 横向是什么（docs/主流程定义.md §1）：**可独立执行的作业单元 + 有明确产物 + 子项容器**。
 * 本组件在界面上把它表现为**一行**：
 *   行首 = 序号 + 名称 + 状态 + 产物摘要
 *   行尾 = 操作按钮（开始 / 重跑 / 展开）
 *   行下 = 可展开的子项区（由调用方通过 #items 插槽提供，各横向形态不同）
 *
 * 设计要点：
 * - **状态不在此计算** —— 后端 StageRowCore 纯函数算出（可离线验证），前端只渲染。
 *   避免"后端算的状态"与"前端理解的阶段"各说各话（旧 PhaseStepper 即此问题）。
 * - `skipped` 态是本组件最需要表达清楚的一个：它表示用户**主动跳过**了洗稿，
 *   而不是"卡在这一步"。故单独配色 + 「可选」标记。
 */
import { computed } from 'vue';

import { Button, Card, Tag, Tooltip } from 'ant-design-vue';

import type { StageRow } from '#/api/core/dramafloow';

const props = defineProps<{
  /** 顺序号（① ② …），由父组件按数组下标给 */
  index: number;
  /** 该横向是否可展开子项 */
  expandable?: boolean;
  expanded?: boolean;
  /** 是否为建议的下一步（后端 nextRunnable） */
  isNext?: boolean;
  row: StageRow;
}>();

const emit = defineEmits<{
  (e: 'toggle'): void;
  (e: 'run'): void;
}>();

/** 状态 → 中文（与后端 StageStatus 一一对应） */
const STATUS_TEXT: Record<string, string> = {
  done: '已完成',
  failed: '失败',
  pending: '未开始',
  running: '进行中',
  skipped: '已跳过',
  stale: '已失效',
};

/** 状态 → antd Tag 颜色（只用 preset，禁硬编码色值） */
function statusColor(s: string): string {
  if (s === 'done') return 'success';
  if (s === 'failed') return 'error';
  if (s === 'stale') return 'error';
  if (s === 'running') return 'processing';
  if (s === 'skipped') return 'default';
  return 'default';
}

/** 状态 → 序号圆圈样式（未开始灰、进行中蓝、完成绿、失败红） */
const circleClass = computed(() => {
  switch (props.row.status) {
    case 'done': {
      return 'bg-primary text-white';
    }
    case 'failed':
    case 'stale': {
      return 'bg-destructive text-white';
    }
    case 'running': {
      return 'bg-primary/70 text-white';
    }
    case 'skipped': {
      return 'bg-muted text-muted-foreground';
    }
    default: {
      return 'bg-muted text-muted-foreground';
    }
  }
});

const statusText = computed(
  () => STATUS_TEXT[props.row.status] ?? props.row.status,
);

/** 序号显示（1..5；与后端 StageKey 顺序一致） */
const ordinal = computed(() => '①②③④⑤'[props.index] ?? String(props.index + 1));

/** 是否需要显示「跳过」的说明（可选性 + 已跳过 → 明确告诉用户这不是错误） */
const skipHint = computed(() => {
  if (props.row.optional && props.row.status === 'skipped') {
    return '洗稿是可选环节，本剧未洗稿，直接用了原始稿/结构产物继续生产';
  }
  return '';
});

/** 前置门未满足时，说明为什么不能开始 */
const gateHint = computed(() => {
  if (props.row.gateOpen) return '';
  return '前置条件未满足，请先完成上一步';
});
</script>

<template>
  <Card
    class="df-stage-row"
    size="small"
    :class="isNext ? 'border-primary' : ''"
  >
    <div class="flex flex-wrap items-center gap-3">
      <!-- 序号 -->
      <span
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs"
        :class="circleClass"
      >
        {{ ordinal }}
      </span>

      <!-- 名称 + 可选标记 -->
      <span class="font-medium">{{ row.name }}</span>
      <Tooltip v-if="row.optional" title="可选横向：不做也能继续往下走">
        <Tag class="!mr-0">可选</Tag>
      </Tooltip>

      <!-- 状态 -->
      <Tag :color="statusColor(row.status)">{{ statusText }}</Tag>

      <!-- 产物摘要（用户诉求：「产出了哪些产物」） -->
      <span class="text-xs text-muted-foreground">{{
        row.artifact.summary
      }}</span>

      <!-- 版本数（用户诉求：「每一个版本」） -->
      <Tag v-if="row.versions.length > 0" class="!mr-0">
        {{ row.versions.length }} 次执行
      </Tag>

      <span class="flex-1"></span>

      <!-- 建议的下一步：高亮提示 -->
      <Tag v-if="isNext" color="processing">建议下一步</Tag>

      <!-- 操作 -->
      <Tooltip :title="gateHint">
        <Button
          size="small"
          type="primary"
          :disabled="!row.gateOpen || row.status === 'running'"
          @click="emit('run')"
        >
          {{ row.status === 'pending' ? '开始' : '重跑' }}
        </Button>
      </Tooltip>
      <Button v-if="expandable" size="small" @click="emit('toggle')">
        {{ expanded ? '收起' : '详情' }}
      </Button>
    </div>

    <!-- skipped 说明：明确告诉用户这不是"卡住" -->
    <div v-if="skipHint" class="mt-2 text-xs text-muted-foreground">
      {{ skipHint }}
    </div>

    <!-- 展开区：子项由调用方提供（各横向形态不同） -->
    <div v-if="expanded" class="mt-3 border-t pt-3">
      <slot name="items"></slot>
    </div>
  </Card>
</template>

<style scoped>
.df-stage-row {
  /* 仅用 token，禁硬编码色值 */
  background: hsl(var(--card));
}
</style>
