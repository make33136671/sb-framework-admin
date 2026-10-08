<script lang="ts" setup>
import type {
  AssetCategoryNode,
  AssetViewItem,
} from '#/api/core/assetCategory';

/**
 * 素材分类视图（剧目详情 → 素材标签页的默认视图）
 *
 * 结构：顶层分类（Tabs，可增删改）→ 子分类（可勾选的卡片，可增删改）→ 素材网格（预览图 + 简介）。
 * 素材与分类是多对多：一个「张三」可同时挂在「全局人物形象」和「受伤状态」下，两处都会出现。
 * 点某节点时展示「本节点 + 后代节点」的素材，避免同一素材在祖先节点被重复堆叠。
 *
 * 只负责展示与分类交互；素材的生成/历史版本/详情仍由父组件（剧目详情页）负责，通过事件上抛。
 */
import { computed, onMounted, ref } from 'vue';

import {
  Image as AImage,
  Button,
  Checkbox,
  Empty,
  Input,
  message,
  Modal,
  Popconfirm,
  Popover,
  Select,
  Spin,
  Tabs,
  Tag,
  Tooltip,
} from 'ant-design-vue';

import {
  assetCategoryAssign,
  assetCategoryDelete,
  assetCategoryRequirements,
  assetCategorySave,
  assetCategoryTree,
} from '#/api/core/assetCategory';
import { toStorageUrl } from '#/utils/media';

const props = defineProps<{
  dramaId: number;
}>();

const emit = defineEmits<{
  /** 打开素材详情/候选（父组件弹窗） */
  (e: 'open', item: AssetViewItem): void;
  /** 生成候选 */
  (e: 'generate', item: AssetViewItem): void;
  /** 历史版本 */
  (e: 'versions', item: AssetViewItem): void;
  /** 素材数据变化（生成/审核后） */
  (e: 'changed'): void;
  /** 批量：为选中素材生成提示词（PE-T2I，不出图）。force=true 时强制替换旧提示词 */
  (
    e: 'batchPrompts',
    payload: { force: boolean; items: AssetViewItem[] },
  ): void;
  /** 批量：清除定稿（把选中素材的定稿图改回未定稿） */
  (e: 'batchUnapprove', payload: { items: AssetViewItem[] }): void;
  /** 批量：为选中素材出图。force=true 时清空旧图并生成新的 */
  (
    e: 'batchGenerate',
    payload: { autoFinalize: boolean; force: boolean; items: AssetViewItem[] },
  ): void;
}>();

// ───────────────── 多选（用户 2026-10-07 要求）─────────────────
//
// > 「素材 我还希望加入 多选 全选 然后一键生成提示词 一键生成图像 生成图像自动定稿」
//
// 选中态存 **id 集合**而不是对象数组：素材列表会因生成/审核而刷新，
// 存对象会在刷新后变成一批陈旧副本（勾选看似还在、实际对象已换）。
// 存 id 则刷新后按 id 重新匹配，勾选状态始终准确。
const selectedIds = ref<Set<number>>(new Set());

const selectedItems = computed(() =>
  items.value.filter((it) => selectedIds.value.has(it.id)),
);

/** 当前筛选结果是否已全选（全选框用） */
const allSelected = computed(
  () =>
    filtered.value.length > 0 &&
    filtered.value.every((it) => selectedIds.value.has(it.id)),
);
const someSelected = computed(
  () => selectedIds.value.size > 0 && !allSelected.value,
);

function toggleSelect(id: number, checked: boolean) {
  // ⚠️ Set 是引用类型，原地改**不会**触发 computed —— 必须换一个新 Set。
  //    这是 Vue 响应式最典型的静默失效点：改了但界面不动，且不报错。
  const next = new Set(selectedIds.value);
  if (checked) next.add(id);
  else next.delete(id);
  selectedIds.value = next;
}

/** 全选/取消全选：只作用于**当前筛选结果**（与用户看到的一致） */
function toggleSelectAll(checked: boolean) {
  const next = new Set(selectedIds.value);
  for (const it of filtered.value) {
    if (checked) next.add(it.id);
    else next.delete(it.id);
  }
  selectedIds.value = next;
}

function clearSelection() {
  selectedIds.value = new Set();
}

/** 生成图像是否自动定稿（用户偏好：勾一次对后续批量操作仍生效） */
const batchAutoFinalize = ref(false);

/**
 * **强制执行**（用户 2026-10-07 要求）。
 *
 * > 「两个一键生成 提示词 和 图片 增加个选项为强制执行
 * >   就是不管有没有 强制生成替换 关键词是更新为新的
 * >   图片就是 清空掉现有选择的 生成新的」
 *
 * 勾选后：
 *   · 不再因"已有进行中任务"而跳过 —— 照发
 *   · 提示词：清掉旧提示词，更新为新的
 *   · 图片：清空现有候选图（并解除定稿），生成新的
 *
 * ⚠️ 默认**不勾**：它是破坏性操作（会删掉已有图/提示词），
 *    默认开启会让用户误删成果。必须显式选择。
 */
const batchForce = ref(false);

function runBatchPrompts() {
  if (selectedItems.value.length === 0) return;
  emit('batchPrompts', {
    force: batchForce.value,
    items: selectedItems.value,
  });
}

function runBatchUnapprove() {
  if (selectedItems.value.length === 0) return;
  emit('batchUnapprove', { items: selectedItems.value });
}

function runBatchGenerate() {
  if (selectedItems.value.length === 0) return;
  emit('batchGenerate', {
    items: selectedItems.value,
    autoFinalize: batchAutoFinalize.value,
    force: batchForce.value,
  });
}

const loading = ref(false);
const tree = ref<AssetCategoryNode[]>([]);
const items = ref<AssetViewItem[]>([]);

/** 当前选中的顶层分类 id；null = 全部 */
const topId = ref<null | number>(null);
/** 当前选中的子分类 id 集合；空集 = 该顶层下全部 */
const subIds = ref<number[]>([]);

async function loadAll() {
  loading.value = true;
  try {
    const [t, list] = await Promise.all([
      assetCategoryTree(),
      assetCategoryRequirements(props.dramaId),
    ]);
    tree.value = t;
    items.value = list;
    // 首次进入默认选中第一个顶层分类（否则停在「全部」，看不出分类结构）
    if (topId.value === null && t.length > 0) {
      topId.value = t[0]?.id ?? null;
    }
    // 顶层分类被删掉后，选中的 id 要能自愈
    if (topId.value !== null && !t.some((x) => x.id === topId.value)) {
      topId.value = t[0]?.id ?? null;
      subIds.value = [];
    }
  } catch {
    // 拦截器已提示
  } finally {
    loading.value = false;
  }
}

onMounted(() => void loadAll());
// clearSelection 也暴露出去：父组件下发批量任务成功后要清空勾选，
// 否则用户会以为"还选着"、再点一次就重复下发了。
defineExpose({ reload: loadAll, clearSelection });

// ─────────────────────────── 分类树辅助 ───────────────────────────

const currentTop = computed(
  () => tree.value.find((t) => t.id === topId.value) ?? null,
);

/** 当前顶层下的子分类（一层；层级不写死，这里只展示直接子级） */
const subCategories = computed<AssetCategoryNode[]>(
  () => currentTop.value?.children ?? [],
);

/** 收集某分类自己 + 所有后代的 id（点父分类要带上后代素材） */
function selfAndDescendants(node: AssetCategoryNode): number[] {
  return [node.id, ...node.children.flatMap((c) => selfAndDescendants(c))];
}

/** 当前筛选命中哪些分类 id；null = 不筛（全部） */
const activeCategoryIds = computed<null | Set<number>>(() => {
  if (topId.value === null) return null;
  const top = currentTop.value;
  if (!top) return null;
  if (subIds.value.length > 0) {
    return new Set(subIds.value);
  }
  return new Set(selfAndDescendants(top));
});

const filtered = computed(() => {
  const ids = activeCategoryIds.value;
  if (!ids) return items.value;
  return items.value.filter((it) => it.categoryIds.some((c) => ids.has(c)));
});

/** 未归类的素材数（提示"还有多少没分类"） */
const uncategorizedCount = computed(
  () => items.value.filter((it) => it.categoryIds.length === 0).length,
);

// ─────────────────────────── 分类增删改 ───────────────────────────

const editOpen = ref(false);
const saving = ref(false);
const editing = ref<{
  id?: number;
  kind: string;
  name: string;
  parentId: number;
  sortNo: number;
}>({ name: '', parentId: 0, kind: '', sortNo: 0 });

function openCreateTop() {
  editing.value = {
    name: '',
    parentId: 0,
    kind: '',
    sortNo: tree.value.length,
  };
  editOpen.value = true;
}

/** 在某个顶层分类下加子分类 */
function openCreateSub(top: AssetCategoryNode) {
  editing.value = {
    name: '',
    parentId: top.id,
    kind: top.kind ?? '',
    sortNo: top.children.length,
  };
  editOpen.value = true;
}

function openEdit(node: AssetCategoryNode) {
  editing.value = {
    id: node.id,
    name: node.name,
    parentId: node.parentId,
    kind: node.kind ?? '',
    sortNo: node.sortNo,
  };
  editOpen.value = true;
}

async function submitCategory() {
  const f = editing.value;
  if (!f.name.trim()) {
    message.error('请填写分类名');
    return;
  }
  saving.value = true;
  try {
    await assetCategorySave({
      id: f.id,
      name: f.name.trim(),
      parentId: f.parentId,
      kind: f.kind || undefined,
      sortNo: f.sortNo,
    });
    editOpen.value = false;
    await loadAll();
  } finally {
    saving.value = false;
  }
}

async function removeCategory(node: AssetCategoryNode, cascade = false) {
  try {
    await assetCategoryDelete(node.id, cascade);
    if (topId.value === node.id) topId.value = null;
    subIds.value = subIds.value.filter((x) => x !== node.id);
    await loadAll();
  } catch (error: any) {
    // 有子分类时后端会拒绝：这里追问是否级联删除
    if (!cascade && String(error?.message ?? '').includes('子分类')) {
      Modal.confirm({
        content: `「${node.name}」下还有子分类，是否连同子分类一起删除？（素材本身不会被删除）`,
        okText: '一并删除',
        cancelText: '取消',
        onOk: () => removeCategory(node, true),
        title: '确认删除分类',
      });
    }
  }
}

// ─────────────────────────── 素材改分类 ───────────────────────────

/** 素材 → 分类的多选（Popover 里勾选，覆盖式保存） */
const assignTarget = ref<AssetViewItem | null>(null);
const assignDraft = ref<number[]>([]);

function openAssign(item: AssetViewItem) {
  assignTarget.value = item;
  assignDraft.value = [...item.categoryIds];
}

async function submitAssign() {
  const item = assignTarget.value;
  if (!item) return;
  try {
    await assetCategoryAssign(item.id, assignDraft.value);
    assignTarget.value = null;
    await loadAll();
    emit('changed');
  } catch {
    // 拦截器已提示
  }
}

/** 全部子分类（跨顶层，供"归类"下拉选择） */
const allLeaves = computed(() =>
  tree.value.flatMap((t) =>
    t.children.map((c) => ({ label: `${t.name} / ${c.name}`, value: c.id })),
  ),
);

function categoryName(id: number): string {
  for (const t of tree.value) {
    if (t.id === id) return t.name;
    const sub = t.children.find((c) => c.id === id);
    if (sub) return sub.name;
  }
  return '';
}

// ─────────────────────────── 素材卡片展示 ───────────────────────────

const KIND_TEXT: Record<string, string> = {
  character: '人物',
  scene: '场景',
  prop: '道具',
};

function kindText(kind: string): string {
  return KIND_TEXT[kind] ?? kind;
}

function statusColor(status: string): string {
  if (status === 'approved') return 'success';
  if (status === 'rejected') return 'error';
  if (status === 'generating') return 'processing';
  return 'warning';
}

function statusText(status: string): string {
  if (status === 'approved') return '已定稿';
  if (status === 'rejected') return '已驳回';
  if (status === 'generating') return '生成中';
  if (status === 'pending') return '待生成';
  return status;
}

/** 简介里的「出场集数」：压缩成 1,3,5 或 1-3 区间 */
function episodesText(eps: number[]): string {
  if (eps.length === 0) return '未在分镜中出现';
  const sorted = eps.toSorted((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0] ?? 0;
  let prev = start;
  for (let i = 1; i <= sorted.length; i++) {
    const cur = sorted[i];
    if (cur !== undefined && cur === prev + 1) {
      prev = cur;
      continue;
    }
    parts.push(start === prev ? `第${start}集` : `第${start}-${prev}集`);
    if (cur !== undefined) {
      start = cur;
      prev = cur;
    }
  }
  return `出场 ${parts.join('、')}`;
}
</script>

<template>
  <Spin :spinning="loading">
    <!-- 顶层分类：可增删改 -->
    <div class="mb-3">
      <Tabs v-model:active-key="topId as any" size="small" type="card">
        <Tabs.TabPane :key="null as any" tab="全部" />
        <Tabs.TabPane v-for="t in tree" :key="t.id">
          <template #tab>
            <span class="flex items-center gap-1">
              {{ t.name }}
              <span class="text-xs text-muted-foreground">
                ({{ t.requirementIds.length }})
              </span>
            </span>
          </template>
        </Tabs.TabPane>
      </Tabs>

      <div class="mt-2 flex flex-wrap items-center gap-2">
        <Button size="small" @click="openCreateTop">+ 顶层分类</Button>
        <template v-if="currentTop">
          <Button size="small" @click="openEdit(currentTop)">
            编辑当前顶层
          </Button>
          <Popconfirm
            title="删除该顶层分类？（其下子分类需一并确认）"
            @confirm="removeCategory(currentTop)"
          >
            <Button danger size="small">删除当前顶层</Button>
          </Popconfirm>
          <span class="text-xs text-muted-foreground">
            共 {{ currentTop.requirementIds.length }} 个素材直接挂在此分类
          </span>
        </template>
        <span v-else class="text-xs text-muted-foreground">
          共 {{ items.length }} 个素材
          <template v-if="uncategorizedCount > 0">
            · 其中 {{ uncategorizedCount }} 个未归类
          </template>
        </span>
      </div>
    </div>

    <!-- 子分类：可多选筛选，也能增删改 -->
    <div v-if="currentTop" class="mb-3">
      <div class="mb-1 text-xs text-muted-foreground">子分类（可多选筛选）</div>
      <div class="flex flex-wrap items-center gap-2">
        <div
          v-for="c in subCategories"
          :key="c.id"
          class="group flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs transition-all"
          :class="
            subIds.includes(c.id)
              ? 'border-primary ring-1 ring-primary/40'
              : 'border-border hover:border-primary/50'
          "
          @click="
            subIds.includes(c.id)
              ? (subIds = subIds.filter((x) => x !== c.id))
              : subIds.push(c.id)
          "
        >
          <span>{{ c.name }}</span>
          <span class="text-muted-foreground"
            >({{ c.requirementIds.length }})</span
          >
          <Tooltip title="编辑">
            <span
              class="text-muted-foreground hover:text-primary"
              @click.stop="openEdit(c)"
              >✎</span
            >
          </Tooltip>
          <Tooltip title="删除（不影响素材）">
            <span
              class="text-muted-foreground hover:text-destructive"
              @click.stop="removeCategory(c)"
              >✕</span
            >
          </Tooltip>
        </div>
        <Button size="small" @click="openCreateSub(currentTop)">
          + 子分类
        </Button>
        <Button v-if="subIds.length > 0" size="small" @click="subIds = []">
          清除筛选
        </Button>
      </div>
    </div>

    <!--
      批量操作栏（用户 2026-10-07 要求：多选 / 全选 / 一键生成提示词 / 一键生成图像）。
      只在当前筛选结果非空时显示，避免空列表上挂一排点不动的按钮。
    -->
    <div
      v-if="filtered.length > 0"
      class="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 p-2"
    >
      <Checkbox
        :checked="allSelected"
        :indeterminate="someSelected"
        @change="(e: any) => toggleSelectAll(e.target.checked)"
      >
        <span class="text-xs">全选本页（{{ filtered.length }}）</span>
      </Checkbox>

      <!--
        定稿操作（用户 2026-10-07 要求）。
        > 「我说的清空选择 是把选择图 改为 未定稿状态 清除他的定稿」

        ⚠️ 注意区分两个概念（我最初理解错了）：
          · **清空选择** = 取消勾选（多选态）—— 这只是工具栏的本地状态
          · **清除定稿** = 把已定稿的图改回**未定稿**（业务状态，要落库）
        用户要的是后者。
      -->
      <Tooltip
        title="把选中素材的定稿图改回未定稿状态（需求状态回到「待生成」）"
      >
        <Button
          :disabled="selectedIds.size === 0"
          size="small"
          @click="runBatchUnapprove"
        >
          清除定稿
        </Button>
      </Tooltip>

      <template v-if="selectedIds.size > 0">
        <Tag class="!mr-0" color="blue">已选 {{ selectedIds.size }}</Tag>
        <Tooltip title="仅取消勾选（不改动定稿状态）">
          <Button size="small" type="link" @click="clearSelection">
            取消勾选
          </Button>
        </Tooltip>
      </template>

      <span class="flex-1"></span>

      <!-- 自动定稿：勾选后出图完成即取第 1 张定为定稿（后端执行） -->
      <Checkbox v-model:checked="batchAutoFinalize">
        <span class="text-xs">生成图像自动定稿</span>
      </Checkbox>

      <!--
        强制执行（用户 2026-10-07 要求）—— 破坏性开关，默认**不勾**。
        用 Tooltip 讲清"会删掉什么"，避免用户误以为只是"重试一下"。
      -->
      <Tooltip
        title="强制替换：不管有没有进行中的任务都照发。提示词会清掉旧的重新生成；图片会清空现有图片（含定稿）后重新生成。默认关闭。"
      >
        <Checkbox v-model:checked="batchForce">
          <span class="text-xs text-destructive">强制执行（替换已有）</span>
        </Checkbox>
      </Tooltip>

      <Tooltip
        :title="
          batchForce
            ? '强制模式：将清空选中素材的旧提示词并重新生成'
            : '为选中素材逐个生成提示词（走 PE-T2I），只补提示词、不出图；任务可在 AI 任务列表查看'
        "
      >
        <Button
          :disabled="selectedIds.size === 0"
          size="small"
          @click="runBatchPrompts"
        >
          一键生成提示词
        </Button>
      </Tooltip>
      <Tooltip
        :title="
          batchForce
            ? '强制模式：将清空选中素材的现有图片（含定稿）并重新生成'
            : '为选中素材下发 t2i 出图任务'
        "
      >
        <Button
          :disabled="selectedIds.size === 0"
          size="small"
          :danger="batchForce"
          :type="batchForce ? 'default' : 'primary'"
          @click="runBatchGenerate"
        >
          一键生成图像
        </Button>
      </Tooltip>
    </div>

    <!-- 素材网格：预览图 + 简介 -->
    <div
      v-if="filtered.length > 0"
      class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4"
    >
      <div
        v-for="it in filtered"
        :key="it.id"
        class="flex flex-col rounded-md border p-2"
        :class="
          selectedIds.has(it.id)
            ? 'border-primary bg-primary/5'
            : 'border-border'
        "
      >
        <!-- 勾选：让"选了哪些"一眼可见（选中卡片同时加边框高亮） -->
        <div class="mb-1 flex items-center gap-1">
          <Checkbox
            :checked="selectedIds.has(it.id)"
            @change="(e: any) => toggleSelect(it.id, e.target.checked)"
          />
          <span class="flex-1"></span>
        </div>

        <!-- 预览图 -->
        <div
          class="mb-2 cursor-pointer overflow-hidden rounded bg-muted/40"
          @click="emit('open', it)"
        >
          <AImage
            v-if="toStorageUrl(it.previewPath)"
            :src="toStorageUrl(it.previewPath)"
            :height="150"
            class="w-full object-cover"
          />
          <div
            v-else
            class="flex h-[150px] w-full items-center justify-center text-xs text-muted-foreground"
          >
            暂无图（{{ statusText(it.status) }}）
          </div>
        </div>

        <!-- 名称 + 状态 -->
        <!--
          名称可点击 → 打开素材详情（用户 2026-10-06 要求：
          「在素材页面 点击素材名字 我希望显示 这个素材的信息 并且可以修改
            例如对于任务的描述 提示词 这些」）。

          ⚠️ 改之前名称是**纯文本**，点它没有任何反应 —— 素材详情只能从
             「看候选」按钮进，而用户的心智是"点名字看详情"（列表页的通行做法）。

          用 button 而不是 span+@click：键盘可达（Tab 聚焦 / Enter 触发），
          不必额外补 a11y 属性；样式仍是普通文字，仅 hover 出现下划线，
          不改变原有视觉密度。
        -->
        <div class="flex items-center gap-1">
          <button
            class="min-w-0 truncate text-left font-medium hover:text-primary hover:underline"
            :title="`${it.name} —— 点击查看详情并修改描述 / 提示词`"
            type="button"
            @click="emit('open', it)"
          >
            {{ it.name }}
          </button>
          <Tag :color="statusColor(it.status)" class="!mr-0">
            {{ statusText(it.status) }}
          </Tag>
        </div>

        <!-- 简介：大类 · 分类 · 出场集数 -->
        <div class="mt-1 flex flex-wrap items-center gap-1 text-xs">
          <Tag class="!mr-0">{{ kindText(it.kind) }}</Tag>
          <Tag v-for="c in it.categoryIds" :key="c" class="!mr-0" color="blue">
            {{ categoryName(c) }}
          </Tag>
          <span
            v-if="it.categoryIds.length === 0"
            class="text-muted-foreground"
          >
            未归类
          </span>
        </div>
        <div class="mt-1 text-xs text-muted-foreground">
          {{ episodesText(it.episodes) }} · 候选 {{ it.candidateCount }}
        </div>
        <div class="mt-1 line-clamp-2 text-xs" :title="it.description || ''">
          {{ it.description || '（暂无描述）' }}
        </div>

        <!-- 操作 -->
        <div class="mt-2 flex flex-wrap items-center gap-1">
          <Button size="small" @click="emit('open', it)">看候选</Button>
          <Button size="small" type="primary" @click="emit('generate', it)">
            生成
          </Button>
          <Button size="small" @click="emit('versions', it)">历史版本</Button>
          <Popover
            :open="assignTarget?.id === it.id"
            placement="bottom"
            trigger="click"
            @open-change="
              (v: boolean) => (v ? openAssign(it) : (assignTarget = null))
            "
          >
            <template #content>
              <div class="w-64">
                <div class="mb-2 text-xs text-muted-foreground">
                  勾选该素材所属的子分类（可多选）
                </div>
                <Checkbox.Group
                  v-model:value="assignDraft"
                  :options="allLeaves"
                  class="flex flex-col gap-1"
                />
                <div class="mt-2 flex justify-end gap-2">
                  <Button size="small" @click="assignTarget = null">
                    取消
                  </Button>
                  <Button size="small" type="primary" @click="submitAssign">
                    保存
                  </Button>
                </div>
              </div>
            </template>
            <Button size="small">归类</Button>
          </Popover>
        </div>
      </div>
    </div>

    <Empty
      v-else
      :description="
        items.length === 0
          ? '该剧目还没有素材：先做「素材提取」，或直接在上方点「生成」'
          : '当前分类下没有素材（可在卡片上点「归类」把素材放进来）'
      "
    />

    <!-- 分类编辑弹窗 -->
    <Modal
      v-model:open="editOpen"
      :confirm-loading="saving"
      :title="editing.id ? '编辑分类' : '新增分类'"
      @ok="submitCategory"
    >
      <div class="flex flex-col gap-3">
        <div>
          <div class="mb-1 text-sm">分类名 *</div>
          <Input
            v-model:value="editing.name"
            placeholder="如：全局人物形象 / 受伤状态 / 夜戏"
          />
        </div>
        <div>
          <div class="mb-1 text-sm">父分类</div>
          <Select
            v-model:value="editing.parentId"
            :options="[
              { label: '（作为顶层分类）', value: 0 },
              ...tree.map((t) => ({
                label: `挂在「${t.name}」下`,
                value: t.id,
              })),
            ]"
            style="width: 100%"
          />
        </div>
        <div>
          <div class="mb-1 text-sm">排序（小在前）</div>
          <Input v-model:value="editing.sortNo as any" type="number" />
        </div>
      </div>
    </Modal>

    <!-- 归类之外的提示（未归类素材快捷入口） -->
    <div
      v-if="topId !== null && uncategorizedCount > 0"
      class="mt-3 text-xs text-muted-foreground"
    >
      还有 {{ uncategorizedCount }} 个素材未归类，切到「全部」可以看到它们。
    </div>
  </Spin>
</template>
