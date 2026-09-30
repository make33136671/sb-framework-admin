<script lang="ts" setup>
/**
 * AI 服务管理（一个模型 = 一个服务）
 *
 * 为什么需要这个页面：任务要「用哪个服务跑」必须先在这里登记模型，
 * 并勾选它具备哪些能力（文本处理 / 图片生成 / 图片理解 / 视频生成）；
 * 任务侧按能力选服务，不具备该能力的服务在任务选择器里置灰。
 *
 * 算力调度（P2）：服务可归属一个「算力节点」（同节点服务争同一张卡，
 * 受互斥/攒批/切换约束）；不挂节点 = 旧路径。列表额外展示运行状态
 * （idle/busy/offline，由调度器与心跳维护）与失败熔断暂停。
 *
 * 关键规则（与后端一致）：
 *   - 能力必选至少一项；
 *   - 「默认服务」只能设置在已勾选的能力上（取消勾选会自动清掉对应默认）；
 *   - 同一能力同时只能有一个默认服务（后端保存时互斥清理，前端只提示）；
 *   - 编辑时密钥留空 = 不修改（列表接口从不返回明文）。
 */
import { computed, onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Alert,
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
} from 'ant-design-vue';

import type { AiProviderItem } from '#/api/core/aiProvider';

import {
  AI_CAPABILITY_OPTIONS,
  AI_PROVIDER_TYPES,
  AI_RUN_STATUS,
  aiProviderDelete,
  aiProviderList,
  aiProviderSave,
  aiProviderSetEnabled,
} from '#/api/core/aiProvider';

import { computeNodeList } from '#/api/core/computeNode';

// ─────────────────────────── 列表 ───────────────────────────

const rows = ref<AiProviderItem[]>([]);
const loading = ref(false);
const acting = ref<null | number>(null);

async function load() {
  loading.value = true;
  try {
    rows.value = await aiProviderList();
    await loadNodeOptions();
  } catch {
    // 拦截器已提示
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());

/** 「归属节点」下拉：0 = 不挂节点（旧路径） */
const nodeOptions = ref<{ label: string; value: number }[]>([
  { label: '不挂节点（旧路径，无调度约束）', value: 0 },
]);

async function loadNodeOptions() {
  try {
    const nodes = await computeNodeList();
    nodeOptions.value = [
      { label: '不挂节点（旧路径，无调度约束）', value: 0 },
      ...nodes
        .filter((n) => n.isEnabled)
        .map((n) => ({
          label: `${n.name}（${n.isOnline ? '在线' : '离线'}）`,
          value: n.id,
        })),
    ];
  } catch {
    // 节点接口失败不影响服务编辑（降级为只有「不挂节点」）
  }
}

// ─────────────────────────── 表单 ───────────────────────────

interface FormState {
  id?: number;
  name: string;
  providerType: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  capabilities: number[];
  defaultFor: number[];
  isEnabled: boolean;
  sortNo: number;
  remark: string;
  /** 归属节点 id；0 = 不挂节点（旧路径） */
  nodeId: number;
}

const editOpen = ref(false);
const saving = ref(false);
const editing = ref<FormState>(blank());

function blank(): FormState {
  return {
    name: '',
    providerType: 'openai',
    baseUrl: '',
    apiKey: '',
    model: '',
    capabilities: [],
    defaultFor: [],
    isEnabled: true,
    sortNo: 0,
    remark: '',
    nodeId: 0,
  };
}

/** 位掩码 ↔ 勾选数组 */
function bitsToList(bits: number): number[] {
  return AI_CAPABILITY_OPTIONS.map((o) => o.value).filter(
    (v) => (bits & v) !== 0,
  );
}
function listToBits(list: number[]): number {
  return list.reduce((acc, v) => acc | v, 0);
}

function openCreate() {
  editing.value = blank();
  editOpen.value = true;
}

function openEdit(row: AiProviderItem | Record<string, any>) {
  editing.value = {
    id: row.id,
    name: row.name,
    providerType: row.providerType,
    baseUrl: row.baseUrl ?? '',
    apiKey: '',
    model: row.model ?? '',
    capabilities: bitsToList(row.capabilities),
    defaultFor: bitsToList(row.defaultFor),
    isEnabled: row.isEnabled,
    sortNo: row.sortNo,
    remark: row.remark ?? '',
    nodeId: row.nodeId ?? 0,
  };
  editOpen.value = true;
}

/** 取消勾选能力时，同步取消该能力的「默认」标记（后端也会拒绝这种组合） */
function onCapabilitiesChange() {
  editing.value.defaultFor = editing.value.defaultFor.filter((d) =>
    editing.value.capabilities.includes(d),
  );
}

/** 类型是否为 mock（mock 不需要端点/密钥） */
const isMock = computed(() => editing.value.providerType === 'mock');
/** ComfyUI 类型用于出图/视频，提示能力建议 */
const isComfy = computed(() =>
  ['comfyui', 'comfyui_i2v'].includes(editing.value.providerType),
);

async function submit() {
  const f = editing.value;
  if (!f.name.trim()) {
    message.error('请填写服务名');
    return;
  }
  if (f.capabilities.length === 0) {
    message.error('至少勾选一项能力');
    return;
  }
  if (!isMock.value && !f.baseUrl.trim()) {
    message.error('该类型服务必须填写端点地址');
    return;
  }

  saving.value = true;
  try {
    await aiProviderSave({
      id: f.id,
      name: f.name.trim(),
      providerType: f.providerType,
      capabilities: listToBits(f.capabilities),
      baseUrl: f.baseUrl.trim(),
      apiKey: f.apiKey.trim(),
      model: f.model.trim(),
      defaultFor: listToBits(f.defaultFor),
      isEnabled: f.isEnabled,
      sortNo: f.sortNo,
      remark: f.remark.trim(),
      nodeId: f.nodeId || null,
    });
    editOpen.value = false;
    await load();
  } finally {
    saving.value = false;
  }
}

async function toggleEnabled(
  row: AiProviderItem | Record<string, any>,
  next: boolean,
) {
  acting.value = row.id;
  try {
    await aiProviderSetEnabled(row.id, next);
    await load();
  } finally {
    acting.value = null;
  }
}

async function remove(row: AiProviderItem | Record<string, any>) {
  acting.value = row.id;
  try {
    await aiProviderDelete(row.id);
    await load();
  } finally {
    acting.value = null;
  }
}

// ─────────────────────────── 展示辅助 ───────────────────────────

const TYPE_TEXT: Record<string, string> = {
  openai: 'OpenAI 兼容',
  comfyui: 'ComfyUI 出图',
  comfyui_i2v: 'ComfyUI 视频',
  mock: 'Mock',
};

function capNames(bits: number): string[] {
  return AI_CAPABILITY_OPTIONS.filter((o) => (bits & o.value) !== 0).map(
    (o) => o.label,
  );
}

function defaultNames(bits: number): string[] {
  return AI_CAPABILITY_OPTIONS.filter((o) => (bits & o.value) !== 0).map(
    (o) => o.label,
  );
}

const columns = [
  { title: '服务名', key: 'name', width: 200 },
  { title: '类型', key: 'type', width: 130 },
  { title: '模型 / 端点', key: 'endpoint', ellipsis: true },
  { title: '归属节点', key: 'node', width: 160 },
  { title: '运行状态', key: 'runStatus', width: 130 },
  { title: '能力', key: 'capabilities', width: 200 },
  { title: '默认服务', key: 'defaultFor', width: 150 },
  { title: '启用', key: 'enabled', width: 80 },
  { title: '排序', dataIndex: 'sortNo', key: 'sortNo', width: 60 },
  { title: '操作', key: 'action', width: 150 },
];

function runStatusMeta(status: string) {
  return (
    AI_RUN_STATUS[status as keyof typeof AI_RUN_STATUS] ?? {
      color: 'default',
      label: status,
    }
  );
}
</script>

<template>
  <Page
    class="df-page"
    description="登记可用的 AI 模型（服务）：勾选它具备的能力，任务按能力选服务，不具备能力的服务自动置灰"
    title="AI 服务"
  >
    <template #extra>
      <Space>
        <Button :loading="loading" size="small" @click="load">刷新</Button>
        <Button size="small" type="primary" @click="openCreate">
          添加服务
        </Button>
      </Space>
    </template>

    <Alert
      class="mb-4"
      message="「服务」= 一个可调用的 AI 模型"
      description="添加时勾选它具备的能力；当某个服务被设为某能力的「默认服务」时，任务不指定服务就走它。服务可归属算力节点（同节点争同一张卡）；不挂节点则走旧路径。任务选择器里不具备所需能力的服务会置灰不可选。"
      show-icon
      type="info"
    />

    <Card size="small" title="服务列表">
      <Table
        v-if="rows.length > 0"
        :columns="columns"
        :data-source="rows"
        :loading="loading"
        :pagination="false"
        row-key="id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'name'">
            <div class="flex items-center gap-2">
              <span class="font-medium">{{ record.name }}</span>
              <Tag v-if="!record.isEnabled" color="default" class="!mr-0">
                已停用
              </Tag>
            </div>
            <div v-if="record.remark" class="text-xs text-muted-foreground">
              {{ record.remark }}
            </div>
          </template>

          <template v-else-if="column.key === 'type'">
            <Tag class="!mr-0">
              {{ TYPE_TEXT[record.providerType] ?? record.providerType }}
            </Tag>
          </template>

          <template v-else-if="column.key === 'endpoint'">
            <div class="text-xs">
              {{ record.model || '（未填模型）' }}
            </div>
            <div class="text-xs break-all text-muted-foreground">
              {{ record.baseUrl || '（未填端点）' }}
            </div>
            <div class="text-xs text-muted-foreground">
              密钥：{{ record.hasApiKey ? '已配置' : '未配置' }}
            </div>
          </template>

          <template v-else-if="column.key === 'node'">
            <template v-if="record.nodeId">
              <span class="text-xs">{{
                record.nodeName ?? `#${record.nodeId}`
              }}</span>
              <Tag
                v-if="record.nodeOnline === false"
                color="error"
                class="ml-1 !mr-0"
              >
                离线
              </Tag>
              <Tag
                v-else-if="record.nodeSwitching"
                color="processing"
                class="ml-1 !mr-0"
              >
                切换中
              </Tag>
            </template>
            <span v-else class="text-xs text-muted-foreground">
              （不挂节点）
            </span>
          </template>

          <template v-else-if="column.key === 'runStatus'">
            <Space :size="[4, 4]" wrap>
              <Tag :color="runStatusMeta(record.runStatus).color" class="!mr-0">
                {{ runStatusMeta(record.runStatus).label }}
              </Tag>
              <Tag v-if="record.paused" color="warning" class="!mr-0">
                熔断暂停
              </Tag>
              <span
                v-if="record.currentTaskId"
                class="text-xs text-muted-foreground"
              >
                #{{ record.currentTaskId }}
              </span>
            </Space>
          </template>

          <template v-else-if="column.key === 'capabilities'">
            <Space :size="[4, 4]" wrap>
              <Tag
                v-for="n in capNames(record.capabilities)"
                :key="n"
                class="!mr-0"
                color="blue"
              >
                {{ n }}
              </Tag>
            </Space>
          </template>

          <template v-else-if="column.key === 'defaultFor'">
            <Space
              v-if="defaultNames(record.defaultFor).length > 0"
              :size="[4, 4]"
              wrap
            >
              <Tag
                v-for="n in defaultNames(record.defaultFor)"
                :key="n"
                class="!mr-0"
                color="success"
              >
                {{ n }} 默认
              </Tag>
            </Space>
            <span v-else class="text-xs text-muted-foreground">-</span>
          </template>

          <template v-else-if="column.key === 'enabled'">
            <Switch
              :checked="record.isEnabled"
              :loading="acting === record.id"
              size="small"
              @change="(v: any) => toggleEnabled(record, Boolean(v))"
            />
          </template>

          <template v-else-if="column.key === 'action'">
            <Space>
              <Button size="small" @click="openEdit(record)">编辑</Button>
              <Popconfirm
                description="删除后任务将无法再选它（历史任务记录保留）。"
                title="确认删除该服务？"
                @confirm="remove(record)"
              >
                <Button danger size="small" :loading="acting === record.id">
                  删除
                </Button>
              </Popconfirm>
            </Space>
          </template>
        </template>
      </Table>

      <Empty
        v-else
        description="还没有服务：点右上角「添加服务」登记一个 AI 模型"
      />
    </Card>

    <!-- 新增/编辑 -->
    <Modal
      v-model:open="editOpen"
      :confirm-loading="saving"
      :title="editing.id ? '编辑服务' : '添加服务'"
      :width="720"
      @ok="submit"
    >
      <div class="flex flex-col gap-3">
        <div>
          <div class="mb-1 text-sm">服务名 *</div>
          <Input
            v-model:value="editing.name"
            placeholder="如：本地 Qwen3-27B / 闭源 GPT-4o / ComfyUI 出图机"
          />
        </div>

        <div>
          <div class="mb-1 text-sm">类型 *</div>
          <Select
            v-model:value="editing.providerType"
            :options="AI_PROVIDER_TYPES"
            style="width: 100%"
          />
          <div class="mt-1 text-xs text-muted-foreground">
            <template v-if="isComfy">
              ComfyUI 类服务用于出图/视频，模板在「模板管理」里维护。
            </template>
            <template v-else-if="isMock">
              Mock 不连外部服务，用于离线自测（确定性输出）。
            </template>
            <template v-else>
              OpenAI 兼容：端点需可直接拼 /chat/completions（一般以 /v1 结尾）。
            </template>
          </div>
        </div>

        <div>
          <div class="mb-1 text-sm">
            能力 *（任务按能力选服务；不勾选的能力无法被该类任务使用）
          </div>
          <Checkbox.Group
            v-model:value="editing.capabilities"
            :options="AI_CAPABILITY_OPTIONS"
            @change="onCapabilitiesChange"
          />
        </div>

        <div>
          <div class="mb-1 text-sm">默认服务</div>
          <Checkbox.Group
            v-model:value="editing.defaultFor"
            :options="
              AI_CAPABILITY_OPTIONS.filter((o) =>
                editing.capabilities.includes(o.value),
              )
            "
          />
          <div class="mt-1 text-xs text-muted-foreground">
            勾选后：任务不指定服务时就用这个（同一能力只能有一个默认服务；未勾选则按排序取最靠前的可用服务）
          </div>
        </div>

        <div>
          <div class="mb-1 text-sm">归属节点</div>
          <Select
            v-model:value="editing.nodeId"
            :options="nodeOptions"
            style="width: 100%"
          />
          <div class="mt-1 text-xs text-muted-foreground">
            挂到节点后：与同节点其他服务争同一张卡（受互斥 / 攒批 / 切换约束，
            见「算力节点」页）；不挂节点则不受节点约束（旧路径）。
          </div>
        </div>

        <div v-if="!isMock" class="grid grid-cols-2 gap-3">
          <div>
            <div class="mb-1 text-sm">端点地址 *</div>
            <Input
              v-model:value="editing.baseUrl"
              :placeholder="
                isComfy ? 'http://127.0.0.1:18188' : 'http://host:port/v1'
              "
            />
          </div>
          <div>
            <div class="mb-1 text-sm">API Key</div>
            <Input.Password
              v-model:value="editing.apiKey"
              :placeholder="
                editing.id ? '留空 = 不修改' : '可留空（如内网无需鉴权）'
              "
            />
          </div>
        </div>

        <div v-if="!isComfy" class="grid grid-cols-2 gap-3">
          <div>
            <div class="mb-1 text-sm">模型名</div>
            <Input
              v-model:value="editing.model"
              placeholder="如 qwen3-27b / gpt-4o"
            />
          </div>
          <div>
            <div class="mb-1 text-sm">排序（小在前，兜底默认按此顺序）</div>
            <InputNumber
              v-model:value="editing.sortNo"
              :min="0"
              class="w-full"
            />
          </div>
        </div>
        <div v-else>
          <div class="mb-1 text-sm">排序（小在前，兜底默认按此顺序）</div>
          <InputNumber v-model:value="editing.sortNo" :min="0" class="w-full" />
        </div>

        <div>
          <div class="mb-1 text-sm">备注</div>
          <Input
            v-model:value="editing.remark"
            placeholder="如：仅夜间可用 / 单卡 24G 限制 1024 分辨率"
          />
        </div>

        <div class="flex items-center gap-2">
          <Switch v-model:checked="editing.isEnabled" size="small" />
          <span class="text-sm">启用（停用后任务不再解析到它）</span>
        </div>
      </div>
    </Modal>
  </Page>
</template>
