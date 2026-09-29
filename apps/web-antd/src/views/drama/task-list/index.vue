<script lang="ts" setup>
/**
 * AI 任务列表（独立页）
 *
 * 仪表盘的「生产线看板」是全局快照；这个页面是**任务维度的正经列表页**：
 *   - 顶部：正在跑什么（实时卡，带动态效果）+ 关键计数 + WS 连接状态
 *   - 筛选：关键词（剧目/具体任务）、线路、状态、排序、每页条数、自动刷新
 *   - 表格：剧目（含剧本版本）/ 线路 / 具体任务 / 状态 / 进度 / 已耗时 / tokens / 创建时间 / 操作
 *
 * 实时性：REST 首屏 + WS task 事件增量合并（useTaskStream），另可选自动刷新兜底。
 * 不写配对 toast（拦截器已弹）；失败行可就地重试/取消。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';

import { useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';

import {
  Badge,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
} from 'ant-design-vue';

import type { TaskItem, TaskTokenSummary } from '#/api/core/dramafloow';

import {
  taskCancel,
  taskList,
  taskRetry,
  taskStats,
} from '#/api/core/dramafloow';
import { RunningTaskList } from '#/components/RunningTaskList';
import {
  elapsedSecondsOf,
  formatElapsed,
  formatTokens,
} from '#/components/TaskDrawer/taskDisplay';
import { TaskDrawer } from '#/components/TaskDrawer';
import { TimeTag } from '#/components/TimeTag';
import {
  TASK_STATUS_TEXT,
  TASK_TYPE_TEXT,
  taskStatusColor,
  useTaskStream,
} from '#/composables/useTaskStream';

const router = useRouter();
const stream = useTaskStream();

// ─────────────────────────── 数据 ───────────────────────────

const tasks = ref<TaskItem[]>([]);
const tokensByTask = ref<Record<number, TaskTokenSummary>>({});
const counts = ref({ done: 0, failed: 0, queued: 0, running: 0, total: 0 });
const loading = ref(false);
/** 详情抽屉：null = 关闭 */
const taskId = ref<null | number>(null);
const acting = ref<null | number>(null);

// 筛选条件
const keyword = ref('');
const typeFilter = ref('all');
const statusFilter = ref('all');
const sortOrder = ref<'asc' | 'desc'>('desc');
const pageSize = ref(20);
/** 自动刷新 on/off（默认开；WS 断线时仍有数据更新兜底） */
const autoRefresh = ref('on');

const typeOptions = [
  { label: '全部线路', value: 'all' },
  { label: '剧本线（洗稿）', value: 'rewrite' },
  { label: '分镜线', value: 'storyboard' },
  { label: '素材提取', value: 'asset_extract' },
  { label: '素材线（出图）', value: 't2i' },
  { label: '视频线（片段）', value: 'i2v' },
  { label: '成片线（合并）', value: 'concat' },
];

const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '在跑', value: 'running' },
  { label: '排队中', value: 'queued' },
  { label: '待审核', value: 'pending_review' },
  { label: '失败', value: 'failed' },
  { label: '已完成', value: 'done' },
];

async function load() {
  loading.value = true;
  try {
    const [list, stats] = await Promise.all([
      // 拉足够多以便前端筛选（任务量级可控；后端 pageSize 上限宽松）
      taskList({ page: 1, pageSize: 500 }),
      taskStats(),
    ]);
    tasks.value = list.items;
    tokensByTask.value = stats.tokensByTask ?? {};
    counts.value = {
      total: stats.total,
      queued: stats.queued,
      running:
        (stats.byStatus?.preparing ?? 0) +
        (stats.byStatus?.generating ?? 0) +
        (stats.byStatus?.collecting ?? 0),
      done: stats.byStatus?.done ?? 0,
      failed: stats.byStatus?.failed ?? 0,
    };
  } catch {
    // 拦截器已提示
  } finally {
    loading.value = false;
  }
}

/** 每秒 tick：在跑任务的耗时走字 */
const nowTick = ref(Date.now());
let tickTimer: null | ReturnType<typeof setInterval> = null;
let refreshTimer: null | ReturnType<typeof setInterval> = null;

onMounted(() => {
  void load();
  tickTimer = setInterval(() => {
    nowTick.value = Date.now();
  }, 1000);
  refreshTimer = setInterval(() => {
    if (autoRefresh.value === 'on') void load();
  }, 30_000);
});
onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer);
  if (refreshTimer) clearInterval(refreshTimer);
});

// ─────────────────── WS 增量 + 筛选 + 统计 ───────────────────

/** WS 事件与 REST 首屏合并（同 id 以 WS 最新为准；剧目名/剧本版本等 REST 字段保留） */
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
      dramaName: prev?.dramaName,
      dramaCode: prev?.dramaCode,
      scriptVersion: prev?.scriptVersion,
      target: prev?.target,
      startedAt: prev?.startedAt ?? e.ts,
      finishedAt: prev?.finishedAt,
      createdAt: prev?.createdAt ?? e.ts,
      updatedAt: e.ts,
    });
  }
  return [...map.values()];
});

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  let list = merged.value;

  if (typeFilter.value !== 'all') {
    list = list.filter((t) => t.type === typeFilter.value);
  }
  switch (statusFilter.value) {
    case 'running': {
      list = list.filter((t) =>
        ['collecting', 'generating', 'preparing'].includes(t.status),
      );
      break;
    }
    case 'done': {
      list = list.filter((t) =>
        ['done', 'approved', 'rejected'].includes(t.status),
      );
      break;
    }
    case 'all': {
      break;
    }
    default: {
      list = list.filter((t) => t.status === statusFilter.value);
    }
  }
  if (kw) {
    list = list.filter((t) =>
      [t.dramaName, t.dramaCode, t.target, t.type, String(t.id)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(kw)),
    );
  }
  return list.toSorted((a, b) =>
    sortOrder.value === 'desc' ? b.id - a.id : a.id - b.id,
  );
});

/** 排队最久等待时长（给「排队中」指标卡一个可行动的数字） */
const oldestQueuedWait = computed(() => {
  const queued = merged.value.filter((t) => t.status === 'queued');
  if (queued.length === 0) return null;
  const oldest = queued.reduce((min, t) =>
    (elapsedSecondsOf(t, nowTick.value) ?? 0) >
    (elapsedSecondsOf(min, nowTick.value) ?? 0)
      ? t
      : min,
  );
  return elapsedSecondsOf(oldest, nowTick.value);
});

// ─────────────────────────── 展示辅助 ───────────────────────────

function elapsedText(t: TaskItem | Record<string, any>): string {
  const sec = elapsedSecondsOf(t, nowTick.value);
  return sec === null ? '-' : formatElapsed(0, sec);
}

function typeText(type?: string): string {
  if (!type) return '-';
  return TASK_TYPE_TEXT[type] ?? type;
}

function tokensOf(t: TaskItem | Record<string, any>): null | TaskTokenSummary {
  return tokensByTask.value[t.id] ?? null;
}

function tokensTip(t: TaskItem | Record<string, any>): string {
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

function isRunning(status: string): boolean {
  return ['collecting', 'generating', 'preparing'].includes(status);
}

function openDrama(dramaId?: number) {
  if (!dramaId) return;
  router.push({ name: 'DramaDetail', query: { id: dramaId } });
}

async function retry(t: TaskItem | Record<string, any>) {
  acting.value = t.id;
  try {
    await taskRetry(t.id);
    await load();
  } finally {
    acting.value = null;
  }
}

async function cancel(t: TaskItem | Record<string, any>) {
  acting.value = t.id;
  try {
    await taskCancel(t.id);
    await load();
  } finally {
    acting.value = null;
  }
}

const columns = [
  { title: '剧目 / 剧本', key: 'drama', width: 240 },
  { title: '线路', key: 'line', width: 120 },
  { title: '具体任务', key: 'target', ellipsis: true },
  { title: '状态', key: 'status', width: 110 },
  { title: '进度', key: 'progress', width: 150 },
  { title: '已耗时', key: 'elapsed', width: 110 },
  { title: 'tokens', key: 'tokens', width: 110 },
  { title: '创建时间', key: 'createdAt', width: 180 },
  { title: '操作', key: 'action', width: 160 },
];
</script>

<template>
  <Page
    class="df-page"
    description="AI 生产任务的实时列表：线路 / 剧目 / 剧本版本 / 具体任务 / 进度 / 耗时 / tokens"
    title="AI 任务列表"
  >
    <template #extra>
      <Space>
        <Badge
          :status="stream.connected.value ? 'success' : 'error'"
          :text="stream.connected.value ? '实时通道已连接' : '实时通道断开'"
        />
        <Button size="small" :loading="loading" @click="load">刷新</Button>
      </Space>
    </template>

    <!-- 正在跑（实时卡 + 动态效果） -->
    <Card class="mb-4" size="small" title="正在跑">
      <RunningTaskList
        :tasks="merged"
        :tokens-by-task="tokensByTask"
        @detail="(id) => (taskId = id)"
      />
    </Card>

    <!-- 关键计数 -->
    <Row :gutter="16" class="mb-4">
      <Col :span="5">
        <Card size="small">
          <Statistic title="任务总数" :value="counts.total" suffix="个" />
        </Card>
      </Col>
      <Col :span="5">
        <Card size="small">
          <Statistic title="正在跑" :value="counts.running" suffix="个" />
          <div class="mt-1 text-xs text-muted-foreground">
            排队 {{ counts.queued }} 个
            <template v-if="oldestQueuedWait !== null">
              · 最久已等 {{ formatElapsed(0, oldestQueuedWait) }}
            </template>
          </div>
        </Card>
      </Col>
      <Col :span="5">
        <Card size="small">
          <Statistic title="已完成" :value="counts.done" suffix="个" />
        </Card>
      </Col>
      <Col :span="5">
        <Card size="small">
          <Statistic title="失败" :value="counts.failed" suffix="个" />
          <div class="mt-1 text-xs text-muted-foreground">
            可在列表内直接重试
          </div>
        </Card>
      </Col>
      <Col :span="4">
        <Card size="small">
          <div class="mb-2 text-sm text-muted-foreground">自动刷新</div>
          <Segmented
            v-model:value="autoRefresh"
            :options="[
              { label: '开', value: 'on' },
              { label: '关', value: 'off' },
            ]"
          />
          <div class="mt-1 text-xs text-muted-foreground">每 30 秒</div>
        </Card>
      </Col>
    </Row>

    <!-- 筛选 + 表格 -->
    <Card size="small" title="任务明细">
      <div class="mb-3 flex flex-wrap items-center gap-3">
        <Input
          v-model:value="keyword"
          allow-clear
          placeholder="搜剧目 / 剧本编号 / 具体任务 / 任务号"
          style="width: 280px"
        />
        <Select
          v-model:value="typeFilter"
          :options="typeOptions"
          style="width: 190px"
        />
        <Segmented v-model:value="statusFilter" :options="statusOptions" />
        <Select
          v-model:value="sortOrder"
          :options="[
            { label: '最新在前', value: 'desc' },
            { label: '最早在前', value: 'asc' },
          ]"
          style="width: 130px"
        />
        <Select
          v-model:value="pageSize"
          :options="[
            { label: '每页 20', value: 20 },
            { label: '每页 50', value: 50 },
            { label: '每页 100', value: 100 },
          ]"
          style="width: 120px"
        />
        <span class="text-xs text-muted-foreground">
          共 {{ filtered.length }} 条
        </span>
      </div>

      <Table
        v-if="filtered.length > 0"
        :columns="columns"
        :data-source="filtered"
        :loading="loading"
        :pagination="{ pageSize, showSizeChanger: false, size: 'small' }"
        :row-class-name="
          (record: TaskItem) => (isRunning(record.status) ? 'df-row-live' : '')
        "
        row-key="id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <!-- 剧目 / 剧本版本 -->
          <template v-if="column.key === 'drama'">
            <div v-if="record.dramaId" class="flex flex-col">
              <a class="truncate" @click="openDrama(record.dramaId)">
                {{ record.dramaName || `剧目 #${record.dramaId}` }}
              </a>
              <span class="text-xs text-muted-foreground">
                {{ record.dramaCode || '-' }}
                <template v-if="record.scriptVersion">
                  · 剧本 v{{ record.scriptVersion }}
                </template>
              </span>
            </div>
            <span v-else class="text-muted-foreground">-</span>
          </template>

          <!-- 线路 -->
          <template v-else-if="column.key === 'line'">
            <Tag class="!mr-0" color="blue">{{ typeText(record.type) }}</Tag>
          </template>

          <!-- 具体任务 -->
          <template v-else-if="column.key === 'target'">
            <span class="text-xs">{{ record.target || '-' }}</span>
          </template>

          <!-- 状态 -->
          <template v-else-if="column.key === 'status'">
            <Tag :color="taskStatusColor(record.status)" class="!mr-0">
              <span
                v-if="isRunning(record.status)"
                class="df-live-dot mr-1 align-middle"
              />
              {{ TASK_STATUS_TEXT[record.status] ?? record.status }}
            </Tag>
          </template>

          <!-- 进度 -->
          <template v-else-if="column.key === 'progress'">
            <Progress
              :percent="record.progress ?? 0"
              :status="
                record.status === 'failed'
                  ? 'exception'
                  : isRunning(record.status)
                    ? 'active'
                    : (record.progress ?? 0) >= 100
                      ? 'success'
                      : 'normal'
              "
              size="small"
            />
          </template>

          <!-- 已耗时（在跑每秒走字） -->
          <template v-else-if="column.key === 'elapsed'">
            <span
              class="text-xs tabular-nums"
              :class="isRunning(record.status) ? 'df-live-num' : ''"
            >
              {{ elapsedText(record) }}
            </span>
            <Tooltip v-if="record.finishedAt" title="已结束：为实际总耗时">
              <span class="ml-1 text-xs text-muted-foreground">·</span>
            </Tooltip>
          </template>

          <!-- tokens -->
          <template v-else-if="column.key === 'tokens'">
            <Tooltip :title="tokensTip(record)">
              <span class="text-xs tabular-nums">
                <template v-if="tokensOf(record)">
                  {{ formatTokens(tokensOf(record)!.totalTokens) }}
                  <span
                    v-if="tokensOf(record)!.estimated"
                    class="text-muted-foreground"
                  >
                    （估）
                  </span>
                </template>
                <span v-else class="text-muted-foreground">-</span>
              </span>
            </Tooltip>
          </template>

          <!-- 创建时间 -->
          <template v-else-if="column.key === 'createdAt'">
            <TimeTag :time="record.createdAt" />
          </template>

          <!-- 操作 -->
          <template v-else-if="column.key === 'action'">
            <Space>
              <Button size="small" @click="taskId = record.id">详情</Button>
              <Button
                v-if="record.status === 'failed'"
                :loading="acting === record.id"
                size="small"
                type="primary"
                @click="retry(record)"
              >
                重试
              </Button>
              <Button
                v-if="['failed', 'queued', 'preparing'].includes(record.status)"
                :loading="acting === record.id"
                danger
                size="small"
                @click="cancel(record)"
              >
                取消
              </Button>
            </Space>
          </template>
        </template>
      </Table>

      <Empty v-else description="没有符合筛选条件的任务" />
    </Card>

    <!-- 任务详情抽屉（查看 / 重新生成 / 取消 / 删除 / 手动改） -->
    <TaskDrawer :task-id="taskId" @changed="load" @close="taskId = null" />
  </Page>
</template>
