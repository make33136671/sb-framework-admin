<script lang="ts" setup>
import type { CloudDecisionItem, CloudDecisionSnapshot } from './api';

/**
 * CloudDecisionReview —— 上云决策回看表（前端设计 §6.3）
 *
 * **这张表是本功能的信任基础**：用户只有看懂"系统为什么花/不花这笔钱"，
 * 才敢开启开关、才会去校准阈值。因此**两类决策都要列**：
 *   已上云（CloudUpshift）与未上云（CloudHold，含未通过的原因）。
 *
 * 数据源：`GET /Scheduler/CloudDecisions` → `{ items, todaySpent, gates, note, serverUtcNow }`，
 * `items[].detail` 是后端写的 JSON 计算过程：
 *   - CloudUpshift：estimate{saveMin, costYuan, ratio, threshold}、pricing、route=cloud
 *   - CloudHold  ：estimate{localFinishMin, cloudFinishMin, ...}、reasonText（中文原因）、route=local
 *
 * 关键取舍：
 *   - 原因中文**优先用后端的 `reasonText`**，缺失才回退本地映射（后端是文案单一事实源）；
 *   - CloudHold 才有的 localFinishMin/cloudFinishMin 缺失时渲染 `-`（不伪造数字）；
 *   - 解析**绝不抛**（坏 JSON / 缺字段 / 空列表都要能优雅降级）。
 *
 * ⚠️ 未上云行在服务端**按「任务 × 原因」节流**（30 分钟至多一条），列表天然稀疏 ——
 * 空列表是正常状态，不是故障。
 *
 * 不写配对 toast（拦截器已统一处理）。
 */
import { computed, onMounted, ref } from 'vue';

import {
  Alert,
  Button,
  Descriptions,
  DescriptionsItem,
  Empty,
  Statistic,
  Table,
  Tag,
  Tooltip,
} from 'ant-design-vue';

import { TimeTag } from '#/components/TimeTag';

import {
  cloudDecisions,
  cloudReasonTextOf,
  isUpshiftSnapshot,
  parseCloudSnapshot,
} from './api';

const items = ref<CloudDecisionItem[]>([]);
const todaySpent = ref<null | number>(null);
const gates = ref<null | Record<string, any>>(null);
const note = ref('');
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const data = await cloudDecisions(100);
    // 防御：后端可能返回空对象 / 形状不符 —— 一律降级为空表
    items.value = Array.isArray(data?.items) ? data.items : [];
    todaySpent.value =
      typeof data?.todaySpent === 'number' ? data.todaySpent : null;
    gates.value = data?.gates ?? null;
    note.value = data?.note ?? '';
  } catch {
    // 端点异常 → 空表而非报错页
    items.value = [];
    todaySpent.value = null;
    gates.value = null;
    note.value = '';
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());

interface ViewRow {
  key: number;
  id: number;
  createdAt: string;
  taskId: null | number;
  taskType: string;
  modelName: string;
  providerName: string;
  period: string;
  localFinishMin: null | number;
  cloudFinishMin: null | number;
  saveMin: null | number;
  costYuan: null | number;
  ratio: null | number;
  threshold: null | number;
  reason: string;
  reasonText: string;
  upshift: boolean;
  snapshot: CloudDecisionSnapshot | null;
  /** 无法解析载荷（坏 JSON / 老格式）→ 只展示时间与占位 */
  opaque: boolean;
}

const view = computed<ViewRow[]>(() =>
  (items.value ?? []).map((r) => {
    const snap = parseCloudSnapshot(r.detail);
    const est = snap?.estimate;
    const cost = est?.costYuan;
    return {
      key: r.id,
      id: r.id,
      createdAt: r.createdAt,
      taskId: snap?.task?.id ?? r.entityId ?? null,
      taskType: snap?.task?.type ?? '',
      modelName: snap?.model?.name ?? '',
      providerName: snap?.model?.provider ?? '',
      period: snap?.pricing?.period ?? '',
      localFinishMin: est?.localFinishMin ?? null,
      cloudFinishMin: est?.cloudFinishMin ?? null,
      saveMin: est?.saveMin ?? null,
      costYuan: typeof cost === 'number' ? cost : null,
      ratio: est?.ratio ?? null,
      threshold: est?.threshold ?? null,
      reason: snap?.reason ?? '',
      reasonText: cloudReasonTextOf(snap),
      upshift: isUpshiftSnapshot(snap),
      snapshot: snap,
      opaque: snap === null,
    };
  }),
);

const upshiftCount = computed(() => view.value.filter((r) => r.upshift).length);
const holdCount = computed(() => view.value.length - upshiftCount.value);
const hasOpaque = computed(() => view.value.some((r) => r.opaque));

function fmtMin(v: null | number): string {
  if (v === null || v === undefined) return '-';
  return `${Number(v).toFixed(0)} min`;
}

function fmtMoney(v: null | number): string {
  if (v === null || v === undefined) return '-';
  return `¥${Number(v).toFixed(2)}`;
}

function fmtRatio(v: null | number): string {
  if (v === null || v === undefined) return '-';
  return Number(v).toFixed(1);
}

/** 结论 tooltip：把闸门快照摊开（"为什么没上云"要能追问到底） */
function gateTip(row: Record<string, any>): string {
  // slot record 是 Record<string, any>：这里按 ViewRow 读取即可（只读展示）
  const r = row as ViewRow;
  const g = r.snapshot?.gates;
  if (!g) return r.reasonText;
  return [
    `结论：${r.upshift ? '已上云' : '未上云'} · ${r.reasonText}`,
    `总开关：${g.costAwareEnabled ? '已开启' : '未开启'}`,
    `优惠时段：${g.offPeak ? '是（谷时）' : '否（峰时）'}`,
    `性价比达标：${g.ratioOk ? '是' : '否'}`,
    `单任务上限：¥${(g.perTaskCap ?? 0).toFixed(2)}`,
    `单日上限：¥${(g.dailyCap ?? 0).toFixed(2)}（今日已花 ¥${(g.dailySpent ?? 0).toFixed(2)}）`,
  ].join('\n');
}

/** 当前闸门状态（解释"此刻为什么不上云"，与逐条历史互补） */
const gateStateText = computed(() => {
  const g = gates.value;
  if (!g) return '';
  return [
    `开关：${g.costAwareEnabled ? '已开启' : '未开启'}`,
    `只优惠时段：${g.preferOffpeak ? '是' : '否'}`,
    `阈值：${g.valueRatio ?? '-'} 分钟/元`,
    `单任务上限：¥${g.maxCostPerTask ?? '-'}`,
    `单日上限：¥${g.maxCostPerDay ?? '-'}`,
  ].join(' · ');
});

const columns = [
  { title: '时间', key: 'time', width: 160 },
  { title: '决策', key: 'verdict', width: 110 },
  { title: '任务', key: 'task', width: 160 },
  { title: '模型', key: 'model', width: 190 },
  { title: '本地预计', key: 'local', width: 110 },
  { title: '云端预计', key: 'cloud', width: 110 },
  { title: '省时', key: 'save', width: 100 },
  { title: '花费', key: 'cost', width: 100 },
  { title: '性价比', key: 'ratio', width: 110 },
  { title: '原因', key: 'reason', width: 260 },
];
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- 顶部摘要：今日花费 + 当前闸门状态（§6.5 每日成本摘要） -->
    <div class="flex flex-wrap items-center gap-x-8 gap-y-2">
      <Statistic
        v-if="todaySpent !== null"
        prefix="¥"
        :precision="2"
        title="今日花费"
        :value="todaySpent"
      />
      <div v-if="gateStateText" class="text-xs text-muted-foreground">
        当前闸门：{{ gateStateText }}
      </div>
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <Tag class="!mr-0" color="success">已上云 {{ upshiftCount }}</Tag>
        <Tag class="!mr-0">未上云 {{ holdCount }}</Tag>
      </div>
      <Button :loading="loading" size="small" @click="load">刷新</Button>
    </div>

    <Alert v-if="note" show-icon type="info">
      <template #message>{{ note }}</template>
      <template #description>
        <div class="text-xs">
          未上云的决策同样会被记录（含未通过的原因），但受服务端节流限制，
          同一任务同一原因 30 分钟内至多一条 ——
          因此本表条数天然稀疏，少是正常的。
        </div>
      </template>
    </Alert>

    <Table
      v-if="view.length > 0"
      :columns="columns"
      :data-source="view"
      :loading="loading"
      :pagination="{ pageSize: 20, showSizeChanger: false, size: 'small' }"
      :scroll="{ x: 'max-content' }"
      row-key="key"
      size="small"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'time'">
          <TimeTag :time="record.createdAt" />
        </template>

        <!-- 决策：已上云 / 未上云 -->
        <template v-else-if="column.key === 'verdict'">
          <Tooltip :title="gateTip(record)">
            <Tag
              :color="record.upshift ? 'success' : 'default'"
              class="!mr-0 cursor-help"
            >
              {{ record.upshift ? '✅ 已上云' : '❌ 未上云' }}
            </Tag>
          </Tooltip>
        </template>

        <template v-else-if="column.key === 'task'">
          <div class="flex flex-col text-xs">
            <span v-if="record.taskId">#{{ record.taskId }}</span>
            <span v-else class="text-muted-foreground">-</span>
            <span class="text-muted-foreground">
              {{ record.taskType || '未知类型' }}
            </span>
          </div>
        </template>

        <template v-else-if="column.key === 'model'">
          <div class="flex flex-col text-xs">
            <span>{{ record.modelName || '-' }}</span>
            <span class="text-muted-foreground">
              {{ record.providerName || '-' }}
              <template v-if="record.period === 'off_peak'"> 🌙</template>
              <template v-else-if="record.period === 'peak'"> ☀️</template>
            </span>
          </div>
        </template>

        <!-- 本地预计完成（仅未上云行有） -->
        <template v-else-if="column.key === 'local'">
          <span class="text-xs tabular-nums">
            {{ fmtMin(record.localFinishMin) }}
          </span>
        </template>

        <!-- 云端预计完成（仅未上云行有） -->
        <template v-else-if="column.key === 'cloud'">
          <span class="text-xs tabular-nums">
            {{ fmtMin(record.cloudFinishMin) }}
          </span>
        </template>

        <template v-else-if="column.key === 'save'">
          <span class="text-xs tabular-nums">{{ fmtMin(record.saveMin) }}</span>
        </template>

        <template v-else-if="column.key === 'cost'">
          <span class="text-xs tabular-nums">
            {{ fmtMoney(record.costYuan) }}
          </span>
        </template>

        <template v-else-if="column.key === 'ratio'">
          <Tooltip
            :title="`阈值：${record.threshold ?? '-'} 分钟/元（省时 ÷ 花费 ≥ 阈值 才判定划算）`"
          >
            <span class="text-xs tabular-nums">
              {{ fmtRatio(record.ratio) }}
            </span>
          </Tooltip>
        </template>

        <!-- 原因：优先后端 reasonText -->
        <template v-else-if="column.key === 'reason'">
          <div class="text-xs">{{ record.reasonText }}</div>
          <div v-if="record.opaque" class="text-xs text-muted-foreground">
            （决策载荷缺失或无法解析，已按可读字段降级展示）
          </div>
        </template>
      </template>
    </Table>

    <Empty v-else-if="!loading" description="">
      <template #description>
        <div class="flex flex-col gap-1">
          <span>暂无成本感知上云决策记录</span>
          <span class="text-xs text-muted-foreground">
            开关关闭时不会产生这类决策；未上云的决策按「任务 × 原因」每 30
            分钟至多一条节流记录，因此条数天然稀疏。
          </span>
        </div>
      </template>
    </Empty>

    <Descriptions v-if="hasOpaque" :column="1" size="small">
      <DescriptionsItem label="说明">
        <span class="text-xs text-muted-foreground">
          部分记录缺少决策载荷（旧格式或写入异常），已按可读字段降级展示；
          本表对解析失败完全容错，不影响其余行。
        </span>
      </DescriptionsItem>
    </Descriptions>
  </div>
</template>
