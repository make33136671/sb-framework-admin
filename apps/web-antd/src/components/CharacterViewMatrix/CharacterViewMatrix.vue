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
import { useRouter } from 'vue-router';

import {
  Image as AImage,
  Alert,
  Button,
  Empty,
  message,
  Modal,
  Spin,
  Tag,
} from 'ant-design-vue';

import { assetCharacterMatrix, assetSetViewImage } from '#/api/core/dramafloow';
import { toStorageUrl } from '#/utils/media';

const props = defineProps<{
  dramaId: number;
}>();

const emit = defineEmits<{
  /** 数据变化（定稿后）—— 父组件据此刷新其它视图 */
  (e: 'changed'): void;
}>();

const router = useRouter();

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
  if (row.candidates.length === 0) {
    message.info(`「${row.name}」还没有任何图 —— 请先在素材里生成候选`);
    return;
  }
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
 * 「去生成」：带参数跳到统一生成下发页（用户 2026-10-04 要求）。
 *
 * ## 关键语义：**只跳转 + 预填，绝不建任务**
 *
 * 用户明确要求「用户在页面点提交才建任务；中途关掉 = 什么都没发生」。
 * 所以这里**不能**调任何生成接口，只把第 3 层参数（视图提示词/反向/尺寸）
 * 通过 query 传给下发页；前两层（工作流默认 / 剧目风格）由后端在提交时补齐 ——
 * 这正是"统一入口"的价值：调用方只传自己特有的那层。
 *
 * 尺寸取该视图的宽高比默认（全身竖图 / 头部方图），与模型无关。
 */
function goGenerate(row: CharacterMatrixRow, cell: CharacterViewCell) {
  if (!cell.requirementId) {
    message.warning(
      `「${row.name}」还没有「${cell.label}」的视图需求 —— 请先点上方的「补齐角色视图」`,
    );
    return;
  }

  const view = viewBySuffix(cell.suffix);
  const query: Record<string, string> = {
    dramaId: String(props.dramaId),
    refEntityId: String(cell.requirementId),
    viewLabel: cell.label,
    characterName: row.name,
    requirementKey:
      row.candidates.find((c) => c.requirementId === cell.requirementId)
        ?.requirementKey ?? '',
  };

  // 第 3 层正向：视图的 spec（构图 + 纯灰底 + 跨视图一致性）
  if (view?.spec) query.subjectPrompt = view.spec;
  // 第 3 层反向：视图专有叠加（如全身图排除"裁掉脚"）
  if (view?.negativeSpec) query.subjectNegative = view.negativeSpec;
  if (view) {
    query.width = String(view.width);
    query.height = String(view.height);
  }

  picker.value = null;
  router.push({ name: 'DramaTaskSubmit', query });
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

    <div v-if="matrix.characters.length > 0" class="overflow-x-auto">
      <div
        v-for="row in matrix.characters"
        :key="row.name"
        class="mb-4 rounded-md border border-border p-2"
      >
        <!-- 角色名 + 该角色可选图总数 -->
        <div class="mb-2 flex items-center gap-2">
          <span class="font-medium">{{ row.name }}</span>
          <Tag class="!mr-0">{{ row.candidates.length }} 张已有图</Tag>
          <span
            v-if="row.candidates.length === 0"
            class="text-xs text-muted-foreground"
          >
            还没有图 —— 先在素材列表里生成候选
          </span>
        </div>

        <!-- 7 个视图格子 -->
        <div class="grid grid-cols-3 gap-2 md:grid-cols-4 xl:grid-cols-7">
          <div
            v-for="cell in row.views"
            :key="cell.suffix"
            class="cursor-pointer overflow-hidden rounded border transition-all hover:border-primary"
            :class="
              cell.approvedAssetId
                ? 'border-primary'
                : 'border-dashed border-border'
            "
            @click="openPicker(row, cell)"
          >
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

        <Empty v-else description="这个来源下没有图，换个来源或选「全部」" />
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
  </Spin>
</template>
