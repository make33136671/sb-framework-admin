<script lang="ts" setup>
import type { TaskItem, TaskTokenSummary } from '#/api/core/dramafloow';

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
  formatStopwatch,
  formatTokens,
  isLiveStatus,
} from '#/components/TaskDrawer/taskDisplay';
import { TaskRouteBadge } from '#/components/TaskRouteBadge';
import { TimeTag } from '#/components/TimeTag';
import { requiredCapabilityText } from '#/composables/useAiProviders';
import { enumText } from '#/composables/useEnumText';
import { taskStatusColor, useTaskStream } from '#/composables/useTaskStream';
import { wallNow } from '#/utils/wallTime';

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
  // ⚠️ 新增任务类型必须同步本列表：此前缺 analyze / episode_split，
  // 导致剧本分析任务在列表里既筛不出来、又被后端兜底标签显示成「洗稿」（2026-10-04 修复）。
  { label: '剧本线（洗稿）', value: 'rewrite' },
  { label: '剧本分析', value: 'analyze' },
  { label: '分集拆分', value: 'episode_split' },
  { label: '选区重洗', value: 'partial_rewrite' },
  { label: '分镜线', value: 'storyboard' },
  { label: '素材提取', value: 'asset_extract' },
  { label: '素材线（出图）', value: 't2i' },
  { label: '视频线（片段）', value: 'i2v' },
  { label: '成片线（合并）', value: 'concat' },
];

/**
 * 状态筛选。
 *
 * ⚠️ 「待审核」这一项过去让人看不懂（用户 2026-10-04 反馈）：
 * > 「这个列表里的 待审核 我一直没看懂他有什么作用」
 *
 * 用户随后自己点破了根因：
 * > 「他并不与当前的 AI 任务存在状态关联 他是 **素材任务链**上的」
 *
 * 核对后端确认用户是对的：
 *   · `pending_review` **确实在任务状态机上**（`TaskStatuses.PendingReview`，
 *     编排器在 t2i 出完图后写入，`TaskOrchestrator.cs:1768`）；
 *   · 但**没有任何代码把任务从这个状态推进出去** —— 全仓搜不到给任务写
 *     `approved` 的地方。人工审核实际发生在**素材候选**上
 *     （`Asset.Approve` / `Review.Approve` 动的是 `asset_candidate`）。
 *
 * 也就是说：`pending_review` 是任务的**事实终态**，它表达的是
 * 「这个任务该出的图已经出完了，接下来是素材链上的人工挑选」——
 * 把它叫「待审核」会让用户以为"任务还在审核中、还会变"，于是永远等不到。
 *
 * 处理：**改名为「已出图，待定稿」**并加 tooltip 说明它不会再推进。
 * 不改后端状态值（那会影响编排器与既有数据的兼容性），只把**界面语义**说对。
 */
const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '在跑', value: 'running' },
  { label: '排队中', value: 'queued' },
  { label: '已出图待定稿', value: 'pending_review' },
  { label: '失败', value: 'failed' },
  { label: '已完成', value: 'done' },
];

/**
 * 状态标签上的一句话解释（鼠标悬停可见）。
 *
 * 只给**容易被误读**的状态写：其余（在跑/失败/已完成）语义自明，加了反而是噪音。
 */
const statusHints: Record<string, string> = {
  pending_review:
    '图片已生成完毕，任务不会再推进。请到「素材」页通过/丢弃候选图，或到角色视图定稿。',
  queued: '已入队，等待编排器领取（受并发与 GPU 窗口限制）。',
  collecting: '正在把生成的图片收拢入库，稍后进入「已出图待定稿」。',
};

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

/** 每 tick 刷新「现在」：在跑任务的耗时走字（不再推进的任务会自行冻结）
 *  ⚠️ 必须用 `wallNow()`：后端时间戳是项目时区墙上时间，混用绝对时刻会偏一个时区。
 *
 *  间隔取 **50ms**（不是 1s）：用户要求「改成持续跳动的毫秒数」——
 *  毫秒位要真的在动才叫"跳动"，1s 一跳的话毫秒永远显示 .000，看起来像坏了。
 *  50ms 是流畅度与渲染开销的折中（约 20fps，人眼已足够顺；表格一屏几十行也不吃力）。 */
const nowTick = ref(wallNow());
let tickTimer: null | ReturnType<typeof setInterval> = null;
let refreshTimer: null | ReturnType<typeof setInterval> = null;

onMounted(() => {
  void load();
  tickTimer = setInterval(() => {
    nowTick.value = wallNow();
  }, 50);
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
      // ⚠️ finishedAt/updatedAt 的合并口径直接决定「已耗时」是否正确：
      //  · finishedAt 只能来自 REST（WS 事件不携带），但**不能被覆盖成 undefined**，
      //    否则刷新一次就丢掉终态时刻，读秒又会用 now 走字；
      //  · updatedAt 取「事件时刻」，它是任务最后一次落库时间 ——
      //    pending_review 这类**不写 finishedAt 的终态**靠它冻结耗时（见 elapsedSecondsOf）。
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
    case 'all': {
      break;
    }
    case 'done': {
      list = list.filter((t) =>
        ['approved', 'done', 'rejected'].includes(t.status),
      );
      break;
    }
    case 'running': {
      list = list.filter((t) =>
        ['collecting', 'generating', 'preparing'].includes(t.status),
      );
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
  let oldest = queued[0];
  if (!oldest) return null;
  for (const t of queued) {
    if (
      (elapsedSecondsOf(t, nowTick.value) ?? 0) >
      (elapsedSecondsOf(oldest, nowTick.value) ?? 0)
    ) {
      oldest = t;
    }
  }
  return elapsedSecondsOf(oldest, nowTick.value);
});

// ─────────────────────────── 展示辅助 ───────────────────────────

function elapsedText(t: Record<string, any> | TaskItem): string {
  const sec = elapsedSecondsOf(t, nowTick.value);
  if (sec === null) return '-';
  // 在跑 → 跑表样式（毫秒跳动，用户要求）；已定型 → 中文自然语言（"3 分 12 秒"）
  return isRunning(t.status) ? formatStopwatch(sec) : formatElapsed(0, sec);
}

function typeText(type?: string): string {
  return enumText.taskType(type);
}

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

/** 在跑（真正会推进的状态）：决定读秒走字 + 动效。
 *  ⚠️ 与 `elapsedSecondsOf` 的冻结判据必须同源（都用 isLiveStatus），
 *  否则会出现「状态已不推进、读秒还在跑」的不一致（2026-10-04 用户报的缺陷）。 */
function isRunning(status: string): boolean {
  return isLiveStatus(status);
}

function openDrama(dramaId?: number) {
  if (!dramaId) return;
  router.push({ name: 'DramaDetail', query: { id: dramaId } });
}

async function retry(t: Record<string, any> | TaskItem) {
  acting.value = t.id;
  try {
    await taskRetry(t.id);
    await load();
  } finally {
    acting.value = null;
  }
}

async function cancel(t: Record<string, any> | TaskItem) {
  acting.value = t.id;
  try {
    await taskCancel(t.id);
    await load();
  } finally {
    acting.value = null;
  }
}

/**
 * 列宽（用户 2026-10-04 要求）：
 * > 「我希望 固定列宽 只留一个 能自动适应的列就好 其他列 是你根据内容 推测的 列宽给他设定好」
 *
 * 做法：**除「具体任务」外全部给确定宽度**，并让「具体任务」不设 width
 * —— antd 会把剩余宽度全部给它（配合 `:scroll={ x: 'max-content' }`，
 * 表格总宽不足时它会撑满，超出时整体横向滚动）。
 *
 * 宽度按**内容实际需要**推的，不是拍脑袋：
 *   · 剧目/剧本 = 剧名一行 + 「编号 · 剧本 vN」一行 → 220 够放中文剧名不折行；
 *   · 线路/状态/tokens 都是短标签 → 100~110；
 *   · AI 服务（模型）常见「服务名 + 指定服务」两行 → 170；
 *   · 路由徽标（🏠/☁ + 金额）→ 140；
 *   · 进度 / 已耗时 / 创建时间 / 操作按组件固有尺寸取。
 *
 * ⚠️ 「已耗时」列刻意加宽到 150：它是**毫秒跳动**的大字号数字（见下），
 * 窄了会把数字挤到换行，跳动时整行高度抖动。
 */
const columns = [
  { title: '剧目 / 剧本', key: 'drama', width: 220 },
  { title: '任务线路', key: 'line', width: 110 },
  { title: 'AI 服务（模型）', key: 'provider', width: 170 },
  // 成本感知调度 §6.4：路由徽标（🏠 本地 / ☁ 云端）+ 上云原因 tooltip + 金额
  { title: '路由', key: 'route', width: 140 },
  // ★ 唯一自适应列：不设 width，吃掉剩余宽度（配合表格横向滚动的 max-content 下限）
  { title: '具体任务', key: 'target', ellipsis: true },
  { title: '状态', key: 'status', width: 110 },
  {
    title: '进度',
    key: 'progress',
    width: 160,
    // 让加粗进度条的圆角/高度样式能命中（class 挂在 td 上）
    customCell: () => ({ class: 'df-task-progress' }),
  },
  {
    title: '已耗时',
    key: 'elapsed',
    width: 150,
    // 让毫秒跳动的大字号能"占满整行"（td 不限高 + flex 撑满）
    customCell: () => ({ class: 'df-elapsed-cell' }),
  },
  { title: 'tokens', key: 'tokens', width: 100 },
  { title: '创建时间', key: 'createdAt', width: 170 },
  { title: '操作', key: 'action', width: 150 },
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

    <!-- 关键计数：5 张卡统一高度（内容行数不同也不再参差） -->
    <Row :gutter="16" class="mb-4">
      <Col :span="5">
        <Card class="df-stat-card" size="small">
          <Statistic title="任务总数" :value="counts.total" suffix="个" />
        </Card>
      </Col>
      <Col :span="5">
        <Card class="df-stat-card" size="small">
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
        <Card class="df-stat-card" size="small">
          <Statistic title="已完成" :value="counts.done" suffix="个" />
        </Card>
      </Col>
      <Col :span="5">
        <Card class="df-stat-card" size="small">
          <Statistic title="失败" :value="counts.failed" suffix="个" />
          <div class="mt-1 text-xs text-muted-foreground">
            可在列表内直接重试
          </div>
        </Card>
      </Col>
      <Col :span="4">
        <Card class="df-stat-card" size="small">
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
    <Card class="df-table-card" size="small" title="任务明细">
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
        :scroll="{ x: 'max-content' }"
        row-key="id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <!-- 剧目 / 剧本版本 -->
          <template v-if="column.key === 'drama'">
            <div v-if="record.dramaId" class="flex min-w-0 flex-col">
              <a
                class="truncate"
                :title="record.dramaName || `剧目 #${record.dramaId}`"
                @click="openDrama(record.dramaId)"
              >
                {{ record.dramaName || `剧目 #${record.dramaId}` }}
              </a>
              <span class="truncate text-xs text-muted-foreground">
                {{ record.dramaCode || '-' }}
                <template v-if="record.scriptVersion">
                  · 剧本 v{{ record.scriptVersion }}
                </template>
              </span>
            </div>
            <span v-else class="text-muted-foreground">-</span>
          </template>

          <!-- 任务线路（任务类型所属生产线） -->
          <template v-else-if="column.key === 'line'">
            <Tooltip
              :title="`该任务需要「${requiredCapabilityText(record.type)}」能力的服务`"
            >
              <Tag class="!mr-0" color="blue">{{ typeText(record.type) }}</Tag>
            </Tooltip>
          </template>

          <!-- 实际使用的 AI 服务（模型） -->
          <template v-else-if="column.key === 'provider'">
            <div v-if="record.providerName" class="flex flex-col">
              <span class="text-xs">{{ record.providerName }}</span>
              <span class="text-xs text-muted-foreground"> 指定服务 </span>
            </div>
            <div v-else class="flex flex-col">
              <span class="text-xs text-muted-foreground"
                >自动（默认服务）</span
              >
              <span class="text-xs text-muted-foreground">
                需要 {{ requiredCapabilityText(record.type) }}
              </span>
            </div>
          </template>

          <!-- 路由徽标（🏠 本地 / ☁ 云端）+ 上云原因 tooltip + 金额 -->
          <template v-else-if="column.key === 'route'">
            <TaskRouteBadge
              :cost-yuan="record.costYuan"
              :off-peak="record.offPeak"
              :reason="record.routeReason"
              :reason-text="record.routeReasonText"
              :route="record.route"
            />
            <span v-if="!record.route" class="text-xs text-muted-foreground">
              -
            </span>
          </template>

          <!-- 具体任务 -->
          <template v-else-if="column.key === 'target'">
            <span class="text-xs">{{ record.target || '-' }}</span>
          </template>

          <!-- 状态（pending_review 带 tooltip 说明：它不会再推进，见 statusOptions 注释） -->
          <template v-else-if="column.key === 'status'">
            <Tooltip
              v-if="statusHints[record.status]"
              :title="statusHints[record.status]"
            >
              <Tag :color="taskStatusColor(record.status)" class="!mr-0">
                <span
                  v-if="isRunning(record.status)"
                  class="df-live-dot mr-1 align-middle"
                ></span>
                {{ enumText.taskStatus(record.status) }}
              </Tag>
            </Tooltip>
            <Tag v-else :color="taskStatusColor(record.status)" class="!mr-0">
              <span
                v-if="isRunning(record.status)"
                class="df-live-dot mr-1 align-middle"
              ></span>
              {{ enumText.taskStatus(record.status) }}
            </Tag>
          </template>

          <!-- 进度（用户要求：加高加粗） -->
          <template v-else-if="column.key === 'progress'">
            <div class="df-task-progress">
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
                :stroke-width="16"
              />
            </div>
          </template>

          <!--
            已耗时（用户 2026-10-04 要求）：
            > 「生成中的已耗时 这里我希望改成 持续跳动的 毫秒数 看起来舒服点
            >  字体大一点 我希望他**高度占满整行** 这样跳动起来视觉冲击力更大」

            实现要点：
              · 在跑 → `formatStopwatch`（`01:23.456`，毫秒位随 50ms tick 真在动）；
                已定型 → 中文自然语言，且**冻结**（判据与读秒同源，见 isRunning）；
              · `.df-task-elapsed-live`：撑满行高 + 加大字号 + 等宽数字
                （等宽是关键：不定宽的数字每跳一次都会左右抖，越大越明显）
          -->
          <template v-else-if="column.key === 'elapsed'">
            <div
              v-if="isRunning(record.status)"
              class="df-task-elapsed-live df-live-num"
            >
              {{ elapsedText(record) }}
            </div>
            <template v-else>
              <span class="text-xs tabular-nums">{{
                elapsedText(record)
              }}</span>
              <Tooltip v-if="record.finishedAt" title="已结束：为实际总耗时">
                <span class="ml-1 text-xs text-muted-foreground">·</span>
              </Tooltip>
            </template>
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
