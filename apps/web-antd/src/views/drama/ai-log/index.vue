<script lang="ts" setup>
/**
 * 全局 AI 日志（用户 2026-10-06：「ai任务页面 加一个全局ai日志」）。
 *
 * ## 为什么需要（真实困境）
 *
 * 用户报「AI 任务不执行」时，**界面上完全看不出原因**：
 *   · 任务停在 queued，但"这次调用到底发了什么/报了什么错"看不到；
 *   · "编排器为什么不领这个任务"只写在容器日志文件里（用户看不到）。
 *
 * 本页把两类日志都从**数据库**读出来，分两个页签：
 *   · **调用日志** —— 逐次 LLM 调用（llm_call_log）：线路/模型/用途/tokens/耗时/错误。
 *     回答「这次调用发生了什么、花了多少」。
 *   · **系统事件** —— 调度决策与告警（audit_log）：节点/模型状态迁移、上云决策、
 *     全局暂停等。回答「为什么任务没被执行」。
 *
 * ## 为什么不合并成一个列表
 *
 * 两者**粒度与问题都不同**（一次 LLM 调用 vs 一次调度动作），
 * 合并后"按任务查某次调用的 token"就无法表达了。
 *
 * ## 实时性
 *
 * 不走 WS（日志是只读回溯，不需要秒级推送），用「自动刷新」按需轮询，
 * 避免把日志量灌进实时通道。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import { Page } from '@vben/common-ui';

import {
  Button,
  Card,
  Col,
  Empty,
  Input,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
} from 'ant-design-vue';

import type { AiCallLogItem, AiSystemEventItem } from '#/api/core/dramafloow';

import {
  aiLogCallFilters,
  aiLogCallStats,
  aiLogCalls,
  aiLogEventFilters,
  aiLogEvents,
} from '#/api/core/dramafloow';
import { TimeTag } from '#/components/TimeTag';
import { enumText } from '#/composables/useEnumText';

const route = useRoute();

/** 页签：calls = 逐次 LLM 调用；events = 系统运行事件 */
const tab = ref<'calls' | 'events'>('calls');

// ─────────────────────────── 调用日志 ───────────────────────────

const calls = ref<AiCallLogItem[]>([]);
const callTotal = ref(0);
const callLoading = ref(false);
const callPage = ref(1);
const callPageSize = ref(50);
const callKeyword = ref('');
const callPurpose = ref<string | undefined>();
const callOnlyError = ref(false);
const callStats = ref<null | {
  avgLatencyMs: number;
  completionTokens: number;
  errors: number;
  estimated: number;
  promptTokens: number;
  total: number;
}>(null);
const callFilterOptions = ref<{
  models: string[];
  providers: string[];
  purposes: string[];
}>({ models: [], providers: [], purposes: [] });

/** 从 URL 带过来的 taskId（任务详情「查看日志」跳转用） */
const taskIdFilter = ref<null | number>(
  route.query.taskId ? Number(route.query.taskId) : null,
);

async function loadCalls() {
  callLoading.value = true;
  try {
    const params = {
      keyword: callKeyword.value.trim() || undefined,
      onlyError: callOnlyError.value,
      page: callPage.value,
      pageSize: callPageSize.value,
      purpose: callPurpose.value,
      taskId: taskIdFilter.value ?? undefined,
    };
    const [list, stats] = await Promise.all([
      aiLogCalls(params),
      aiLogCallStats({
        keyword: params.keyword,
        onlyError: params.onlyError,
        purpose: params.purpose,
        taskId: params.taskId,
      }),
    ]);
    calls.value = list.items;
    callTotal.value = list.total;
    callStats.value = stats;
  } catch {
    // 拦截器已提示
  } finally {
    callLoading.value = false;
  }
}

async function loadCallFilters() {
  try {
    callFilterOptions.value = await aiLogCallFilters();
  } catch {
    // 筛选器拿不到不该让整页失败：只是少了可选值
  }
}

// ─────────────────────────── 系统事件 ───────────────────────────

const events = ref<AiSystemEventItem[]>([]);
const eventTotal = ref(0);
const eventLoading = ref(false);
const eventPage = ref(1);
const eventPageSize = ref(50);
const eventAction = ref<string | undefined>();
const eventKeyword = ref('');
/** 折叠连续重复事件（默认开）：实测同一模型离线一天几百条，不折叠会淹没有效信息 */
const eventCollapse = ref(true);
const eventActionOptions = ref<string[]>([]);

async function loadEvents() {
  eventLoading.value = true;
  try {
    const res = await aiLogEvents({
      action: eventAction.value,
      collapse: eventCollapse.value,
      keyword: eventKeyword.value.trim() || undefined,
      page: eventPage.value,
      pageSize: eventPageSize.value,
      taskId: taskIdFilter.value ?? undefined,
    });
    events.value = res.items;
    eventTotal.value = res.total;
  } catch {
    // 拦截器已提示
  } finally {
    eventLoading.value = false;
  }
}

async function loadEventFilters() {
  try {
    const r = await aiLogEventFilters();
    eventActionOptions.value = r.actions;
  } catch {
    // 同上：筛选器拿不到不影响主列表
  }
}

// ─────────────────────────── 交互 ───────────────────────────

/** 筛选变化必须回到第 1 页（服务端分页：停在不存在的页码会显示空列表） */
function reloadCalls() {
  callPage.value = 1;
  void loadCalls();
}
function reloadEvents() {
  eventPage.value = 1;
  void loadEvents();
}

/** 切换页签时首次拉取该页签数据（避免进页面就把两份都拉了） */
watch(tab, (t) => {
  if (t === 'calls' && calls.value.length === 0 && !callLoading.value) {
    void loadCalls();
    void loadCallFilters();
  }
  if (t === 'events' && events.value.length === 0 && !eventLoading.value) {
    void loadEvents();
    void loadEventFilters();
  }
});

/** 自动刷新（只读回溯，默认关；开着时 15 秒拉一次当前页签） */
const autoRefresh = ref(false);
let timer: null | ReturnType<typeof setInterval> = null;

onMounted(() => {
  void loadCalls();
  void loadCallFilters();
  timer = setInterval(() => {
    if (!autoRefresh.value) return;
    if (tab.value === 'calls') void loadCalls();
    else void loadEvents();
  }, 15_000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});

/** 从任务列表跳过来时，把任务号显示出来并允许一键清除 */
const hasTaskFilter = computed(() => taskIdFilter.value !== null);
function clearTaskFilter() {
  taskIdFilter.value = null;
  reloadCalls();
  reloadEvents();
}

// ─────────────────────────── 展示辅助 ───────────────────────────

const callColumns = [
  { title: '时间', key: 'createdAt', width: 170 },
  { title: '用途', key: 'purpose', width: 130 },
  { title: '线路 / 模型', key: 'provider', width: 250 },
  { title: '归属', key: 'owner', width: 170 },
  { title: '路由', key: 'route', width: 90 },
  { title: 'tokens', key: 'tokens', width: 150 },
  { title: '耗时', key: 'latency', width: 90 },
  { title: '结果', key: 'result' },
];

const eventColumns = [
  { title: '时间', key: 'createdAt', width: 170 },
  { title: '动作', key: 'action', width: 150 },
  { title: '对象', key: 'entity', width: 130 },
  { title: '变化', key: 'change' },
  { title: '重复', key: 'repeat', width: 90 },
];

/** 用途 → 中文（走全站唯一事实源，缺配置时落 unknown 兜底而不是裸英文） */
function purposeText(p?: null | string): string {
  return enumText.llmPurpose(p);
}

/** 路由徽标：本地 / 云端 */
function routeText(r?: null | string): string {
  return r === 'cloud' ? '云端' : '本地';
}

/** 系统事件动作 → 中文说明（未知动作原样回显，便于排查新事件类型） */
const ACTION_TEXT: Record<string, string> = {
  sched_decision: '调度决策',
  sched_alert: '调度告警',
  'task.pause_all': '全局暂停',
  'task.resume_all': '恢复运行',
  'task.run_now': '立即执行',
  'task.batch_cancel': '批量取消',
  'task.batch_delete': '批量删除',
  'task.batch_retry': '批量重试',
};
function actionText(a?: null | string): string {
  if (!a) return '-';
  return ACTION_TEXT[a] ?? a;
}

function actionColor(a?: null | string): string {
  if (a === 'sched_alert') return 'warning';
  if (a === 'sched_decision') return 'processing';
  return 'default';
}

/**
 * 从 before/after 里尽量抽出"人看得懂的一句话"。
 *
 * 这两列是自由 JSON（各调用点自己拼），故**不做严格解析**：
 * 优先取常见字段（decision/reason/after 里的状态），取不到就原样显示。
 * 强行解析会在字段变化时抛错或显示空白 —— 那是比"显示原始 JSON"更糟的体验。
 */
/**
 * 事件的「变化」文案。
 *
 * `before`/`after` 是各调用点自己拼的自由 JSON，**不做严格解析**（字段会变），
 * 但优先抽出现成的**中文说明**（`reasonText`）—— 后端已经翻好了。
 * 直接显示原样 JSON 会让"为什么没执行"这类关键信息淹没在括号引号里
 * （实测用户看到的是 `{"decision":"CloudHold","reason":"peak_hours",...}`，
 *  而他真正需要的是那句「峰时不上云（只在优惠时段利用）」）。
 *
 * 抽不到（或不是 JSON）就原样显示 —— **绝不吞掉信息**。
 */
function changeText(rec: Record<string, any> | AiSystemEventItem): string {
  const tryText = (raw?: null | string): null | string => {
    if (!raw) return null;
    try {
      const o = JSON.parse(raw);
      if (o?.reasonText) {
        const extra = o?.decision ? `[${o.decision}] ` : '';
        const q =
          Array.isArray(o?.queued) && o.queued.length > 0
            ? `；队列积压：${o.queued.map((x: any) => `${x.Class}=${x.Queued}`).join('、')}`
            : '';
        return `${extra}${o.reasonText}${q}`;
      }
      return null;
    } catch {
      return null;
    }
  };

  const readable = tryText(rec.after) ?? tryText(rec.before);
  if (readable) return readable;

  const parts: string[] = [];
  if (rec.before && rec.before !== rec.after) parts.push(rec.before);
  if (rec.after) parts.push(rec.after);
  return parts.join('  →  ') || '-';
}
</script>

<template>
  <Page
    class="df-page"
    description="AI 全局日志：逐次 LLM 调用（花了多少 token、报了什么错）+ 系统调度事件（为什么任务没被执行）"
    title="AI 日志"
  >
    <template #extra>
      <Space>
        <span class="text-xs text-muted-foreground">自动刷新</span>
        <Switch v-model:checked="autoRefresh" size="small" />
        <Button
          size="small"
          :loading="tab === 'calls' ? callLoading : eventLoading"
          @click="tab === 'calls' ? loadCalls() : loadEvents()"
        >
          刷新
        </Button>
      </Space>
    </template>

    <!-- 从任务列表跳来时的任务过滤条（让"查这个任务的日志"这件事显式可见） -->
    <div
      v-if="hasTaskFilter"
      class="mb-3 flex flex-wrap items-center gap-2 rounded border px-3 py-2 text-xs"
    >
      <Tag class="!mr-0" color="blue">仅看任务 #{{ taskIdFilter }}</Tag>
      <span class="text-muted-foreground">
        已按任务号过滤（两个页签同时生效）
      </span>
      <Button size="small" type="link" @click="clearTaskFilter">
        查看全部
      </Button>
    </div>

    <Segmented
      v-model:value="tab"
      class="mb-3"
      :options="[
        { label: '调用日志', value: 'calls' },
        { label: '系统事件', value: 'events' },
      ]"
    />

    <!-- ══════════════ 页签 1：调用日志 ══════════════ -->
    <template v-if="tab === 'calls'">
      <Row :gutter="16" class="mb-4">
        <Col :span="5">
          <Card size="small">
            <Statistic title="调用次数" :value="callStats?.total ?? 0" />
          </Card>
        </Col>
        <Col :span="5">
          <Card size="small">
            <Statistic
              :value="callStats?.errors ?? 0"
              :value-style="
                (callStats?.errors ?? 0) > 0
                  ? { color: 'var(--ant-color-error)' }
                  : {}
              "
              title="失败"
            />
          </Card>
        </Col>
        <Col :span="7">
          <Card size="small">
            <Statistic
              :value="
                (callStats?.promptTokens ?? 0) +
                (callStats?.completionTokens ?? 0)
              "
              title="tokens 合计"
            />
            <div class="mt-1 text-xs text-muted-foreground">
              输入 {{ callStats?.promptTokens ?? 0 }} · 输出
              {{ callStats?.completionTokens ?? 0 }}
              <!-- tokens 可信度必须如实标注：估算值不能当精确用量展示 -->
              <template v-if="(callStats?.estimated ?? 0) > 0">
                · 含估算 {{ callStats?.estimated }} 次
              </template>
            </div>
          </Card>
        </Col>
        <Col :span="7">
          <Card size="small">
            <Statistic
              :value="callStats?.avgLatencyMs ?? 0"
              suffix="ms"
              title="平均耗时"
            />
          </Card>
        </Col>
      </Row>

      <Card size="small">
        <div class="mb-3 flex flex-wrap items-center gap-3">
          <Input.Search
            v-model:value="callKeyword"
            allow-clear
            placeholder="搜线路 / 模型 / 用途 / 错误信息"
            style="width: 280px"
            @press-enter="reloadCalls"
            @search="reloadCalls"
          />
          <Select
            v-model:value="callPurpose"
            :options="[
              { label: '全部用途', value: undefined },
              ...callFilterOptions.purposes.map((p) => ({
                label: purposeText(p),
                value: p,
              })),
            ]"
            style="width: 180px"
            @change="reloadCalls"
          />
          <span class="flex items-center gap-1 text-xs">
            <Switch
              v-model:checked="callOnlyError"
              size="small"
              @change="reloadCalls"
            />
            只看失败
          </span>
          <span class="flex-1"></span>
          <span class="text-xs text-muted-foreground"
            >共 {{ callTotal }} 条</span
          >
        </div>

        <Table
          v-if="calls.length > 0"
          :columns="callColumns"
          :data-source="calls"
          :loading="callLoading"
          :pagination="{
            current: callPage,
            pageSize: callPageSize,
            total: callTotal,
            showSizeChanger: false,
            size: 'small',
            showTotal: (t: number) => `共 ${t} 条`,
          }"
          :scroll="{ x: 'max-content' }"
          row-key="id"
          size="small"
          @change="
            (p: any) => {
              callPage = p.current ?? 1;
              void loadCalls();
            }
          "
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'createdAt'">
              <TimeTag :time="record.createdAt" />
            </template>

            <template v-else-if="column.key === 'purpose'">
              <Tag class="!mr-0">{{ purposeText(record.purpose) }}</Tag>
            </template>

            <template v-else-if="column.key === 'provider'">
              <div class="flex min-w-0 flex-col">
                <span class="truncate text-xs">{{
                  record.providerName || record.provider || '-'
                }}</span>
                <span class="truncate text-xs text-muted-foreground">
                  {{ record.model || '-' }}
                </span>
              </div>
            </template>

            <template v-else-if="column.key === 'owner'">
              <span v-if="record.taskId" class="text-xs">
                任务 #{{ record.taskId }}
              </span>
              <span v-else class="text-xs text-muted-foreground"
                >非任务触发</span
              >
              <div
                v-if="record.dramaName"
                class="truncate text-xs text-muted-foreground"
              >
                {{ record.dramaName }}
              </div>
            </template>

            <template v-else-if="column.key === 'route'">
              <Tag
                class="!mr-0"
                :color="record.route === 'cloud' ? 'purple' : 'default'"
              >
                {{ routeText(record.route) }}
              </Tag>
            </template>

            <template v-else-if="column.key === 'tokens'">
              <span class="text-xs">
                {{ record.promptTokens }} / {{ record.completionTokens }}
              </span>
              <Tooltip
                v-if="record.tokensEstimated"
                title="网关未返回 usage，按字符数估算"
              >
                <Tag class="ml-1 !mr-0" color="warning">估算</Tag>
              </Tooltip>
            </template>

            <template v-else-if="column.key === 'latency'">
              <span class="text-xs">{{ record.latencyMs }} ms</span>
            </template>

            <template v-else-if="column.key === 'result'">
              <Tooltip v-if="record.error" :title="record.error">
                <Tag class="!mr-0" color="error">失败</Tag>
              </Tooltip>
              <Tag v-else class="!mr-0" color="success">成功</Tag>
            </template>
          </template>
        </Table>

        <Empty v-else description="没有符合条件的调用记录" />
      </Card>
    </template>

    <!-- ══════════════ 页签 2：系统事件 ══════════════ -->
    <template v-else>
      <Card size="small">
        <div class="mb-3 flex flex-wrap items-center gap-3">
          <Input.Search
            v-model:value="eventKeyword"
            allow-clear
            placeholder="搜动作 / 事件内容"
            style="width: 280px"
            @press-enter="reloadEvents"
            @search="reloadEvents"
          />
          <Select
            v-model:value="eventAction"
            :options="[
              { label: '全部动作', value: undefined },
              ...eventActionOptions.map((a) => ({
                label: actionText(a),
                value: a,
              })),
            ]"
            style="width: 180px"
            @change="reloadEvents"
          />
          <Tooltip
            title="同一事件连续重复（如模型持续离线）会折叠成一条并记次数，避免淹没有效信息"
          >
            <span class="flex items-center gap-1 text-xs">
              <Switch
                v-model:checked="eventCollapse"
                size="small"
                @change="reloadEvents"
              />
              折叠重复
            </span>
          </Tooltip>
          <span class="flex-1"></span>
          <span class="text-xs text-muted-foreground"
            >共 {{ eventTotal }} 条</span
          >
        </div>

        <Table
          v-if="events.length > 0"
          :columns="eventColumns"
          :data-source="events"
          :loading="eventLoading"
          :pagination="{
            current: eventPage,
            pageSize: eventPageSize,
            total: eventTotal,
            showSizeChanger: false,
            size: 'small',
            showTotal: (t: number) => `共 ${t} 条`,
          }"
          :scroll="{ x: 'max-content' }"
          row-key="id"
          size="small"
          @change="
            (p: any) => {
              eventPage = p.current ?? 1;
              void loadEvents();
            }
          "
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'createdAt'">
              <TimeTag :time="record.createdAt" />
            </template>

            <template v-else-if="column.key === 'action'">
              <Tag class="!mr-0" :color="actionColor(record.action)">
                {{ actionText(record.action) }}
              </Tag>
            </template>

            <template v-else-if="column.key === 'entity'">
              <span class="text-xs"
                >{{ record.entityType }} #{{ record.entityId }}</span
              >
            </template>

            <template v-else-if="column.key === 'change'">
              <Tooltip :title="changeText(record)">
                <span class="block max-w-[720px] truncate text-xs">
                  {{ changeText(record) }}
                </span>
              </Tooltip>
            </template>

            <template v-else-if="column.key === 'repeat'">
              <Tag v-if="record.repeatCount > 1" class="!mr-0" color="warning">
                ×{{ record.repeatCount }}
              </Tag>
              <span v-else class="text-xs text-muted-foreground">-</span>
            </template>
          </template>
        </Table>

        <Empty v-else description="没有符合条件的系统事件" />
      </Card>
    </template>
  </Page>
</template>
