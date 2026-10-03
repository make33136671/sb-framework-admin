<script lang="ts" setup>
import type {
  AssetRequirementItem,
  DramaDetail,
  ProductEpisodeItem,
  ScriptDetail,
  ScriptEpisode,
  ShotItem,
  StageEpisodeItem,
  StageEpisodeProduceItem,
  StageKey,
  StageShotItem,
  WordParseResult,
} from '#/api/core/dramafloow';
import type { ScriptEpisodeRow } from '#/api/core/scriptEpisode';
import type { ResourceDetailType } from '#/components/ResourceDetailModal';

/**
 * 剧目详情（契约 §8）：PhaseStepper + 5 个标签页
 *   剧本（存原始稿 → 洗稿）/ 分镜 / 素材 / 片段 / 成片
 * WS 订阅 drama:<id>，阶段实时刷新。
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import { Page } from '@vben/common-ui';

import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  message,
  Segmented,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
} from 'ant-design-vue';

import {
  assetExtractStart,
  assetGenerate,
  assetRequirementList,
  dramaGet,
  productEpisodeList,
  productRender,
  scriptAnalyze,
  scriptEpisodeSplit,
  scriptGet,
  scriptParseWord,
  scriptRewrite,
  scriptSave,
  shotList,
  shotStaleReplay,
  shotStoryboard,
} from '#/api/core/dramafloow';
import {
  scriptEpisodeHistory,
  scriptEpisodeList,
  scriptEpisodeSetCurrent,
  scriptPartialPlan,
  scriptPartialRewrite,
} from '#/api/core/scriptEpisode';
import { AiProviderSelect } from '#/components/AiProviderSelect';
import { AssetCategoryView } from '#/components/AssetCategoryView';
import { AssetVersionDrawer } from '#/components/AssetVersionDrawer';
import { ResourceDetailModal } from '#/components/ResourceDetailModal';
import { RewriteOptionsPanel } from '#/components/RewriteOptionsPanel';
import { ArtifactTrace, StageRowList } from '#/components/StageRow';
import { TaskDrawer } from '#/components/TaskDrawer';
import { episodeTitle } from '#/components/TaskDrawer/taskDisplay';
import { TimeTag } from '#/components/TimeTag';
import { defaultRewriteOptions } from '#/composables/rewriteOptions';
import { useTaskStream } from '#/composables/useTaskStream';

// 路由由后端菜单动态生成，视图不接收 props：从 query 取 id（沿用 member/Form.vue 约定）
const route = useRoute();
const dramaId = computed(() => Number(route.query.id ?? 0));

const stream = useTaskStream();

const detail = ref<DramaDetail | null>(null);
const script = ref<null | ScriptDetail>(null);
const shots = ref<ShotItem[]>([]);
const requirements = ref<AssetRequirementItem[]>([]);
const episodes = ref<ProductEpisodeItem[]>([]);
const loading = ref(true);
const activeTab = ref('script');
/** 素材页视图：分类视图（默认）/ 列表视图（原始清单） */
const assetView = ref<'category' | 'list'>('category');
const assetCategoryRef = ref<null | { reload: () => void }>(null);
const sourceDraft = ref('');
const saving = ref(false);
const parsing = ref(false);
const wordInfo = ref<null | WordParseResult>(null);
const wordInputRef = ref<HTMLInputElement>();

/**
 * 五横向（横向结构 P5）：`stagesV2` 优先，回落旧 `stages`（灰度期两套并存）。
 * 仅用于「是否已有横向数据」的轻量判断 —— 实际渲染走 StageRowList 的后端聚合端点，
 * 状态不在前端重算（避免后端算的与前端理解的各说各话）。
 */
const stagesV2 = computed(
  () =>
    stream.dramaMap.value[dramaId.value]?.stagesV2 ??
    stream.dramaMap.value[dramaId.value]?.stages ??
    null,
);

// ─────────────────── 横向（Stage Row）操作 ───────────────────

const stageRowListRef = ref<null | { reload: () => void }>(null);
/** WS drama 事件变化时 +1，驱动 StageRowList 重新拉取（状态由后端算，前端不重算） */
const stageRefreshKey = ref(0);

// 任一 drama 事件落地 → 刷新横向（含初次）
watch(
  () => stream.dramaMap.value[dramaId.value],
  (v) => {
    if (v) stageRefreshKey.value += 1;
  },
);

/** 各横向的「开始/重跑」分发到对应端点 */
async function onStageRun(key: StageKey) {
  try {
    switch (key) {
      case 'analyze': {
        await scriptAnalyze(
          dramaId.value,
          rewriteProviderId.value ?? undefined,
        );

        break;
      }
      case 'episodes': {
        await scriptEpisodeSplit(
          dramaId.value,
          rewriteProviderId.value ?? undefined,
        );

        break;
      }
      case 'extract': {
        await assetExtractStart(
          dramaId.value,
          rewriteProviderId.value ?? undefined,
        );

        break;
      }
      case 'produce': {
        // 成片横向：先要求有分集，再对全部分集跑分镜
        await shotStoryboard(
          dramaId.value,
          null,
          rewriteProviderId.value ?? undefined,
        );

        break;
      }
      case 'rewrite': {
        await rewrite();
        return; // rewrite() 自带提示与刷新
      }
      // No default
    }
    // 入队后稍等再刷新，避免任务状态还没落库
    setTimeout(() => {
      stageRowListRef.value?.reload();
      loadAll();
    }, 600);
  } catch {
    // 拦截器已提示；此处只需保证不阻断 UI
  }
}

/** 单集分镜（用户要求：每一集可以进入了 开始分镜） */
async function storyboardEpisode(ep: StageEpisodeItem) {
  await shotStoryboard(
    dramaId.value,
    ep.episodeNo,
    rewriteProviderId.value ?? undefined,
  );
  setTimeout(() => {
    stageRowListRef.value?.reload();
    loadAll();
  }, 600);
}

/** 把 characterRefs（CSV/JSON 两种历史格式）拆成标签数组 */
function splitRefs(raw?: null | string): string[] {
  if (!raw) return [];
  const t = raw.trim();
  if (t.startsWith('[')) {
    try {
      const arr = JSON.parse(t);
      return Array.isArray(arr) ? arr.map(String) : [];
    } catch {
      return [];
    }
  }
  return t
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 单镜预览：复用既有片段详情弹窗（避免再造一个播放器） */
// 表格插槽给出的 record 是宽松类型，此处收窄（表格数据源本身已强类型）
function previewShot(row: Record<string, any>) {
  openClipDetail(row as StageShotItem as unknown as ShotItem);
}

function previewEpisodeProduct(ep: StageEpisodeProduceItem) {
  const found = episodes.value.find((p) => p.episodeNo === ep.episodeNo);
  if (found) openEpisodeDetail(found);
}

/** 成片横向里的镜级表格列（与剧本 Tab 的分镜表列不同，故单独一份） */
const stageShotColumns = [
  { dataIndex: 'shotNo', key: 'shotNo', title: '镜', width: 70 },
  { dataIndex: 'description', key: 'description', title: '画面描述' },
  { key: 'assets', title: '用了哪些素材', width: 200 },
  { key: 'clip', title: '产出的片段', width: 140 },
];

async function loadAll() {
  loading.value = true;
  // 分类视图是独立数据源（含预览图/出场集数），一起刷新
  const refreshCategoryView = () => assetCategoryRef.value?.reload();
  try {
    detail.value = await dramaGet(dramaId.value);
    // 剧本可能尚未创建（后端返回错误），静默处理
    try {
      script.value = await scriptGet(dramaId.value);
      sourceDraft.value = script.value.sourceText ?? '';
      // 回填该版洗稿用的选项，支持"照上次参数再洗一版"
      loadOptionsFromScript();
    } catch {
      script.value = null;
    }
    const [s, r, p] = await Promise.all([
      shotList({ dramaId: dramaId.value, pageSize: 100 }),
      assetRequirementList({ dramaId: dramaId.value, pageSize: 100 }),
      productEpisodeList(dramaId.value),
    ]);
    shots.value = s.items;
    requirements.value = r.items;
    episodes.value = p.episodes;
  } catch {
    // 拦截器已提示
  } finally {
    loading.value = false;
    refreshCategoryView();
    void loadEpisodeVersions();
  }
}

onMounted(() => {
  stream.subscribeDrama(dramaId.value);
  void loadAll();
});

/** 每集当前版本（100 / 100.1） */
const episodeVersions = ref<ScriptEpisodeRow[]>([]);
/** 选区重洗的预览结果 */
const partialPlan = ref<null | {
  episodes: {
    current: string;
    episodeNo: number;
    next: string;
    sourceLength: number;
  }[];
  selectionLength: number;
}>(null);
const partialLoading = ref(false);

async function loadEpisodeVersions() {
  try {
    episodeVersions.value = await scriptEpisodeList(dramaId.value);
  } catch {
    episodeVersions.value = [];
  }
}

/** 某集的展示版本号（无按集数据时回退到整本版本） */
function episodeVersion(no: number): string {
  const row = episodeVersions.value.find((e) => e.episodeNo === no);
  return row?.version ?? String(script.value?.version ?? '-');
}

/** 某集是否已被局部重洗过（用于高亮标记） */
function isPartial(no: number): boolean {
  const row = episodeVersions.value.find((e) => e.episodeNo === no);
  return row?.origin === 'partial';
}

/** 原始稿框选（当前选中的字符区间与文本） */
const sourceAreaRef = ref<HTMLTextAreaElement | null>(null);
const sourceSelection = ref<null | {
  end: number;
  start: number;
  text: string;
}>(null);
/** 只读展示：直接绑 script.sourceText，写不进去（readonly） */
const sourceDraftView = computed(() => script.value?.sourceText ?? '');

function onSourceSelect() {
  const el = sourceAreaRef.value;
  if (!el) return;
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  const text = el.value.slice(start, end);
  sourceSelection.value = text.trim().length > 0 ? { start, end, text } : null;
}

/** 预览：选区会影响哪几集、各变成什么版本号 */
async function previewPartial() {
  const sel = sourceSelection.value;
  if (!sel) return;
  partialLoading.value = true;
  try {
    const plan = await scriptPartialPlan(dramaId.value, sel.start, sel.end);
    partialPlan.value = plan;
  } catch {
    partialPlan.value = null;
  } finally {
    partialLoading.value = false;
  }
}

/** 提交选区重洗（入队，完成后可刷新查看） */
async function submitPartial() {
  const sel = sourceSelection.value;
  if (!sel) return;
  partialLoading.value = true;
  try {
    await scriptPartialRewrite({
      dramaId: dramaId.value,
      start: sel.start,
      end: sel.end,
      providerId: rewriteProviderId.value,
      rewriteOptions: JSON.stringify(rewriteOpts.value),
    });
    partialPlan.value = null;
    clearSourceSelection();
    await loadAll();
  } finally {
    partialLoading.value = false;
  }
}

/** 当前查看的集的历史版本（供弹窗回退用） */
const episodeHistory = ref<
  {
    createdAt: string;
    id: number;
    isCurrent: boolean;
    origin: string;
    version: string;
  }[]
>([]);

/** 打开某集详情时按需拉取该集历史 */
async function loadEpisodeHistory(no: number) {
  try {
    episodeHistory.value = await scriptEpisodeHistory(dramaId.value, no);
  } catch {
    episodeHistory.value = [];
  }
}

/** 单集回退：切到指定历史版本（不改其它集） */
async function onRevertEpisode(id: number) {
  const no = detailScriptEpisode.value?.no;
  if (!no) return;
  await scriptEpisodeSetCurrent(dramaId.value, no, id);
  await loadEpisodeHistory(no);
  await loadEpisodeVersions();
  await loadAll();
}

function clearSourceSelection() {
  sourceSelection.value = null;
  const el = sourceAreaRef.value;
  if (el) {
    el.selectionStart = el.selectionEnd = 0;
  }
}

/** 洗稿细化选项（A–E；键名与后端 RewriteOptions 一致） */
const rewriteOpts = ref<Record<string, any>>(defaultRewriteOptions());
/** 选项面板是否展开（默认收起，保持剧本页干净） */
const rewriteOptsOpen = ref(false);

/** 各能力当前选中的服务（null = 自动，走该能力的默认服务） */
const rewriteProviderId = ref<null | number>(null);
const extractProviderId = ref<null | number>(null);
const t2iProviderId = ref<null | number>(null);
const i2vProviderId = ref<null | number>(null);

async function saveSource() {
  if (!sourceDraft.value.trim()) return;
  saving.value = true;
  try {
    await scriptSave(dramaId.value, sourceDraft.value);
    await loadAll();
  } finally {
    saving.value = false;
  }
}

/** 选择 .docx → 解析为纯文本填入草稿（不写库，用户校对后再保存） */
async function onWordPicked(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  // 允许重复选择同一文件（否则第二次 change 不触发）
  input.value = '';
  if (!file) return;

  if (!file.name.toLowerCase().endsWith('.docx')) {
    message.error('仅支持 .docx 文件；旧版 .doc 请在 Word 中另存为 .docx');
    return;
  }

  parsing.value = true;
  try {
    const res = await scriptParseWord(file);
    sourceDraft.value = res.text;
    wordInfo.value = res;
    message.success(`解析成功：${res.charCount} 字，请校对后保存`);
  } catch (error: any) {
    // 后端已把 .doc / 损坏 / 加密 等情况转为可读中文提示
    message.error(error?.message || 'Word 解析失败');
  } finally {
    parsing.value = false;
  }
}

async function rewrite() {
  await scriptRewrite(
    dramaId.value,
    rewriteProviderId.value,
    JSON.stringify(rewriteOpts.value),
  );
  await loadAll();
}

/** 载入历史版本时，把该版的选项回填到面板（便于"照上次参数再洗一版"） */
function loadOptionsFromScript() {
  const raw = script.value?.rewriteOptions;
  if (!raw) return;
  try {
    rewriteOpts.value = { ...defaultRewriteOptions(), ...JSON.parse(raw) };
  } catch {
    // 快照损坏就用默认值，不打断页面
  }
}

async function generateAsset(row: AssetRequirementItem) {
  await assetGenerate(row.id, t2iProviderId.value);
  await loadAll();
}

/** 分类视图里只有 id（它是另一套视图模型）：按 id 找到需求再走原逻辑 */
function requirementById(id: number): AssetRequirementItem | null {
  return requirements.value.find((r) => r.id === id) ?? null;
}

function openAssetDetailById(id: number) {
  const row = requirementById(id);
  if (row) openAssetDetail(row);
}

async function generateAssetById(id: number) {
  const row = requirementById(id);
  if (!row) return;
  await generateAsset(row);
  assetCategoryRef.value?.reload();
}

/** 素材提取抽屉 / 子任务详情抽屉 */
const assetKey = ref<null | string>(null);
const taskId = ref<null | number>(null);

/** 触发「素材提取」：LLM 从剧本正文提取 角色/道具/场景（每次新增一版） */
async function extractAssets() {
  const res = await assetExtractStart(dramaId.value, extractProviderId.value);
  message.success(
    `素材提取已入队（任务 #${res.taskId}），完成后可在「历史版本」查看`,
  );
  await loadAll();
}

async function replayShot(row: ShotItem) {
  await shotStaleReplay(row.id, i2vProviderId.value);
  await loadAll();
}

async function renderProduct() {
  await productRender(dramaId.value);
  await loadAll();
}

// ─────────────────── 详情弹窗（分镜 / 片段 / 素材 / 成片 / 剧本集） ───────────────────

/** 当前打开的详情类型；null = 全部关闭 */
const detailType = ref<null | ResourceDetailType>(null);
const detailShot = ref<null | ShotItem>(null);
const detailClipShot = ref<null | ShotItem>(null);
const detailRequirement = ref<AssetRequirementItem | null>(null);
const detailEpisode = ref<null | ProductEpisodeItem>(null);
const detailScriptEpisode = ref<null | ScriptEpisode>(null);

function openShotDetail(row: ShotItem) {
  detailShot.value = row;
  detailType.value = 'shot';
}

/** 片段详情：与分镜详情分开存行数据，避免两个弹窗互相覆盖 */
function openClipDetail(row: ShotItem) {
  detailClipShot.value = row;
  detailType.value = 'clip';
}

function openAssetDetail(row: AssetRequirementItem) {
  detailRequirement.value = row;
  detailType.value = 'asset';
}

function openEpisodeDetail(row: ProductEpisodeItem) {
  detailEpisode.value = row;
  detailType.value = 'product';
}

function openScriptEpisode(ep: ScriptEpisode) {
  detailScriptEpisode.value = ep;
  detailType.value = 'script-ep';
  void loadEpisodeHistory(ep.no);
}

function closeDetail() {
  detailType.value = null;
}

/** 弹窗内的子任务「详情」→ 关弹窗并打开 TaskDrawer（避免双层遮罩叠在一起） */
function openTaskFromDetail(id: number) {
  closeDetail();
  taskId.value = id;
}

// ── 各行点击（antd customRow 收 any，这里统一在 TS 里断言成业务类型） ──

/** 点分镜行 → 分镜详情 */
function onShotRow(record: ShotItem) {
  return { onClick: () => openShotDetail(record) };
}

/** 点素材行 → 素材需求详情 */
function onRequirementRow(record: AssetRequirementItem) {
  return { onClick: () => openAssetDetail(record) };
}

/** 点片段行 → 片段详情 */
function onClipRow(record: ShotItem) {
  return { onClick: () => openClipDetail(record) };
}

/** 点成片行 → 成片详情 */
function onEpisodeRow(record: ProductEpisodeItem) {
  return { onClick: () => openEpisodeDetail(record) };
}

const shotColumns = [
  { title: '集', dataIndex: 'episodeNo', width: 60 },
  { title: '镜', dataIndex: 'shotNo', width: 60 },
  { title: '景别', dataIndex: 'composition', width: 90 },
  { title: '氛围', dataIndex: 'mood', width: 90 },
  { title: '秒', dataIndex: 'durationSec', width: 60 },
  { title: '描述', dataIndex: 'description', ellipsis: true },
  { title: '状态', key: 'status', width: 100 },
  { title: '操作', key: 'action', width: 70 },
];

const reqColumns = [
  { title: 'Key', dataIndex: 'key', width: 180 },
  { title: '种类', key: 'kind', width: 90 },
  { title: '版本', key: 'version', width: 110 },
  { title: '描述', dataIndex: 'description', ellipsis: true },
  { title: '候选', key: 'cand', width: 110 },
  { title: '状态', key: 'status', width: 100 },
  { title: '操作', key: 'action', width: 130 },
];

/** 片段列表列（片段 = 分镜的 clip） */
const clipColumns = [
  { title: '集', dataIndex: 'episodeNo', width: 60 },
  { title: '镜', dataIndex: 'shotNo', width: 60 },
  { title: '分镜状态', key: 'status', width: 110 },
  { title: '片段状态', key: 'clip', width: 110 },
  { title: '视频', key: 'video' },
  { title: '操作', key: 'action', width: 70 },
];

/** 成片列 */
const productColumns = [
  { title: '集', dataIndex: 'episodeNo', width: 60 },
  { title: '版本', dataIndex: 'version', width: 70 },
  { title: '状态', key: 'status', width: 100 },
  { title: '时长', dataIndex: 'durationSec', width: 80 },
  { title: '发布', key: 'published', width: 170 },
  { title: '操作', key: 'action', width: 70 },
];

/** 素材种类中文名（角色 / 场景 / 道具） */
function kindText(kind: string): string {
  if (kind === 'character') return '角色';
  if (kind === 'scene') return '场景';
  if (kind === 'prop') return '道具';
  return kind;
}

function shotStatusColor(s: string): string {
  if (s === 'done') return 'success';
  if (s === 'stale') return 'error';
  if (s === 'generating') return 'processing';
  return 'default';
}

function reqStatusColor(s: string): string {
  if (s === 'approved') return 'success';
  if (s === 'rejected') return 'error';
  if (s === 'generating') return 'processing';
  return 'warning';
}
</script>

<template>
  <Page class="df-page" :title="detail?.drama.name ?? '剧目详情'">
    <template #extra>
      <Space>
        <Tag>{{ detail?.drama.code }}</Tag>
        <Tag color="processing">{{ detail?.drama.status }}</Tag>
      </Space>
    </template>

    <Spin :spinning="loading">
      <!-- 五行横向（横向结构 P5）：每个横向可独立执行、有产物、可展开子项 -->
      <Card
        class="mb-4"
        size="small"
        title="生产横向（每个横向都可单独执行，产出各自产物）"
      >
        <StageRowList
          ref="stageRowListRef"
          :drama-id="dramaId"
          :refresh-key="stageRefreshKey"
          @run="onStageRun"
        >
          <!-- 横向④ 分集：子项 = 一集一行，可单独开始分镜 -->
          <template #episodes="{ row }">
            <div class="space-y-2">
              <Alert
                v-if="(row.items as StageEpisodeItem[]).length === 0"
                message="还没有分集。点上方「开始」按剧本拆集（不依赖洗稿）。"
                show-icon
                type="info"
              />
              <div
                v-for="ep in row.items as StageEpisodeItem[]"
                :key="ep.id"
                class="flex flex-wrap items-center gap-2 rounded border p-2"
              >
                <Tag color="blue" class="!mr-0">第 {{ ep.episodeNo }} 集</Tag>
                <span class="text-sm">{{ ep.title || '（无标题）' }}</span>
                <Tag class="!mr-0">v{{ ep.displayVersion }}</Tag>
                <Tag class="!mr-0">{{ ep.shotCount }} 镜</Tag>
                <Tag v-if="ep.origin !== 'rewrite'" class="!mr-0">
                  来源:
                  {{ ep.origin === 'structure' ? '结构产物' : '规则切分' }}
                </Tag>
                <span class="flex-1"></span>
                <!-- 用户要求：「每一集可以进入了 开始分镜」 -->
                <Button
                  size="small"
                  :type="ep.shotCount === 0 ? 'primary' : 'default'"
                  @click="storyboardEpisode(ep)"
                >
                  {{ ep.shotCount === 0 ? '开始分镜' : '重跑分镜' }}
                </Button>
              </div>
              <ArtifactTrace :versions="row.versions" />
            </div>
          </template>

          <!-- 横向⑤ 成片：子项 = 集 → 镜，支持单集/单镜预览与溯源 -->
          <template #produce="{ row }">
            <div class="space-y-3">
              <Alert
                v-if="(row.items as StageEpisodeProduceItem[]).length === 0"
                message="还没有分镜。请先在「分集」横向里对某一集点「开始分镜」。"
                show-icon
                type="info"
              />
              <div
                v-for="epItem in row.items as StageEpisodeProduceItem[]"
                :key="epItem.episodeNo"
                class="rounded border p-2"
              >
                <div class="mb-2 flex flex-wrap items-center gap-2">
                  <Tag color="blue" class="!mr-0">
                    第 {{ epItem.episodeNo }} 集
                  </Tag>
                  <span class="text-sm">{{
                    epItem.title || '（无标题）'
                  }}</span>
                  <Tag class="!mr-0">{{ epItem.shots.length }} 镜</Tag>
                  <!-- 单集预览（用户要求：单集可预览） -->
                  <template v-if="epItem.product?.videoPath">
                    <Button
                      size="small"
                      type="link"
                      @click="previewEpisodeProduct(epItem)"
                    >
                      预览成片
                    </Button>
                    <Tag color="success" class="!mr-0">
                      成片 v{{ epItem.product.version }}
                    </Tag>
                  </template>
                </div>

                <!-- 镜级子项：用了哪些素材 + 产出了什么 + 单镜预览 -->
                <Table
                  :columns="stageShotColumns"
                  :data-source="epItem.shots"
                  :pagination="false"
                  :row-key="(r: StageShotItem) => r.id"
                  size="small"
                >
                  <template #bodyCell="{ column, record }">
                    <template v-if="column.key === 'shotNo'">
                      镜 {{ record.shotNo }}
                    </template>
                    <template v-else-if="column.key === 'description'">
                      <div class="max-w-md text-xs">
                        {{ record.description || '—' }}
                      </div>
                    </template>
                    <template v-else-if="column.key === 'assets'">
                      <!-- 用了哪些素材（用户诉求） -->
                      <div class="flex flex-wrap gap-1">
                        <Tag
                          v-for="c in splitRefs(record.characterRefs)"
                          :key="c"
                          class="!mr-0"
                        >
                          {{ c }}
                        </Tag>
                        <Tag v-if="record.sceneRef" class="!mr-0" color="cyan">
                          {{ record.sceneRef }}
                        </Tag>
                        <span
                          v-if="!record.characterRefs && !record.sceneRef"
                          class="text-xs text-muted-foreground"
                        >
                          未绑定
                        </span>
                      </div>
                    </template>
                    <template v-else-if="column.key === 'clip'">
                      <!-- 产出了什么 -->
                      <template v-if="record.clip?.videoPath">
                        <Button
                          size="small"
                          type="link"
                          @click="previewShot(record)"
                        >
                          预览片段
                        </Button>
                      </template>
                      <Tag
                        v-else-if="record.clip"
                        color="processing"
                        class="!mr-0"
                      >
                        {{ record.clip.status }}
                      </Tag>
                      <span v-else class="text-xs text-muted-foreground"
                        >未生成</span
                      >
                    </template>
                  </template>
                </Table>
              </div>
              <ArtifactTrace :versions="row.versions" />
            </div>
          </template>
        </StageRowList>

        <div class="mt-2 text-xs text-muted-foreground">
          <template v-if="stagesV2">
            实时通道已连接（WS drama:{{ dramaId }}）；横向状态由后端
            StageRowCore 计算。
          </template>
          <template v-else>
            实时通道连接中…（阶段数据来自 WS drama:{{ dramaId }} 事件）
          </template>
          「已跳过」表示该横向是可选环节且未执行，不影响后续横向。
        </div>
      </Card>

      <Tabs v-model:active-key="activeTab">
        <!-- 1) 剧本 -->
        <Tabs.TabPane key="script" tab="剧本">
          <Card size="small">
            <template v-if="!script">
              <Alert
                class="mb-3"
                message="尚未保存原始稿。原始稿只能保存一次且不可修改（不变量：source_text 不可变）。"
                type="info"
                show-icon
              />

              <!-- 上传剧本通常为 Word：先解析 → 预览校对 → 再保存 -->
              <div class="mb-3 flex flex-wrap items-center gap-3">
                <input
                  ref="wordInputRef"
                  accept=".docx"
                  class="hidden"
                  type="file"
                  @change="onWordPicked"
                />
                <Button :loading="parsing" @click="wordInputRef?.click()">
                  上传 Word 剧本（.docx）
                </Button>
                <span class="text-xs text-muted-foreground">
                  解析后填入下方文本框，请校对无误再保存（源文本不可修改）
                </span>
              </div>

              <Alert
                v-if="wordInfo"
                class="mb-3"
                :message="`已解析《${wordInfo.fileName}》：${wordInfo.charCount} 字 / ${wordInfo.lineCount} 段${wordInfo.tableCount > 0 ? ` / ${wordInfo.tableCount} 个表格` : ''}`"
                type="success"
                show-icon
                closable
                @close="wordInfo = null"
              />

              <Input.TextArea
                v-model:value="sourceDraft"
                :rows="12"
                placeholder="上传 .docx 自动解析，或直接粘贴原始剧本/小说文本…"
              />
              <Button
                class="mt-3"
                type="primary"
                :loading="saving"
                :disabled="!sourceDraft.trim()"
                @click="saveSource"
              >
                保存原始稿（仅此一次）
              </Button>
            </template>

            <template v-else>
              <div class="mb-2 flex flex-wrap items-center gap-3">
                <span>当前版本 v{{ script.version }}</span>
                <Tag>{{ script.episodeCount }} 集</Tag>
                <Tag v-if="script.model">{{ script.model }}</Tag>
                <AiProviderSelect
                  v-model:value="rewriteProviderId"
                  task-type="rewrite"
                />
                <Button
                  type="primary"
                  size="small"
                  :disabled="script.status === 'rewriting'"
                  @click="rewrite"
                >
                  洗稿（生成 {{ rewriteOpts.episodeCount }} 集）
                </Button>
                <Button
                  size="small"
                  @click="rewriteOptsOpen = !rewriteOptsOpen"
                >
                  {{ rewriteOptsOpen ? '收起细化选项' : '细化选项' }}
                </Button>
                <Button size="small" @click="loadAll">刷新</Button>
              </div>

              <!-- 洗稿细化选项（A 集级结构 / B 强化分析 / C 内容策略 / D 人物主线 / E 各动作强化） -->
              <div v-if="rewriteOptsOpen" class="mb-3">
                <RewriteOptionsPanel
                  v-model="rewriteOpts"
                  :episode-target-count="detail?.drama.episodeTargetCount ?? 10"
                />
              </div>

              <div class="grid grid-cols-2 gap-4">
                <div>
                  <div
                    class="mb-1 flex items-center gap-2 text-sm text-muted-foreground"
                  >
                    <span>原始稿（不可变）</span>
                    <span
                      v-if="sourceSelection"
                      class="flex flex-wrap items-center gap-2 text-xs text-primary"
                    >
                      已选 {{ sourceSelection.text.length }} 字（第
                      {{ sourceSelection.start }}–{{ sourceSelection.end }} 字）
                      <Button
                        size="small"
                        :loading="partialLoading"
                        @click="previewPartial"
                      >
                        预览影响
                      </Button>
                      <Button
                        size="small"
                        type="primary"
                        :loading="partialLoading"
                        @click="submitPartial"
                      >
                        重洗选中部分
                      </Button>
                      <a @click="clearSourceSelection">清除</a>
                    </span>
                  </div>
                  <!--
                    用原生 textarea 而不是 Input.TextArea：
                    antd 的 readonly TextArea 在部分浏览器下无法用鼠标框选文本
                    （用户报「原始稿里没法选择片段」）。原生只读 textarea 可正常选中。
                  -->
                  <textarea
                    ref="sourceAreaRef"
                    v-model="sourceDraftView"
                    class="h-[350px] w-full resize-none rounded border border-border bg-transparent p-3 font-mono text-sm"
                    readonly
                    spellcheck="false"
                    @mouseup="onSourceSelect"
                    @keyup="onSourceSelect"
                  ></textarea>
                  <!-- 选区重洗预览：明确告诉用户"会影响哪几集、各变成什么版本号" -->
                  <div
                    v-if="partialPlan"
                    class="mt-2 rounded border border-border p-2 text-xs"
                  >
                    <div class="mb-1 text-muted-foreground">
                      选中 {{ partialPlan.selectionLength }} 字，将影响
                      {{ partialPlan.episodes.length }} 集：
                    </div>
                    <div class="flex flex-wrap gap-2">
                      <Tag
                        v-for="e in partialPlan.episodes"
                        :key="e.episodeNo"
                        class="!mr-0"
                        color="processing"
                      >
                        第 {{ e.episodeNo }} 集：{{ e.current }} → {{ e.next }}
                      </Tag>
                    </div>
                  </div>
                </div>
                <div>
                  <div class="mb-1 text-sm text-muted-foreground">
                    改写结果（{{ script.episodes.length }} 集）
                  </div>
                  <div
                    class="h-[350px] overflow-auto rounded border border-border p-3 text-sm"
                  >
                    <template v-if="script.episodes.length > 0">
                      <div
                        v-for="ep in script.episodes"
                        :key="ep.no"
                        class="mb-3"
                      >
                        <div class="flex items-center gap-2">
                          <span class="font-medium">
                            第 {{ ep.no }} 集
                            <template v-if="episodeTitle(ep.title)">
                              · {{ episodeTitle(ep.title) }}
                            </template>
                          </span>
                          <Tag class="!mr-0">v{{ episodeVersion(ep.no) }}</Tag>
                          <Tag
                            v-if="isPartial(ep.no)"
                            class="!mr-0"
                            color="processing"
                            title="该集做过局部重洗"
                          >
                            局部重洗
                          </Tag>
                          <Button
                            size="small"
                            type="primary"
                            @click="openScriptEpisode(ep)"
                          >
                            查看详情
                          </Button>
                        </div>
                        <div
                          v-for="(sc, i) in ep.scenes"
                          :key="i"
                          class="text-muted-foreground"
                        >
                          · {{ sc.text }}（{{ sc.duration }}s）
                        </div>
                      </div>
                    </template>
                    <Empty v-else description="尚未洗稿" />
                  </div>
                </div>
              </div>
            </template>
          </Card>
        </Tabs.TabPane>

        <!-- 2) 素材 -->
        <Tabs.TabPane key="assets" :tab="`素材（${requirements.length}）`">
          <div class="mb-3 flex flex-wrap items-center gap-3">
            <Button size="small" type="primary" @click="extractAssets">
              素材提取（角色 / 道具 / 场景）
            </Button>
            <AiProviderSelect
              v-model:value="extractProviderId"
              task-type="asset_extract"
            />
            <span class="flex-1"></span>
            <Segmented
              v-model:value="assetView"
              :options="[
                { label: '分类视图', value: 'category' },
                { label: '列表视图', value: 'list' },
              ]"
            />
          </div>

          <!-- 分类视图（默认）：分类树 + 素材网格 -->
          <AssetCategoryView
            v-if="assetView === 'category'"
            ref="assetCategoryRef"
            :drama-id="dramaId"
            @changed="loadAll"
            @generate="(it) => generateAssetById(it.id)"
            @open="(it) => openAssetDetailById(it.id)"
            @versions="(it) => (assetKey = it.key)"
          />

          <!-- 列表视图：原始清单（key/版本/候选/状态），便于处理没有图的行 -->
          <template v-else>
            <div class="mb-2 flex flex-wrap items-center gap-2 pt-3">
              <span class="text-xs text-muted-foreground">出图服务</span>
              <AiProviderSelect v-model:value="t2iProviderId" task-type="t2i" />
            </div>

            <Table
              :columns="reqColumns"
              :custom-row="onRequirementRow"
              :data-source="requirements"
              :pagination="{ pageSize: 20 }"
              :scroll="{ x: 'max-content' }"
              row-key="id"
              size="small"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'kind'">
                  <Tag class="!mr-0">{{ kindText(record.kind) }}</Tag>
                </template>
                <template v-else-if="column.key === 'version'">
                  <span>v{{ record.version }}</span>
                  <Tag
                    v-if="record.isCurrent"
                    color="success"
                    class="ml-1 !mr-0"
                  >
                    当前
                  </Tag>
                  <div v-if="(record.versionCount ?? 1) > 1" class="text-xs">
                    <a @click.stop="assetKey = record.key">
                      共 {{ record.versionCount }} 版
                    </a>
                  </div>
                </template>
                <template v-else-if="column.key === 'cand'">
                  {{ record.approvedCount }}/{{ record.candidateCount }} 通过
                </template>
                <template v-else-if="column.key === 'status'">
                  <Tag :color="reqStatusColor(record.status)" class="!mr-0">
                    {{ record.status }}
                  </Tag>
                </template>
                <template v-else-if="column.key === 'action'">
                  <Space>
                    <Button
                      size="small"
                      @click.stop="
                        openAssetDetail(record as AssetRequirementItem)
                      "
                    >
                      详情
                    </Button>
                    <Button
                      size="small"
                      type="primary"
                      @click.stop="
                        generateAsset(record as AssetRequirementItem)
                      "
                    >
                      生成
                    </Button>
                    <Button size="small" @click.stop="assetKey = record.key">
                      历史版本
                    </Button>
                  </Space>
                </template>
              </template>
            </Table>
          </template>
        </Tabs.TabPane>

        <!-- 3) 分镜 -->
        <Tabs.TabPane key="shots" :tab="`分镜（${shots.length}）`">
          <div class="mb-2 flex flex-wrap items-center gap-2">
            <span class="text-xs text-muted-foreground">片段服务</span>
            <AiProviderSelect v-model:value="i2vProviderId" task-type="i2v" />
          </div>

          <Table
            :columns="shotColumns"
            :custom-row="onShotRow"
            :data-source="shots"
            :pagination="{ pageSize: 20 }"
            :scroll="{ x: 'max-content' }"
            row-key="id"
            size="small"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'status'">
                <Tag :color="shotStatusColor(record.status)" class="!mr-0">
                  {{ record.status }}
                </Tag>
              </template>
              <template v-else-if="column.key === 'action'">
                <Space>
                  <Button
                    size="small"
                    @click.stop="openShotDetail(record as ShotItem)"
                  >
                    详情
                  </Button>
                  <Button
                    v-if="record.status === 'stale'"
                    size="small"
                    type="primary"
                    @click.stop="replayShot(record as ShotItem)"
                  >
                    重跑
                  </Button>
                </Space>
              </template>
            </template>
          </Table>
        </Tabs.TabPane>

        <!-- 4) 片段 -->
        <Tabs.TabPane key="clips" tab="片段">
          <Card size="small">
            <div class="mb-2 text-sm text-muted-foreground">
              片段由分镜 i2v 生成（无人工审核）；失效片段需在分镜页手动重跑。
            </div>
            <Table
              :columns="clipColumns"
              :custom-row="onClipRow"
              :data-source="shots.filter((s) => s.clip)"
              :pagination="{ pageSize: 20 }"
              row-key="id"
              size="small"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'status'">
                  <Tag :color="shotStatusColor(record.status)" class="!mr-0">
                    {{ record.status }}
                  </Tag>
                </template>
                <template v-else-if="column.key === 'clip'">
                  <Tag
                    :color="record.clip.status === 'done' ? 'success' : 'error'"
                    class="!mr-0"
                  >
                    {{ record.clip.status }}
                  </Tag>
                </template>
                <template v-else-if="column.key === 'video'">
                  <span class="break-all text-xs">{{
                    record.clip.videoPath
                  }}</span>
                </template>
                <template v-else-if="column.key === 'action'">
                  <Button
                    size="small"
                    @click.stop="openClipDetail(record as ShotItem)"
                  >
                    详情
                  </Button>
                </template>
              </template>
            </Table>
          </Card>
        </Tabs.TabPane>

        <!-- 5) 成片 -->
        <Tabs.TabPane key="product" tab="成片">
          <Card size="small">
            <div class="mb-3 flex items-center gap-3">
              <Button type="primary" size="small" @click="renderProduct">
                渲染成片（合并已完成片段）
              </Button>
              <span class="text-xs text-muted-foreground">
                已完成片段 {{ detail?.clipDone ?? 0 }} 个 · 成片
                {{ detail?.productDone ?? 0 }} 集
              </span>
            </div>

            <Table
              v-if="episodes.length > 0"
              :columns="productColumns"
              :custom-row="onEpisodeRow"
              :data-source="episodes"
              :pagination="false"
              row-key="id"
              size="small"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'status'">
                  <Tag
                    :color="record.status === 'done' ? 'success' : 'processing'"
                    class="!mr-0"
                  >
                    {{ record.status }}
                  </Tag>
                </template>
                <template v-else-if="column.key === 'published'">
                  <TimeTag
                    v-if="record.publishedAt"
                    :time="record.publishedAt"
                  />
                  <span v-else class="text-muted-foreground">未发布</span>
                </template>
                <template v-else-if="column.key === 'action'">
                  <Button
                    size="small"
                    @click.stop="
                      openEpisodeDetail(record as ProductEpisodeItem)
                    "
                  >
                    详情
                  </Button>
                </template>
              </template>
            </Table>
            <Empty v-else description="尚未渲染成片（需先有已完成片段）" />
          </Card>
        </Tabs.TabPane>
      </Tabs>
    </Spin>

    <!-- 素材历史版本抽屉（回选/删除/重新提取） -->
    <AssetVersionDrawer
      :drama-id="dramaId"
      :asset-key="assetKey"
      @close="assetKey = null"
      @changed="loadAll"
    />

    <!-- 子任务详情抽屉（查看/重新生成/取消/删除/手动修改） -->
    <TaskDrawer :task-id="taskId" @close="taskId = null" @changed="loadAll" />

    <!-- 统一详情弹窗：分镜 / 片段 / 素材需求 / 成片 / 剧本集 -->
    <ResourceDetailModal
      :product-episode="detailEpisode"
      :requirement="detailRequirement"
      :script-episode="detailScriptEpisode"
      :script-episode-history="episodeHistory"
      :script-episode-version="
        detailScriptEpisode ? episodeVersion(detailScriptEpisode.no) : null
      "
      :shot="detailType === 'clip' ? detailClipShot : detailShot"
      :type="detailType"
      @changed="loadAll"
      @close="closeDetail"
      @open-task="openTaskFromDetail"
      @revert-episode="onRevertEpisode"
    />
  </Page>
</template>
