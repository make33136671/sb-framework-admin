<script lang="ts" setup>
/**
 * AI 提供商管理（二期新增，前端设计 §2）
 *
 * 页面职责（与「AI 模型」页的分工，§1.1）：
 *   本页 = 管"怎么连厂商"（名字/地址/Key/测试连通/拉模型）；
 *   模型页 = 管"系统能用哪些模型、它们有什么能力"。
 *   **主流程在本页完成**：添加提供商 → 测试连通性 → 勾选模型与能力 → 保存。
 *
 * 三个 Tab：
 *   「提供商」列表（§2.1）· 「成本与调度设置」（§6.2）· 「上云决策回看」（§6.3）
 *
 * 关键边界（§5）：
 *   - `verifyStatus=failed` → 行标红，其模型列表提示「连通性异常，请先修复」；
 *   - `isEnabled=false` → 行置灰（其模型在模型页也不可用）；
 *   - `adapterMissing` → 行显示红色「适配器缺失」（该接入类型在当前版本不可用）；
 *   - 删除提供商 → 二次确认「将同时删除其下 N 个模型，引用这些模型的历史任务不受影响」。
 *
 * 不写配对 toast（拦截器已统一处理）。
 */
import { computed, onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tabs,
  TabPane,
  Tag,
  Tooltip,
} from 'ant-design-vue';

import type { AiProviderAdminItem } from '#/api/core/aiProviderAdmin';

import { AI_VERIFY_STATUS } from '#/api/core/aiProvider';
import {
  aiProviderAdminDelete,
  aiProviderAdminList,
  aiProviderAdminSave,
} from '#/api/core/aiProviderAdmin';
import { PeakOffPeakBadge } from '#/components/PeakOffPeakBadge';

import CloudDecisionReview from './CloudDecisionReview.vue';
import CostSettingsPanel from './CostSettingsPanel.vue';
import ModelDiscoveryPanel from './ModelDiscoveryPanel.vue';
import ProviderFormDrawer from './ProviderFormDrawer.vue';

// ─────────────────────────── 列表 ───────────────────────────

const tab = ref('providers');
const rows = ref<AiProviderAdminItem[]>([]);
const loading = ref(false);
const acting = ref<null | number>(null);

async function load() {
  loading.value = true;
  try {
    rows.value = (await aiProviderAdminList()) ?? [];
  } catch {
    // 拦截器已提示
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());

// ─────────────────────────── 添加/编辑 ───────────────────────────

const formOpen = ref(false);
const editing = ref<AiProviderAdminItem | null>(null);

function openCreate() {
  editing.value = null;
  formOpen.value = true;
}

function openEdit(row: AiProviderAdminItem) {
  editing.value = row;
  formOpen.value = true;
}

function onSaved(id: number) {
  void load();
  if (!editing.value && id) {
    // 前端设计 §2.2：保存后提示「建议点『测试连通性』拉取可用模型」
    // （这是引导而非成功提示，故不与拦截器的成功 toast 重复）
    setTimeout(() => {
      const row = rows.value.find((r) => r.id === id);
      if (row) openModels(row);
    }, 300);
  }
}

// ─────────────────────────── 测试连通性 / 管理模型（抽屉） ───────────────────────────

const modelsOpen = ref(false);
const modelsRow = ref<AiProviderAdminItem | null>(null);
/** 该提供商的模型总数（每批测试后刷新，用于列表计数提示） */
const modelsCount = ref(0);

function openModels(row: AiProviderAdminItem) {
  modelsRow.value = row;
  modelsCount.value = row.modelCount;
  modelsOpen.value = true;
}

async function onModelsChanged() {
  await load();
  const fresh = rows.value.find((r) => r.id === modelsRow.value?.id);
  if (fresh) {
    modelsCount.value = fresh.modelCount;
    modelsRow.value = fresh;
  }
}

/** 「测试连通性」= 管理模型抽屉（就地展示测试结果 + 勾选，§2.3） */
function testConnection(row: AiProviderAdminItem) {
  openModels(row);
}

// ─────────────────────────── 启停 / 删除 ───────────────────────────

async function toggleEnabled(row: AiProviderAdminItem, next: boolean) {
  acting.value = row.id;
  try {
    // ⚠️ 提供商没有独立的 SetEnabled 端点 → 只能走 Save。
    // Save 是**整行覆盖**，因此必须把未被修改的字段原样回传，
    // 否则「启停」会顺手清掉地址/备注/适配器配置（remark 传空串而非 undefined，
    // 避免 form 缺参被后端当作 null 清空）。
    await aiProviderAdminSave({
      id: row.id,
      name: row.name,
      providerKey: row.providerKey,
      baseUrl: row.baseUrl ?? '',
      isEnabled: next,
      sortNo: row.sortNo,
      remark: row.remark ?? '',
      adapterConfig: row.adapterConfig ?? undefined,
    });
    await load();
  } finally {
    acting.value = null;
  }
}

async function remove(row: AiProviderAdminItem) {
  acting.value = row.id;
  try {
    await aiProviderAdminDelete(row.id);
    await load();
  } finally {
    acting.value = null;
  }
}

// ─────────────────────────── 展示辅助 ───────────────────────────

// ant-design-vue 的 bodyCell 插槽 record 是 Record<string, any>：
// 统一收窄成 AiProviderAdminItem，避免模板里到处 as any。
function asRow(record: Record<string, any>): AiProviderAdminItem {
  return record as AiProviderAdminItem;
}

function verifyMeta(status: string) {
  return (
    AI_VERIFY_STATUS[status as keyof typeof AI_VERIFY_STATUS] ??
    AI_VERIFY_STATUS.unverified
  );
}

/** 连通性异常 → 其模型不可被启用（§2.6 / §5） */
function modelEnableBlocked(row: AiProviderAdminItem): string {
  if (row.adapterMissing) return '该接入类型在当前版本不可用（适配器缺失）';
  if (!row.isEnabled) return '提供商已停用：其模型在「AI 模型」页也不可用';
  if (row.verifyStatus === 'failed') return '连通性异常，模型暂不可启用';
  return '';
}

const columns = [
  { title: '名称', key: 'name', width: 200 },
  { title: '接入类型', key: 'adapter', width: 150 },
  { title: '地址', key: 'baseUrl', ellipsis: true, width: 240 },
  { title: '密钥', key: 'apiKey', width: 100 },
  { title: '连通性', key: 'verify', width: 160 },
  { title: '模型', key: 'models', width: 150 },
  { title: '启停', key: 'enabled', width: 80 },
  { title: '操作', key: 'action', width: 240 },
];

const enabledCount = computed(
  () => rows.value.filter((r) => r.isEnabled).length,
);
</script>

<template>
  <Page
    class="df-page"
    description="接入 AI 厂商：填地址与密钥 → 测试连通性 → 勾选系统可调用的模型与能力"
    title="AI 提供商"
  >
    <template #extra>
      <Space>
        <Button :loading="loading" size="small" @click="load">刷新</Button>
        <Button size="small" type="primary" @click="openCreate">
          添加提供商
        </Button>
      </Space>
    </template>

    <Tabs v-model:active-key="tab">
      <!-- ① 提供商列表 -->
      <TabPane key="providers" tab="提供商">
        <!-- 空态引导卡片（§2.1） -->
        <Card v-if="rows.length === 0 && !loading" size="small">
          <Empty description="">
            <template #description>
              <div class="flex flex-col gap-2">
                <div class="text-base font-medium">还没有接入 AI 服务</div>
                <div class="text-sm text-muted-foreground">
                  点击『添加提供商』接入 DeepSeek 官网，或用 OpenAI
                  兼容协议接入任意厂商。
                </div>
                <div>
                  <Button type="primary" @click="openCreate">
                    添加提供商
                  </Button>
                </div>
              </div>
            </template>
          </Empty>
        </Card>

        <Card v-else size="small" title="提供商列表">
          <template #extra>
            <span class="text-xs text-muted-foreground">
              共 {{ rows.length }} 个 · 已启用 {{ enabledCount }} 个
            </span>
          </template>

          <Table
            :columns="columns"
            :data-source="rows"
            :loading="loading"
            :pagination="false"
            :row-class-name="
              (record: AiProviderAdminItem) =>
                record.adapterMissing || record.verifyStatus === 'failed'
                  ? 'df-row-danger'
                  : !record.isEnabled
                    ? 'opacity-60'
                    : ''
            "
            :scroll="{ x: 'max-content' }"
            row-key="id"
            size="small"
          >
            <template #bodyCell="{ column, record }">
              <!-- 名称 + providerKey 徽标 -->
              <template v-if="column.key === 'name'">
                <div class="flex min-w-0 flex-col">
                  <div class="flex items-center gap-2">
                    <span class="font-medium">{{ record.name }}</span>
                    <Tag v-if="!record.isEnabled" class="!mr-0">已停用</Tag>
                  </div>
                  <div class="mt-1 flex flex-wrap items-center gap-1">
                    <Tag class="!mr-0" color="blue">
                      {{ record.providerKey }}
                    </Tag>
                    <Tag
                      v-if="record.adapterMissing"
                      class="!mr-0"
                      color="error"
                    >
                      适配器缺失
                    </Tag>
                    <PeakOffPeakBadge :provider-id="record.id" />
                  </div>
                  <span
                    v-if="record.remark"
                    class="truncate text-xs text-muted-foreground"
                  >
                    {{ record.remark }}
                  </span>
                </div>
              </template>

              <!-- 接入类型（适配器 displayName） -->
              <template v-else-if="column.key === 'adapter'">
                <span class="text-xs">{{ record.adapterDisplayName }}</span>
              </template>

              <!-- 地址 -->
              <template v-else-if="column.key === 'baseUrl'">
                <Tooltip :title="record.baseUrl || '（未填）'">
                  <span class="text-xs break-all">
                    {{ record.baseUrl || '（未填）' }}
                  </span>
                </Tooltip>
              </template>

              <!-- 密钥（永不回显明文） -->
              <template v-else-if="column.key === 'apiKey'">
                <Tag
                  :color="record.hasApiKey ? 'success' : 'default'"
                  class="!mr-0"
                >
                  {{ record.hasApiKey ? '已配置' : '未配置' }}
                </Tag>
              </template>

              <!-- 连通性：verifyStatus + verifyMessage tooltip -->
              <template v-else-if="column.key === 'verify'">
                <Tooltip
                  :title="
                    record.verifyMessage ||
                    (record.verifyStatus === 'unverified'
                      ? '尚未测试连通性'
                      : '')
                  "
                >
                  <Tag
                    :color="verifyMeta(record.verifyStatus).color"
                    class="!mr-0 cursor-help"
                  >
                    {{ verifyMeta(record.verifyStatus).label }}
                  </Tag>
                </Tooltip>
                <div
                  v-if="record.verifyStatus === 'failed'"
                  class="mt-1 text-xs text-muted-foreground"
                >
                  连通性异常，模型暂不可启用
                </div>
              </template>

              <!-- 模型计数 -->
              <template v-else-if="column.key === 'models'">
                <a
                  :class="
                    modelEnableBlocked(asRow(record))
                      ? 'pointer-events-none opacity-50'
                      : ''
                  "
                  @click="openModels(asRow(record))"
                >
                  已启用 {{ record.enabledCount }} / 共 {{ record.modelCount }}
                </a>
                <div
                  v-if="modelEnableBlocked(asRow(record))"
                  class="text-xs text-muted-foreground"
                >
                  {{ modelEnableBlocked(asRow(record)) }}
                </div>
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

              <!-- 操作 -->
              <template v-else-if="column.key === 'action'">
                <Space :size="[4, 4]" wrap>
                  <Button size="small" @click="testConnection(asRow(record))">
                    测试连通性
                  </Button>
                  <Button size="small" @click="openModels(asRow(record))">
                    管理模型
                  </Button>
                  <Button size="small" @click="openEdit(asRow(record))"
                    >编辑</Button
                  >
                  <Popconfirm
                    :description="`将同时删除其下 ${record.modelCount} 个模型，引用这些模型的历史任务不受影响。`"
                    title="确认删除该提供商？"
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
        </Card>
      </TabPane>

      <!-- ② 成本与调度设置（§6.2） -->
      <TabPane key="cost" tab="成本与调度设置">
        <Alert
          class="mb-3"
          message="这一页决定系统会不会主动花钱"
          description="默认全部关闭。开启「主动花钱上云」后，系统会在优惠时段按性价比自动把排队久的任务送云端并行执行；受单任务/单日上限约束，且不影响本地继续跑。"
          show-icon
          type="warning"
        />
        <CostSettingsPanel />
      </TabPane>

      <!-- ③ 上云决策回看（§6.3） -->
      <TabPane key="decisions" tab="上云决策回看">
        <CloudDecisionReview />
      </TabPane>
    </Tabs>

    <!-- 添加/编辑提供商 -->
    <ProviderFormDrawer
      v-model:open="formOpen"
      :editing="editing"
      @saved="onSaved"
    />

    <!-- 测试连通性 + 模型勾选（核心交互，§2.3） -->
    <Drawer
      v-model:open="modelsOpen"
      :title="`管理模型：${modelsRow?.name ?? ''}`"
      :width="1000"
    >
      <template v-if="modelsRow">
        <Alert
          v-if="modelEnableBlocked(modelsRow)"
          class="mb-3"
          :message="modelEnableBlocked(modelsRow)"
          show-icon
          type="error"
        />
        <ModelDiscoveryPanel
          :adapter-config="modelsRow.adapterConfig ?? undefined"
          :base-url="modelsRow.baseUrl ?? undefined"
          :provider-id="modelsRow.id"
          :provider-key="modelsRow.providerKey"
          :provider-name="modelsRow.name"
          :supported-capabilities="modelsRow.supportedCapabilities"
          @changed="onModelsChanged"
        />
        <div class="mt-3 text-xs text-muted-foreground">
          当前该提供商下共
          {{ modelsCount }} 个模型（列表页计数随保存自动刷新）。
        </div>
      </template>
      <Empty v-else description="请选择提供商" />
    </Drawer>
  </Page>
</template>
