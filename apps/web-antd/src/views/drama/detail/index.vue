<script lang="ts" setup>
/**
 * 剧目详情（契约 §8）：PhaseStepper + 5 个标签页
 *   剧本（存原始稿 → 洗稿）/ 分镜 / 素材 / 片段 / 成片
 * WS 订阅 drama:<id>，阶段实时刷新。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';

import { Page } from '@vben/common-ui';

import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  message,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
} from 'ant-design-vue';

import type {
  AssetRequirementItem,
  DramaDetail,
  ProductEpisodeItem,
  ScriptDetail,
  ScriptEpisode,
  ShotItem,
  WordParseResult,
} from '#/api/core/dramafloow';
import {
  assetExtractStart,
  assetGenerate,
  assetRequirementList,
  dramaGet,
  productEpisodeList,
  productRender,
  scriptGet,
  scriptParseWord,
  scriptRewrite,
  scriptSave,
  shotList,
  shotStaleReplay,
} from '#/api/core/dramafloow';
import type { ResourceDetailType } from '#/components/ResourceDetailModal';
import { AssetVersionDrawer } from '#/components/AssetVersionDrawer';
import { PhaseStepper } from '#/components/PhaseStepper';
import { ResourceDetailModal } from '#/components/ResourceDetailModal';
import { TaskDrawer } from '#/components/TaskDrawer';
import { TimeTag } from '#/components/TimeTag';
import { useTaskStream } from '#/composables/useTaskStream';

// 路由由后端菜单动态生成，视图不接收 props：从 query 取 id（沿用 member/Form.vue 约定）
const route = useRoute();
const dramaId = computed(() => Number(route.query.id ?? 0));

const stream = useTaskStream();

const detail = ref<null | DramaDetail>(null);
const script = ref<null | ScriptDetail>(null);
const shots = ref<ShotItem[]>([]);
const requirements = ref<AssetRequirementItem[]>([]);
const episodes = ref<ProductEpisodeItem[]>([]);
const loading = ref(true);
const activeTab = ref('script');
const sourceDraft = ref('');
const saving = ref(false);
const parsing = ref(false);
const wordInfo = ref<null | WordParseResult>(null);
const wordInputRef = ref<HTMLInputElement>();

const stages = computed(
  () => stream.dramaMap.value[dramaId.value]?.stages ?? null,
);

async function loadAll() {
  loading.value = true;
  try {
    detail.value = await dramaGet(dramaId.value);
    // 剧本可能尚未创建（后端返回错误），静默处理
    try {
      script.value = await scriptGet(dramaId.value);
      sourceDraft.value = script.value.sourceText ?? '';
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
  }
}

onMounted(() => {
  stream.subscribeDrama(dramaId.value);
  void loadAll();
});

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
  await scriptRewrite(dramaId.value);
  await loadAll();
}

async function generateAsset(row: AssetRequirementItem) {
  await assetGenerate(row.id);
  await loadAll();
}

/** 素材提取抽屉 / 子任务详情抽屉 */
const assetKey = ref<null | string>(null);
const taskId = ref<null | number>(null);

/** 触发「素材提取」：LLM 从剧本正文提取 角色/道具/场景（每次新增一版） */
async function extractAssets() {
  const res = await assetExtractStart(dramaId.value);
  message.success(
    `素材提取已入队（任务 #${res.taskId}），完成后可在「历史版本」查看`,
  );
  await loadAll();
}

async function replayShot(row: ShotItem) {
  await shotStaleReplay(row.id);
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
const detailRequirement = ref<null | AssetRequirementItem>(null);
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
      <!-- 五阶段 -->
      <Card class="mb-4" size="small" title="生产阶段（实时）">
        <PhaseStepper :stages="stages" />
        <div v-if="!stages" class="mt-2 text-xs text-muted-foreground">
          实时通道连接中…（阶段数据来自 WS drama:{{ dramaId }} 事件）
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
              <div class="mb-2 flex items-center gap-3">
                <span>当前版本 v{{ script.version }}</span>
                <Tag>{{ script.episodeCount }} 集</Tag>
                <Tag v-if="script.model">{{ script.model }}</Tag>
                <Button
                  type="primary"
                  size="small"
                  :disabled="script.status === 'rewriting'"
                  @click="rewrite"
                >
                  洗稿（生成 10 集）
                </Button>
                <Button size="small" @click="loadAll">刷新</Button>
              </div>

              <div class="grid grid-cols-2 gap-4">
                <div>
                  <div class="mb-1 text-sm text-muted-foreground">
                    原始稿（不可变）
                  </div>
                  <Input.TextArea
                    :value="script.sourceText"
                    :rows="14"
                    readonly
                  />
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
                            第 {{ ep.no }} 集 {{ ep.title }}
                          </span>
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

        <!-- 2) 分镜 -->
        <Tabs.TabPane key="shots" :tab="`分镜（${shots.length}）`">
          <Table
            :columns="shotColumns"
            :custom-row="onShotRow"
            :data-source="shots"
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

        <!-- 3) 素材 -->
        <Tabs.TabPane key="assets" :tab="`素材（${requirements.length}）`">
          <div class="mb-3 flex flex-wrap items-center gap-3">
            <Button size="small" type="primary" @click="extractAssets">
              素材提取（角色 / 道具 / 场景）
            </Button>
            <span class="text-xs text-muted-foreground">
              用 LLM
              从剧本正文提取，每次新增一版；不满意可重新提取，历史版本可回选
            </span>
          </div>

          <Table
            :columns="reqColumns"
            :custom-row="onRequirementRow"
            :data-source="requirements"
            :pagination="{ pageSize: 20 }"
            row-key="id"
            size="small"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'kind'">
                <Tag class="!mr-0">{{ kindText(record.kind) }}</Tag>
              </template>
              <template v-else-if="column.key === 'version'">
                <span>v{{ record.version }}</span>
                <Tag v-if="record.isCurrent" color="success" class="ml-1 !mr-0">
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
                    @click.stop="generateAsset(record as AssetRequirementItem)"
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
      :shot="detailType === 'clip' ? detailClipShot : detailShot"
      :type="detailType"
      @changed="loadAll"
      @close="closeDetail"
      @open-task="openTaskFromDetail"
    />
  </Page>
</template>
