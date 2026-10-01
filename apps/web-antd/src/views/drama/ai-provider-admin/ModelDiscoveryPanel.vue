<script lang="ts" setup>
/**
 * ModelDiscoveryPanel —— 测试连通性 + 模型/能力勾选（**核心组件**，前端设计 §2.3）
 *
 * 主流程：点【测试连通性】→ 不关闭表单，就地下方展开第二步：
 *   ① TestConnection 拉回厂商模型列表（含 shadow 元数据 + 本地已存在行的用户勾选）
 *   ② 每个模型一行：勾选启用 + 能力多选（厂商声明 vs 系统可用 并排）
 *   ③ 确认并保存 → SaveModels（只提交**勾选的 + 已存在行的改动**）
 *
 * 硬性交互规则（前端设计 §2.3 表，逐条落地）：
 *   R1 模型**默认全部不勾**（后端新模型 isEnabled=false，未勾选 = 系统不可调用）
 *   R2 只有勾了模型，才展开/启用该模型的能力勾选
 *   R3 能力初始值 = suggestedCapabilities（= shadow，元数据优先）
 *   R4 厂商声明 vs 系统可用**并排展示**（ProviderModelCapabilities）
 *   R5 capabilitiesSource=manual / capabilitiesKnown=false → 提示条 +【探测】按钮
 *   R6 重复测试**不覆盖**用户已有勾选 —— 用后端返回的 isEnabled/capabilities
 *      （后端已做增量合并：已存在行保留用户值，只更新 shadow 元数据）
 *   R7 未勾选能力里厂商声明支持的 → 标注「厂商支持」灰字（组件内实现）
 *   R8 TTS/ASR/向量 → 「暂无任务使用」灰字
 *
 * 另：supportsModelList=false 或列表为空（私有部署 vLLM/Ollama/LM Studio）→
 *     引导「手工添加模型」；ComfyUI（providerKey=comfyui）无模型列表概念 → 只能手工添加，
 *     且**必须绑定工作流模板**（§2.5）。
 *
 * 不写配对 toast（拦截器已统一处理）。
 */
import { computed, onMounted, ref } from 'vue';

import {
  Alert,
  Button,
  Checkbox,
  Divider,
  Empty,
  Input,
  message,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tag,
} from 'ant-design-vue';

import type {
  DiscoveryModelItem,
  SaveModelItem,
  TestConnectionResult,
} from '#/api/core/aiProviderAdmin';

import { AI_CAPABILITY_OPTIONS } from '#/api/core/aiProvider';
import {
  aiProviderAddModelManually,
  aiProviderProbeCapabilities,
  aiProviderSaveModels,
  aiProviderTestConnection,
} from '#/api/core/aiProviderAdmin';
import { computeNodeList } from '#/api/core/computeNode';
import { templateWorkflowList } from '#/api/core/dramafloow';
import { ProviderModelCapabilities } from '#/components/ProviderModelCapabilities';

const props = defineProps<{
  /** 已保存提供商的 id；未保存时传 null（走临时配置测试） */
  providerId: null | number;
  providerKey: string;
  /** 未保存场景的临时配置 */
  baseUrl?: string;
  apiKey?: string;
  adapterConfig?: string;
  providerName?: string;
  /** 该适配器支持的能力位掩码（限制能力勾选范围） */
  supportedCapabilities?: number;
}>();

const emit = defineEmits<{
  /** 测试/保存完成后通知父组件刷新（提供商计数 + 连通性徽标变化） */
  (e: 'changed'): void;
}>();

// ─────────────────────────── 状态 ───────────────────────────

const testing = ref(false);
const saving = ref(false);
const result = ref<null | TestConnectionResult>(null);
/** 每行的工作副本（用户勾选态）；不直接改 result，避免误改后端语义 */
const drafts = ref<Draft[]>([]);
const probing = ref<null | string>(null);

interface Draft {
  modelId: string;
  displayName: string;
  shadowCapabilities: number;
  capabilitiesKnown: boolean;
  contextWindow: null | number;
  maxOutputTokens: null | number;
  existsLocally: boolean;
  /** 勾选启用 */
  isEnabled: boolean;
  /** 系统可用能力（位数组，界面用 Checkbox.Group） */
  capabilities: number[];
  capabilitiesSource: string;
  /** ComfyUI 必填：绑定的工作流模板 */
  bindWorkflowId: null | number;
}

/** 该适配器支持的能力（限制勾选范围；0 = 不限） */
const supportedMask = computed(() => props.supportedCapabilities ?? 0);

/** 能力选项：只留适配器支持的能力，并标注「暂无任务使用」 */
const capabilityOptions = computed(() =>
  AI_CAPABILITY_OPTIONS.filter(
    (o) => supportedMask.value === 0 || (supportedMask.value & o.value) !== 0,
  ),
);

const isComfy = computed(() => props.providerKey === 'comfyui');

/** 拉不到模型列表（也可手工添加） */
const noModelList = computed(
  () =>
    result.value !== null &&
    (!result.value.supportsModelList || drafts.value.length === 0),
);

// ─────────────────────────── 工作流模板 + 节点 ───────────────────────────

const workflows = ref<{ label: string; value: number }[]>([]);
const nodes = ref<{ label: string; value: number }[]>([]);

async function loadOptions() {
  try {
    const list = await templateWorkflowList();
    workflows.value = (list ?? [])
      .filter((w) => w.isActive !== false)
      .map((w) => ({ label: `${w.name}（${w.key}）`, value: w.id }));
  } catch {
    workflows.value = [];
  }
  try {
    const list = await computeNodeList();
    nodes.value = (list ?? [])
      .filter((n) => n.isEnabled)
      .map((n) => ({
        label: `${n.name}（${n.isOnline ? '在线' : '离线'}）`,
        value: n.id,
      }));
  } catch {
    nodes.value = [];
  }
}

onMounted(() => {
  void loadOptions();
  // 已保存的提供商：面板一挂载就自动测一次（用户点开「管理模型」即可看到结果）
  if (props.providerId) void runTest();
});

// ─────────────────────────── 测试连通性 ───────────────────────────

function bitsToList(bits: number, permitted?: number): number[] {
  return AI_CAPABILITY_OPTIONS.filter(
    (o) =>
      (bits & o.value) !== 0 &&
      (permitted === undefined || (permitted & o.value) !== 0),
  ).map((o) => o.value);
}

function listToBits(list: number[]): number {
  return list.reduce((acc, v) => acc | v, 0);
}

/**
 * R6 落地：**已存在行**用后端返回的 isEnabled/capabilities（后端增量合并已保留用户值），
 * **新模型**默认不勾、能力预填 suggestedCapabilities（= shadow）。
 */
function toDraft(m: DiscoveryModelItem): Draft {
  return {
    modelId: m.modelId,
    displayName: m.displayName ?? '',
    shadowCapabilities: m.shadowCapabilities ?? 0,
    capabilitiesKnown: Boolean(m.capabilitiesKnown),
    contextWindow: m.contextWindow ?? null,
    maxOutputTokens: m.maxOutputTokens ?? null,
    existsLocally: Boolean(m.existsLocally),
    // 新模型：后端返回 isEnabled=false（R1 默认全部不勾）
    isEnabled: Boolean(m.existsLocally && m.isEnabled),
    // 已存在行用其现有 capabilities；新模型用 suggestedCapabilities（= shadow 预填）
    capabilities: bitsToList(
      m.existsLocally ? m.capabilities : (m.suggestedCapabilities ?? 0),
      supportedMask.value || undefined,
    ),
    capabilitiesSource: m.capabilitiesSource ?? 'manual',
    bindWorkflowId: null,
  };
}

async function runTest() {
  testing.value = true;
  try {
    const data = await aiProviderTestConnection({
      providerId: props.providerId ?? undefined,
      providerKey: props.providerKey || undefined,
      baseUrl: props.baseUrl || undefined,
      apiKey: props.apiKey || undefined,
      adapterConfig: props.adapterConfig || undefined,
      name: props.providerName || undefined,
    });
    result.value = data;
    drafts.value = (data.models ?? []).map((m) => toDraft(m));
    if (data.ok) emit('changed');
  } catch {
    // 拦截器已提示；保留上一次结果，避免面板整块消失
    result.value = {
      ok: false,
      message: '测试请求失败（详见提示）',
      supportsModelList: false,
      remoteCount: 0,
      models: [],
    };
    drafts.value = [];
  } finally {
    testing.value = false;
  }
}

/** 能力探测（不落库）：返回 null → 「模型未能自述能力，请手工勾选」 */
async function probe(d: Draft) {
  if (!props.providerId) {
    message.warning('请先保存提供商，再使用「探测」功能');
    return;
  }
  probing.value = d.modelId;
  try {
    const r = await aiProviderProbeCapabilities({
      providerId: props.providerId,
      modelId: d.modelId,
    });
    if (r?.predefined === null || r?.predefined === undefined) {
      message.info('模型未能自述能力，请手工勾选');
      return;
    }
    d.capabilities = bitsToList(r.predefined, supportedMask.value || undefined);
    // 探测结果只是**预填**，用户确认保存后才生效（G6）
    d.capabilitiesSource = 'probed';
    d.isEnabled = true;
  } catch {
    // 拦截器已提示
  } finally {
    probing.value = null;
  }
}

// ─────────────────────────── 保存 ───────────────────────────

/** 已存在行保持原样也算「用户劳动」，保存时一并提交（值相同则后端视为无变化） */
const selectedDrafts = computed(() => drafts.value.filter((d) => d.isEnabled));

const saveDisabledReason = computed(() => {
  if (drafts.value.length === 0) return '没有可保存的模型';
  if (selectedDrafts.value.length === 0) return '请至少勾选一个模型';
  return '';
});

async function save() {
  if (!props.providerId) {
    message.warning('请先保存提供商（保存后再测试连通性即可勾选模型）');
    return;
  }
  // R2：勾了模型但一个能力都没勾 → 模型无法被任何任务调用（后端也会拒绝空能力）
  const bad = selectedDrafts.value.find((d) => d.capabilities.length === 0);
  if (bad) {
    message.error(
      `模型「${bad.modelId}」未勾选任何能力（未勾选能力的模型无法被调度）`,
    );
    return;
  }
  if (isComfy.value) {
    // ComfyUI 必须有工作流才能执行（§2.5）。
    // ⚠️ 已存在的行走 SaveModels 时 bindWorkflowId 留空 = **保留库里原有绑定**
    //    （TestConnection 不回传该字段，强行要求会误伤"只想改能力"的重存）。
    //    因此只对**新增行**强制选模板。
    const noFlow = selectedDrafts.value.find(
      (d) => !d.existsLocally && !d.bindWorkflowId,
    );
    if (noFlow) {
      message.error(
        `新增的 ComfyUI 模型「${noFlow.modelId}」必须绑定工作流模板（否则不知道跑什么流程）`,
      );
      return;
    }
    const existingNoFlow = selectedDrafts.value.filter(
      (d) => d.existsLocally && !d.bindWorkflowId,
    );
    if (existingNoFlow.length > 0) {
      message.info(
        `${existingNoFlow.length} 个已存在的模型沿用库中已绑定的工作流（此处留空 = 不修改）`,
      );
    }
  }

  const items: SaveModelItem[] = selectedDrafts.value.map((d) => ({
    modelId: d.modelId,
    displayName: d.displayName,
    isEnabled: d.isEnabled,
    capabilities: listToBits(d.capabilities),
    shadowCapabilities: d.shadowCapabilities,
    capabilitiesSource: d.capabilitiesSource,
    contextWindow: d.contextWindow,
    maxOutputTokens: d.maxOutputTokens,
    bindWorkflowId: d.bindWorkflowId,
  }));

  saving.value = true;
  try {
    const r = await aiProviderSaveModels(props.providerId, items);
    emit('changed');
    // 保存后重新测一次，让「已存在/新增」状态与后端一致（增量合并会保留刚保存的勾选）
    await runTest();
    message.success(
      `已保存（新增 ${r?.inserted ?? 0}，更新 ${r?.updated ?? 0}）`,
    );
  } catch {
    // 拦截器已提示
  } finally {
    saving.value = false;
  }
}

// ─────────────────────────── 手工添加模型（§2.4 / §2.5） ───────────────────────────

const manualOpen = ref(false);
const manualSaving = ref(false);
const manual = ref({
  modelId: '',
  displayName: '',
  capabilities: [] as number[],
  bindWorkflowId: null as null | number,
  nodeId: null as null | number,
  isEnabled: true,
});

function openManual() {
  manual.value = {
    modelId: isComfy.value ? '' : '',
    displayName: '',
    capabilities: [],
    bindWorkflowId: null,
    nodeId: null,
    isEnabled: true,
  };
  manualOpen.value = true;
}

async function submitManual() {
  if (!props.providerId) {
    message.warning('请先保存提供商，再添加模型');
    return;
  }
  const f = manual.value;
  if (!f.modelId.trim()) {
    message.error('请填写模型标识（model_id）');
    return;
  }
  if (f.capabilities.length === 0) {
    message.error('至少勾选一项能力（未勾选能力的模型无法被调度）');
    return;
  }
  if (isComfy.value && !f.bindWorkflowId) {
    message.error('ComfyUI 模型必须绑定工作流模板');
    return;
  }
  manualSaving.value = true;
  try {
    await aiProviderAddModelManually({
      providerId: props.providerId,
      modelId: f.modelId.trim(),
      displayName: f.displayName.trim() || undefined,
      capabilities: listToBits(f.capabilities),
      bindWorkflowId: f.bindWorkflowId,
      nodeId: f.nodeId,
      isEnabled: f.isEnabled,
    });
    manualOpen.value = false;
    emit('changed');
    await runTest();
  } catch {
    // 拦截器已提示
  } finally {
    manualSaving.value = false;
  }
}

// ─────────────────────────── 展示辅助 ───────────────────────────

/** 已存在行数（保存后提示「保留你之前的勾选」） */
const existingCount = computed(
  () => drafts.value.filter((d) => d.existsLocally).length,
);

/** 表头「全选」：勾选/取消全部（仅对当前表格内的模型） */
const allChecked = computed({
  get: () => drafts.value.length > 0 && drafts.value.every((d) => d.isEnabled),
  set: (v: boolean) => {
    for (const d of drafts.value) d.isEnabled = v;
  },
});

const columns = [
  { title: '模型', key: 'model', width: 260 },
  { title: '上下文 / 输出', key: 'window', width: 150 },
  { title: '厂商声明能力', key: 'shadow', width: 230 },
  { title: '系统可用能力（勾选后生效）', key: 'capabilities' },
  { title: '工作流', key: 'workflow', width: 200 },
];

function fmtTokens(n: null | number): string {
  if (!n && n !== 0) return '-';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return String(n);
}

/** 未勾选时能力选择置灰（R2） */
function capsDisabled(d: Draft): boolean {
  return !d.isEnabled;
}

// ant-design-vue 的 bodyCell 插槽 record 是 Record<string, any>，
// 这里统一收窄成 Draft，避免模板里到处 as any（保持模板可读）。
function asDraft(record: Record<string, any>): Draft {
  return record as Draft;
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- 操作条 -->
    <div class="flex flex-wrap items-center gap-2">
      <Button :loading="testing" size="small" type="primary" @click="runTest">
        测试连通性
      </Button>
      <Button size="small" @click="openManual">+ 手工添加模型</Button>
      <span v-if="isComfy" class="text-xs text-muted-foreground">
        ComfyUI 无「模型列表」概念：请手工添加模型并绑定工作流模板
      </span>
    </div>

    <Spin :spinning="testing">
      <!-- 测试结果摘要 -->
      <template v-if="result">
        <Alert
          v-if="result.ok"
          :message="`连接成功 · ${result.httpStatus ? `HTTP ${result.httpStatus} · ` : ''}发现 ${result.remoteCount} 个模型`"
          show-icon
          type="success"
        >
          <template #description>
            <div class="text-xs">
              <template v-if="existingCount > 0">
                已存在
                {{ existingCount }} 个同名模型（保留你之前的勾选，不覆盖）
              </template>
              <template v-else>
                模型默认全部不勾：没勾选的，即使厂商提供，系统也不允许调用
              </template>
            </div>
          </template>
        </Alert>

        <Alert
          v-else
          show-icon
          type="error"
          :message="`连接失败${result.httpStatus ? ` · HTTP ${result.httpStatus}` : ''}`"
        >
          <template #description>
            <div class="text-xs break-all">{{ result.message }}</div>
            <div class="mt-1 text-xs text-muted-foreground">
              可「仍然保存（未验证）」——临时网络问题常见；但连通性异常时其模型不可被启用。
            </div>
          </template>
        </Alert>

        <!-- 未提供模型列表（私有部署） -->
        <Alert
          v-if="result.ok && noModelList"
          class="mt-2"
          show-icon
          type="warning"
        >
          <template #message> 该服务未提供模型列表接口（或返回为空） </template>
          <template #description>
            <div class="text-xs">
              这在使用私有部署（vLLM / Ollama / LM Studio）时很常见。
              你可以手工添加模型名，能力由你自行勾选。
            </div>
            <Button class="mt-2" size="small" @click="openManual">
              + 手工添加模型
            </Button>
          </template>
        </Alert>
      </template>

      <!-- 模型表 -->
      <div v-if="drafts.length > 0" class="mt-3">
        <div class="mb-2 flex items-center gap-3">
          <Checkbox v-model:checked="allChecked">全选</Checkbox>
          <span class="text-xs text-muted-foreground">
            能力来源：厂商接口元数据（未给元数据的模型可点【探测】）
          </span>
        </div>

        <Table
          :columns="columns"
          :data-source="drafts"
          :pagination="false"
          :scroll="{ x: 'max-content' }"
          row-key="modelId"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <!-- 勾选 + 模型名 -->
            <template v-if="column.key === 'model'">
              <div class="flex items-start gap-2">
                <Checkbox v-model:checked="record.isEnabled" class="mt-1" />
                <div class="flex min-w-0 flex-col">
                  <span class="font-medium">{{ record.modelId }}</span>
                  <span class="text-xs text-muted-foreground">
                    显示名：{{ record.displayName || '（未提供）' }}
                  </span>
                  <Space :size="[4, 4]" class="mt-1" wrap>
                    <Tag v-if="record.existsLocally" class="!mr-0" color="blue">
                      已存在（保留勾选）
                    </Tag>
                    <Tag
                      v-if="!record.capabilitiesKnown"
                      class="!mr-0"
                      color="warning"
                    >
                      能力未探测
                    </Tag>
                  </Space>
                </div>
              </div>
            </template>

            <!-- 上下文 / 最大输出 -->
            <template v-else-if="column.key === 'window'">
              <div class="text-xs">
                上下文：{{ fmtTokens(record.contextWindow) }}
              </div>
              <div class="text-xs">
                最大输出：{{ fmtTokens(record.maxOutputTokens) }}
              </div>
            </template>

            <!-- 厂商声明能力 -->
            <template v-else-if="column.key === 'shadow'">
              <ProviderModelCapabilities
                :capabilities="record.shadowCapabilities"
              />
              <div class="mt-1 text-xs text-muted-foreground">
                来源：{{
                  record.capabilitiesKnown ? '接口元数据' : '未知（可探测）'
                }}
              </div>
              <Button
                v-if="!record.capabilitiesKnown"
                :loading="probing === record.modelId"
                class="mt-1"
                size="small"
                @click="probe(asDraft(record))"
              >
                探测
              </Button>
            </template>

            <!-- 系统可用能力（用户勾选） -->
            <template v-else-if="column.key === 'capabilities'">
              <div :class="capsDisabled(asDraft(record)) ? 'opacity-50' : ''">
                <Checkbox.Group
                  v-model:value="record.capabilities"
                  :disabled="capsDisabled(asDraft(record))"
                  :options="capabilityOptions"
                  class="flex flex-wrap gap-x-3 gap-y-1"
                >
                  <template #label="{ label, value }">
                    <span>
                      {{ label }}
                      <span
                        v-if="
                          capabilityOptions.find((o) => o.value === value)?.note
                        "
                        class="text-[10px] text-muted-foreground"
                      >
                        ({{
                          capabilityOptions.find((o) => o.value === value)
                            ?.note
                        }})
                      </span>
                      <span
                        v-if="
                          (record.shadowCapabilities & value) !== 0 &&
                          !record.capabilities.includes(value)
                        "
                        class="ml-1 text-[10px] text-muted-foreground"
                      >
                        厂商支持
                      </span>
                    </span>
                  </template>
                </Checkbox.Group>
                <!-- R2：未勾选模型 → 能力置灰 -->
                <div
                  v-if="capsDisabled(asDraft(record))"
                  class="mt-1 text-xs text-muted-foreground"
                >
                  勾选左侧「模型」后才能配置它的能力
                </div>
              </div>
            </template>

            <!-- ComfyUI：绑定工作流模板（必填） -->
            <template v-else-if="column.key === 'workflow'">
              <template v-if="isComfy">
                <Select
                  :value="record.bindWorkflowId ?? undefined"
                  @update:value="
                    (v: any) => (record.bindWorkflowId = v ?? null)
                  "
                  :disabled="!record.isEnabled"
                  :options="workflows"
                  :placeholder="
                    workflows.length === 0
                      ? '（暂无工作流模板，请先到「模板管理」创建）'
                      : '请选择工作流模板（必填）'
                  "
                  allow-clear
                  show-search
                  :filter-option="
                    (input: string, option: any) =>
                      String(option?.label ?? '')
                        .toLowerCase()
                        .includes(input.toLowerCase())
                  "
                  size="small"
                  style="width: 100%"
                />
              </template>
              <span v-else class="text-xs text-muted-foreground">—</span>
            </template>
          </template>
        </Table>

        <Divider class="!my-3" />

        <div class="flex flex-wrap items-center gap-3">
          <Button
            :disabled="Boolean(saveDisabledReason)"
            :loading="saving"
            size="small"
            type="primary"
            @click="save"
          >
            确认并保存
          </Button>
          <span v-if="saveDisabledReason" class="text-xs text-muted-foreground">
            {{ saveDisabledReason }}
          </span>
          <span v-else class="text-xs text-muted-foreground">
            将保存 {{ selectedDrafts.length }} 个模型（未勾选的不提交）
          </span>
        </div>
      </div>

      <Empty
        v-else-if="result"
        class="mt-3"
        description="没有可勾选的模型：点上方「+ 手工添加模型」按模型名手工添加"
      />
    </Spin>

    <!-- 手工添加模型（私有部署 / ComfyUI） -->
    <Modal
      v-model:open="manualOpen"
      :confirm-loading="manualSaving"
      :title="isComfy ? '手工添加 ComfyUI 模型' : '手工添加模型'"
      :width="620"
      @ok="submitManual"
    >
      <div class="flex flex-col gap-3">
        <Alert
          v-if="isComfy"
          message="ComfyUI 通过「工作流模板」定义出图/出视频流程"
          description="因此每个模型必须绑定一个工作流模板；同一模板可以对应多个模型（便于区分参数与能力）。"
          show-icon
          type="info"
        />

        <div>
          <div class="mb-1 text-sm">模型标识（model_id）*</div>
          <Input
            v-model:value="manual.modelId"
            :placeholder="
              isComfy ? '如 comfyui-t2i-sd35' : '如 qwen2.5-32b-instruct'
            "
          />
        </div>

        <div v-if="isComfy">
          <div class="mb-1 text-sm">绑定工作流模板 *</div>
          <Select
            :value="manual.bindWorkflowId ?? undefined"
            @update:value="(v: any) => (manual.bindWorkflowId = v ?? null)"
            :options="workflows"
            :placeholder="
              workflows.length === 0
                ? '（暂无工作流模板，请先到「模板管理」创建）'
                : '请选择工作流模板'
            "
            allow-clear
            show-search
            style="width: 100%"
          />
        </div>

        <div>
          <div class="mb-1 text-sm">显示名</div>
          <Input v-model:value="manual.displayName" placeholder="可选" />
        </div>

        <div>
          <div class="mb-1 text-sm">系统可用能力 *</div>
          <Checkbox.Group
            v-model:value="manual.capabilities"
            :options="capabilityOptions"
            class="flex flex-wrap gap-x-3 gap-y-1"
          >
            <template #label="{ label, value }">
              <span>
                {{ label }}
                <span
                  v-if="capabilityOptions.find((o) => o.value === value)?.note"
                  class="text-[10px] text-muted-foreground"
                >
                  ({{ capabilityOptions.find((o) => o.value === value)?.note }})
                </span>
              </span>
            </template>
          </Checkbox.Group>
          <div class="mt-1 text-xs text-muted-foreground">
            手工添加的能力来源记为「手工勾选」；未勾选能力的模型无法被调度。
          </div>
        </div>

        <div>
          <div class="mb-1 text-sm">归属算力节点</div>
          <Select
            :value="manual.nodeId ?? undefined"
            @update:value="(v: any) => (manual.nodeId = v ?? null)"
            :options="nodes"
            allow-clear
            placeholder="留空 = 独立 API，不占卡"
            style="width: 100%"
          />
        </div>

        <div class="flex items-center gap-2">
          <Checkbox v-model:checked="manual.isEnabled">立即启用</Checkbox>
        </div>
      </div>
    </Modal>
  </div>
</template>
