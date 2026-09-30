<script lang="ts" setup>
/**
 * 算力节点管理（P2）
 *
 * 「算力节点」= 一台机器（一期：本地 GPU，独占一张卡）。
 * AI 服务经「归属节点」挂到节点上：同节点服务争同一张卡，
 * 调度器按「节点互斥 + 软攒批 + 切换经济学」决定谁先跑、要不要换服务。
 *
 * 关键规则（与后端一致）：
 *   - 在线/离线由心跳维护（3 次连续探测失败 → 离线）；
 *   - 停用节点 = 调度整体回退旧路径（挂载服务照旧可用，只是不受节点约束）；
 *   - 删除节点会把挂载服务「摘下」（退回不挂节点的旧路径），不会删服务；
 *   - 云端/边缘/超算是二期预留（计费/折扣窗/配额），一期只留位。
 */
import { computed, onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Alert,
  Button,
  Card,
  Collapse,
  CollapsePanel,
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
  Tooltip,
} from 'ant-design-vue';

import { TimeTag } from '#/components/TimeTag';

import type {
  ComputeNodeItem,
  ComputeNodeStatusView,
} from '#/api/core/computeNode';

import {
  computeNodeDelete,
  computeNodeList,
  computeNodeSave,
  computeNodeSetEnabled,
  computeNodeStatus,
  isPhase2NodeType,
  NODE_TYPES,
  NODE_TYPE_TEXT,
} from '#/api/core/computeNode';

// ─────────────────────────── 列表 ───────────────────────────

const rows = ref<ComputeNodeItem[]>([]);
const loading = ref(false);
const acting = ref<null | number>(null);

async function load() {
  loading.value = true;
  try {
    rows.value = await computeNodeList();
    await loadStatus();
  } catch {
    // 拦截器已提示
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());

// ─────────────────────────── 节点状态（第一个启用节点） ───────────────────────────

const statusView = ref<ComputeNodeStatusView | null>(null);
const statusLoading = ref(false);

async function loadStatus() {
  const enabled = rows.value.find((n) => n.isEnabled);
  if (!enabled) {
    statusView.value = null;
    return;
  }
  statusLoading.value = true;
  try {
    statusView.value = await computeNodeStatus(enabled.id);
  } catch {
    statusView.value = null;
  } finally {
    statusLoading.value = false;
  }
}

/** 切换中剩余时间 mm:ss */
function fmtSwitchingRemain(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(
    s % 60,
  ).padStart(2, '0')}`;
}

// ─────────────────────────── 表单 ───────────────────────────

interface FormState {
  canSwitch: boolean;
  id?: number;
  isEnabled: boolean;
  name: string;
  nodeType: string;
  slotCount: number;
  sortNo: number;
  switchCostMin: number;
  remark: string;
}

const editOpen = ref(false);
const saving = ref(false);
const editing = ref<FormState>(blank());

function blank(): FormState {
  return {
    name: '',
    nodeType: 'local_gpu',
    slotCount: 1,
    canSwitch: true,
    switchCostMin: 10,
    isEnabled: true,
    sortNo: 0,
    remark: '',
  };
}

function openCreate() {
  editing.value = blank();
  editOpen.value = true;
}

function openEdit(row: ComputeNodeItem | Record<string, any>) {
  editing.value = {
    id: row.id,
    name: row.name,
    nodeType: row.nodeType,
    slotCount: row.slotCount,
    canSwitch: row.canSwitch,
    switchCostMin: row.switchCostMin,
    isEnabled: row.isEnabled,
    sortNo: row.sortNo,
    remark: row.remark ?? '',
  };
  editOpen.value = true;
}

async function submit() {
  const f = editing.value;
  if (!f.name.trim()) {
    message.error('请填写节点名');
    return;
  }
  if (isPhase2NodeType(f.nodeType)) {
    message.error('云端 / 边缘 / 超算为二期能力，一期不可配置');
    return;
  }
  if (f.switchCostMin < 0) {
    message.error('切换耗时不能为负');
    return;
  }

  saving.value = true;
  try {
    await computeNodeSave({
      id: f.id,
      name: f.name.trim(),
      nodeType: f.nodeType,
      slotCount: 1, // 一期恒定：一张卡只服务一个服务
      canSwitch: f.canSwitch,
      switchCostMin: f.switchCostMin,
      isEnabled: f.isEnabled,
      sortNo: f.sortNo,
      remark: f.remark.trim(),
    });
    editOpen.value = false;
    await load();
  } finally {
    saving.value = false;
  }
}

async function toggleEnabled(
  row: ComputeNodeItem | Record<string, any>,
  next: boolean,
) {
  acting.value = row.id;
  try {
    await computeNodeSetEnabled(row.id, next);
    await load();
  } finally {
    acting.value = null;
  }
}

async function remove(row: ComputeNodeItem | Record<string, any>) {
  acting.value = row.id;
  try {
    await computeNodeDelete(row.id);
    await load();
  } finally {
    acting.value = null;
  }
}

// ─────────────────────────── 展示辅助 ───────────────────────────

const columns = [
  { title: '节点', key: 'name', width: 220 },
  { title: '类型', key: 'type', width: 110 },
  { title: '当前服务', key: 'currentService', width: 190 },
  {
    title: '挂载服务',
    dataIndex: 'serviceCount',
    key: 'serviceCount',
    width: 90,
  },
  { title: '心跳', key: 'heartbeat', width: 170 },
  { title: '状态', key: 'state', width: 130 },
  { title: '启用', key: 'enabled', width: 80 },
  { title: '操作', key: 'action', width: 150 },
];

/** 二期预留字段（云计费 / 折扣窗 / 配额）：一期只留位，不启用 */
const phase2Fields = computed(() => [
  '计费模式（按时长 / 按 token / 按图）',
  '折扣窗口（夜间低价时段）',
  '配额（总量 / 已用 / 重置规则）',
]);

/** 表单里的类型选项：二期类型置灰不可选 */
const nodeTypeOptions = computed(() =>
  NODE_TYPES.map((t) => ({
    ...t,
    disabled: isPhase2NodeType(t.value),
  })),
);
</script>

<template>
  <Page
    class="df-page"
    description="节点是一台机器（独占一张卡）；AI 服务挂到节点上后，同节点服务受互斥 / 攒批 / 切换约束"
    title="算力节点"
  >
    <template #extra>
      <Space>
        <Button :loading="loading" size="small" @click="load">刷新</Button>
        <Button size="small" type="primary" @click="openCreate">
          添加节点
        </Button>
      </Space>
    </template>

    <Alert
      class="mb-4"
      description="节点在线/离线由心跳自动维护（3 次探测失败判离线）。停用节点后，调度整体回退旧路径（挂载服务照旧可用，只失去节点约束）。在「AI 服务」页把服务挂到节点上。"
      message="「算力节点」= 一台物理 / 虚拟机器"
      show-icon
      type="info"
    />

    <Card size="small" title="节点列表">
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
              <Tag v-if="!record.isOnline" color="error" class="!mr-0">
                离线
              </Tag>
              <Tag v-else color="success" class="!mr-0">在线</Tag>
              <Tag v-if="record.switching" color="processing" class="!mr-0">
                切换中 {{ fmtSwitchingRemain(record.switchingRemainSec) }}
              </Tag>
            </div>
            <div v-if="record.remark" class="text-xs text-muted-foreground">
              {{ record.remark }}
            </div>
          </template>

          <template v-else-if="column.key === 'type'">
            <span class="text-xs">
              {{ NODE_TYPE_TEXT[record.nodeType] ?? record.nodeType }}
            </span>
            <div class="text-xs text-muted-foreground">
              {{ record.canSwitch ? '可换服务' : '固定绑定' }} · 切换
              {{ record.switchCostMin }} 分钟
            </div>
          </template>

          <template v-else-if="column.key === 'currentService'">
            <template v-if="record.currentServiceName">
              <span class="text-xs">{{ record.currentServiceName }}</span>
            </template>
            <span v-else class="text-xs text-muted-foreground">
              （未绑定）
            </span>
          </template>

          <template v-else-if="column.key === 'heartbeat'">
            <TimeTag v-if="record.heartbeatAt" :time="record.heartbeatAt" />
            <span v-else class="text-xs text-muted-foreground">
              （从未探活）
            </span>
          </template>

          <template v-else-if="column.key === 'state'">
            <template v-if="!record.isEnabled">
              <Tag color="default" class="!mr-0">已停用</Tag>
            </template>
            <template v-else-if="record.switching">
              <Tag color="processing" class="!mr-0">切换中</Tag>
            </template>
            <template v-else-if="record.isOnline">
              <Tag color="success" class="!mr-0">就绪</Tag>
            </template>
            <template v-else>
              <Tag color="error" class="!mr-0">不可用</Tag>
            </template>
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
                description="挂载的服务会被摘下（退回不挂节点的旧路径），不会删除服务；在途任务正常跑完。"
                title="确认删除该节点？"
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
        description="还没有节点：点右上角「添加节点」登记一台机器"
      />
    </Card>

    <!-- 当前调度状态（第一个启用节点） -->
    <Card v-if="statusView" class="mt-4" size="small" title="调度状态">
      <div
        v-if="statusView.node"
        class="flex flex-wrap items-center gap-6 text-sm"
      >
        <div>
          <span class="text-muted-foreground">节点：</span>
          <span class="font-medium">{{ statusView.node.name }}</span>
          <Tag
            v-if="statusView.node.switching"
            color="processing"
            class="ml-2 !mr-0"
          >
            切换中 {{ fmtSwitchingRemain(statusView.node.switchingRemainSec) }}
          </Tag>
          <Tag
            v-else
            :color="statusView.node.isOnline ? 'success' : 'error'"
            class="ml-2 !mr-0"
          >
            {{ statusView.node.isOnline ? '在线' : '离线' }}
          </Tag>
        </div>
        <div>
          <span class="text-muted-foreground">当前服务：</span>
          <span>{{ statusView.node.currentServiceName ?? '（未绑定）' }}</span>
        </div>
        <div>
          <span class="text-muted-foreground">用户队列：</span>
          <span>
            出图 {{ statusView.queues.image }} · 视频
            {{ statusView.queues.video }} · 文本
            {{ statusView.queues.text }}
          </span>
        </div>
        <div>
          <span class="text-muted-foreground">系统任务：</span>
          <span>
            排队 {{ statusView.system.queued }} · 在途
            {{ statusView.system.inFlight }}
          </span>
        </div>
      </div>
      <div class="mt-2 text-xs text-muted-foreground">
        节点挂载的服务（运行态由调度器 / 心跳维护）：
        <template v-if="statusView.services.length > 0">
          <span v-for="s in statusView.services" :key="s.id" class="ml-2">
            {{ s.name }}（{{
              s.runStatus === 'busy'
                ? '执行中'
                : s.runStatus === 'offline'
                  ? '离线'
                  : '空闲'
            }}{{ s.paused ? '·熔断暂停' : '' }}
            <template v-if="s.currentTask">
              · 任务 #{{ s.currentTask.id }} {{ s.currentTask.type }}
            </template>
            ）
          </span>
        </template>
        <span v-else>（无）</span>
      </div>
      <div class="mt-1 text-xs text-muted-foreground">
        <Tooltip title="节点离线时任务继续排队，节点恢复后自动领取执行">
          <span underline>
            说明：节点离线不影响任务提交，只影响执行（排队等恢复）。
          </span>
        </Tooltip>
      </div>
    </Card>

    <Card v-else-if="!loading" class="mt-4" size="small" title="调度状态">
      <Empty description="没有启用的节点（调度走旧路径：服务互不约束）" />
    </Card>

    <!-- 二期预留 -->
    <Card class="mt-4" size="small">
      <Collapse>
        <CollapsePanel
          header="二期预留字段（云端计费 / 折扣窗 / 配额）"
          key="p2"
        >
          <ul class="mb-0 ml-4 list-disc text-xs text-muted-foreground">
            <li v-for="f in phase2Fields" :key="f">{{ f }}</li>
            <li>这些字段已随实体预留，一期不启用；云端节点接入后开放编辑</li>
          </ul>
        </CollapsePanel>
      </Collapse>
    </Card>

    <!-- 新增/编辑 -->
    <Modal
      v-model:open="editOpen"
      :confirm-loading="saving"
      :title="editing.id ? '编辑节点' : '添加节点'"
      :width="640"
      @ok="submit"
    >
      <div class="flex flex-col gap-3">
        <div>
          <div class="mb-1 text-sm">节点名 *</div>
          <Input v-model:value="editing.name" placeholder="如：120 本地 3090" />
        </div>

        <div>
          <div class="mb-1 text-sm">类型 *</div>
          <Select
            v-model:value="editing.nodeType"
            :options="nodeTypeOptions"
            style="width: 100%"
          >
            <template #option="{ value, label }">
              <span
                :class="isPhase2NodeType(value) ? 'text-muted-foreground' : ''"
              >
                {{ label }}
              </span>
            </template>
          </Select>
          <div class="mt-1 text-xs text-muted-foreground">
            一期只支持本地 GPU（独占一张卡）；云端 / 边缘 /
            超算是二期预留（置灰）。
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <div class="mb-1 text-sm">并发槽位（一期固定 1）</div>
            <InputNumber :value="1" :min="1" :max="1" class="w-full" disabled />
          </div>
          <div>
            <div class="mb-1 text-sm">一次切换耗时（分钟）</div>
            <InputNumber
              v-model:value="editing.switchCostMin"
              :min="0"
              :step="1"
              class="w-full"
            />
          </div>
        </div>
        <div class="text-xs text-muted-foreground">
          切换耗时用于「切换经济学」：新服务队列的工作量明显超过当前服务时才换。
        </div>

        <div>
          <div class="mb-1 text-sm">排序（小在前；多节点时的兜底顺序）</div>
          <InputNumber v-model:value="editing.sortNo" :min="0" class="w-full" />
        </div>

        <div>
          <div class="mb-1 text-sm">备注</div>
          <Input
            v-model:value="editing.remark"
            placeholder="如：单卡 24G，限制 1024 分辨率"
          />
        </div>

        <div class="flex items-center gap-2">
          <Switch v-model:checked="editing.canSwitch" size="small" />
          <span class="text-sm">允许换服务（关闭 = 固定绑定，永不换）</span>
        </div>
        <div class="flex items-center gap-2">
          <Switch v-model:checked="editing.isEnabled" size="small" />
          <span class="text-sm">启用（停用后调度回退旧路径）</span>
        </div>
      </div>
    </Modal>
  </Page>
</template>
