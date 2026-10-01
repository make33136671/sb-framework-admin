<script lang="ts" setup>
/**
 * RunningTaskList —— 「正在跑」实时任务卡（仪表盘看板 + AI 任务列表页共用）
 *
 * 每张卡回答用户的全部问题：
 *   用哪条线路 / 哪个剧目 / 哪版剧本 / 具体在干什么 / 进度 / 已耗时 / token / 创建时间 / 状态。
 *
 * 动态效果（都走 CSS animation，不硬编码颜色；`prefers-reduced-motion` 下自动关闭）：
 *   - 状态点脉冲 + 呼吸光环：一眼看出「在动」
 *   - 卡片流光扫过：说明数据是活的（WS 在推）
 *   - 进度条条纹滚动 + 耗时数字每秒走字
 *
 * 只负责展示；数据来自父组件（REST 首屏 + WS 增量合并后的列表）。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { Button, Empty, Progress, Tag, Tooltip } from 'ant-design-vue';

import type { TaskItem, TaskTokenSummary } from '#/api/core/dramafloow';

import {
  elapsedSecondsOf,
  formatElapsed,
  formatTokens,
  isFinishedStatus,
} from '#/components/TaskDrawer/taskDisplay';
import { TaskRouteBadge } from '#/components/TaskRouteBadge';
import { TimeTag } from '#/components/TimeTag';
import {
  TASK_STATUS_TEXT,
  TASK_TYPE_TEXT,
  taskStatusColor,
} from '#/composables/useTaskStream';

const props = withDefaults(
  defineProps<{
    /** 任务列表（已含 WS 增量；组件内部自行过滤未终态） */
    tasks: TaskItem[];
    /** 紧凑模式（仪表盘用）：不显示进度条，摘要压成一行 */
    compact?: boolean;
    /** token 汇总：taskId → 汇总 */
    tokensByTask?: Record<number, TaskTokenSummary>;
  }>(),
  {
    compact: false,
    tokensByTask: () => ({}),
  },
);

const emit = defineEmits<{
  (e: 'detail', taskId: number): void;
}>();

const router = useRouter();

/** 每秒 tick：耗时走字（终态任务不再变化） */
const nowTick = ref(Date.now());
let tickTimer: null | ReturnType<typeof setInterval> = null;
onMounted(() => {
  tickTimer = setInterval(() => {
    nowTick.value = Date.now();
  }, 1000);
});
onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer);
});

/** 在跑（含排队）：generating/collecting 优先，其次 preparing，最后 queued */
const running = computed(() =>
  props.tasks
    .filter((t) => !isFinishedStatus(t.status))
    .toSorted((a, b) => {
      const rank = (s: string) =>
        ['generating', 'collecting'].includes(s)
          ? 0
          : s === 'preparing'
            ? 1
            : 2;
      return rank(a.status) - rank(b.status) || b.id - a.id;
    }),
);

/** 合计已耗时（各任务耗时相加；同一时刻通常只有一个任务在跑） */
const totalElapsed = computed(() =>
  running.value.reduce(
    (sum, t) => sum + (elapsedSecondsOf(t, nowTick.value) ?? 0),
    0,
  ),
);

function elapsedText(t: TaskItem): string {
  const sec = elapsedSecondsOf(t, nowTick.value);
  return sec === null ? '-' : formatElapsed(0, sec);
}

function tokensOf(t: TaskItem): null | TaskTokenSummary {
  return props.tokensByTask[t.id] ?? null;
}

function tokensTip(t: TaskItem): string {
  const s = tokensOf(t);
  if (!s) return '暂无 LLM 调用记录（该线路不消耗 token，或数据未归集）';
  const lines = [
    `共 ${s.calls} 次 LLM 调用`,
    `输入 ${s.promptTokens.toLocaleString('zh-CN')} tokens`,
    `输出 ${s.completionTokens.toLocaleString('zh-CN')} tokens`,
  ];
  if (s.estimated) lines.push('含估算值（网关未返回 usage）');
  return lines.join('\n');
}

/** 正在干活（区别于「排队中」）：脉冲点 + 流光只给这些状态 */
function isActivelyRunning(status: string): boolean {
  return ['collecting', 'generating', 'preparing'].includes(status);
}

function openDrama(dramaId?: number) {
  if (!dramaId) return;
  router.push({ name: 'DramaDetail', query: { id: dramaId } });
}
</script>

<template>
  <div>
    <template v-if="running.length > 0">
      <div class="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span class="df-live-dot" />
        <span class="font-medium">正在跑 {{ running.length }} 个任务</span>
        <span class="text-muted-foreground">
          合计已耗时 {{ formatElapsed(0, totalElapsed) }}
        </span>
      </div>

      <div class="flex flex-col gap-2">
        <div
          v-for="t in running"
          :key="t.id"
          class="df-live-card relative overflow-hidden rounded-md border border-border px-3 py-2"
          :class="isActivelyRunning(t.status) ? 'df-live-card-active' : ''"
        >
          <!-- 第一行：状态 · 谁 · 什么线路 · 具体在干什么 -->
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <Tag :color="taskStatusColor(t.status)" class="!mr-0">
              {{ TASK_STATUS_TEXT[t.status] ?? t.status }}
            </Tag>
            <a
              v-if="t.dramaId"
              class="font-medium"
              @click="openDrama(t.dramaId)"
            >
              {{ t.dramaName || `剧目 #${t.dramaId}` }}
            </a>
            <span v-else class="text-muted-foreground">（无剧目）</span>
            <Tag class="!mr-0" color="blue">
              {{ TASK_TYPE_TEXT[t.type] ?? t.type }}
            </Tag>
            <span v-if="t.scriptVersion" class="text-xs text-muted-foreground">
              剧本 v{{ t.scriptVersion }}
            </span>
            <span v-if="t.target" class="text-xs">{{ t.target }}</span>
            <!-- 成本感知调度 §6.4：路由徽标 + 上云原因 + 金额 -->
            <TaskRouteBadge
              :cost-yuan="t.costYuan"
              :off-peak="t.offPeak"
              :reason="t.routeReason"
              :reason-text="t.routeReasonText"
              :route="t.route"
            />
            <span class="flex-1" />
            <span class="text-xs text-muted-foreground">#{{ t.id }}</span>
            <Button size="small" @click="emit('detail', t.id)">详情</Button>
          </div>

          <!-- 第二行：进度 · 耗时 · token · 创建时间 -->
          <div
            v-if="!compact"
            class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs"
          >
            <div class="min-w-[160px] flex-1">
              <Progress
                :percent="t.progress ?? 0"
                :status="
                  t.status === 'failed'
                    ? 'exception'
                    : (t.progress ?? 0) >= 100
                      ? 'success'
                      : 'active'
                "
                size="small"
              />
            </div>
            <span class="tabular-nums">
              已耗时
              <span :class="isActivelyRunning(t.status) ? 'df-live-num' : ''">{{
                elapsedText(t)
              }}</span>
            </span>
            <Tooltip :title="tokensTip(t)">
              <span class="tabular-nums">
                tokens
                <template v-if="tokensOf(t)">
                  <span class="df-live-num">{{
                    formatTokens(tokensOf(t)!.totalTokens)
                  }}</span>
                  <span class="text-muted-foreground">
                    （{{ tokensOf(t)!.calls }} 次调用{{
                      tokensOf(t)!.estimated ? '，含估算' : ''
                    }}）
                  </span>
                </template>
                <span v-else class="text-muted-foreground">-</span>
              </span>
            </Tooltip>
            <span class="flex items-center gap-1 text-muted-foreground">
              创建 <TimeTag :time="t.createdAt" />
            </span>
          </div>

          <!-- 紧凑模式（仪表盘）：摘要压成一行 -->
          <div
            v-else
            class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
          >
            <span class="tabular-nums">已耗时 {{ elapsedText(t) }}</span>
            <span class="tabular-nums">进度 {{ t.progress ?? 0 }}%</span>
            <span v-if="tokensOf(t)" class="tabular-nums">
              {{ formatTokens(tokensOf(t)!.totalTokens) }} tokens
            </span>
            <span class="flex items-center gap-1">
              创建 <TimeTag :time="t.createdAt" />
            </span>
          </div>
        </div>
      </div>
    </template>

    <Empty
      v-else
      :image="Empty.PRESENTED_IMAGE_SIMPLE"
      description="当前没有在跑的任务"
    />
  </div>
</template>
