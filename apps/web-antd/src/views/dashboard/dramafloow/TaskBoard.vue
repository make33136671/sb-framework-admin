<script lang="ts" setup>
import type { TaskItem, TaskTokenSummary } from '#/api/core/dramafloow';

/**
 * C 区：生产线看板（设计文档 §C）
 *
 * 按**线路**（剧本/分镜/素材/视频/成片）分组，而不是按状态平铺 ——
 * 这是架构设计 §8「按线路分组」的原意，也对应编排器 TaskTypes 的实际形态。
 *
 * 数据源：Task/List 首屏 + WS task 事件增量（useTaskStream）+ Task/Stats（token 汇总）。
 * 每行回答「哪个剧目、在跑什么、跑了多久、烧了多少 token」；
 * 失败行可直接 Retry / Cancel，不必跳页（设计原则 §1「一行一动作」）。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import {
  Button,
  Card,
  Empty,
  Progress,
  Segmented,
  Space,
  Table,
  Tag,
  Tooltip,
} from 'ant-design-vue';

import {
  taskCancel,
  taskList,
  taskRetry,
  taskStats,
} from '#/api/core/dramafloow';
import { RunningTaskList } from '#/components/RunningTaskList';
import { TaskDrawer } from '#/components/TaskDrawer';
import {
  elapsedSecondsOf,
  formatElapsed,
  formatTokens,
} from '#/components/TaskDrawer/taskDisplay';
import { enumText } from '#/composables/useEnumText';
import { taskStatusColor, useTaskStream } from '#/composables/useTaskStream';
import { wallNow } from '#/utils/wallTime';

const router = useRouter();
const stream = useTaskStream();

/** 线路定义：与编排器 TaskTypes 一一对应 */
const LINES = [
  { key: 'rewrite', label: '剧本线', type: 'rewrite' },
  { key: 'storyboard', label: '分镜线', type: 'storyboard' },
  { key: 't2i', label: '素材线', type: 't2i' },
  { key: 'i2v', label: '视频线', type: 'i2v' },
  { key: 'concat', label: '成片线', type: 'concat' },
] as const;

const tasks = ref<TaskItem[]>([]);
const loading = ref(false);
const lineFilter = ref<string>('all');
const viewFilter = ref<string>('active');
const acting = ref<null | number>(null);
/** 子任务详情抽屉：null = 关闭 */
const taskId = ref<null | number>(null);

/** 未终态任务的 token 汇总：taskId → 汇总（Task/Stats 带出，避免看板 N+1） */
const tokensByTask = ref<Record<number, TaskTokenSummary>>({});

/** 每秒 tick：让在飞任务的「已耗时」实时走字（不再推进的任务会自行冻结）
 *  ⚠️ 必须用 `wallNow()`：后端时间戳是项目时区墙上时间，混用绝对时刻会偏一个时区。 */
const nowTick = ref(wallNow());
let tickTimer: null | ReturnType<typeof setInterval> = null;

async function load() {
  loading.value = true;
  try {
    // 一次拉取全部任务（面板是全局视图，量级可控），前端按线路/状态分组
    const [list, stats] = await Promise.all([
      taskList({ page: 1, pageSize: 200 }),
      taskStats(),
    ]);
    tasks.value = list.items;
    tokensByTask.value = stats.tokensByTask ?? {};
  } catch {
    // 拦截器已提示
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load();
  tickTimer = setInterval(() => {
    nowTick.value = wallNow();
  }, 1000);
});
onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer);
});

/** WS 增量与 REST 首屏合并：同一 task id 以 WS 最新事件为准 */
const merged = computed<TaskItem[]>(() => {
  const map = new Map<number, TaskItem>();
  for (const t of tasks.value) map.set(t.id, t);
  for (const e of Object.values(stream.taskMap.value)) {
    const prev = map.get(e.id);
    map.set(e.id, {
      ...(prev ?? ({} as TaskItem)),
      id: e.id,
      type: e.type,
      dramaId: e.dramaId,
      status: e.status,
      progress: e.progress,
      version: e.version,
      currentVariant: e.currentVariant,
      error: e.error ?? prev?.error,
      refEntityType: e.refEntityType ?? prev?.refEntityType,
      refEntityId: e.refEntityId ?? prev?.refEntityId,
      // 剧目名/开始时间/结束时间只有 REST 带得回来：WS 事件缺这些字段时保留首屏值
      dramaName: prev?.dramaName,
      dramaCode: prev?.dramaCode,
      startedAt: prev?.startedAt ?? e.ts,
      finishedAt: prev?.finishedAt,
      createdAt: prev?.createdAt ?? e.ts,
      updatedAt: e.ts,
    });
  }
  return [...map.values()];
});

/** 心跳超时：heartbeat_at 落后 > 2× 间隔（10s）→ 疑似卡住（崩溃恢复的早期信号） */
function isStuck(t: Record<string, any> | TaskItem): boolean {
  if (!['collecting', 'generating', 'preparing'].includes(t.status)) {
    return false;
  }
  const hb = t.heartbeatAt ?? t.updatedAt;
  if (!hb) return false;
  return Date.now() - new Date(hb).getTime() > 20_000;
}

const filtered = computed(() => {
  let list = merged.value;
  if (lineFilter.value !== 'all') {
    list = list.filter((t) => t.type === lineFilter.value);
  }
  switch (viewFilter.value) {
    case 'active': {
      list = list.filter(
        (t) => !['approved', 'done', 'failed', 'rejected'].includes(t.status),
      );
      break;
    }
    case 'failed': {
      list = list.filter((t) => t.status === 'failed');
      break;
    }
    case 'pending': {
      list = list.filter((t) => t.status === 'pending_review');
      break;
    }
    default: {
      break;
    }
  }
  return list;
});

/** 按线路统计（用于分组标题与「全部」视图的线路概览） */
const lineStats = computed(() =>
  LINES.map((l) => {
    const ofLine = merged.value.filter((t) => t.type === l.type);
    return {
      ...l,
      total: ofLine.length,
      inFlight: ofLine.filter((t) =>
        ['collecting', 'generating', 'preparing'].includes(t.status),
      ).length,
      queued: ofLine.filter((t) => t.status === 'queued').length,
      pendingReview: ofLine.filter((t) => t.status === 'pending_review').length,
      failed: ofLine.filter((t) => t.status === 'failed').length,
    };
  }),
);

const lineLabel = (type: string): string =>
  LINES.find((l) => l.type === type)?.label ?? type;

async function retry(t: Record<string, any> | TaskItem) {
  acting.value = t.id;
  try {
    await taskRetry(t.id);
    await load();
  } catch {
    // 拦截器已提示
  } finally {
    acting.value = null;
  }
}

async function cancel(t: Record<string, any> | TaskItem) {
  acting.value = t.id;
  try {
    await taskCancel(t.id);
    await load();
  } catch {
    // 拦截器已提示
  } finally {
    acting.value = null;
  }
}

function openDrama(dramaId: number) {
  if (!dramaId) return;
  router.push({ name: 'DramaDetail', query: { id: dramaId } });
}

/** 该任务已耗时：在飞走字，结束固定（后端不返回 total，前端按 started_at/finished_at 算） */
function elapsedText(t: Record<string, any> | TaskItem): string {
  const sec = elapsedSecondsOf(t, nowTick.value);
  return sec === null ? '-' : formatElapsed(0, sec);
}

/** 任务类型中文名（不显示裸英文） */
function typeText(type?: string): string {
  return enumText.taskType(type);
}

/** 该任务的 token 汇总（看板只统计未终态任务，见 Task/Stats） */
function tokensOf(t: Record<string, any> | TaskItem): null | TaskTokenSummary {
  return tokensByTask.value[t.id] ?? null;
}

function tokensTip(t: Record<string, any> | TaskItem): string {
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

const columns = [
  { title: '剧目', key: 'drama', width: 190 },
  { title: '线路', key: 'line', width: 84 },
  { title: '在跑什么', key: 'type', width: 130 },
  { title: '版本', key: 'version', width: 84 },
  { title: '状态', key: 'status', width: 104 },
  { title: '进度', key: 'progress', width: 140 },
  { title: '已耗时', key: 'elapsed', width: 110 },
  { title: 'tokens', key: 'tokens', width: 100 },
  { title: '信息', key: 'message', ellipsis: true },
  { title: '操作', key: 'action', width: 150 },
];

const viewOptions = [
  { label: '进行中', value: 'active' },
  { label: '待审', value: 'pending' },
  { label: '失败', value: 'failed' },
  { label: '全部', value: 'all' },
];
</script>

<template>
  <Card size="small" title="生产线看板">
    <template #extra>
      <Space>
        <Segmented v-model:value="viewFilter" :options="viewOptions" />
        <Button size="small" :loading="loading" @click="load">刷新</Button>
      </Space>
    </template>

    <!-- 线路概览（点击筛选） -->
    <div class="mb-3 flex flex-wrap gap-2">
      <div
        class="cursor-pointer rounded-md border px-3 py-2 text-xs transition-all"
        :class="
          lineFilter === 'all'
            ? 'border-primary ring-1 ring-primary/40'
            : 'border-border hover:border-primary/50'
        "
        @click="lineFilter = 'all'"
      >
        <div class="font-medium">全部线路</div>
        <div class="text-muted-foreground">
          在飞
          {{ lineStats.reduce((s, l) => s + l.inFlight, 0) }} · 排队
          {{ lineStats.reduce((s, l) => s + l.queued, 0) }} · 待审
          {{ lineStats.reduce((s, l) => s + l.pendingReview, 0) }} · 失败
          {{ lineStats.reduce((s, l) => s + l.failed, 0) }}
        </div>
      </div>

      <div
        v-for="l in lineStats"
        :key="l.key"
        class="cursor-pointer rounded-md border px-3 py-2 text-xs transition-all"
        :class="
          lineFilter === l.type
            ? 'border-primary ring-1 ring-primary/40'
            : 'border-border hover:border-primary/50'
        "
        @click="lineFilter = l.type"
      >
        <div class="font-medium">{{ l.label }}</div>
        <div class="text-muted-foreground">
          在飞 {{ l.inFlight }} · 排队 {{ l.queued }} · 待审
          {{ l.pendingReview }}
          <span v-if="l.failed > 0"> · 失败 {{ l.failed }}</span>
        </div>
      </div>
    </div>

    <!-- 正在跑什么：复用 RunningTaskList（与「AI 任务列表」页同一套实时卡，逻辑不漂移） -->
    <div class="mb-3">
      <RunningTaskList
        compact
        :tasks="merged"
        :tokens-by-task="tokensByTask"
        @detail="(id) => (taskId = id)"
      />
      <div class="mt-1 text-right text-xs text-muted-foreground">
        完整列表见「AI 任务列表」页
      </div>
    </div>

    <Table
      v-if="filtered.length > 0"
      :columns="columns"
      :data-source="filtered"
      :loading="loading"
      :pagination="{ pageSize: 10, size: 'small' }"
      row-key="id"
      size="small"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'drama'">
          <div v-if="record.dramaId" class="flex flex-col">
            <a class="truncate" @click="openDrama(record.dramaId)">
              {{ record.dramaName || `剧目 #${record.dramaId}` }}
            </a>
            <span v-if="record.dramaCode" class="text-xs text-muted-foreground">
              {{ record.dramaCode }}
            </span>
          </div>
          <span v-else class="text-muted-foreground">-</span>
        </template>

        <template v-else-if="column.key === 'line'">
          <Tag class="!mr-0">{{ lineLabel(record.type) }}</Tag>
        </template>

        <template v-else-if="column.key === 'type'">
          <span class="text-xs">{{ typeText(record.type) }}</span>
        </template>

        <template v-else-if="column.key === 'version'">
          <span class="text-xs">
            v{{ record.version }}
            <template v-if="record.currentVariant > 0">
              · 候选 {{ record.currentVariant }}
            </template>
          </span>
        </template>

        <template v-else-if="column.key === 'status'">
          <Tag :color="taskStatusColor(record.status)" class="!mr-0">
            {{ enumText.taskStatus(record.status) }}
          </Tag>
        </template>

        <template v-else-if="column.key === 'progress'">
          <Progress
            :percent="record.progress ?? 0"
            :status="record.status === 'failed' ? 'exception' : 'normal'"
            size="small"
          />
        </template>

        <template v-else-if="column.key === 'elapsed'">
          <span class="text-xs tabular-nums" :title="elapsedText(record)">
            {{ elapsedText(record) }}
          </span>
        </template>

        <template v-else-if="column.key === 'tokens'">
          <Tooltip :title="tokensTip(record)">
            <span class="text-xs tabular-nums">
              <template v-if="tokensOf(record)">
                {{ formatTokens(tokensOf(record)!.totalTokens) }}
                <span
                  v-if="tokensOf(record)!.estimated"
                  class="text-muted-foreground"
                  >（估）</span
                >
              </template>
              <span v-else class="text-muted-foreground">-</span>
            </span>
          </Tooltip>
        </template>

        <template v-else-if="column.key === 'message'">
          <Tooltip v-if="record.error" :title="record.error">
            <span class="text-xs">{{ record.error }}</span>
          </Tooltip>
          <span v-else-if="isStuck(record)" class="text-xs">
            疑似卡住（心跳超时）
          </span>
          <span
            v-else-if="record.refEntityType"
            class="text-xs text-muted-foreground"
          >
            {{ record.refEntityType }} #{{ record.refEntityId ?? '-' }}
          </span>
          <span v-else class="text-xs text-muted-foreground">-</span>
        </template>

        <template v-else-if="column.key === 'action'">
          <Space>
            <Button size="small" @click="taskId = record.id">详情</Button>
            <template v-if="record.status === 'failed'">
              <Button
                size="small"
                type="primary"
                :loading="acting === record.id"
                @click="retry(record)"
              >
                重试
              </Button>
              <Button
                size="small"
                danger
                :loading="acting === record.id"
                @click="cancel(record)"
              >
                取消
              </Button>
            </template>
            <template
              v-else-if="['queued', 'preparing'].includes(record.status)"
            >
              <Button
                size="small"
                danger
                :loading="acting === record.id"
                @click="cancel(record)"
              >
                取消
              </Button>
            </template>
          </Space>
        </template>
      </template>
    </Table>

    <Empty v-else description="当前筛选下暂无任务" />

    <!-- 子任务详情抽屉（查看 / 重新生成 / 取消 / 删除 / 手动修改） -->
    <TaskDrawer :task-id="taskId" @close="taskId = null" @changed="load" />
  </Card>
</template>
