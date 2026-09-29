<script lang="ts" setup>
/**
 * C 区：生产线看板（设计文档 §C）
 *
 * 按**线路**（剧本/分镜/素材/视频/成片）分组，而不是按状态平铺 ——
 * 这是架构设计 §8「按线路分组」的原意，也对应编排器 TaskTypes 的实际形态。
 *
 * 数据源：Task/List 首屏 + WS task 事件增量（useTaskStream）。
 * 失败行可直接 Retry / Cancel，不必跳页（设计原则 §1「一行一动作」）。
 */
import { computed, onMounted, ref } from 'vue';

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

import type { TaskItem } from '#/api/core/dramafloow';

import { taskCancel, taskList, taskRetry } from '#/api/core/dramafloow';
import { TaskDrawer } from '#/components/TaskDrawer';
import {
  TASK_STATUS_TEXT,
  taskStatusColor,
  useTaskStream,
} from '#/composables/useTaskStream';

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
const acting = ref<number | null>(null);
/** 子任务详情抽屉：null = 关闭 */
const taskId = ref<null | number>(null);

async function load() {
  loading.value = true;
  try {
    // 一次拉取全部任务（面板是全局视图，量级可控），前端按线路/状态分组
    const res = await taskList({ page: 1, pageSize: 200 });
    tasks.value = res.items;
  } catch {
    // 拦截器已提示
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load();
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
      createdAt: prev?.createdAt ?? e.ts,
      updatedAt: e.ts,
    });
  }
  return [...map.values()];
});

/** 心跳超时：heartbeat_at 落后 > 2× 间隔（10s）→ 疑似卡住（崩溃恢复的早期信号） */
function isStuck(t: TaskItem | Record<string, any>): boolean {
  if (!['preparing', 'generating', 'collecting'].includes(t.status)) {
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
        (t) => !['done', 'approved', 'rejected', 'failed'].includes(t.status),
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
        ['preparing', 'generating', 'collecting'].includes(t.status),
      ).length,
      queued: ofLine.filter((t) => t.status === 'queued').length,
      pendingReview: ofLine.filter((t) => t.status === 'pending_review').length,
      failed: ofLine.filter((t) => t.status === 'failed').length,
    };
  }),
);

const lineLabel = (type: string): string =>
  LINES.find((l) => l.type === type)?.label ?? type;

async function retry(t: TaskItem | Record<string, any>) {
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

async function cancel(t: TaskItem | Record<string, any>) {
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

const columns = [
  { title: '线路', key: 'line', width: 90 },
  { title: '类型', dataIndex: 'type', key: 'type', width: 100 },
  { title: '版本', key: 'version', width: 80 },
  { title: '状态', key: 'status', width: 110 },
  { title: '进度', key: 'progress', width: 160 },
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
        <template v-if="column.key === 'line'">
          <Tag class="!mr-0">{{ lineLabel(record.type) }}</Tag>
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
            {{ TASK_STATUS_TEXT[record.status] ?? record.status }}
          </Tag>
        </template>

        <template v-else-if="column.key === 'progress'">
          <Progress
            :percent="record.progress ?? 0"
            :status="record.status === 'failed' ? 'exception' : 'normal'"
            size="small"
          />
        </template>

        <template v-else-if="column.key === 'message'">
          <Tooltip v-if="record.error" :title="record.error">
            <span class="text-xs">{{ record.error }}</span>
          </Tooltip>
          <span v-else-if="isStuck(record)" class="text-xs">
            疑似卡住（心跳超时）
          </span>
          <span v-else class="text-xs text-muted-foreground">
            <a v-if="record.dramaId" @click="openDrama(record.dramaId)">
              查看剧目
            </a>
          </span>
        </template>

        <template v-else-if="column.key === 'action'">
          <Space>
            <Button type="link" size="small" @click="taskId = record.id">
              详情
            </Button>
            <template v-if="record.status === 'failed'">
              <Button
                type="link"
                size="small"
                :loading="acting === record.id"
                @click="retry(record)"
              >
                重试
              </Button>
              <Button
                type="link"
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
                type="link"
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
