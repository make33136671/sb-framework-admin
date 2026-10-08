<script lang="ts" setup>
import type { TaskItem } from '#/api/core/dramafloow';

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
  message,
  Popconfirm,
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
  taskAssignProvider,
  taskBatch,
  taskCancel,
  taskList,
  taskPauseAll,
  taskPauseStatus,
  taskResumeAll,
  taskRetry,
  taskRunNow,
  taskStats,
} from '#/api/core/dramafloow';
import { AiProviderSelect } from '#/components/AiProviderSelect';
import { SchedulerStatusPanel } from '#/components/SchedulerStatusPanel';
import { TaskDrawer } from '#/components/TaskDrawer';
import {
  elapsedSecondsOf,
  formatElapsed,
  formatStopwatch,
  isTickingStatus,
} from '#/components/TaskDrawer/taskDisplay';
import { TimeTag } from '#/components/TimeTag';
import { requiredCapabilityText } from '#/composables/useAiProviders';
import { enumText } from '#/composables/useEnumText';
import { taskStatusColor, useTaskStream } from '#/composables/useTaskStream';
import { wallNow } from '#/utils/wallTime';

const router = useRouter();
const stream = useTaskStream();

// ─────────────────────────── 数据 ───────────────────────────

const tasks = ref<TaskItem[]>([]);
/**
 * 全局计数（来自 `Task/Stats`，**不受当前筛选条件影响**）。
 * `byStatus` 是「状态 → 条数」的原始映射，供筛选器显示各项数量。
 */
const counts = ref<{
  byStatus: Record<string, number>;
  done: number;
  failed: number;
  queued: number;
  running: number;
  total: number;
}>({ byStatus: {}, done: 0, failed: 0, queued: 0, running: 0, total: 0 });
const loading = ref(false);
/** 详情抽屉：null = 关闭 */
const taskId = ref<null | number>(null);
const acting = ref<null | number>(null);

// 筛选条件
const keyword = ref('');
const typeFilter = ref('all');
const statusFilter = ref('all');
const pageSize = ref(20);
/** 当前页码（**服务端分页**：page/pageSize 下推到后端，见 load()） */
const page = ref(1);
/** 服务端返回的总条数（受当前筛选条件影响）—— 分页器用它，而不是本地数组长度 */
const total = ref(0);
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
 * 各状态筛选项的**数量**（用户 2026-10-05：「这些状态选择 里面加一个数量」）。
 *
 * 数据源是 `Task/Stats` 的 `byStatus`（全站统计，与筛选条件无关）——
 * ⚠️ **不能**用当前页/当前筛选结果的长度：那是"这一页里有几个"，
 * 而筛选器的数量要回答的是"这个状态总共有几个"，否则数字会随翻页乱跳，
 * 且选中某一项后其余项会全变成 0（自己把自己筛没了）。
 *
 * ⚠️ 两个聚合项必须与**后端的聚合口径逐字一致**（见 TaskController.List 的
 *    status=running / done 分支），否则会出现"标签写 3、点进去只有 1 条"：
 *      · 在跑 = preparing + generating + collecting
 *      · 已完成 = approved + done + rejected
 */
const statusCounts = computed<Record<string, number>>(() => {
  const by = counts.value.byStatus;
  const n = (s: string) => by[s] ?? 0;
  return {
    all: counts.value.total,
    running: n('preparing') + n('generating') + n('collecting'),
    queued: n('queued'),
    pending_review: n('pending_review'),
    failed: n('failed'),
    done: n('approved') + n('done') + n('rejected'),
  };
});

/**
 * 带数量的状态选项。
 *
 * 数量为 0 时**仍显示数字**（而不是省略）：用户要的是"这个状态下有没有活"，
 * 看到「失败 0」本身就是有效信息（说明当前没有失败任务）；
 * 省略反而让人以为"没统计"。
 */
const statusOptionsWithCount = computed(() =>
  statusOptions.map((o) => ({
    ...o,
    label: `${o.label} ${statusCounts.value[o.value] ?? 0}`,
  })),
);

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

/**
 * 拉取当前页（**服务端分页 + 服务端筛选**）。
 *
 * 为什么必须下推到后端（本页此前的设计缺陷）：
 *   旧实现写死 `taskList({ page: 1, pageSize: 500 })` —— 一次拉 500 条，
 *   分页/搜索/筛选**全在前端**做。三个后果：
 *     ① 超过 500 条的任务**根本看不到**（且没有任何提示）；
 *     ② 搜索只在那 500 条里搜，命中不了更早的数据；
 *     ③ 500 条全渲染，页面越用越卡。
 *   改为把 keyword/type/status/page/pageSize 全部交给后端，前端只渲染当前页。
 *
 * ⚠️ 状态筛选里的 `running`/`done` 是**多状态聚合**（不是一个枚举值），
 *   后端 List 只接受单个 status。故这两个走"前端二次过滤当前页"不可行
 *   （会把一页过滤空却不显示还有更多）。这里改为：多状态时用 status=list 拉取，
 *   由后端按聚合语义处理 —— 见 TaskController.List 的 status=running/done 分支。
 *   单状态（queued/failed…）直接透传。
 */
async function load() {
  loading.value = true;
  try {
    const [list, stats] = await Promise.all([
      taskList({
        page: page.value,
        pageSize: pageSize.value,
        keyword: keyword.value.trim() || undefined,
        type: typeFilter.value === 'all' ? undefined : typeFilter.value,
        status: statusFilter.value === 'all' ? undefined : statusFilter.value,
      }),
      taskStats(),
    ]);
    tasks.value = list.items;
    total.value = list.total;
    counts.value = {
      // 原始「状态 → 条数」，供状态筛选器显示各项数量（见 statusCounts）
      byStatus: stats.byStatus ?? {},
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

/** 筛选条件变化 → 必须回到第 1 页（否则会停在一个不存在的页码上，显示空列表） */
function reloadFromFirstPage() {
  page.value = 1;
  void load();
}

/** 「只看在跑」：走服务端的聚合筛选（status=running → preparing/generating/collecting） */
function filterRunning() {
  statusFilter.value = 'running';
  reloadFromFirstPage();
}

/** 分页器/每页条数变化（服务端分页：改完重新拉那一页） */
function onPageChange(p: number, ps: number) {
  page.value = p;
  if (ps !== pageSize.value) {
    // 每页条数变了 → 当前页码会失效（第 10 页 × 100 条可能根本不存在）→ 回第 1 页
    pageSize.value = ps;
    page.value = 1;
  }
  void load();
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
  // 暂停状态也要首屏拉一次：否则刷新页面后按钮恒显示"一键暂停"，
  // 而实际仍在暂停中 —— 用户点下去会得到"已经是暂停状态"，白跑一趟。
  void loadPauseStatus();
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

/**
 * 表格数据源 = 当前页（服务端已按 keyword/type/status 过滤并分页）
 *   + **WS 实时增量**（在跑任务的进度/状态/耗时需要每秒更新，不能等 30s 轮询）。
 *
 * ⚠️ 这里**不再做任何前端筛选**：改了分页之后，本地数组只是"全量的第 N 页"，
 * 在此过滤会把页面过滤空、而分页器仍显示还有更多页 —— 是最难自查的一类不一致。
 * 所有筛选条件都必须在同一层（SQL）与分页一起生效。
 *
 * ⚠️ `merged` 含**全站**收到过 WS 事件的任务（不止当前页），直接用会把别的页的任务
 * 混进来。故必须用当前页的 id 集合去"筛出本页 + 叠加实时字段"（而不是取 merged 全量）。
 *
 * 排序：后端固定 `ORDER BY id DESC`。若要支持"最早在前"，必须给后端加排序参数，
 * 而不是在前端翻当前页（那只会把当页倒过来，不是全局排序）。
 */
const pageRows = computed(() => {
  const live = new Map(merged.value.map((t) => [t.id, t]));
  return tasks.value.map((t) => live.get(t.id) ?? t);
});

/**
 * 在跑任务数（用于顶部实时提示条）。
 *
 * ⚠️ 数据源是 `merged`（当前页 + WS 增量）而**不是** `counts.running`：
 * 后者是全局统计（`Task/Stats`），与"本页看得见的在跑任务"不是一回事。
 * 提示条要说的是"你现在能看到的列表里有几个在动"。
 */
const runningOnPage = computed(() =>
  pageRows.value.filter((t) => isRunning(t.status)),
);

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

/**
 * 「已耗时」列文案。
 *
 * 用户 2026-10-05：
 * > 「排队中的任务 不应该跑计时」
 *
 * 三档：
 *   · **排队中** → 显示「排队中」而**不是**读秒。它还没开始干活，
 *     给一个跳动秒表会让人误以为"已经在跑了"；
 *   · **在跑**（preparing/generating/collecting）→ 跑表样式（毫秒跳动）；
 *   · **已定型** → 中文自然语言（"3 分 12 秒"），不再走字。
 */
function elapsedText(t: Record<string, any> | TaskItem): string {
  if (isQueued(t.status)) return '排队中';
  const sec = elapsedSecondsOf(t, nowTick.value);
  if (sec === null) return '-';
  return isRunning(t.status) ? formatStopwatch(sec) : formatElapsed(0, sec);
}

function typeText(type?: string): string {
  return enumText.taskType(type);
}

/**
 * 是否**正在干活**（决定读秒走字 + 行内动效）。
 *
 * 用户 2026-10-05：「排队中的任务 不应该跑计时」——
 * 故读秒判据用 `isTickingStatus`（不含 queued），
 * 而"耗时该不该冻结"仍用 `isLiveStatus`（含 queued，见 elapsedSecondsOf）。
 * 两者都不是"终态"，别混用：混了就会出现"排队中也跳秒"或"排队中耗时归零且不再更新"。
 */
function isRunning(status: string): boolean {
  return isTickingStatus(status);
}

/** 排队中（用于状态色区分与耗时列的「排队中」文案） */
function isQueued(status: string): boolean {
  return status === 'queued';
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
 * 手动接管：给**排队中**的任务指定执行模型（`null` = 改回「自动」）。
 *
 * 成功后必须重新拉列表 —— 否则界面还显示旧的模型名，而任务实际会用新模型跑，
 * 用户看到的与服务端不一致（本项目最忌讳的静默不一致）。
 * 失败（如任务恰好已被编排器领走）由拦截器弹出后端的中文原因，不写配对 toast。
 */
async function assignProvider(
  t: Record<string, any> | TaskItem,
  providerId: null | number,
) {
  acting.value = t.id;
  try {
    await taskAssignProvider(t.id, providerId);
    await load();
  } finally {
    acting.value = null;
  }
}

// ─────────────────── 批量操作（用户 2026-10-05）───────────────────

/** 已勾选的任务号（跨页保留：用户可能在第 1 页勾几条、翻页再勾几条） */
const selectedIds = ref<number[]>([]);
const batchActing = ref(false);

/** 表格行选择配置 */
const rowSelection = computed(() => ({
  selectedRowKeys: selectedIds.value,
  onChange: (keys: (number | string)[]) => {
    selectedIds.value = keys.map(Number);
  },
  // 勾选列固定宽度，避免挤压其它列
  columnWidth: 42,
}));

/**
 * 执行批量操作。
 *
 * ⚠️ 三个动作的**可执行范围不同**（后端逐条判定），前端只需如实透传结果：
 *   · cancel —— 排队中/在飞可取消，已结束的跳过
 *   · delete —— 仅在**非进行中**可删（进行中的要先取消）—— 这是既有约束，不改
 *   · retry  —— 仅失败/驳回可重试
 *
 * ⚠️ 后端是"尽力而为 + 逐条回报"（不回滚），故这里必须把 `skipped` 的原因显示出来；
 *    只报"成功 N 条"会让用户以为剩下的也处理了。
 */
async function runBatch(action: 'cancel' | 'delete' | 'retry') {
  if (selectedIds.value.length === 0) return;
  batchActing.value = true;
  try {
    const res = await taskBatch(selectedIds.value, action);
    const label = { cancel: '取消', delete: '删除', retry: '重试' }[action];
    if (res?.skipped?.length) {
      // 按原因归并，避免"跳过了 37 条"这种没有信息量的提示
      const byWhy = new Map<string, number>();
      for (const s of res.skipped) {
        byWhy.set(s.why, (byWhy.get(s.why) ?? 0) + 1);
      }
      const detail = [...byWhy.entries()]
        .map(([why, n]) => `${why} ${n} 条`)
        .join('；');
      message.warning(
        `已${label} ${res.ok} 条；跳过 ${res.skipped.length} 条（${detail}）`,
      );
    }
    selectedIds.value = [];
    await load();
  } finally {
    batchActing.value = false;
  }
}

// ─────────────────── 全局暂停 / 恢复（用户 2026-10-05）───────────────────

/**
 * 全局暂停状态 + 待处理量。
 *
 * 用户原话：
 * > 「顶部也加入个 一键暂停 就是AI就是个机器 不管他连接那条线路
 * >   执行哪个任务 暂停了就全部都停下了」
 *
 * 暂停后**整个编排器不领任何任务**（所有线路/类型一并停下），并中断在飞任务；
 * 排队中的任务保持不动，恢复后继续。
 */
const paused = ref(false);
const pauseActing = ref(false);

async function loadPauseStatus() {
  try {
    const r = await taskPauseStatus();
    paused.value = r?.paused ?? false;
  } catch {
    // 拦截器已提示；保持上次状态，不误报为"已暂停"
  }
}

async function togglePause() {
  pauseActing.value = true;
  try {
    if (paused.value) {
      await taskResumeAll();
    } else {
      await taskPauseAll();
    }
    // 以服务端为准回读，不做本地乐观翻转 —— 否则请求失败时按钮会永远显示错的状态
    await loadPauseStatus();
    await load();
  } finally {
    pauseActing.value = false;
  }
}

/**
 * 立即执行（排队中的任务插队）。
 *
 * 为什么要确认弹窗（用户要求「按钮上加确认提示」）：
 * 它会让**这一个任务**跳过其他排队任务先跑 —— 在批量出图（实测有过 86 个 t2i 排队）
 * 的场景里，这可能明显影响别人/别的剧目的排队公平性，属于"有副作用的加速"，
 * 不该一点就走。
 *
 * 为什么要把后端的返回语**透传**给用户：紧急通道仍受算力节点离线/切换中约束，
 * 节点离线时"插队成功但仍不会立刻跑"。不说这句话，用户会以为功能坏了。
 */
async function runNow(t: Record<string, any> | TaskItem) {
  acting.value = t.id;
  try {
    const res = await taskRunNow(t.id);
    // 插队 ≠ 马上能跑：后端查出"还在等什么"（节点离线 / 云端开关关闭 / 模型不匹配）时，
    // 必须把原因说出来 —— 否则"点了立即执行还是没跑"就成了无从排查的谜题
    // （用户本次正是这么被卡住的）。
    if (res?.blockedReason) {
      message.warning(`已插队，但当前无法执行：${res.blockedReason}`);
    }
    await load();
  } finally {
    acting.value = null;
  }
}

/**
 * 列宽（用户 2026-10-04 要求）：
 * > 「我希望 固定列宽 只留一个 能自动适应的列就好 其他列 是你根据内容 推测的 列宽给他设定好」
 *
 * 做法：**除「剧目 / 具体做什么」外全部给确定宽度**，并让它不设 width
 * —— antd 会把剩余宽度全部给它（配合 `:scroll={ x: 'max-content' }`，
 * 表格总宽不足时它会撑满，超出时整体横向滚动）。
 *
 * 宽度按**内容实际需要**推，不是拍脑袋。2026-10-07 合并成 5 列后：
 *   · 执行线路 / 模型 = 线路标签一行 + 模型下拉（min-w 220）→ 320；
 *   · 剧目 / 具体做什么 = 唯一自适应列（剧名 + 版本 + 动作，越宽越好）；
 *   · 状态 / 耗时 = **上下两行**后取两者较宽者 → 150
 *     （跳动的 `00:12.345` 22px 等宽约 130px，状态标签约 80px）；
 *   · 创建时间 / 操作按组件固有尺寸取。
 */
const columns = [
  // ★ 合并列①（用户 2026-10-07）：「任务线路 + AI 服务（模型）」
  // > 「任务线路	AI 服务（模型） 这两个合成一列」
  //
  // 两列说的本来就是**同一件事**："这条任务由谁跑" ——
  // 线路（t2i/prompt_gen…）说明需要什么能力，模型说明谁来提供。
  // 合成后：上行是线路标签，下行是模型（可编辑），一眼看完"谁在跑什么"。
  //
  // 宽度 320：既要放下模型下拉（min-w 220），又要放下线路标签，窄了会折行。
  { title: '执行线路 / 模型', key: 'lineProvider', width: 320 },

  // ★ 合并列②（用户 2026-10-07）：「剧目 / 剧本 + 具体做什么」
  // > 「剧目 / 剧本		具体做什么  这两个合成一列」
  //
  // 都是"这条任务属于谁、在做什么"：剧目名 + 剧本版本 + 具体动作。
  // 合成后紧凑呈现，且作为**唯一自适应列**（吃掉剩余宽度）。
  { title: '剧目 / 具体做什么', key: 'dramaTarget' },

  // ★ 合并列③（用户 2026-10-07）：「状态 + 已耗时」
  // > 「状态	已耗时  合成一列」
  //
  // 语义上是一体的："现在什么状态、已经花了多久" —— 状态徽标 + 耗时并排。
  // 在跑时耗时是**毫秒跳动**的大字号（判据 isRunning），故宽度取 260：
  // 状态标签（约 72px）+ 跳动数字（约 120px）+ 间距，窄了跳动时会折行抖动。
  {
    title: '状态 / 耗时',
    key: 'statusElapsed',
    // ★ 上下两行布局后可以收窄（2026-10-07）：
    //   并排时两者争同一行宽度，需要 260 才不折行；
    //   上下排列后各占一行，宽度取**两者较宽者**即可 ——
    //   跳动的 `00:12.345`（22px 等宽）约 130px，状态标签约 80px，故 150 足够。
    width: 150,
    // 让毫秒跳动的大字号能撑满行高（class 挂在 td 上）
    customCell: () => ({ class: 'df-elapsed-cell' }),
  },

  { title: '创建时间', key: 'createdAt', width: 170 },
  // 排队中的行会有「详情 / 立即执行 / 取消」三个按钮（失败行是「详情 / 重试 / 取消」），
  // 150 放不下三个按钮会折行 → 加宽到 240。
  { title: '操作', key: 'action', width: 240 },
];
//
// ── 2026-10-07 用户精简（原话）──
// > 「AI 任务列表 这个表格 列表 我希望 多列 合成 一下
// >   token列没用 直接删掉 具体任务 里面的问题 是错误的 进度列也没用
// >   路由列 也没用」
//
// 删除的三列及理由：
//   · **tokens** —— 只有 LLM 类任务有值，GPU 类恒为 "-"；且对"任务跑到哪了"
//     没有任何指导意义（用户看的是进度与产物，不是烧了多少 token）。
//   · **进度** —— 与「状态」重复表达同一件事，而进度百分比本身是**估算**的
//     （各阶段自己报 10/30/…，不是真实完成度）。两个列说同一件事且其中一个不准，
//     会让人反复怀疑"到底跑没跑"。保留状态（准确、有语义色）即可。
//   · **路由** —— 只在"上云"场景才有徽标，本地任务全是 "-"；
//     真需要看走哪条线路时，「AI 服务（模型）」列已经写明模型名
//     （含 DeepSeek 这类云端模型），信息是冗余的。
</script>

<template>
  <Page
    class="df-page"
    description="AI 生产任务的实时列表：线路 / 剧目 / 剧本版本 / 具体做什么 / 状态 / 耗时"
    title="AI 任务列表"
  >
    <template #extra>
      <Space>
        <Badge
          :status="stream.connected.value ? 'success' : 'error'"
          :text="stream.connected.value ? '实时通道已连接' : '实时通道断开'"
        />
        <!-- 一键暂停 / 恢复（全局）：
             用户原话：「AI 就是个机器 不管他连接那条线路 执行哪个任务 暂停了就全部都停下了」。
             暂停 = 编排器不再领任何任务 + 中断在飞任务；排队中的保持不动、恢复后继续。
             用 Popconfirm 二次确认：它会打断正在跑的活（那几张图会废掉）。 -->
        <Popconfirm
          v-if="!paused"
          :ok-text="'确认暂停'"
          cancel-text="取消"
          title="暂停全部 AI 任务？"
          description="编排器将不再领取任何任务（所有线路），并中断正在执行的任务。排队中的任务会保留，恢复后继续。"
          @confirm="togglePause"
        >
          <Button :loading="pauseActing" danger size="small"> 一键暂停 </Button>
        </Popconfirm>
        <Button
          v-else
          :loading="pauseActing"
          size="small"
          type="primary"
          @click="togglePause"
        >
          恢复运行
        </Button>
        <Button size="small" :loading="loading" @click="load">刷新</Button>
      </Space>
    </template>

    <!-- 已暂停横幅：状态必须显眼（否则用户看到"任务不动"会以为是坏了） -->
    <div
      v-if="paused"
      class="mb-3 flex flex-wrap items-center gap-2 rounded border px-3 py-2 text-xs"
    >
      <Tag class="!mr-0" color="error">已暂停</Tag>
      <span class="font-medium">
        AI 已全部停止：编排器不领取任何任务（所有线路）
      </span>
      <span class="text-muted-foreground">
        排队中的任务保持不动，点「恢复运行」后继续
      </span>
    </div>

    <!-- 在跑提示条（**不是**独立列表，只是表格上方的一行摘要）。
         用户反馈「上下两个列表功能有重叠」—— 原来这里是 RunningTaskList 卡片，
         与下方表格列的是同一批数据、字段也几乎一样（剧目/线路/目标/进度/耗时/tokens）。
         现在只保留"有几个在跑 + 有没有人在动"这一条信息，
         真正的明细统一由下方表格（走服务端分页）呈现。 -->
    <div
      v-if="runningOnPage.length > 0"
      class="mb-3 flex flex-wrap items-center gap-2 rounded border px-3 py-2 text-xs"
    >
      <span class="df-live-dot"></span>
      <span class="font-medium"
        >本页 {{ runningOnPage.length }} 个任务正在执行</span
      >
      <span class="text-muted-foreground">
        （全站在跑 {{ counts.running }} 个 · 排队
        {{ counts.queued }} 个<template v-if="oldestQueuedWait !== null">
          · 最久已等 {{ formatElapsed(0, oldestQueuedWait) }}</template
        >）
      </span>
      <span class="flex-1"></span>
      <!-- 一键只看在跑：用服务端聚合筛选（status=running），不是本地过滤 -->
      <Button size="small" type="link" @click="filterRunning">
        只看在跑
      </Button>
    </div>

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

    <!--
      调度器状态（用户 2026-10-07 要求）：
      > 「在 AI 任务页面 加入一个 调度器状态 我需要知道每一台机器 现在在干嘛、
      >   调度器在干嘛。如果有任务在排队 我要能从状态里看出来 他卡在哪了」

      放在统计卡下方、任务明细上方 —— 排查"任务不下发"时第一眼就该看到
      "调度器为什么没领"，而不是去翻日志（这正是本次事故的痛点）。
    -->
    <SchedulerStatusPanel />

    <!-- 筛选 + 表格 -->
    <Card class="df-table-card" size="small" title="任务明细">
      <div class="mb-3 flex flex-wrap items-center gap-3">
        <!-- 关键词：**服务端搜索**。加 @search/@press-enter 与防抖，
             避免边打字边打后端（每敲一个字一次全表 LIKE 查询）。 -->
        <Input.Search
          v-model:value="keyword"
          allow-clear
          placeholder="搜剧目 / 剧本编号 / 具体任务 / 任务号"
          style="width: 280px"
          @press-enter="reloadFromFirstPage"
          @search="reloadFromFirstPage"
        />
        <Select
          v-model:value="typeFilter"
          :options="typeOptions"
          style="width: 190px"
          @change="reloadFromFirstPage"
        />
        <!-- 状态筛选：选项带数量（用户要求「这些状态选择 里面加一个数量」）。
             数量来自 Task/Stats 的全局统计，**不随筛选/翻页变化**
             —— 否则选中"排队中"后其余项会全变成 0（自己把自己筛没了）。 -->
        <Segmented
          v-model:value="statusFilter"
          :options="statusOptionsWithCount"
          @change="reloadFromFirstPage"
        />
        <!-- ⚠️ 排序：后端当前固定 `ORDER BY id DESC`。
             这里**只提供"最新在前"**（去掉误导性的"最早在前"）——
             前端翻转当前页不等于全局正序，会给用户错误印象。 -->
        <span
          class="text-xs text-muted-foreground"
          title="后端按任务号倒序返回（最新在前）"
        >
          最新在前
        </span>
        <Select
          v-model:value="pageSize"
          :options="[
            { label: '每页 20', value: 20 },
            { label: '每页 50', value: 50 },
            { label: '每页 100', value: 100 },
          ]"
          style="width: 120px"
          @change="() => onPageChange(1, pageSize)"
        />
        <span class="text-xs text-muted-foreground"> 共 {{ total }} 条 </span>
      </div>

      <!-- 批量操作条：**有勾选才出现**（没勾选时不占地方、不干扰浏览）。
           动作按可执行范围给足提示：删除要求先取消（后端既有约束，不在这里放宽）。 -->
      <div
        v-if="selectedIds.length > 0"
        class="mb-3 flex flex-wrap items-center gap-2 rounded border px-3 py-2"
      >
        <span class="text-xs font-medium">
          已选 {{ selectedIds.length }} 条
        </span>
        <Button size="small" @click="selectedIds = []">取消选择</Button>
        <span class="flex-1"></span>
        <Popconfirm
          :ok-text="'确认取消'"
          cancel-text="返回"
          title="取消所选任务？"
          @confirm="runBatch('cancel')"
        >
          <Button :loading="batchActing" size="small">批量取消</Button>
        </Popconfirm>
        <Popconfirm
          :ok-text="'确认重试'"
          cancel-text="返回"
          title="重试所选任务？（仅失败/驳回的会重试）"
          @confirm="runBatch('retry')"
        >
          <Button :loading="batchActing" size="small" type="primary">
            批量重试
          </Button>
        </Popconfirm>
        <Popconfirm
          :ok-text="'确认删除'"
          cancel-text="返回"
          title="删除所选任务？"
          description="进行中（排队中/在飞）的会被跳过，需先取消再删除。"
          @confirm="runBatch('delete')"
        >
          <Button :loading="batchActing" danger size="small">批量删除</Button>
        </Popconfirm>
      </div>

      <Table
        v-if="pageRows.length > 0"
        :columns="columns"
        :data-source="pageRows"
        :loading="loading"
        :pagination="{
          current: page,
          pageSize,
          total,
          showSizeChanger: false,
          showTotal: (t: number) => `共 ${t} 条`,
          size: 'small',
        }"
        :row-selection="rowSelection"
        :scroll="{ x: 'max-content' }"
        row-key="id"
        size="small"
        @change="
          (p: any) => onPageChange(p.current ?? 1, p.pageSize ?? pageSize)
        "
      >
        <template #bodyCell="{ column, record }">
          <!-- ★ 合并列①：执行线路 / 模型（用户 2026-10-07 要求合成） -->
          <template v-if="column.key === 'lineProvider'">
            <div class="flex flex-col gap-1">
              <!-- 线路标签：说明这个任务需要什么能力 -->
              <Tooltip
                :title="`该任务需要「${requiredCapabilityText(record.type)}」能力的服务`"
              >
                <Tag class="!mr-0 self-start" color="blue">
                  {{ typeText(record.type) }}
                </Tag>
              </Tooltip>

              <!-- 模型：**手动接管**（仅排队中可改）
                   用户诉求：「AI任务里只有自动排队，不能手动指定任务模型跑，这部分我希望可以手动接管」。
                   为什么限定「排队中」才给编辑入口：编排器是在**执行那一刻**读 provider_id 的，
                   已开跑的任务改了**不会影响本次执行**，却会让界面显示"已改为X" ——
                   这种静默不一致比直接不给改更难排查。后端也有同样的时机校验（双保险）。 -->

              <!-- 指定的模型当前不可用 → 这是"任务一直排队"的真正原因，
                   必须直接说出来（实测：任务 #731 被指定了一个不具备文本能力的模型，
                   领取 SQL 把它排除，界面只显示"排队中"，用户以为系统坏了）。
                   ★ 不可用时**仍然保留选择器**（仅排队中的行）：只提示不给改，
                     等于让用户看着问题干瞪眼。 -->
              <template
                v-if="
                  record.providerUnavailableReason && record.status === 'queued'
                "
              >
                <AiProviderSelect
                  :task-type="record.type"
                  :value="record.providerId ?? null"
                  @update:value="(v) => assignProvider(record, v)"
                />
                <Tag class="!mr-0" color="error">
                  {{ record.providerUnavailableReason }}
                </Tag>
                <span class="text-xs text-muted-foreground">
                  换个模型或改回「自动」即可继续
                </span>
              </template>

              <!-- 不可用但不是排队中（已开跑/已结束）：只读提示（后端也拒绝改） -->
              <Tooltip
                v-else-if="record.providerUnavailableReason"
                :title="`任务${enumText.taskStatus(record.status)}，模型已不可更改`"
              >
                <div class="flex flex-col gap-1">
                  <span class="text-xs">
                    {{ record.providerName || `模型 #${record.providerId}` }}
                  </span>
                  <Tag class="!mr-0" color="error">
                    {{ record.providerUnavailableReason }}
                  </Tag>
                </div>
              </Tooltip>

              <!-- 排队中且模型可用：就地可编辑 -->
              <template v-else-if="record.status === 'queued'">
                <AiProviderSelect
                  :task-type="record.type"
                  :value="record.providerId ?? null"
                  @update:value="(v) => assignProvider(record, v)"
                />
                <span class="text-xs text-muted-foreground">
                  {{
                    acting === record.id
                      ? '正在切换…'
                      : '排队中 · 可手动指定模型'
                  }}
                </span>
              </template>

              <!-- 其余状态：只读（为什么不能改写在 tooltip 里） -->
              <Tooltip
                v-else
                :title="`任务${enumText.taskStatus(record.status)}，模型已不可更改；如需换模型请用「重新生成」`"
              >
                <span v-if="record.providerName" class="text-xs">
                  {{ record.providerName }}
                </span>
                <span v-else class="text-xs text-muted-foreground">
                  自动（默认服务）
                </span>
              </Tooltip>
            </div>
          </template>

          <!-- ★ 合并列②：剧目 / 具体做什么（用户 2026-10-07 要求合成） -->
          <template v-else-if="column.key === 'dramaTarget'">
            <div class="flex min-w-0 flex-col">
              <!-- 第一行：剧目名（可点击跳转） -->
              <a
                v-if="record.dramaId"
                class="truncate"
                :title="record.dramaName || `剧目 #${record.dramaId}`"
                @click="openDrama(record.dramaId)"
              >
                {{ record.dramaName || `剧目 #${record.dramaId}` }}
              </a>
              <span v-else class="text-muted-foreground">-</span>

              <!-- 第二行：剧本版本 -->
              <span
                v-if="record.dramaId"
                class="truncate text-xs text-muted-foreground"
              >
                {{ record.dramaCode || '-' }}
                <template v-if="record.scriptVersion">
                  · 剧本 v{{ record.scriptVersion }}
                </template>
              </span>

              <!-- 第三行：具体做什么（本表最该看的信息） -->
              <span class="truncate text-xs" :title="record.target || ''">
                {{ record.target || '-' }}
              </span>
            </div>
          </template>

          <!-- ★ 合并列③：状态 / 耗时（用户 2026-10-07 要求合成） -->
          <template v-else-if="column.key === 'statusElapsed'">
            <!--
              ★ 上下两行布局（用户 2026-10-07 要求）。
              > 「状态 / 耗时 这一列 采用 上下两行布局」

              原来状态徽标与耗时**并排**在一行。问题：在跑时耗时是毫秒跳动的大字号，
              两者挤在一行会导致
                · 数字每跳一次（50ms）横向抖动 —— 因为它的宽度在变；
                · 两个元素争同一行宽度，窄屏时容易折行 → 整行高度跟着抖。
              上下两行后：上行状态、下行耗时，各自独占行宽，
              数字跳动不再影响状态标签位置，视觉稳定得多。
            -->
            <div class="flex flex-col gap-1">
              <!-- 第一行：状态徽标（pending_review 带 tooltip 说明：它不会再推进） -->
              <Tooltip
                v-if="statusHints[record.status]"
                :title="statusHints[record.status]"
              >
                <Tag
                  :color="taskStatusColor(record.status)"
                  class="!mr-0 self-start"
                >
                  <span
                    v-if="isRunning(record.status)"
                    class="df-live-dot mr-1 align-middle"
                  ></span>
                  {{ enumText.taskStatus(record.status) }}
                </Tag>
              </Tooltip>
              <Tag
                v-else
                :color="taskStatusColor(record.status)"
                class="!mr-0 self-start"
              >
                <span
                  v-if="isRunning(record.status)"
                  class="df-live-dot mr-1 align-middle"
                ></span>
                {{ enumText.taskStatus(record.status) }}
              </Tag>

              <!--
                第二行：耗时（用户 2026-10-04 要求）
                > 「生成中的已耗时 这里我希望改成 持续跳动的 毫秒数 看起来舒服点
                >  字体大一点 我希望他**高度占满整行** 这样跳动起来视觉冲击力更大」

                在跑 → `formatStopwatch`（`01:23.456`，毫秒位随 50ms tick 真在动）；
                已定型 → 中文自然语言且**冻结**（判据与读秒同源，见 isRunning）。
              -->
              <div
                v-if="isRunning(record.status)"
                class="df-task-elapsed-live df-live-num"
              >
                {{ elapsedText(record) }}
              </div>
              <span v-else class="text-xs tabular-nums">
                {{ elapsedText(record) }}
                <Tooltip v-if="record.finishedAt" title="已结束：为实际总耗时">
                  <span class="text-muted-foreground">·</span>
                </Tooltip>
              </span>
            </div>
          </template>

          <!-- 创建时间 -->
          <template v-else-if="column.key === 'createdAt'">
            <TimeTag :time="record.createdAt" />
          </template>

          <!-- 操作 -->
          <template v-else-if="column.key === 'action'">
            <Space>
              <Button size="small" @click="taskId = record.id">详情</Button>
              <!-- 立即执行：仅排队中可见（用户诉求：「排队中的 不能设置立即执行」）。
                   用 Popconfirm 而不是直接执行 —— 它会让这个任务跳过其他排队任务先跑，
                   在有积压（实测出现过 86 个 t2i 排队）时是"有副作用的加速"，
                   不该一点就走。 -->
              <Popconfirm
                v-if="record.status === 'queued'"
                :ok-text="'立即执行'"
                cancel-text="取消"
                title="让这个任务插队先跑？"
                @confirm="runNow(record)"
              >
                <Button
                  :loading="acting === record.id"
                  size="small"
                  type="primary"
                >
                  立即执行
                </Button>
              </Popconfirm>
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
