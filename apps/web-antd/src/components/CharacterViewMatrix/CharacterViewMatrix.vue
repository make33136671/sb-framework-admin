<script lang="ts" setup>
import type {
  CharacterImageOption,
  CharacterMatrix,
  CharacterMatrixRow,
  CharacterViewCell,
} from '#/api/core/dramafloow';

/**
 * 角色 × 视图矩阵（用户诉求）
 *
 * > 「7 个标准视图 你做到一个页面上 然后 这个标准视图 是空的 点击 就从现有角色的图像里选择」
 *
 * 形态：一行一个角色，7 个格子对应 7 个标准视图。
 * - 格子**默认是空的** → 显示「+ 选择」
 * - 点格子 → 从**该角色全部已有候选图**里挑一张（跨视图、含旧的无后缀数据）
 * - 选中 = **定稿该视图**（该图成为这个视图的最终选择）
 *
 * ## 两条关键设计
 *
 * 1. **不重新出图**：选图池就是该角色已有的图。用户可能已经在旧结构下出过一堆图
 *    （`character_丽迪雅` 累积了 54 张），这些图必须能被复用，否则等于白出。
 *
 * 2. **跨角色绝对隔离**：选图弹窗里只列**本角色**的图；后端 `SetViewImage` 也会
 *    再校验一次角色名。把别人的脸填进这个角色的视图**不会报错**，
 *    只会在下游分镜里安静地出现错的人 —— 这类"操作错对象"比报错更难发现。
 *
 * 视图列与顺序一律由后端返回（`CharacterViews.Standard` 是唯一事实源），
 * 本组件**不硬编码** 7 个视图，避免两边各写一套后漂移。
 */
import { computed, onMounted, ref } from 'vue';

import {
  Image as AImage,
  Alert,
  Button,
  Checkbox,
  Empty,
  message,
  Modal,
  Spin,
  Tag,
  Tooltip,
} from 'ant-design-vue';

import {
  assetBatchGenerate,
  assetBatchGeneratePrompts,
  assetUnapprove,
  assetCharacterMatrix,
  assetSetViewImage,
} from '#/api/core/dramafloow';
import { GenerateTaskModal } from '#/components/GenerateTaskModal';
import { TaskDrawer } from '#/components/TaskDrawer';
import { toStorageUrl } from '#/utils/media';

import BatchGenerateViewsModal from './BatchGenerateViewsModal.vue';
import CharacterInfoModal from './CharacterInfoModal.vue';
import PromptBatchModal from './PromptBatchModal.vue';

const props = defineProps<{
  dramaId: number;
}>();

const emit = defineEmits<{
  /** 数据变化（定稿后）—— 父组件据此刷新其它视图 */
  (e: 'changed'): void;
}>();

const loading = ref(false);
const matrix = ref<CharacterMatrix>({ characters: [], viewColumns: [] });

async function load() {
  loading.value = true;
  try {
    matrix.value = await assetCharacterMatrix(props.dramaId);
  } catch {
    // 拦截器已提示
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());
defineExpose({ reload: load });

// ─────────────────────────── 选图弹窗 ───────────────────────────

/** 当前正在为哪个格子选图 */
const picker = ref<{
  cell: CharacterViewCell;
  characterName: string;
  /** 该角色在矩阵里的整行 —— 「去生成」要拿它的 name 等字段，故直接存行引用 */
  row: CharacterMatrixRow;
} | null>(null);

const picking = ref(false);
/** 弹窗里的筛选：只看某个来源视图（null = 全部） */
const sourceFilter = ref<null | string>(null);

/** 旧的无后缀数据（`character_丽迪雅`）在筛选里的标识 */
const UNCLASSIFIED = 'unclassified';

/** 弹窗对应角色在矩阵里的那一行 */
const pickerRow = computed<CharacterMatrixRow | null>(() => {
  const p = picker.value;
  if (!p) return null;
  return (
    matrix.value.characters.find((c) => c.name === p.characterName) ?? null
  );
});

/** 该角色全部可选图（不受来源筛选影响） */
const pickerAll = computed<CharacterImageOption[]>(
  () => pickerRow.value?.candidates ?? [],
);

const pickerTotal = computed(() => pickerAll.value.length);

/** 按来源筛一张图是否命中（'unclassified' 命中无后缀的旧数据） */
function matchSource(c: CharacterImageOption, value: string): boolean {
  return value === UNCLASSIFIED ? !c.viewSuffix : c.viewSuffix === value;
}

/** 某个来源下有几张图（用于标签上的计数） */
function sourceCount(value: string): number {
  return pickerAll.value.filter((c) => matchSource(c, value)).length;
}

const pickerCandidates = computed<CharacterImageOption[]>(() => {
  const filter = sourceFilter.value;
  if (filter === null) return pickerAll.value;
  return pickerAll.value.filter((c) => matchSource(c, filter));
});

/** 该格子当前选中的图（用于高亮 + 显示「当前」标记） */
const currentApprovedId = computed<null | number>(
  () => picker.value?.cell.approvedAssetId ?? null,
);

/** 弹窗里可选的来源视图（只列该角色**真的有图**的来源） */
const sourceOptions = computed(() => {
  const seen = new Map<string, string>();
  for (const c of pickerAll.value) {
    const key = c.viewSuffix ?? UNCLASSIFIED;
    if (!seen.has(key)) seen.set(key, c.viewLabel);
  }
  return [...seen.entries()].map(([value, label]) => ({ value, label }));
});

function openPicker(row: CharacterMatrixRow, cell: CharacterViewCell) {
  if (!cell.requirementId) {
    message.warning(
      `「${row.name}」还没有「${cell.label}」的视图需求 —— 请先点上方的「补齐角色视图」`,
    );
    return;
  }
  // ⚠️ 这里**不再因为"该角色没有图"而挡回**。
  //
  // 旧实现是 `if (row.candidates.length === 0) { 提示"还没有任何图"; return; }` ——
  // 那会造成一个**死循环**：新角色一张图都没有 → 点格子被挡回 → 没有任何入口去出图。
  // （用户报：「如果角色没有一张图 那么他只会提示 没有图片 我都不能进入他的生成页面」）
  //
  // 正确做法：照常打开选图弹窗；弹窗在"没有图"时展示空态并给出**「去生成」**入口 ——
  // 那正是没有图时唯一该做的事。
  sourceFilter.value = null;
  picker.value = { cell, characterName: row.name, row };
}

async function choose(cand: CharacterImageOption) {
  const p = picker.value;
  if (!p?.cell.requirementId) return;
  picking.value = true;
  try {
    const res = await assetSetViewImage(p.cell.requirementId, cand.id);
    // 改选已有定稿时会级联 stale —— 必须让用户看见，否则他不知道下游要重跑
    if (res.staled > 0) {
      message.warning(
        `已定稿；${res.staled} 个引用该视图的分镜/片段已标记为待更新`,
      );
    }
    picker.value = null;
    await load();
    emit('changed');
  } catch {
    // 拦截器已提示（含"只能选择同一角色的图"）
  } finally {
    picking.value = false;
  }
}

/**
 * 「去生成」（用户 2026-10-04 二次要求）：
 *
 * > 「手动操作的时候 点击去生成 **直接在当前窗口 弹出 AI任务的执行窗口**」
 *
 * 旧实现是 `router.push` 跳到 `/dramafloow/tasks/submit` 整页 —— 用户点一次
 * 就离开了角色视图，回来还得重新找角色、重新点格子。现在改为**就地弹窗**。
 *
 * 语义不变（仍然成立）：**弹窗只预填，不建任务**；用户点弹窗里的「提交生成」
 * 才真正下发；关掉弹窗 = 什么都没发生。
 */
const generateCtx = ref<null | {
  characterName: string;
  dramaId: number;
  height?: null | number;
  requirementId: null | number;
  requirementKey: string;
  subjectNegative: string;
  subjectPrompt: string;
  viewLabel: string;
  width?: null | number;
}>(null);

/**
 * 任务执行窗口要展示的任务 id（null = 关闭）。
 *
 * 提交生成后由 `onTaskSubmitted` 设置 → 就地弹出执行窗口。
 */
const execTaskId = ref<null | number>(null);

/**
 * 生成表单提交成功 → 关掉表单、就地弹出**该任务的执行窗口**。
 *
 * 用户要求：「提交任务后 直接把任务执行窗口 也 直接用弹窗的方式在当前页面弹出来」。
 *
 * 顺序刻意是「先关表单、再开执行窗口」：两个 Modal 同时挂载会叠两层遮罩，
 * 关掉上面那层时下面那层会闪一下。先关后开只有一个遮罩，视觉干净。
 */
function onTaskSubmitted(payload: { taskId: number }) {
  generateCtx.value = null;
  execTaskId.value = payload.taskId;
  // 矩阵可能已因新任务变化（需求进入 generating），刷一次让格子状态跟上
  void load();
}

function goGenerate(row: CharacterMatrixRow, cell: CharacterViewCell) {
  if (!cell.requirementId) {
    message.warning(
      `「${row.name}」还没有「${cell.label}」的视图需求 —— 请先点上方的「补齐角色视图」`,
    );
    return;
  }

  const view = viewBySuffix(cell.suffix);

  picker.value = null;
  generateCtx.value = {
    dramaId: props.dramaId,
    characterName: row.name,
    viewLabel: cell.label,
    requirementId: cell.requirementId,
    requirementKey:
      row.candidates.find((c) => c.requirementId === cell.requirementId)
        ?.requirementKey ?? '',
    // 第 3 层正向：视图的 spec（构图 + 纯灰底 + 跨视图一致性）
    subjectPrompt: view?.spec ?? '',
    // 第 3 层反向：通用底线 + 视图专有叠加
    subjectNegative: view?.negativeSpec ?? '',
    width: view?.width ?? null,
    height: view?.height ?? null,
  };
}

// ───────────────── 一键生成 7 图（用户 2026-10-04 要求）─────────────────

/**
 * > 「一个角色名旁边 右侧 加一个 一键生成 7图（旁边加一个 checked 自动定稿）
 * >  自动按照全默认参数 但是每个视图生成 1 张就好 把 7 张图 补齐」
 *
 * 「自动定稿」的勾选态放在这里（而不是弹窗内）：
 * 它是一个**用户偏好**，勾一次之后对下一个角色仍然生效，不该每个角色重勾。
 */
const autoFinalize = ref(false);

/**
 * **强制执行**（用户 2026-10-07 要求）—— 与素材页同一语义。
 *
 * > 「两个一键生成 提示词 和 图片 增加个选项为强制执行
 * >   就是不管有没有 强制生成替换 关键词是更新为新的
 * >   图片就是 清空掉现有选择的 生成新的」
 *
 * ⚠️ 素材页有这个开关而角色视图没有 → 用户实测发现两处不一致
 *    （原话：「强制执行 分类视图有 但是 角色视图没有」）。
 *    两处工具栏的动作集必须**保持一致**，否则用户在不同视图下能力不同，极易困惑。
 *
 * 默认**不勾**：破坏性操作（会删掉已有图/提示词），默认开启会让用户误删成果。
 */
const force = ref(false);

/** 当前正在批量生成的角色行；null = 弹窗关闭 */
const batchRow = ref<CharacterMatrixRow | null>(null);

function openBatch(row: CharacterMatrixRow) {
  // 一个视图需求都没有 → 批量生成无从下手，先引导去建档
  const hasAny = row.views.some((v) => v.requirementId);
  if (!hasAny) {
    message.warning(
      `「${row.name}」还没有任何视图需求 —— 请先点上方的「补齐角色视图」`,
    );
    return;
  }
  batchRow.value = row;
}

// ───────────────── 一键补充提示词（用户 2026-10-07 要求）─────────────────
//
// > 「一键生7图边上 加入一个 一键补充提示词」
//
// 与「一键生成 7 图」的区别：**只生成提示词、不出图**。
// 每个视图下发一条 image_prompt_gen 任务（可在 AI 任务列表看到），
// 由编排器调 PE-T2I 生成正/反向并落回该需求。
//
// 为什么不做成"跳过已有提示词的视图"：
// 提示词不是图，重生成无损失（不覆盖任何已定稿的图），
// 且用户点它多半正是因为"之前生成的不满意，想全刷一遍"。
const promptBatchRow = ref<CharacterMatrixRow | null>(null);

/** 角色信息弹窗（点角色名打开）；null = 关闭 */
const infoRow = ref<CharacterMatrixRow | null>(null);

function openPromptBatch(row: CharacterMatrixRow) {
  const hasAny = row.views.some((v) => v.requirementId);
  if (!hasAny) {
    message.warning(
      `「${row.name}」还没有任何视图需求 —— 请先点上方的「补齐角色视图」`,
    );
    return;
  }
  promptBatchRow.value = row;
}

// ─────────────────────────── 展示辅助 ───────────────────────────

/**
 * 按后缀取视图定义（含 spec / 反向 / 建议尺寸）。
 *
 * 尺寸与反向提示词由**后端**（CharacterViews 是唯一事实源）在建视图需求时
 * 就已生成；这里从矩阵数据里已有的 spec 反查，避免前端再写一份视图表
 * —— 两边各写一套必然漂移。
 */
function viewBySuffix(suffix: string) {
  const col = matrix.value.viewColumns.find((c) => c.suffix === suffix);
  if (!col) return null;
  return {
    suffix,
    spec: col.spec ?? '',
    negativeSpec: col.negativeSpec ?? '',
    width: col.width ?? 1024,
    height: col.height ?? 1024,
  };
}

/** 格子缩略图：从已定稿候选里取 filePath */
function cellImage(row: CharacterMatrixRow, cell: CharacterViewCell): string {
  if (!cell.approvedAssetId) return '';
  const hit = row.candidates.find((c) => c.id === cell.approvedAssetId);
  return hit ? toStorageUrl(hit.filePath) : '';
}

function statusText(status: string): string {
  if (status === 'approved') return '已定稿';
  if (status === 'rejected') return '已丢弃';
  if (status === 'generating') return '生成中';
  if (status === 'missing') return '无档案';
  if (status === 'pending') return '待选择';
  // 未知状态**回显原值**而不是落到某个默认文案：
  // 后端将来新增状态时，落到「待选择」会让用户以为"这个格子还没定稿"，
  // 而它可能其实是"已作废/生成失败"之类需要处理的态 —— 静默错报比显示生词更糟。
  return status;
}

function statusColor(status: string): string {
  if (status === 'approved') return 'success';
  if (status === 'rejected') return 'error';
  if (status === 'generating') return 'processing';
  if (status === 'missing') return 'default';
  return 'warning';
}

function candidateStatusText(status: string): string {
  if (status === 'approved') return '已通过';
  if (status === 'rejected') return '已丢弃';
  return '待审核';
}

/** 已定稿格子数（顶部进度提示，让用户一眼看出还剩几个空格） */
const filledCount = computed(() =>
  matrix.value.characters.reduce(
    (n, r) => n + r.views.filter((v) => v.approvedAssetId).length,
    0,
  ),
);

const totalCells = computed(() =>
  matrix.value.characters.reduce((n, r) => n + r.views.length, 0),
);

// ───────────────── 多选（用户 2026-10-07 要求）─────────────────
//
// > 「角色视图里 角色不能多选」—— 补上，且要求与素材页**保持一致**的动作：
// >   一键生成提示词 / 一键生成图像 / 自动定稿
// > 粒度要求：「全选 单选 逐个单选 逐行单选」→ 行级 + 视图级都支持。
//
// 选中态用 **requirementId 集合**（视图级）作为唯一事实源，行选中 = 该行 7 个
// 视图全被选中。这样"行勾选"与"格子勾选"天然自洽 —— 若两者各存一份，
// 勾了行再取消一个格子就会出现"行还勾着但少一个"的矛盾态。

/** 选中的视图需求 id（唯一的选中事实源） */
const checkedReqIds = ref<Set<number>>(new Set());

/** 该行 7 个视图的 requirementId（未建档的视图没有 id，不参与选择） */
function reqIdsOf(row: CharacterMatrixRow): number[] {
  return row.views
    .map((v) => v.requirementId)
    .filter((id): id is number => typeof id === 'number');
}

/** 行是否全选 */
function isRowChecked(row: CharacterMatrixRow): boolean {
  const ids = reqIdsOf(row);
  return ids.length > 0 && ids.every((id) => checkedReqIds.value.has(id));
}

/** 行是否部分选中（用于三态勾选框） */
function isRowIndeterminate(row: CharacterMatrixRow): boolean {
  const ids = reqIdsOf(row);
  const hit = ids.filter((id) => checkedReqIds.value.has(id)).length;
  return hit > 0 && hit < ids.length;
}

function toggleCell(reqId: number | null | undefined, checked: boolean) {
  if (typeof reqId !== 'number') return;
  // ⚠️ Set 是引用类型：原地增删**不会**触发 computed，必须整体替换。
  const next = new Set(checkedReqIds.value);
  if (checked) next.add(reqId);
  else next.delete(reqId);
  checkedReqIds.value = next;
}

/** 行级勾选 = 该行全部视图一起勾/取消 */
function toggleRow(row: CharacterMatrixRow, checked: boolean) {
  const next = new Set(checkedReqIds.value);
  for (const id of reqIdsOf(row)) {
    if (checked) next.add(id);
    else next.delete(id);
  }
  checkedReqIds.value = next;
}

/** 全选/取消全选：作用于**全部角色**（与素材页的"全选本页"同义） */
function toggleSelectAll(checked: boolean) {
  const next = new Set(checkedReqIds.value);
  for (const row of matrix.value.characters) {
    for (const id of reqIdsOf(row)) {
      if (checked) next.add(id);
      else next.delete(id);
    }
  }
  checkedReqIds.value = next;
}

/** 可被选中的视图总数（未建档的视图没有 requirementId，选不了） */
const selectableCount = computed(() =>
  matrix.value.characters.reduce((n, r) => n + reqIdsOf(r).length, 0),
);

const allChecked = computed(
  () =>
    selectableCount.value > 0 &&
    checkedReqIds.value.size >= selectableCount.value,
);
const someChecked = computed(
  () => checkedReqIds.value.size > 0 && !allChecked.value,
);

const selectedReqIds = computed(() => [...checkedReqIds.value]);

/** 批量操作进行中（防重复点击） */
const batchRunning = ref(false);

/**
 * 批量生成提示词 / 批量出图（与素材页同一套后端接口）。
 *
 * ⚠️ **一次请求下发全部**：前端循环调用时，关页面/切标签会让后面的视图
 * 根本没被创建且不报错（`taskBatchSubmitViews` 的 api 注释记录过该事故）。
 */
async function runBatchPrompts() {
  const ids = selectedReqIds.value;
  if (ids.length === 0) return;
  batchRunning.value = true;
  try {
    const res = await assetBatchGeneratePrompts(ids, force.value);
    const parts = [`已下发 ${res.created.length} 个`];
    if (res.replaced?.length > 0)
      parts.push(`替换旧提示词 ${res.replaced.length} 个`);
    if (res.skipped.length > 0)
      parts.push(
        `跳过 ${res.skipped.length} 个（${res.skipped[0]?.why ?? ''}）`,
      );
    if (res.replaced?.length > 0 || res.skipped.length > 0)
      message.info(parts.join('，'));
    checkedReqIds.value = new Set();
    await load();
  } catch {
    // 拦截器已提示
  } finally {
    batchRunning.value = false;
  }
}

async function runBatchGenerate() {
  const ids = selectedReqIds.value;
  if (ids.length === 0) return;
  batchRunning.value = true;
  try {
    const res = await assetBatchGenerate({
      requirementIds: ids,
      autoFinalize: autoFinalize.value,
      force: force.value,
    });
    const parts = [`已下发 ${res.created.length} 个`];
    if (res.replaced?.length > 0) {
      const total = res.replaced.reduce((n, r) => n + r.removedCandidates, 0);
      parts.push(`清空旧图 ${total} 张`);
    }
    if (res.skipped.length > 0)
      parts.push(
        `跳过 ${res.skipped.length} 个（${res.skipped[0]?.why ?? ''}）`,
      );
    if (res.replaced?.length > 0 || res.skipped.length > 0)
      message.info(parts.join('，'));
    checkedReqIds.value = new Set();
    await load();
  } catch {
    // 拦截器已提示
  } finally {
    batchRunning.value = false;
  }
}

/**
 * **批量清除定稿**（用户 2026-10-07 要求）。
 *
 * 与素材页同一个语义：把选中视图的定稿图改回未定稿。
 * 逐个调用（接口是单条语义，要回滚需求+候选+引用方三处）；
 * 选中数量通常是个位数，串行足够且失败能精确定位。
 */
async function runBatchUnapprove() {
  const ids = selectedReqIds.value;
  if (ids.length === 0) return;
  batchRunning.value = true;
  let changed = 0;
  let skipped = 0;
  try {
    for (const id of ids) {
      try {
        const r = await assetUnapprove(id);
        if (r.changed) changed += 1;
        else skipped += 1;
      } catch {
        skipped += 1;
      }
    }
    message.info(
      skipped > 0
        ? `已清除 ${changed} 个定稿，${skipped} 个本就未定稿`
        : `已清除 ${changed} 个定稿`,
    );
    checkedReqIds.value = new Set();
    await load();
  } finally {
    batchRunning.value = false;
  }
}
</script>

<template>
  <Spin :spinning="loading">
    <Alert
      v-if="matrix.characters.length > 0"
      class="mb-3"
      type="info"
      show-icon
    >
      <template #message>
        每个角色的 7
        个标准视图；格子为空时点一下，从**该角色已有的图**里选一张定稿。
      </template>
      <template #description>
        <span class="text-xs">
          已定稿 {{ filledCount }} / {{ totalCells }} 格 · 选图不会重新出图，
          只是把已有候选指定为该视图的最终选择
        </span>
      </template>
    </Alert>

    <!--
      批量工具栏（用户 2026-10-07：「角色视图里 角色不能多选」）。
      动作与素材页保持一致：一键生成提示词 / 一键生成图像 / 自动定稿。
    -->
    <div
      v-if="matrix.characters.length > 0"
      class="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 p-2"
    >
      <Checkbox
        :checked="allChecked"
        :indeterminate="someChecked"
        @change="(e: any) => toggleSelectAll(e.target.checked)"
      >
        <span class="text-xs">全选（{{ selectableCount }} 个视图）</span>
      </Checkbox>

      <Tag v-if="checkedReqIds.size > 0" class="!mr-0" color="blue">
        已选 {{ checkedReqIds.size }}
      </Tag>

      <!--
        定稿操作（用户 2026-10-07）—— 与素材页**保持一致的动作集**。
        > 「我说的清空选择 是把选择图 改为 未定稿状态 清除他的定稿」
      -->
      <Tooltip
        title="把选中视图的定稿图改回未定稿状态（需求状态回到「待生成」）"
      >
        <Button
          :disabled="checkedReqIds.size === 0"
          :loading="batchRunning"
          size="small"
          @click="runBatchUnapprove"
        >
          清除定稿
        </Button>
      </Tooltip>

      <Button
        v-if="checkedReqIds.size > 0"
        size="small"
        type="link"
        @click="checkedReqIds = new Set()"
      >
        取消勾选
      </Button>

      <span class="flex-1"></span>

      <Checkbox v-model:checked="autoFinalize">
        <span class="text-xs">生成图像自动定稿</span>
      </Checkbox>

      <!--
        强制执行（与素材页同款）—— 破坏性开关，默认不勾。
        Tooltip 讲清"会删掉什么"，避免误以为只是"重试一下"。
      -->
      <Tooltip
        title="强制替换：不管有没有进行中的任务都照发。提示词会清掉旧的重新生成；图片会清空现有图片（含定稿）后重新生成。默认关闭。"
      >
        <Checkbox v-model:checked="force">
          <span class="text-xs text-destructive">强制执行（替换已有）</span>
        </Checkbox>
      </Tooltip>

      <Tooltip
        :title="
          force
            ? '强制模式：将清空选中视图的旧提示词并重新生成'
            : '为选中视图逐个生成提示词（走 PE-T2I），只补提示词、不出图；任务可在 AI 任务列表查看'
        "
      >
        <Button
          :disabled="checkedReqIds.size === 0"
          :loading="batchRunning"
          size="small"
          @click="runBatchPrompts"
        >
          一键生成提示词
        </Button>
      </Tooltip>
      <Tooltip
        :title="
          force
            ? '强制模式：将清空选中视图的现有图片（含定稿）并重新生成'
            : '为选中视图下发 t2i 出图任务（等同逐个点「一键生成 7 图」，已有定稿的视图会跳过）'
        "
      >
        <Button
          :disabled="checkedReqIds.size === 0"
          :loading="batchRunning"
          size="small"
          :danger="force"
          :type="force ? 'default' : 'primary'"
          @click="runBatchGenerate"
        >
          一键生成图像
        </Button>
      </Tooltip>
    </div>

    <div v-if="matrix.characters.length > 0" class="overflow-x-auto">
      <div
        v-for="row in matrix.characters"
        :key="row.name"
        class="mb-4 rounded-md border border-border p-2"
      >
        <!-- 角色名 + 该角色可选图总数 + 一键生成 7 图（用户要求：名字右侧） -->
        <div class="mb-2 flex flex-wrap items-center gap-2">
          <!-- 行级勾选：勾上 = 该角色全部 7 视图一起选中（逐行单选） -->
          <Checkbox
            :checked="isRowChecked(row)"
            :indeterminate="isRowIndeterminate(row)"
            @change="(e: any) => toggleRow(row, e.target.checked)"
          />
          <!--
            角色名可点击 → 角色信息弹窗（用户 2026-10-07 要求）：
            > 「在角色视图 点击那个名字 显示角色的 信息 角色信息可以修改 底下是7视图」
            用 button 而非 span：键盘可达；样式仍是普通文字，仅 hover 下划线。
          -->
          <button
            class="font-medium hover:text-primary hover:underline"
            title="点击查看/修改角色信息（描述 + 7 视图）"
            type="button"
            @click="infoRow = row"
          >
            {{ row.name }}
          </button>
          <Tag class="!mr-0">{{ row.candidates.length }} 张已有图</Tag>
          <span
            v-if="row.candidates.length === 0"
            class="text-xs text-muted-foreground"
          >
            还没有图 —— 用右侧「一键生成 7 图」补齐
          </span>
          <span class="flex-1"></span>
          <!-- 自动定稿：勾选后每视图出图即取第 1 张定为最终选择 -->
          <Checkbox v-model:checked="autoFinalize">
            <span class="text-xs">自动定稿</span>
          </Checkbox>
          <Tooltip
            title="按全默认参数，为这个角色**还缺**的视图各生成 1 张（已有定稿的视图会跳过，不会覆盖）"
          >
            <Button size="small" type="primary" @click="openBatch(row)">
              一键生成 7 图
            </Button>
          </Tooltip>
          <!--
            一键补充提示词（用户 2026-10-07 要求）：
            > 「一键生7图边上 加入一个 一键补充提示词」
            只生成提示词、不出图；每个视图一条任务，可在「AI任务列表」里看到。
          -->
          <Tooltip
            title="为这个角色的 7 个视图逐个生成提示词（走 PE-T2I 真机），只补提示词、不出图；任务可在「AI 任务列表」查看进度"
          >
            <Button size="small" @click="openPromptBatch(row)">
              一键补充提示词
            </Button>
          </Tooltip>
        </div>

        <!-- 7 个视图格子 -->
        <div class="grid grid-cols-3 gap-2 md:grid-cols-4 xl:grid-cols-7">
          <div
            v-for="cell in row.views"
            :key="cell.suffix"
            class="cursor-pointer overflow-hidden rounded border transition-all hover:border-primary"
            :class="
              cell.requirementId && checkedReqIds.has(cell.requirementId)
                ? 'border-primary bg-primary/5'
                : cell.approvedAssetId
                  ? 'border-primary'
                  : 'border-dashed border-border'
            "
            @click="openPicker(row, cell)"
          >
            <!--
              视图级勾选（用户要求「逐个单选」）：
              @click.stop 必须加 —— 否则勾选会同时触发 openPicker 弹窗。
            -->
            <div class="flex items-center gap-1 px-1 pt-1">
              <Checkbox
                :checked="
                  !!cell.requirementId && checkedReqIds.has(cell.requirementId)
                "
                :disabled="!cell.requirementId"
                @click.stop
                @change="
                  (e: any) => toggleCell(cell.requirementId, e.target.checked)
                "
              />
              <span class="flex-1"></span>
            </div>
            <!-- 已定稿：缩略图；空：点击提示 -->
            <AImage
              v-if="cellImage(row, cell)"
              :src="cellImage(row, cell)"
              :height="110"
              class="w-full object-cover"
            />
            <div
              v-else
              class="flex h-[110px] w-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground"
            >
              <span class="text-lg leading-none">+</span>
              <span>{{
                cell.status === 'missing' ? '无档案' : '点击选择'
              }}</span>
            </div>

            <div class="flex flex-col gap-1 p-1">
              <span class="truncate text-xs" :title="cell.label">
                {{ cell.label }}
              </span>
              <Tag :color="statusColor(cell.status)" class="!mr-0 !text-xs">
                {{ statusText(cell.status) }}
              </Tag>
            </div>
          </div>
        </div>
      </div>
    </div>

    <Empty
      v-else
      description="该剧目还没有角色素材需求 —— 先做「素材提取」，再点「补齐角色视图」"
    />

    <!-- 选图弹窗：只列本角色的图（跨视图、含旧数据） -->
    <Modal
      :open="picker !== null"
      :footer="null"
      :width="920"
      @cancel="picker = null"
      :title="
        picker
          ? `为「${picker.characterName}」的「${picker.cell.label}」选择一张图`
          : ''
      "
    >
      <Alert class="mb-2" type="info" show-icon>
        <template #message>
          只列出「{{ picker?.characterName }}」自己的图（含历史未分类的图）
        </template>
        <template #description>
          <span class="text-xs">
            选中即定稿为该视图的最终选择；若该视图原本已有图，改选会把引用它的
            分镜/片段标记为待更新。
          </span>
        </template>
      </Alert>

      <!-- 来源筛选：图可能来自别的视图或旧数据，标出来避免"不知道这图哪来的" -->
      <div class="mb-2 flex flex-wrap items-center gap-2">
        <span class="text-xs text-muted-foreground">来源</span>
        <Tag
          class="cursor-pointer !mr-0"
          :color="sourceFilter === null ? 'blue' : undefined"
          @click="sourceFilter = null"
        >
          全部 ({{ pickerTotal }})
        </Tag>
        <Tag
          v-for="o in sourceOptions"
          :key="o.value"
          class="cursor-pointer !mr-0"
          :color="sourceFilter === o.value ? 'blue' : undefined"
          @click="sourceFilter = o.value"
        >
          {{ o.label }} ({{ sourceCount(o.value) }})
        </Tag>
      </div>

      <Spin :spinning="picking">
        <div
          v-if="pickerCandidates.length > 0"
          class="grid max-h-[460px] grid-cols-3 gap-2 overflow-auto md:grid-cols-4"
        >
          <div
            v-for="c in pickerCandidates"
            :key="c.id"
            class="cursor-pointer overflow-hidden rounded border transition-all hover:border-primary"
            :class="
              c.id === currentApprovedId
                ? 'border-primary ring-1 ring-primary'
                : 'border-border'
            "
            @click="choose(c)"
          >
            <AImage
              :src="toStorageUrl(c.filePath)"
              :height="120"
              class="w-full object-cover"
            />
            <div class="flex flex-col gap-1 p-1">
              <div class="flex flex-wrap items-center gap-1">
                <Tag
                  v-if="c.id === currentApprovedId"
                  class="!mr-0 !text-xs"
                  color="success"
                >
                  当前
                </Tag>
                <Tag class="!mr-0 !text-xs">{{ c.viewLabel }}</Tag>
              </div>
              <span class="text-xs text-muted-foreground">
                变体 {{ c.variantNo }}
                <template v-if="c.width && c.height">
                  · {{ c.width }}×{{ c.height }}
                </template>
                · {{ candidateStatusText(c.status) }}
              </span>
            </div>
          </div>
        </div>

        <!--
          空态分两种，给的话必须不同：
          · 该角色**一张图都没有**（新角色）→ 唯一该做的事是「去生成」，故直接把它做成主按钮；
          · 只是当前**来源筛选**下没有 → 提示换来源。
          旧实现把前者也挡在弹窗外（连弹窗都打不开），用户完全无从下手。
        -->
        <Empty
          v-else
          :description="
            pickerTotal === 0
              ? `「${picker?.characterName ?? ''}」还没有任何图 —— 点下方「去生成」出第一张`
              : '这个来源下没有图，换个来源或选「全部」'
          "
        >
          <Button
            v-if="pickerTotal === 0"
            type="primary"
            @click="picker && goGenerate(picker.row, picker.cell)"
          >
            去生成第一张
          </Button>
        </Empty>
      </Spin>

      <div class="mt-3 flex items-center justify-between">
        <span class="text-xs text-muted-foreground">
          没有合适的图？带着本视图的提示词与尺寸去下发页生成
        </span>
        <Space>
          <Button @click="picker = null">取消</Button>
          <Button
            type="primary"
            @click="picker && goGenerate(picker.row, picker.cell)"
          >
            去生成
          </Button>
        </Space>
      </div>
    </Modal>

    <!-- 一键生成 7 图（按全默认参数补齐空格子；可选自动定稿） -->
    <BatchGenerateViewsModal
      :auto-finalize="autoFinalize"
      :drama-id="props.dramaId"
      :row="batchRow"
      :view-columns="matrix.viewColumns"
      @close="batchRow = null"
      @finished="load"
      @view-task="(id) => (execTaskId = id)"
    />

    <!-- 一键补充提示词：只生成提示词、不出图，任务进 AI 任务列表 -->
    <PromptBatchModal
      :drama-id="props.dramaId"
      :row="promptBatchRow"
      :view-columns="matrix.viewColumns"
      @close="promptBatchRow = null"
      @finished="load"
      @view-task="(id) => (execTaskId = id)"
    />

    <!-- 角色信息（点角色名打开）：上半可改可存，下半 7 视图 -->
    <CharacterInfoModal
      :drama-id="props.dramaId"
      :row="infoRow"
      @close="infoRow = null"
      @open-view="
        ({ suffix }) => {
          const r = infoRow;
          if (!r) return;
          const cell = r.views.find((v) => v.suffix === suffix);
          if (cell) {
            infoRow = null;
            openPicker(r, cell);
          }
        }
      "
      @saved="load"
    />

    <!-- 「去生成」= 当前窗口弹出生成表单 → 提交后紧接着弹出任务执行窗口 -->
    <GenerateTaskModal
      :context="generateCtx"
      @close="generateCtx = null"
      @submitted="onTaskSubmitted"
    />

    <!--
      任务执行窗口（用户要求）：
      > 「提交任务后 直接把任务执行窗口 也 直接用弹窗的方式在当前页面弹出来」

      与「去生成」表单**依次**出现：提交 → 表单关闭 → 执行窗口弹出，
      用户不用离开角色视图、也不用去任务列表找刚建的任务。
    -->
    <TaskDrawer
      presentation="modal"
      :task-id="execTaskId"
      @close="execTaskId = null"
      @changed="load"
    />
  </Spin>
</template>
