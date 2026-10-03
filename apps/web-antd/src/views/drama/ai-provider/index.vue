<script lang="ts" setup>
import type { AiProviderItem } from '#/api/core/aiProvider';

/**
 * AI 模型管理（原「AI 服务」页改造，前端设计 §3）
 *
 * 语义升级：一期这个页面「一行一个模型」且地址/Key/模型名混填；二期模型归属**提供商**，
 * 本页用于**事后调整**（改能力、设默认、挂节点、启停）。
 *
 * ⚠️ **本页不提供「新建模型」**（设计 §3.1）：
 * 模型来源是「AI 提供商」页的发现流程（测试连通性 → 勾选 → 保存），
 * 避免用户手输模型名拼错；私有部署/ComfyUI 走提供商页的「手工添加模型」。
 *
 * 能力展示使用 `ProviderModelCapabilities`（生效 vs 厂商声明对照，R4）。
 * 不写配对 toast（拦截器已统一处理）。
 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';

import {
  Alert,
  Button,
  Card,
  Checkbox,
  Empty,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
} from 'ant-design-vue';

import {
  AI_CAPABILITY_OPTIONS,
  AI_CAPABILITY_SOURCE,
  AI_RUN_STATUS,
  aiProviderDelete,
  aiProviderList,
  aiProviderSetCapabilities,
  aiProviderSetEnabled,
  aiProviderSetNode,
} from '#/api/core/aiProvider';
import { computeNodeList } from '#/api/core/computeNode';
import { PeakOffPeakBadge } from '#/components/PeakOffPeakBadge';
import { ProviderModelCapabilities } from '#/components/ProviderModelCapabilities';

const router = useRouter();

// ─────────────────────────── 列表 ───────────────────────────

const rows = ref<AiProviderItem[]>([]);
const loading = ref(false);
const acting = ref<null | number>(null);

const providerFilter = ref<'all' | number>('all');
const capabilityFilter = ref<'all' | number>('all');
const enabledFilter = ref<'all' | 'no' | 'yes'>('all');

async function load() {
  loading.value = true;
  try {
    rows.value = (await aiProviderList()) ?? [];
    await loadNodeOptions();
  } catch {
    // 拦截器已提示
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());

/** 提供商筛选选项（从数据里现取，不额外请求） */
const providerOptions = computed(() => {
  const map = new Map<number, string>();
  for (const r of rows.value) {
    if (!map.has(r.providerId))
      map.set(r.providerId, r.providerName || `#${r.providerId}`);
  }
  return [
    { label: '全部提供商', value: 'all' as const },
    ...[...map.entries()].map(([id, name]) => ({ label: name, value: id })),
  ];
});

const filtered = computed(() =>
  rows.value.filter((r) => {
    if (
      providerFilter.value !== 'all' &&
      r.providerId !== providerFilter.value
    ) {
      return false;
    }
    if (
      capabilityFilter.value !== 'all' &&
      ((r.capabilities ?? 0) & capabilityFilter.value) === 0
    ) {
      return false;
    }
    if (enabledFilter.value === 'yes' && !r.isEnabled) return false;
    if (enabledFilter.value === 'no' && r.isEnabled) return false;
    return true;
  }),
);

// ─────────────────────────── 编辑（弹窗：能力 / 默认 / 节点 / 启停） ───────────────────────────

const nodeOptions = ref<{ label: string; value: number }[]>([]);

async function loadNodeOptions() {
  try {
    const nodes = await computeNodeList();
    nodeOptions.value = (nodes ?? [])
      .filter((n) => n.isEnabled)
      .map((n) => ({
        label: `${n.name}（${n.isOnline ? '在线' : '离线'}）`,
        value: n.id,
      }));
  } catch {
    // 节点接口失败不影响模型编辑（降级为只有「不挂节点」）
    nodeOptions.value = [];
  }
}

interface EditState {
  row: AiProviderItem | null;
  capabilities: number[];
  defaultFor: number[];
  nodeId: null | number;
  isEnabled: boolean;
}

const editOpen = ref(false);
const saving = ref(false);
const editing = ref<EditState>({
  row: null,
  capabilities: [],
  defaultFor: [],
  nodeId: null,
  isEnabled: true,
});

/** 位掩码 ↔ 勾选数组 */
function bitsToList(bits: number): number[] {
  return AI_CAPABILITY_OPTIONS.filter((o) => (bits & o.value) !== 0).map(
    (o) => o.value,
  );
}
function listToBits(list: number[]): number {
  return list.reduce((acc, v) => acc | v, 0);
}

function openEdit(row: AiProviderItem) {
  editing.value = {
    row,
    capabilities: bitsToList(row.capabilities ?? 0),
    defaultFor: bitsToList(row.defaultFor ?? 0),
    nodeId: row.nodeId ?? null,
    isEnabled: row.isEnabled,
  };
  editOpen.value = true;
}

/**
 * 取消勾选能力时同步取消该能力的「默认」标记。
 * ⚠️ 后端 SetCapabilities 会**拒绝** defaultFor 超出 capabilities 的组合，
 * 前端必须先自洽，否则用户会收到一个本可避免的失败。
 */
function onCapabilitiesChange() {
  const caps = editing.value.capabilities;
  editing.value.defaultFor = editing.value.defaultFor.filter((d) =>
    caps.includes(d),
  );
}

/** 厂商声明但未生效的能力（提示「厂商支持但我没开」） */
const shadowOnlyCount = computed(() => {
  const row = editing.value.row;
  if (!row) return 0;
  const shadow = row.shadowCapabilities ?? 0;
  const caps = listToBits(editing.value.capabilities);
  return AI_CAPABILITY_OPTIONS.filter(
    (o) => (shadow & o.value) !== 0 && (caps & o.value) === 0,
  ).length;
});

async function submitEdit() {
  const e = editing.value;
  const row = e.row;
  if (!row) return;
  const capabilities = listToBits(e.capabilities);
  if (capabilities === 0) {
    // 与后端一致：能力是空的模型无法被任何任务调用
    Modal.warning({
      title: '请至少勾选一项能力',
      content: '未勾选能力的模型无法被任何任务调用（等同于停用）。',
    });
    return;
  }
  const defaultFor = listToBits(e.defaultFor) & capabilities;

  saving.value = true;
  try {
    await aiProviderSetCapabilities(row.id, capabilities, defaultFor);
    await aiProviderSetNode(row.id, e.nodeId);
    if (row.isEnabled !== e.isEnabled) {
      await aiProviderSetEnabled(row.id, e.isEnabled);
    }
    editOpen.value = false;
    await load();
  } catch {
    // 拦截器已提示
  } finally {
    saving.value = false;
  }
}

// ─────────────────────────── 启停 / 删除 ───────────────────────────

async function toggleEnabled(row: AiProviderItem, next: boolean) {
  acting.value = row.id;
  try {
    await aiProviderSetEnabled(row.id, next);
    await load();
  } finally {
    acting.value = null;
  }
}

async function remove(row: AiProviderItem) {
  acting.value = row.id;
  try {
    await aiProviderDelete(row.id);
    await load();
  } finally {
    acting.value = null;
  }
}

// ─────────────────────────── 展示辅助 ───────────────────────────

// ant-design-vue 的 bodyCell 插槽 record 是 Record<string, any>：
// 统一收窄成 AiProviderItem，避免模板里到处 as any。
function asRow(record: Record<string, any>): AiProviderItem {
  return record as AiProviderItem;
}

function runStatusMeta(status: string) {
  return (
    AI_RUN_STATUS[status as keyof typeof AI_RUN_STATUS] ?? {
      color: 'default',
      label: status,
    }
  );
}

function capSourceText(src?: null | string): string {
  return (
    AI_CAPABILITY_SOURCE[src as keyof typeof AI_CAPABILITY_SOURCE] ?? '未知'
  );
}

/** 跳转到提供商页（列表页是「管理模型/测试连通性」的入口） */
function gotoProviderAdmin() {
  router.push({ name: 'AiProviderAdminList' }).catch(() => {
    router.push('/dramafloow/ai-provider-admin/list').catch(() => {});
  });
}

const capabilityFilterOptions = computed(() => [
  { label: '全部能力', value: 'all' as const },
  ...AI_CAPABILITY_OPTIONS.map((o) => ({ label: o.label, value: o.value })),
]);

const columns = [
  { title: '模型名', key: 'model', width: 220 },
  { title: '提供商', key: 'provider', width: 180 },
  { title: '能力', key: 'capabilities', width: 280 },
  { title: '默认', key: 'defaultFor', width: 160 },
  { title: '状态', key: 'enabled', width: 80 },
  { title: '运行状态', key: 'runStatus', width: 150 },
  { title: '归属节点', key: 'node', width: 150 },
  { title: '操作', key: 'action', width: 150 },
];
</script>

<template>
  <Page
    class="df-page"
    description="系统可调用的 AI 模型：能力 / 默认 / 归属节点 / 启停。模型在「AI 提供商」页通过测试连通性发现并勾选"
    title="AI 模型"
  >
    <template #extra>
      <Space>
        <Button :loading="loading" size="small" @click="load">刷新</Button>
        <Button size="small" type="primary" @click="gotoProviderAdmin">
          去「AI 提供商」添加
        </Button>
      </Space>
    </template>

    <Alert class="mb-4" show-icon type="info">
      <template #message>模型不在本页新建</template>
      <template #description>
        <div class="text-xs">
          模型来源是「AI 提供商」页的发现流程：<b
            >测试连通性 → 勾选模型与能力 → 保存</b
          >
          （私有部署 / ComfyUI 用「手工添加模型」）。这样避免手输模型名拼错。
          本页用于事后调整：改能力、设默认、挂节点、启停。
        </div>
      </template>
    </Alert>

    <Card class="df-table-card" size="small" title="模型列表">
      <div class="mb-3 flex flex-wrap items-center gap-3">
        <Select
          v-model:value="providerFilter"
          :options="providerOptions"
          style="width: 200px"
        />
        <Select
          v-model:value="capabilityFilter"
          :options="capabilityFilterOptions"
          style="width: 160px"
        />
        <Segmented
          v-model:value="enabledFilter"
          :options="[
            { label: '全部', value: 'all' },
            { label: '已启用', value: 'yes' },
            { label: '已停用', value: 'no' },
          ]"
        />
        <span class="text-xs text-muted-foreground">
          共 {{ filtered.length }} 个模型
        </span>
      </div>

      <Table
        v-if="filtered.length > 0"
        :columns="columns"
        :data-source="filtered"
        :loading="loading"
        :pagination="{ pageSize: 20, size: 'small', showSizeChanger: false }"
        :row-class-name="
          (record: AiProviderItem) => (record.isEnabled ? '' : 'opacity-60')
        "
        :scroll="{ x: 'max-content' }"
        row-key="id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <!-- 模型名 + 显示名 -->
          <template v-if="column.key === 'model'">
            <div class="flex min-w-0 flex-col">
              <span class="font-medium">{{
                record.modelId || record.model
              }}</span>
              <span class="text-xs text-muted-foreground">
                {{ record.displayName || '（无显示名）' }}
              </span>
              <span
                v-if="record.bindWorkflowId"
                class="text-xs text-muted-foreground"
              >
                工作流模板 #{{ record.bindWorkflowId }}
              </span>
            </div>
          </template>

          <!-- 提供商（点击跳转提供商页） -->
          <template v-else-if="column.key === 'provider'">
            <div class="flex min-w-0 flex-col">
              <a class="truncate" @click="gotoProviderAdmin">
                {{ record.providerName || `#${record.providerId}` }}
              </a>
              <div class="mt-1 flex flex-wrap items-center gap-1">
                <Tag class="!mr-0" color="blue">{{ record.providerType }}</Tag>
                <PeakOffPeakBadge :provider-id="record.providerId" />
              </div>
            </div>
          </template>

          <!-- 能力：生效 vs 厂商声明（R4） -->
          <template v-else-if="column.key === 'capabilities'">
            <ProviderModelCapabilities
              :capabilities="record.capabilities"
              :shadow-capabilities="record.shadowCapabilities"
            />
            <div class="mt-1 text-xs text-muted-foreground">
              来源：{{ capSourceText(record.capabilitiesSource) }}
            </div>
          </template>

          <!-- 默认 -->
          <template v-else-if="column.key === 'defaultFor'">
            <ProviderModelCapabilities :capabilities="record.defaultFor" />
          </template>

          <!-- 启停 -->
          <template v-else-if="column.key === 'enabled'">
            <Switch
              :checked="record.isEnabled"
              :loading="acting === record.id"
              size="small"
              @change="(v: any) => toggleEnabled(asRow(record), Boolean(v))"
            />
          </template>

          <!-- 运行状态 -->
          <template v-else-if="column.key === 'runStatus'">
            <Space :size="[4, 4]" wrap>
              <Tag :color="runStatusMeta(record.runStatus).color" class="!mr-0">
                {{ runStatusMeta(record.runStatus).label }}
              </Tag>
              <Tag v-if="record.paused" class="!mr-0" color="warning">
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

          <!-- 归属节点 -->
          <template v-else-if="column.key === 'node'">
            <template v-if="record.nodeId">
              <span class="text-xs">
                {{ record.nodeName ?? `#${record.nodeId}` }}
              </span>
              <Tag
                v-if="record.nodeOnline === false"
                class="ml-1 !mr-0"
                color="error"
              >
                离线
              </Tag>
              <Tag
                v-else-if="record.nodeSwitching"
                class="ml-1 !mr-0"
                color="processing"
              >
                切换中
              </Tag>
            </template>
            <span v-else class="text-xs text-muted-foreground">
              （独立 API，不占卡）
            </span>
          </template>

          <!-- 操作 -->
          <template v-else-if="column.key === 'action'">
            <Space>
              <Button size="small" @click="openEdit(asRow(record))">
                编辑
              </Button>
              <Popconfirm
                description="删除后任务将无法再选它（历史任务记录保留）；其在飞任务会被中断。"
                title="确认删除该模型？"
                @confirm="remove(asRow(record))"
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
        description="还没有模型：到「AI 提供商」页测试连通性后勾选模型，或手工添加"
      >
        <Button type="primary" @click="gotoProviderAdmin">
          去「AI 提供商」添加
        </Button>
      </Empty>
    </Card>

    <!-- 编辑模型：能力 / 默认 / 节点 / 启停（§3.2） -->
    <Modal
      v-model:open="editOpen"
      :confirm-loading="saving"
      :title="`编辑模型：${editing.row?.modelId ?? ''}`"
      :width="640"
      @ok="submitEdit"
    >
      <div v-if="editing.row" class="flex flex-col gap-3">
        <div class="text-xs text-muted-foreground">
          提供商：{{ editing.row.providerName }}（
          {{ editing.row.providerType }} ）· 模型名：{{
            editing.row.modelId
          }}（如需改请重新拉取）
        </div>

        <div>
          <div class="mb-1 text-sm">系统可用能力</div>
          <Checkbox.Group
            v-model:value="editing.capabilities"
            :options="AI_CAPABILITY_OPTIONS"
            class="flex flex-wrap gap-x-4 gap-y-1"
            @change="onCapabilitiesChange"
          >
            <template #label="{ label, value }">
              <span>
                {{ label }}
                <span
                  v-if="
                    AI_CAPABILITY_OPTIONS.find((o) => o.value === value)?.note
                  "
                  class="text-[10px] text-muted-foreground"
                >
                  ({{
                    AI_CAPABILITY_OPTIONS.find((o) => o.value === value)?.note
                  }})
                </span>
              </span>
            </template>
          </Checkbox.Group>
          <div class="mt-1 text-xs text-muted-foreground">
            <template v-if="editing.row.shadowCapabilities">
              ⓘ 厂商声明：
              {{
                AI_CAPABILITY_OPTIONS.filter(
                  (o) => (editing.row!.shadowCapabilities & o.value) !== 0,
                )
                  .map((o) => o.label)
                  .join('、') || '无'
              }}
              （据{{ capSourceText(editing.row.capabilitiesSource) }}）
              <template v-if="shadowOnlyCount > 0">
                · 其中 {{ shadowOnlyCount }} 项厂商支持但你未启用
              </template>
            </template>
            <template v-else>
              ⓘ 该模型无厂商声明能力（手工添加或接口未提供元数据）
            </template>
          </div>
        </div>

        <div>
          <div class="mb-1 text-sm">设为默认</div>
          <Checkbox.Group
            v-model:value="editing.defaultFor"
            :options="
              AI_CAPABILITY_OPTIONS.filter((o) =>
                editing.capabilities.includes(o.value),
              )
            "
          />
          <div class="mt-1 text-xs text-muted-foreground">
            任务不指定模型时就用它（同一能力只能有一个默认；未设置则按排序取最靠前的可用模型）
          </div>
        </div>

        <div>
          <div class="mb-1 text-sm">归属节点</div>
          <Select
            :options="nodeOptions"
            :value="editing.nodeId ?? undefined"
            allow-clear
            placeholder="留空 = 独立 API，不占卡"
            style="width: 100%"
            @update:value="(v: any) => (editing.nodeId = v ?? null)"
          />
          <div class="mt-1 text-xs text-muted-foreground">
            挂到节点后：与同节点其他模型争同一张卡（受互斥/攒批/切换约束）；留空则不占卡。
          </div>
        </div>

        <div class="flex items-center gap-2">
          <Switch v-model:checked="editing.isEnabled" size="small" />
          <span class="text-sm"
            >启用（停用后任务不再解析到它，且会撤销其默认位）</span
          >
        </div>

        <Tooltip
          title="保存会调用 SetCapabilities / SetNode / SetEnabled 三个端点"
        >
          <span class="text-xs text-muted-foreground">
            保存时按需调用对应接口（能力 + 默认、节点、启停）。
          </span>
        </Tooltip>
      </div>
    </Modal>
  </Page>
</template>
