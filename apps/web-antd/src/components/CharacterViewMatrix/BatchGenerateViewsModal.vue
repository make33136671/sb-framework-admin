<script lang="ts" setup>
import type { BatchItemState, ViewToGenerate } from './batchPlan';

import type {
  CharacterMatrix,
  CharacterMatrixRow,
} from '#/api/core/dramafloow';

/**
 * BatchGenerateViewsModal —— 「一键生成 7 图」（用户 2026-10-04 要求）
 *
 * > 「角色视图 一个角色名旁边 右侧 加一个 一键生成 7图（旁边加一个 checked 自动定稿）
 * >  自动按照全默认参数 但是每个视图生成 1 张就好 把 7 张图 补齐」
 *
 * ## 三条必须守住的语义
 *
 * 1. **补齐 ≠ 重出**：已定稿的视图**跳过**（`planViewsToGenerate`），
 *    否则点一次会把用户已选好的定稿图覆盖掉 —— 且不会报错。
 *
 * 2. **全默认参数**：每视图 1 张；尺寸走后端解析的视图默认；线路不指定（自动）。
 *
 * 3. **自动定稿是可选项，且必须等出图**：
 *    勾选后，每个视图**等它的任务产出候选**，再取第 1 张 `Approve` 定稿。
 *    没等到候选就不定稿（不能"定稿一张不存在的图"）。
 *
 * ⚠️ 定稿走的是 `assetApprove(candidateId)`（该需求内部选图），
 * 与矩阵格子的 `assetSetViewImage`（跨视图搬运）语义不同 ——
 * 批量生成的图**本来就是本视图的候选**，用 Approve 才对。
 */
import { computed, ref } from 'vue';

import {
  Alert,
  Button,
  Empty,
  Modal,
  Progress,
  Space,
  Table,
  Tag,
} from 'ant-design-vue';

import { taskBatchSubmitViews } from '#/api/core/dramafloow';

import { planViewsToGenerate } from './batchPlan';

const props = defineProps<{
  /** 自动定稿勾选态（由父组件持有，勾选后记住用户偏好） */
  autoFinalize: boolean;
  /** 剧目 id（提交任务用；矩阵行本身不带它） */
  dramaId: number;
  /** 矩阵里的一行（一个角色）；null = 关闭 */
  row: CharacterMatrixRow | null;
  /** 列定义（含 spec / 反向 / 尺寸）—— 格子本身不带这些，必须从这里取 */
  viewColumns: CharacterMatrix['viewColumns'];
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  /** 全部完成后通知父组件刷新矩阵 */
  (e: 'finished'): void;
  /**
   * 查看某个已下发任务的执行窗口。
   *
   * ⚠️ 批量**不自动弹**执行窗口：一次产生多达 7 条任务，弹 7 层窗口是灾难。
   * 改为每行一个「查看」，让用户挑要看的那条 —— 这与单视图「提交完直接弹」
   * 的诉求并不冲突：那里只有一条任务，弹出即所见。
   */
  (e: 'viewTask', taskId: number): void;
}>();

const open = computed(() => props.row !== null);

const plan = computed(() => {
  if (!props.row)
    return { skippedFilled: 0, skippedNoRequirement: 0, todo: [] };
  return planViewsToGenerate(props.row, props.viewColumns);
});

const items = ref<BatchItemState[]>([]);
const running = ref(false);
const done = ref(false);
const failures = ref<{ label: string; reason: string }[]>([]);

/**
 * 本次运行**锁定**的待生成清单（`run()` 开跑时快照）。
 *
 * 为什么不在运行中直接用响应式的 `plan`：运行期间父组件会因 `@finished`
 * 或自身刷新而重拉矩阵，`props.row` 一换 `plan.todo` 就可能变短 ——
 * 而循环正按旧下标取 `items[i]`，两边错位会把状态写到**别的视图行**上
 * （界面显示"某视图已定稿"，实际定的是另一个视图；全程无报错）。
 * 故开跑前快照一次，运行期间只认这份。
 */
const runQueue = ref<ViewToGenerate[]>([]);

/** 实际要展示/遍历的清单：运行中与结束后用锁定快照，之前用实时计划 */
const activeTodo = computed(() =>
  running.value || done.value ? runQueue.value : plan.value.todo,
);

const percent = computed(() => {
  const total = items.value.length;
  if (total === 0) return 0;
  return Math.round(
    (items.value.filter((i) => !['pending', 'submitted'].includes(i.status))
      .length /
      total) *
      100,
  );
});

/**
 * 下发这一批视图（用户 2026-10-06：「点击一键7视图 实际上是加入任务列队」）。
 *
 * ⚠️ **一次 API 调用**，不再是浏览器 for 循环。
 *
 * 用户实测报障：
 * > 「点击 一键生成7视图 是不是 关掉页面 任务就结束了 如果生成了2张
 * >   在关掉页面后 剩下的 5张图 不会在生成了」
 *
 * 确实如此 —— 原来的循环一旦因关页面/切标签/睡眠而终止，
 * 后面的视图任务**根本没被创建**（不是创建了没执行），且不报错。
 *
 * 现在：请求返回时所有任务已入库，由后端按队列顺序推进，页面关不关都不影响。
 *
 * 两阶段（prompt_gen + t2i）由**后端**建立，故前端不再关心顺序 ——
 * 后端按分区分段分配 sort_no，天然形成先提示词、后出图。
 */
async function run() {
  const row = props.row;
  if (!row) return;
  running.value = true;
  done.value = false;
  failures.value = [];
  // ★ 快照待生成清单：运行期间不用响应式的 plan（见 runQueue 注释）
  runQueue.value = [...plan.value.todo];
  items.value = runQueue.value.map((v) => ({
    label: v.label,
    status: 'pending' as const,
    suffix: v.suffix,
  }));

  if (runQueue.value.length === 0) {
    running.value = false;
    done.value = true;
    emit('finished');
    return;
  }

  try {
    const res = await taskBatchSubmitViews({
      autoFinalize: props.autoFinalize,
      candidateCount: 1,
      requirementIds: runQueue.value.map((v) => v.requirementId),
    });

    // 按需求 id 回填每个视图的状态
    const byReq = new Map(res.created.map((c) => [c.requirementId, c]));
    const skipByReq = new Map(res.skipped.map((s) => [s.requirementId, s.why]));

    runQueue.value.forEach((view, i) => {
      const item = items.value[i];
      if (!item) return;
      const hit = byReq.get(view.requirementId);
      if (hit) {
        // 展示 t2i 任务号（用户关心的是哪张图，提示词任务是内部阶段）
        item.taskId = hit.t2iTaskId;
        item.status = 'submitted';
        item.message = '已加入队列（提示词 → 出图）';
      } else {
        const why = skipByReq.get(view.requirementId) ?? '未下发';
        item.status = 'failed';
        item.message = why;
        failures.value.push({ label: view.label, reason: why });
      }
    });
  } catch (error: any) {
    const reason = error?.message || '下发失败';
    items.value.forEach((item) => {
      item.status = 'failed';
      item.message = reason;
    });
    failures.value = runQueue.value.map((v) => ({ label: v.label, reason }));
  }

  running.value = false;
  done.value = true;
  emit('finished');
}

const columns = [
  { title: '视图', dataIndex: 'label', key: 'label', width: 170 },
  { title: '状态', key: 'status', width: 100 },
  { title: '任务', key: 'task', width: 80 },
  { title: '说明', dataIndex: 'message', key: 'message', ellipsis: true },
  // 逐个任务打开执行窗口：批量会产生多条任务，用"查看"而不是自动弹 7 个窗口
  { title: '操作', key: 'action', width: 80 },
];

function statusColor(s: string): string {
  if (s === 'approved') return 'success';
  if (s === 'failed') return 'error';
  if (s === 'candidate-ready') return 'warning';
  if (s === 'submitted') return 'processing';
  return 'default';
}

function statusText(s: string): string {
  if (s === 'approved') return '已定稿';
  if (s === 'candidate-ready') return '待定稿';
  if (s === 'failed') return '失败';
  if (s === 'submitted') return '生成中';
  return '等待中';
}
</script>

<template>
  <Modal
    :footer="null"
    :open="open"
    :title="row ? `一键生成 7 图 —— ${row.name}` : '一键生成 7 图'"
    :width="720"
    @cancel="running ? undefined : emit('close')"
  >
    <template v-if="row">
      <Alert class="mb-3" show-icon type="info">
        <template #message>
          按全默认参数生成：每个视图 1 张，尺寸取该视图的系统默认，线路自动
        </template>
        <template #description>
          <span class="text-xs">
            <template v-if="plan.skippedFilled > 0">
              已跳过
              {{ plan.skippedFilled }} 个已定稿的视图（不会覆盖你选好的图）；
            </template>
            <template v-if="plan.skippedNoRequirement > 0">
              有
              {{ plan.skippedNoRequirement }}
              个视图还没建档（请先点「补齐角色视图」）；
            </template>
            <template v-if="autoFinalize">
              已勾选<b>自动定稿</b>：每个视图出图后自动取第 1 张定为最终选择。
            </template>
            <template v-else> 未勾选自动定稿：出图后仍需你人工挑选。 </template>
          </span>
        </template>
      </Alert>

      <template v-if="activeTodo.length === 0">
        <Empty description="该角色的 7 个视图都已有定稿图，无需补齐" />
      </template>

      <template v-else>
        <Progress
          v-if="running || done"
          class="mb-3"
          :percent="percent"
          :status="failures.length > 0 ? 'exception' : 'active'"
        />

        <Table
          :columns="columns"
          :data-source="items"
          :pagination="false"
          :row-key="(r: BatchItemState) => r.suffix"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'status'">
              <Tag :color="statusColor(record.status)" class="!mr-0">
                {{ statusText(record.status) }}
              </Tag>
            </template>
            <template v-else-if="column.key === 'task'">
              <span v-if="record.taskId" class="text-xs"
                >#{{ record.taskId }}</span
              >
              <span v-else class="text-xs text-muted-foreground">-</span>
            </template>
            <template v-else-if="column.key === 'action'">
              <Button
                v-if="record.taskId"
                size="small"
                @click="emit('viewTask', record.taskId)"
              >
                查看
              </Button>
              <span v-else class="text-xs text-muted-foreground">-</span>
            </template>
          </template>
        </Table>

        <Alert
          v-if="failures.length > 0"
          class="mt-3"
          show-icon
          type="error"
          :message="`${failures.length} 个视图下发/生成失败`"
        >
          <template #description>
            <ul class="m-0 pl-4 text-xs">
              <li v-for="f in failures" :key="f.label">
                {{ f.label }}：{{ f.reason }}
              </li>
            </ul>
          </template>
        </Alert>
      </template>

      <div class="mt-4 flex justify-end">
        <Space>
          <Button :disabled="running" @click="emit('close')">
            {{ done ? '关闭' : '取消' }}
          </Button>
          <Button
            v-if="activeTodo.length > 0 && !done"
            :loading="running"
            type="primary"
            @click="run"
          >
            {{ running ? '生成中…' : `开始生成 ${activeTodo.length} 张` }}
          </Button>
          <Button v-else-if="done" type="primary" @click="emit('close')">
            完成
          </Button>
        </Space>
      </div>
    </template>
  </Modal>
</template>
