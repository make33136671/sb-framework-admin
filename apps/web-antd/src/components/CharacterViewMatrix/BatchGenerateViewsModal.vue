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

import {
  assetApprove,
  assetCandidateList,
  taskGet,
  taskSubmit,
} from '#/api/core/dramafloow';

import { firstCandidateId, planViewsToGenerate } from './batchPlan';

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

/** 任务是否还在跑（轮询等待出图用） */
function isLive(status?: string): boolean {
  return ['collecting', 'generating', 'preparing', 'queued'].includes(
    status ?? '',
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 等某个任务产出候选（最多 `timeoutMs`），返回候选 id（按 variantNo 升序）。
 *
 * 为什么必须等：自动定稿要在**图真的出来之后**才能选一张通过。
 * 立刻去查候选只会查到空列表，然后"什么都没定稿" —— 而用户以为已经定稿了。
 *
 * 终止条件（三条，缺一不可 —— 少任何一条都会变成死循环或过早放弃）：
 *   ① 任务 failed/rejected → 抛错（把这个视图记成失败，不静默）；
 *   ② 任务定型（pending_review/done/approved）→ 候选已落库，跳出；
 *   ③ 超时 → 跳出并按"有没有候选"决定下一步。
 *
 * 主判据用**任务状态**而不是轮询候选列表：候选落库与状态更新之间有个很短的窗口，
 * 只看候选会在恰好那个窗口里误判成"没有图"。
 */
async function waitForCandidates(
  taskId: number,
  timeoutMs = 10 * 60 * 1000,
): Promise<number[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const detail = await taskGet(taskId).catch(() => null);
    const status = detail?.status;
    if (status === 'failed' || status === 'rejected') {
      throw new Error(detail?.error || '生成失败');
    }
    // pending_review = 出图完毕、等人工定稿；done/approved 同样算产出完毕
    if (['approved', 'done', 'pending_review'].includes(status ?? '')) break;
    // 未知/已定型但不在上面三个里（如人工取消）→ 也别再等了，交给下面的候选查询定性
    if (!isLive(status)) break;
    await sleep(3000);
  }

  const detail = await taskGet(taskId).catch(() => null);
  const requirementId = detail?.refEntityId;
  if (!requirementId) return [];
  const cands = await assetCandidateList(requirementId).catch(() => []);
  // 只认**本任务产出**且**真的有文件**的候选：别的任务留下的候选不能拿来定稿，
  // 没有 file_path 的候选后端 `Approve` 会直接拒绝（"候选文件缺失"）。
  return cands
    .filter((c) => c.taskId === taskId && c.filePath)
    .toSorted((a, b) => a.variantNo - b.variantNo)
    .map((c) => c.id);
}

/** 逐个视图下发任务（**串行**：避免一次性把 GPU 队列打满，也让进度可读） */
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

  for (const [i, view] of runQueue.value.entries()) {
    const item = items.value[i];
    if (!item) continue;
    try {
      const res = await taskSubmit({
        dramaId: props.dramaId,
        type: 't2i',
        refEntityType: 'asset_requirement',
        refEntityId: view.requirementId,
        subjectPrompt: view.spec ?? null,
        subjectNegative: view.negativeSpec ?? null,
        // 全默认：每视图 1 张
        candidateCount: 1,
      });
      item.taskId = res.taskId;
      item.status = 'submitted';
      item.message = '任务已下发';

      if (props.autoFinalize) {
        item.message = '等待出图…';
        const ids = await waitForCandidates(res.taskId);
        // waitForCandidates 已按 variant_no 升序返回 → 第 1 个就是这一版的主图
        const first = firstCandidateId(
          ids.map((id, idx) => ({ id, variantNo: idx })),
        );
        if (first) {
          const r = await assetApprove(first);
          item.status = 'approved';
          item.message =
            r?.staled > 0
              ? `已自动定稿（${r.staled} 个引用待更新）`
              : '已自动定稿';
        } else {
          item.status = 'candidate-ready';
          item.message = '已出图，待人工定稿';
        }
      }
    } catch (error: any) {
      item.status = 'failed';
      const reason = error?.message || '下发失败';
      item.message = reason;
      failures.value.push({ label: view.label, reason });
    }
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
              {{
                plan.skippedNoRequirement
              }}
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
