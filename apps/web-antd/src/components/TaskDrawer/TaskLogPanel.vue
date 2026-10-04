<script lang="ts" setup>
import type { TaskLogItem } from '#/api/core/dramafloow';

/**
 * TaskLogPanel —— 任务详情「生图交互日志」（用户诉求原文：
 * 「我希望在任务详情里 能看到 生图的交互日志」）。
 *
 * 数据来自后端 <c>Task/Get</c> 的 <c>logs</c>：把 job（生图作业）+ task_version（提示词快照）
 * + 任务自身状态/错误按时间**归并**成一条人可读的时间线。
 *
 * 为什么不是「只把 jobs 表格列出来」：
 *   · 用户问的是「交互日志」，需要的是**按时间读一遍这个任务经历了什么**；
 *     纯表格把「提交 / 完成 / 失败」压在同一行的不同列里，读不出先后与因果；
 *   · 提示词是交互的核心一环（喂了什么才有什么结果），必须和时间线在一起。
 *
 * level 决定节点颜色：ok/info 主色、warn 警示、error 危险 —— 全走主题 token。
 */
import { computed, ref } from 'vue';

import { Empty, Tag } from 'ant-design-vue';

import { TimeTag } from '#/components/TimeTag';

const props = defineProps<{
  loading?: boolean;
  logs?: null | TaskLogItem[];
}>();

const logs = computed<TaskLogItem[]>(() => props.logs ?? []);

/** 细节展开（key = 时间戳+标题，日志无 id；同一时刻同标题理论不重复） */
const openDetail = ref<Record<string, boolean>>({});
function keyOf(l: TaskLogItem, i: number): string {
  return `${l.at}-${l.kind}-${i}`;
}
function toggle(k: string) {
  openDetail.value = { ...openDetail.value, [k]: !openDetail.value[k] };
}

/** 类别 → 中文短标签（时间线上的小徽标） */
const KIND_TEXT: Record<string, string> = {
  error: '失败',
  job: '生图',
  prompt: '提示词',
  task: '任务',
};

function kindText(k: string): string {
  return KIND_TEXT[k] ?? k;
}

/** 类别 → 徽标颜色（与 level 分开：类别说「是什么」，级别说「好不好」） */
function kindColor(k: string): string {
  switch (k) {
    case 'error': {
      return 'error';
    }
    case 'job': {
      return 'processing';
    }
    case 'prompt': {
      return 'purple';
    }
    default: {
      return 'default';
    }
  }
}

/** 耗时格式化（job 类事件：提交→完成） */
function fmtDuration(ms?: null | number): string {
  if (ms === null || ms === undefined) return '';
  if (ms < 1000) return `${ms} ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)} 秒`;
  const min = Math.floor(sec / 60);
  return `${min} 分 ${Math.round(sec % 60)} 秒`;
}
</script>

<template>
  <div class="df-log">
    <template v-if="logs.length > 0">
      <div class="df-log__list">
        <div
          v-for="(l, i) in logs"
          :key="keyOf(l, i)"
          class="df-log__item"
          :class="`df-log__item--${l.level}`"
        >
          <!-- 时间线节点 -->
          <span class="df-log__dot"></span>

          <div class="df-log__body">
            <div class="df-log__head">
              <TimeTag :time="l.at" class="df-log__time" />
              <Tag class="!mr-0" :color="kindColor(l.kind)">
                {{ kindText(l.kind) }}
              </Tag>
              <span
                v-if="l.variantNo !== null && l.variantNo !== undefined"
                class="text-xs text-muted-foreground"
              >
                候选 {{ l.variantNo + 1 }}
              </span>
              <span class="df-log__title">{{ l.title }}</span>
              <span v-if="l.durationMs" class="text-xs text-muted-foreground">
                耗时 {{ fmtDuration(l.durationMs) }}
              </span>
              <span class="flex-1"></span>
              <a v-if="l.detail" class="text-xs" @click="toggle(keyOf(l, i))">
                {{ openDetail[keyOf(l, i)] ? '收起' : '详情' }}
              </a>
            </div>

            <!-- 细节：默认折叠（提示词/错误正文可能很长，不折叠会把时间线冲垮） -->
            <pre
              v-if="l.detail && openDetail[keyOf(l, i)]"
              class="df-log__detail"
              >{{ l.detail }}</pre
            >
          </div>
        </div>
      </div>
    </template>

    <Empty
      v-else-if="loading"
      :image="Empty.PRESENTED_IMAGE_SIMPLE"
      description="加载中…"
    />
    <Empty
      v-else
      :image="Empty.PRESENTED_IMAGE_SIMPLE"
      description="暂无交互日志"
    />
  </div>
</template>

<style scoped>
.df-log__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 420px;
  padding-left: 4px;
  overflow-y: auto;
}

/* 左侧竖线构成时间轴；节点圆点叠在其上 */
.df-log__item {
  position: relative;
  display: flex;
  gap: 10px;
  padding: 6px 0 6px 14px;
}

.df-log__item::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 4px;
  content: '';
  border-left: 1px solid hsl(var(--border));
}

.df-log__dot {
  position: absolute;
  top: 12px;
  left: 0;
  width: 9px;
  height: 9px;
  background: hsl(var(--primary));
  border: 1px solid hsl(var(--background));
  border-radius: 9999px;
}

/* 级别 → 节点颜色（错误醒目，普通事件不抢眼） */
.df-log__item--error .df-log__dot {
  background: hsl(var(--destructive));
}

.df-log__item--warn .df-log__dot {
  background: hsl(var(--warning));
}

.df-log__item--ok .df-log__dot {
  background: hsl(var(--success));
}

.df-log__body {
  flex: 1;
  min-width: 0;
}

.df-log__head {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  font-size: 13px;
}

.df-log__time {
  font-variant-numeric: tabular-nums;
}

.df-log__title {
  font-weight: 500;
}

.df-log__item--error .df-log__title {
  color: hsl(var(--destructive));
}

.df-log__detail {
  max-height: 240px;
  padding: 6px 8px;
  margin: 6px 0 0;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.5;
  word-break: break-all;
  white-space: pre-wrap;
  background: hsl(var(--muted) / 50%);
  border-radius: 4px;
}
</style>
