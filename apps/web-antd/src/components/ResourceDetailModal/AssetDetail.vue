<script lang="ts" setup>
import type {
  AssetCandidateItem,
  AssetRequirementItem,
  ReasonItem,
  TaskItem,
} from '#/api/core/dramafloow';

/**
 * 素材需求详情（弹窗内容）：Asset/RequirementGet 补全 spec/来源/候选/驳回原因/子任务
 *
 * 列表页只带 key/kind/version/计数，弹窗按 id 重新拉一次，展开：
 *   - 需求本体：spec（生成规格）、description、来源、版本与当前标记
 *   - 候选图：缩略图 + 变体号 + 状态（点击看大图，antd Image 自带预览）
 *   - 子任务：可直接跳 TaskDrawer
 * 不写配对 toast（拦截器已弹）。
 */
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import {
  Button,
  Descriptions,
  Empty,
  Input,
  Modal,
  Select,
  Spin,
  Table,
  Tag,
} from 'ant-design-vue';

import {
  assetGenerate,
  assetRequirementGet,
  assetRequirementSave,
} from '#/api/core/dramafloow';
import { CandidateGallery } from '#/components/CandidateGallery';
import { TimeTag } from '#/components/TimeTag';
import { enumText } from '#/composables/useEnumText';

import { sourceText } from './utils';

interface RequirementGetResult {
  requirement: AssetRequirementItem;
  candidates: AssetCandidateItem[];
  reasons: ReasonItem[];
  tasks: TaskItem[];
}

const props = defineProps<{
  /** 要查看的素材需求；null 表示弹窗关闭 */
  requirement: AssetRequirementItem | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  /** 生成/状态变化后通知父组件刷新列表 */
  (e: 'changed'): void;
  (e: 'openTask', taskId: number): void;
}>();

const router = useRouter();

const open = computed(() => props.requirement !== null);
const loading = ref(false);
const detail = ref<null | RequirementGetResult>(null);
const generating = ref(false);

async function load(id: number) {
  loading.value = true;
  detail.value = null;
  try {
    detail.value = await assetRequirementGet(id);
  } catch {
    // 拦截器已提示：退化为展示列表行数据
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.requirement?.id,
  (id) => {
    if (id !== undefined && id !== null) void load(id);
  },
  { immediate: true },
);

const row = computed<AssetRequirementItem | null>(
  () => detail.value?.requirement ?? props.requirement ?? null,
);

/** 候选：图片优先，无图的（失败/待生成）单独标注 */
const candidates = computed(() => detail.value?.candidates ?? []);

function taskStatusColor(s: string): string {
  if (s === 'done' || s === 'approved') return 'success';
  if (s === 'failed' || s === 'rejected') return 'error';
  if (['collecting', 'generating', 'preparing'].includes(s))
    return 'processing';
  return 'default';
}

/** 审核（通过/丢弃/入库）后：重拉本详情 + 通知父组件刷新列表。
 *  审核会连带改变需求状态与其它候选（同需求其余候选自动丢弃），
 *  所以必须整体重拉，而不是只改本地那一条。 */
async function refreshAfterReview() {
  const r = row.value;
  if (!r) return;
  await load(r.id);
  emit('changed');
}

/**
 * 「沿用此种子再生成」：跳到统一生成下发页，带上该候选的种子与提示词。
 *
 * ⚠️ **只跳转 + 预填，不建任务**（用户明确要求：点提交才建任务，中途关掉无副作用）。
 * 种子会经下发页原样回传，后端已修好「传入 seed 被静默忽略」的缺陷，
 * 因此这里传的种子是**真的会生效**的 —— 这正是用户要的"复现同一张图"。
 */
function reuseSeed(cand: AssetCandidateItem) {
  const r = row.value;
  if (!r) return;
  router.push({
    name: 'DramaTaskSubmit',
    query: {
      dramaId: String(r.dramaId),
      refEntityId: String(r.id),
      requirementKey: r.key,
      viewLabel: r.key,
      // 沿用候选原提示词与种子（种子是关键：决定"画的是哪一张"）
      subjectPrompt: cand.prompt ?? '',
      seed: String(cand.seed),
      ...(cand.width ? { width: String(cand.width) } : {}),
      ...(cand.height ? { height: String(cand.height) } : {}),
    },
  });
}

/** 套用视图模板：antd 的 @select 回调签名是 (value: RawValue, option)，不能直接写窄类型 */
function onPickSpecPreset(value: unknown) {
  if (typeof value === 'string') editSpec.value = value;
}

async function generate() {
  const r = row.value;
  if (!r) return;
  generating.value = true;
  try {
    await assetGenerate(r.id);
    await load(r.id);
    emit('changed');
  } finally {
    generating.value = false;
  }
}

// ─────────────────── 可编辑提示词（用户诉求）───────────────────
// 用户原话：「剧目详情里 素材详情 不能改提示词 只有一个去生成候选」。
//
// 两个字段的分工（这是改之前必须先搞清楚的，否则改了不生效）：
//   · description = 角色本体描述 → 进 prompt_gen 的 {{shot_description}}
//   · spec        = 生成规格（视图/背景/构图约束）→ 进 {{character_refs}}
//     模板里明确要求「必须原样保留在 prompt 中，不得改写」
// 所以「改提示词」= 改这两个字段；只改其中一个往往不够（③ 的视图结构就靠 spec）。
const editing = ref(false);
const editDescription = ref('');
const editSpec = ref('');
const saving = ref(false);

function startEdit() {
  const r = row.value;
  if (!r) return;
  editDescription.value = r.description ?? '';
  editSpec.value = r.spec ?? '';
  editing.value = true;
}

async function saveEdit() {
  const r = row.value;
  if (!r) return;
  saving.value = true;
  try {
    // name 由 key 反推（后端要它重算 key）：key 形如 character_丽迪雅 → 取 _ 之后
    const name = r.key.includes('_')
      ? r.key.slice(r.key.indexOf('_') + 1)
      : r.key;
    await assetRequirementSave({
      id: r.id,
      dramaId: r.dramaId,
      kind: r.kind,
      name,
      description: editDescription.value,
      spec: editSpec.value,
    });
    editing.value = false;
    await load(r.id);
    emit('changed');
  } finally {
    saving.value = false;
  }
}

/** 生成规格的快捷模板（③ 的行业规范预览：无背景 + 视图定义） */
const SPEC_PRESETS = [
  {
    label: '角色 · 正脸特写（无背景）',
    value:
      'head-and-shoulders portrait, facing camera directly, neutral expression, ' +
      'plain light gray background (#F0F0F0), no shadows, no props, no scene elements, ' +
      'even flat lighting, character reference sheet style',
  },
  {
    label: '角色 · 全身正面（无背景）',
    value:
      'full body front view, standing straight, arms relaxed at sides, feet fully visible, ' +
      'head to toe in frame, plain light gray background (#F0F0F0), no shadows, no props, ' +
      'no scene elements, even flat lighting, character turnaround sheet style',
  },
  {
    label: '角色 · 3/4 侧脸（无背景）',
    value:
      'head-and-shoulders portrait turned 45 degrees, three-quarter view, neutral expression, ' +
      'plain light gray background (#F0F0F0), no shadows, no props, even flat lighting',
  },
  {
    label: '角色 · 手臂张开 A-pose（无背景）',
    value:
      'full body A-pose, arms slightly away from body, feet fully visible, ' +
      'plain light gray background (#F0F0F0), no shadows, no props, ' +
      'even flat lighting, 3D modeling reference sheet style',
  },
];
</script>

<template>
  <Modal
    :footer="null"
    :open="open"
    :title="`素材需求详情 · ${row?.key ?? ''}`"
    :width="960"
    @cancel="emit('close')"
  >
    <Spin :spinning="loading">
      <template v-if="row">
        <div class="mb-3 flex flex-wrap items-center gap-3">
          <Tag class="!mr-0">{{ enumText.assetKind(row.kind) }}</Tag>
          <Tag class="!mr-0">v{{ row.version }}</Tag>
          <Tag v-if="row.isCurrent" class="!mr-0" color="success">当前版本</Tag>
          <Tag v-if="row.status" class="!mr-0">
            {{ enumText.requirementStatus(row.status) }}
          </Tag>
          <div class="flex-1"></div>
          <Button
            :loading="generating"
            size="small"
            type="primary"
            @click="generate"
          >
            生成候选
          </Button>
        </div>

        <Descriptions bordered class="mb-4" :column="3" size="small">
          <Descriptions.Item label="Key">{{ row.key }}</Descriptions.Item>
          <Descriptions.Item label="种类">
            {{ enumText.assetKind(row.kind) }}
          </Descriptions.Item>
          <Descriptions.Item label="来源">
            {{ sourceText(row.source) }}
          </Descriptions.Item>
          <Descriptions.Item label="版本">
            v{{ row.version }} / 共 {{ row.versionCount ?? 1 }} 版
          </Descriptions.Item>
          <Descriptions.Item label="候选">
            {{ row.candidateCount }} 个（通过 {{ row.approvedCount }} / 待审
            {{ row.pendingCount }}）
          </Descriptions.Item>
          <Descriptions.Item label="状态">
            {{ enumText.requirementStatus(row.status) }}
          </Descriptions.Item>
          <Descriptions.Item label="创建">
            <TimeTag :time="row.createdAt" />
          </Descriptions.Item>
          <Descriptions.Item label="更新">
            <TimeTag :time="row.updatedAt" />
          </Descriptions.Item>
          <Descriptions.Item label="已选定素材">
            {{ row.approvedAssetId ? '已选定' : '未选定' }}
          </Descriptions.Item>
        </Descriptions>

        <!-- 提示词（可编辑）：description 进 {{shot_description}}，spec 进 {{character_refs}} -->
        <div class="mb-4 rounded-md border border-border p-3">
          <div class="mb-2 flex flex-wrap items-center gap-2">
            <span class="text-sm font-medium">提示词</span>
            <span class="text-xs text-muted-foreground">
              改完保存，下次「生成候选」就会带上
            </span>
            <div class="flex-1"></div>
            <template v-if="!editing">
              <Button size="small" @click="startEdit">编辑</Button>
            </template>
            <template v-else>
              <Button size="small" @click="editing = false">取消</Button>
              <Button
                :loading="saving"
                size="small"
                type="primary"
                @click="saveEdit"
              >
                保存
              </Button>
            </template>
          </div>

          <template v-if="!editing">
            <div class="mb-2">
              <div class="mb-1 text-xs text-muted-foreground">
                角色/素材描述（进「镜头描述」）
              </div>
              <div
                class="max-h-32 overflow-auto rounded border border-border p-2 text-sm whitespace-pre-wrap"
              >
                {{ row.description || '（无）' }}
              </div>
            </div>
            <div>
              <div class="mb-1 text-xs text-muted-foreground">
                生成规格 spec（进「角色规范描述」，prompt 模板要求原样保留）
              </div>
              <pre
                class="max-h-40 overflow-auto rounded border border-border p-2 text-xs whitespace-pre-wrap"
                >{{ row.spec || '（无 —— 建议补齐：无背景 + 视图定义）' }}</pre
              >
            </div>
          </template>

          <template v-else>
            <div class="mb-2">
              <div class="mb-1 text-xs text-muted-foreground">
                角色/素材描述（进「镜头描述」）
              </div>
              <Input.TextArea
                v-model:value="editDescription"
                :rows="3"
                placeholder="例如：26 岁女性，金色卷发，柔和面容，摄政时期长裙"
              />
            </div>
            <div>
              <div class="mb-1 flex flex-wrap items-center gap-2">
                <span class="text-xs text-muted-foreground">
                  生成规格 spec（进「角色规范描述」）
                </span>
                <Select
                  :options="SPEC_PRESETS"
                  placeholder="套用视图模板…"
                  size="small"
                  style="width: 260px"
                  @select="onPickSpecPreset"
                />
              </div>
              <Input.TextArea
                v-model:value="editSpec"
                :rows="4"
                placeholder="例如：full body front view, plain light gray background (#F0F0F0), no shadows, no props, feet fully visible"
              />
              <div class="mt-1 text-xs text-muted-foreground">
                补上「无背景 + 视图定义」能显著提升可用性（详见
                docs/任务与素材改造需求.md ③）
              </div>
            </div>
          </template>
        </div>

        <!-- 候选图：复用 CandidateGallery（含 通过 / 丢弃 / 入库 + 快捷键） -->
        <div class="mb-4">
          <div class="mb-2 text-sm font-medium">
            候选图（{{ candidates.length }}）
          </div>
          <CandidateGallery
            v-if="detail"
            :candidates="candidates"
            :reasons="detail.reasons"
            @changed="refreshAfterReview"
            @reuse-seed="reuseSeed"
          />
          <Empty v-else description="加载中…" />
        </div>

        <div>
          <div class="mb-2 text-sm font-medium">
            子任务（{{ detail?.tasks.length ?? 0 }}）
          </div>
          <Table
            v-if="detail && detail.tasks.length > 0"
            :columns="[
              { title: '类型', key: 'type', width: 140 },
              { title: '状态', key: 'status', width: 110 },
              { title: '进度', dataIndex: 'progress', width: 80 },
              { title: '创建', key: 'createdAt', width: 170 },
              { title: '操作', key: 'action', width: 90 },
            ]"
            :data-source="detail.tasks"
            :pagination="false"
            row-key="id"
            size="small"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'type'">
                {{ enumText.taskType(record.type) }}
              </template>
              <template v-else-if="column.key === 'status'">
                <Tag :color="taskStatusColor(record.status)" class="!mr-0">
                  {{ enumText.taskStatus(record.status) }}
                </Tag>
              </template>
              <template v-else-if="column.key === 'createdAt'">
                <TimeTag :time="record.createdAt" />
              </template>
              <template v-else-if="column.key === 'action'">
                <Button size="small" @click="emit('openTask', record.id)">
                  详情
                </Button>
              </template>
            </template>
          </Table>
          <Empty v-else :description="detail ? '暂无子任务' : '加载中…'" />
        </div>
      </template>
      <Empty v-else description="未找到该素材需求" />
    </Spin>
  </Modal>
</template>
