<script lang="ts" setup>
/**
 * 调度看板（P3 · T3.8）
 *
 * 回答四个问题（对应两个 Tab）：
 *   Tab 1「运行态」：节点卡片（当前服务 + 切换倒计时）+ 队列分布 + 预测条 + 在飞任务
 *   Tab 2「睡前窗口」：无人值守窗口设定（绝对时间 / 相对时长两路输入）+ 决策审计回溯
 *
 * 关键语义（与后端/设计一致）：
 *   - 窗口到点**只告警不打断**：在跑的任务继续跑完，不做强制停机（设计 §9 风险 8）；
 *   - 预测是**旁路**：只展示 p50/p90，不参与调度硬决策（设计 §5.5 / 风险 1）；
 *   - 样本不足的数值必须显式标注「估算」，不可当精确值展示（风险 1 缓解措施）；
 *   - 紧急通道（source=system）任务不受攒批约束：节点一空就跑，本地忙则排队 + 告警。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Alert,
  Button,
  Card,
  Empty,
  InputNumber,
  Progress,
  Space,
  Spin,
  Statistic,
  Table,
  Tabs,
  TabPane,
  Tag,
  Tooltip,
} from 'ant-design-vue';

import { TimeTag } from '#/components/TimeTag';

import type {
  SchedClassStat,
  SchedDecisionItem,
  SchedNodeCard,
  SchedStatusView,
} from '#/api/core/scheduler';

import {
  schedulerClearWindow,
  schedulerDecisions,
  schedulerSetWindow,
  schedulerStatus,
} from '#/api/core/scheduler';

// ─────────────────────────── 状态 ───────────────────────────

const tab = ref('board');
const loading = ref(false);
const status = ref<SchedStatusView | null>(null);
const acting = ref(false);

/** 自动刷新（看板是运行态页面，默认 10s 轮询；切到窗口 Tab 时也保持，便于看倒计时） */
let timer: null | ReturnType<typeof setInterval> = null;
const autoRefresh = ref(true);

async function load() {
  loading.value = true;
  try {
    status.value = await schedulerStatus();
  } catch {
    // 拦截器已提示
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load();
  void loadDecisions();
  timer = setInterval(() => {
    if (autoRefresh.value) void load();
  }, 10_000);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});

// ─────────────────────────── 展示辅助 ───────────────────────────

const CLASS_TEXT: Record<string, string> = {
  image: '出图',
  video: '出视频',
  text: '文本',
};

const CLASS_COLOR: Record<string, string> = {
  image: 'blue',
  video: 'purple',
  text: 'green',
};

const RUN_STATUS_TEXT: Record<string, string> = {
  idle: '空闲',
  busy: '占用中',
  offline: '离线',
};

const RUN_STATUS_COLOR: Record<string, string> = {
  idle: 'success',
  busy: 'processing',
  offline: 'error',
};

/**
 * 接入类型（provider_key）文案。
 * 二期（T14.12）：服务类型串已删除 —— comfyui_i2v 不再存在（适配器由「能力位」区分），
 * provider_key 也改为动态来自 AdapterTypes；这里保留一张**兜底显示表**，
 * 未命中的 key 直接原样展示（新适配器无需改前端）。
 */
const TYPE_TEXT: Record<string, string> = {
  mock: 'Mock（本地确定性）',
  openai: 'OpenAI 兼容',
  deepseek: 'DeepSeek 官网',
  comfyui: 'ComfyUI',
};

function typeText(t: string): string {
  return TYPE_TEXT[t] ?? t;
}

function classText(c: null | string): string {
  return c ? (CLASS_TEXT[c] ?? c) : '—';
}

/** 切换倒计时 mm:ss */
function fmtRemain(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** 分钟 → 人类可读（<60min 显示分钟，否则 Xh Ym） */
function fmtMin(min: null | number | undefined): string {
  if (min === null || min === undefined) return '—';
  const v = Math.max(0, min);
  if (v < 60) return `${v.toFixed(1)} 分钟`;
  const h = Math.floor(v / 60);
  const m = Math.round(v % 60);
  return `${h} 小时 ${m} 分`;
}

const nodes = computed<SchedNodeCard[]>(() => status.value?.nodes ?? []);
const classes = computed<SchedClassStat[]>(
  () => status.value?.queue.classes ?? [],
);
const window_ = computed(() => status.value?.window ?? null);

/** 预测条：以最长 ETA 为基准做相对宽度（避免除零） */
const etaBase = computed(() => {
  const max = Math.max(...classes.value.map((c) => c.etaMin), 0);
  return max > 0 ? max : 1;
});

// ─────────────────────────── 窗口设定 ───────────────────────────

const winMode = ref<'absolute' | 'relative'>('relative');
const winHours = ref<number>(8);
const winDays = ref<number>(0);
const winAbsDate = ref<string>('');
const winAbsTime = ref<string>('07:00');

/** 「明天几点」：默认值给明天 07:00（贴合夜间出片习惯） */
function defaultAbsolute() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  winAbsDate.value = `${yyyy}-${mm}-${dd}`;
}

async function submitWindow() {
  acting.value = true;
  try {
    if (winMode.value === 'relative') {
      const minutes = Math.round(
        (winDays.value || 0) * 24 * 60 + (winHours.value || 0) * 60,
      );
      if (minutes <= 0) return;
      await schedulerSetWindow({ mode: 'relative', afterMinutes: minutes });
    } else {
      if (!winAbsDate.value || !winAbsTime.value) return;
      await schedulerSetWindow({
        mode: 'absolute',
        deadline: `${winAbsDate.value} ${winAbsTime.value}`,
      });
    }
    await load();
  } catch {
    // 拦截器已提示
  } finally {
    acting.value = false;
  }
}

async function clearWindow() {
  acting.value = true;
  try {
    await schedulerClearWindow();
    await load();
  } catch {
    // 拦截器已提示
  } finally {
    acting.value = false;
  }
}

// ─────────────────────────── 决策审计 ───────────────────────────

const decisions = ref<SchedDecisionItem[]>([]);
const decisionsLoading = ref(false);

const ACTION_TEXT: Record<string, string> = {
  sched_decision: '调度决策',
  sched_alert: '调度告警',
  sched_window_set: '窗口设定',
  sched_window_clear: '窗口清除',
};

const ACTION_COLOR: Record<string, string> = {
  sched_decision: 'blue',
  sched_alert: 'warning',
  sched_window_set: 'green',
  sched_window_clear: 'default',
};

async function loadDecisions() {
  decisionsLoading.value = true;
  try {
    decisions.value = await schedulerDecisions({ limit: 100 });
  } catch {
    decisions.value = [];
  } finally {
    decisionsLoading.value = false;
  }
}

/** 审计 after 字段是 JSON 字符串：抽出关键信息做摘要，解析失败则原文截断 */
function auditSummary(raw: null | string): string {
  if (!raw) return '—';
  try {
    const o = JSON.parse(raw);
    const parts: string[] = [];
    if (o.decision) parts.push(String(o.decision));
    if (o.reason) parts.push(String(o.reason));
    if (o.kind) parts.push(String(o.kind));
    if (o.from) parts.push(`from=${o.from}`);
    if (o.to) parts.push(`to=${o.to}`);
    if (o.deadline !== undefined)
      parts.push(`deadline=${o.deadline ?? '未设定'}`);
    if (o.pending !== undefined) parts.push(`待跑系统任务=${o.pending}`);
    return parts.length > 0 ? parts.join(' · ') : raw;
  } catch {
    return raw.length > 120 ? `${raw.slice(0, 120)}…` : raw;
  }
}

const decisionColumns = [
  { title: '时间', dataIndex: 'createdAt', key: 'createdAt', width: 180 },
  { title: '动作', dataIndex: 'action', key: 'action', width: 120 },
  { title: '对象', dataIndex: 'entityType', key: 'entityType', width: 140 },
  { title: '内容', dataIndex: 'after', key: 'after' },
];

const inFlightColumns = [
  { title: '任务', dataIndex: 'id', key: 'id', width: 90 },
  { title: '类型', dataIndex: 'type', key: 'type', width: 120 },
  { title: '状态', dataIndex: 'status', key: 'status', width: 110 },
  { title: '来源', dataIndex: 'source', key: 'source', width: 100 },
  { title: '服务', dataIndex: 'providerName', key: 'providerName', width: 160 },
  { title: '开始', dataIndex: 'startedAt', key: 'startedAt', width: 180 },
];

const mountedColumns = [
  { title: '服务', dataIndex: 'name', key: 'name' },
  { title: '类型', dataIndex: 'providerType', key: 'providerType', width: 150 },
  { title: '类别', dataIndex: 'capability', key: 'capability', width: 100 },
  { title: '状态', dataIndex: 'runStatus', key: 'runStatus', width: 110 },
  {
    title: '当前任务',
    dataIndex: 'currentTaskId',
    key: 'currentTaskId',
    width: 100,
  },
];

defaultAbsolute();

defineOptions({ name: 'SchedulerBoard' });
</script>

<template>
  <Page title="调度看板" description="节点运行态、队列分布与预测；睡前窗口设定">
    <Tabs v-model:active-key="tab">
      <!-- ─────────────────── Tab 1：运行态 ─────────────────── -->
      <TabPane key="board" tab="运行态">
        <div class="mb-3 flex items-center justify-between">
          <Space>
            <Button :loading="loading" @click="load">刷新</Button>
            <span class="text-xs opacity-60">
              每 10 秒自动刷新{{ autoRefresh ? '' : '（已暂停）' }}
            </span>
          </Space>
          <Space>
            <Tag v-if="status?.queue.system" color="warning">
              紧急通道待跑 {{ status.queue.system }}
            </Tag>
            <Tag>在飞 {{ status?.inFlight.length ?? 0 }}</Tag>
          </Space>
        </div>

        <Spin :spinning="loading">
          <!-- 空态：未配置节点 → 调度不工作（设计 §4.5） -->
          <Empty
            v-if="nodes.length === 0"
            description="尚未配置算力节点：调度不参与，任务走旧的领取路径"
          />

          <div v-else class="grid gap-3 lg:grid-cols-2">
            <Card
              v-for="n in nodes"
              :key="n.id"
              size="small"
              :title="`节点 #${n.id} ${n.name}`"
            >
              <template #extra>
                <Space>
                  <Tag :color="n.isOnline ? 'success' : 'error'">
                    {{ n.isOnline ? '在线' : '离线' }}
                  </Tag>
                  <Tag v-if="!n.isEnabled" color="default">已停用</Tag>
                </Space>
              </template>

              <div class="mb-3 grid grid-cols-2 gap-3">
                <Statistic
                  title="当前服务"
                  :value="n.currentServiceName ?? '未装载'"
                />
                <Statistic
                  title="当前类别"
                  :value="classText(n.currentClass)"
                />
                <Statistic title="槽位" :value="n.slotCount" />
                <Statistic
                  title="切换成本"
                  :value="`${n.switchCostMin} 分钟`"
                />
              </div>

              <!-- 切换中：倒计时（期间不派新活） -->
              <Alert
                v-if="n.switching"
                class="mb-3"
                type="warning"
                show-icon
                :message="`切换服务中，剩余 ${fmtRemain(n.switchingRemainSec)}`"
                description="切换期间该节点不派新活；到期后按队列重新装载"
              />

              <div class="mb-2 text-xs opacity-60">
                最近心跳：<TimeTag
                  v-if="n.heartbeatAt"
                  :value="n.heartbeatAt"
                />
                <span v-else>—</span>
              </div>

              <Table
                :columns="mountedColumns"
                :data-source="n.mounted"
                :pagination="false"
                row-key="id"
                size="small"
              >
                <template #bodyCell="{ column, record }">
                  <template v-if="column.key === 'providerType'">
                    {{ typeText(String(record.providerType)) }}
                  </template>
                  <template v-else-if="column.key === 'capability'">
                    <Tag
                      :color="
                        CLASS_COLOR[String(record.capability)] ?? 'default'
                      "
                    >
                      {{ classText(String(record.capability)) }}
                    </Tag>
                  </template>
                  <template v-else-if="column.key === 'runStatus'">
                    <Space>
                      <Tag
                        :color="
                          RUN_STATUS_COLOR[String(record.runStatus)] ??
                          'default'
                        "
                      >
                        {{
                          RUN_STATUS_TEXT[String(record.runStatus)] ??
                          record.runStatus
                        }}
                      </Tag>
                      <Tag
                        v-if="(record as Record<string, any>).paused"
                        color="warning"
                      >
                        已熔断暂停
                      </Tag>
                    </Space>
                  </template>
                  <template v-else-if="column.key === 'currentTaskId'">
                    {{ record.currentTaskId ?? '—' }}
                  </template>
                </template>
              </Table>
            </Card>
          </div>

          <!-- 队列分布 + 预测条 -->
          <Card class="mt-3" size="small" title="队列分布与预测">
            <template #extra>
              <Tooltip
                title="预测为旁路展示，不参与调度硬决策；样本不足时标「估算」"
              >
                <Tag color="default">p50 / p90 双值</Tag>
              </Tooltip>
            </template>

            <div class="mb-3 flex flex-wrap gap-4">
              <Statistic title="队列合计" :value="status?.queue.total ?? 0" />
              <Statistic title="用户任务" :value="status?.queue.user ?? 0" />
              <Statistic
                title="系统任务（紧急通道）"
                :value="status?.queue.system ?? 0"
              />
            </div>

            <div v-for="c in classes" :key="c.class" class="mb-3 last:mb-0">
              <div class="mb-1 flex items-center justify-between text-xs">
                <Space>
                  <Tag :color="CLASS_COLOR[c.class] ?? 'default'">
                    {{ c.label }}
                  </Tag>
                  <span>排队 {{ c.queued }}</span>
                  <span class="opacity-60">
                    最早等待 {{ fmtMin(c.oldestWaitMin) }}
                  </span>
                  <Tag v-if="!c.eligible" color="default">
                    非 GPU 时间窗（不跑视频）
                  </Tag>
                </Space>
                <Space>
                  <span> 工作量 {{ fmtMin(c.workloadMin) }} </span>
                  <span class="opacity-60">
                    单件 p50 {{ fmtMin(c.p50Min) }} / p90 {{ fmtMin(c.p90Min) }}
                  </span>
                  <Tag v-if="c.estimated" color="warning">估算</Tag>
                </Space>
              </div>
              <Tooltip :title="`预计完成 ${fmtMin(c.etaMin)}`">
                <Progress
                  :percent="
                    Math.min(100, Math.round((c.etaMin / etaBase) * 100))
                  "
                  :show-info="false"
                  :stroke-color="
                    c.class === 'video'
                      ? 'hsl(var(--primary))'
                      : c.class === 'image'
                        ? 'hsl(var(--chart-2, var(--primary)))'
                        : 'hsl(var(--chart-3, var(--primary)))'
                  "
                />
              </Tooltip>
              <div class="mt-1 text-xs opacity-60">
                预计跑完：{{ fmtMin(c.etaMin) }}
              </div>
            </div>
          </Card>

          <!-- 在飞任务 -->
          <Card class="mt-3" size="small" title="在飞任务">
            <Table
              :columns="inFlightColumns"
              :data-source="status?.inFlight ?? []"
              :pagination="false"
              row-key="id"
              size="small"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'source'">
                  <Tag
                    :color="record.source === 'system' ? 'warning' : 'default'"
                  >
                    {{ record.source === 'system' ? '系统（紧急）' : '用户' }}
                  </Tag>
                </template>
                <template v-else-if="column.key === 'providerName'">
                  {{ record.providerName ?? '—' }}
                </template>
                <template v-else-if="column.key === 'startedAt'">
                  <TimeTag v-if="record.startedAt" :value="record.startedAt" />
                  <span v-else>—</span>
                </template>
              </template>
            </Table>
          </Card>

          <!-- 独立服务（不挂节点 = 不占卡、可并行） -->
          <Card
            v-if="(status?.standalone.length ?? 0) > 0"
            class="mt-3"
            size="small"
            title="独立服务（未挂节点，不占卡可并行）"
          >
            <Space wrap>
              <Tag v-for="s in status?.standalone" :key="s.id">
                {{ s.name }} · {{ typeText(s.providerType) }} ·
                {{ classText(s.capability) }}
              </Tag>
            </Space>
          </Card>
        </Spin>
      </TabPane>

      <!-- ─────────────────── Tab 2：睡前窗口 ─────────────────── -->
      <TabPane key="window" tab="睡前窗口">
        <Card size="small" title="无人值守窗口">
          <Alert
            class="mb-3"
            type="info"
            show-icon
            message="窗口只是「跑到几点」的约定"
            description="到点后仅站内提示，不会中断正在跑的任务（设计 §9 风险 8：默认不打扰）。"
          />

          <div v-if="window_?.isSet" class="mb-4">
            <Space>
              <Tag :color="window_?.expired ? 'error' : 'success'">
                {{ window_?.expired ? '已到点' : '进行中' }}
              </Tag>
              <span>
                截止：
                <TimeTag v-if="window_?.deadline" :value="window_!.deadline!" />
                <span v-else>—</span>
              </span>
              <span v-if="!window_?.expired" class="opacity-60">
                剩余 {{ fmtMin(window_?.remainMin) }}
              </span>
              <Button
                danger
                :loading="acting"
                size="small"
                @click="clearWindow"
              >
                清除窗口
              </Button>
            </Space>
          </div>
          <div v-else class="mb-4 opacity-60">当前未设定窗口</div>

          <Tabs v-model:active-key="winMode" size="small">
            <TabPane key="relative" tab="几小时后">
              <Space align="center" wrap>
                <span>跑</span>
                <InputNumber
                  v-model:value="winDays"
                  :min="0"
                  :max="30"
                  addon-after="天"
                />
                <InputNumber
                  v-model:value="winHours"
                  :min="0"
                  :max="23"
                  addon-after="小时"
                />
                <Button type="primary" :loading="acting" @click="submitWindow">
                  设为截止时间
                </Button>
              </Space>
            </TabPane>

            <TabPane key="absolute" tab="明天几点">
              <Space align="center" wrap>
                <span>跑到</span>
                <input
                  v-model="winAbsDate"
                  class="rounded border px-2 py-1 text-sm"
                  style="
                    color: hsl(var(--foreground));
                    background: hsl(var(--background));
                    border-color: hsl(var(--border));
                  "
                  type="date"
                />
                <input
                  v-model="winAbsTime"
                  class="rounded border px-2 py-1 text-sm"
                  style="
                    color: hsl(var(--foreground));
                    background: hsl(var(--background));
                    border-color: hsl(var(--border));
                  "
                  type="time"
                />
                <Button type="primary" :loading="acting" @click="submitWindow">
                  设为截止时间
                </Button>
                <span class="text-xs opacity-60">按本机时区</span>
              </Space>
            </TabPane>
          </Tabs>
        </Card>

        <Card class="mt-3" size="small" title="决策与告警回溯">
          <template #extra>
            <Button
              size="small"
              :loading="decisionsLoading"
              @click="loadDecisions"
            >
              刷新
            </Button>
          </template>
          <Table
            :columns="decisionColumns"
            :data-source="decisions"
            :loading="decisionsLoading"
            :pagination="{ pageSize: 20, size: 'small' }"
            row-key="id"
            size="small"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'createdAt'">
                <TimeTag :value="record.createdAt" />
              </template>
              <template v-else-if="column.key === 'action'">
                <Tag :color="ACTION_COLOR[String(record.action)] ?? 'default'">
                  {{ ACTION_TEXT[String(record.action)] ?? record.action }}
                </Tag>
              </template>
              <template v-else-if="column.key === 'entityType'">
                {{ record.entityType ?? '—' }}
                <span v-if="record.entityId" class="opacity-60">
                  #{{ record.entityId }}
                </span>
              </template>
              <template v-else-if="column.key === 'after'">
                <Tooltip :title="String(record.after ?? '')">
                  <span>{{ auditSummary(record.after) }}</span>
                </Tooltip>
              </template>
            </template>
          </Table>
        </Card>
      </TabPane>
    </Tabs>
  </Page>
</template>
