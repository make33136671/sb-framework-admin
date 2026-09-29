<script lang="ts" setup>
/**
 * E 区：AI 消耗（设计文档 §E）
 *
 * 聚合源 sb_dramafloow_llm_call_log（append-only，每次调用含失败都写一行）。
 *
 * ⚠ 数据可信性（设计 §E 的硬性要求）：
 * 面板必须如实标注 token 数据来源 —— 「实测」= LLM 响应体返回的真实 usage；
 * 「估算」= 网关未返回 usage 时按字符数推测。展示时不加区分会把估算当精确用量，
 * 这正是设计文档把 LlmGateway usage 回填列为 P0 前置的原因。
 *
 * 趋势图复用首页既有手法（自绘 div 柱状图），不引入图表库（设计 §8）。
 */
import { computed, onMounted, ref } from 'vue';

import {
  Alert,
  Card,
  Col,
  Empty,
  Row,
  Segmented,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
} from 'ant-design-vue';

import type { TokenUsage } from '#/api/core/dramafloow';

import { dashboardTokenUsage } from '#/api/core/dramafloow';
import { TimeTag } from '#/components/TimeTag';

const data = ref<null | TokenUsage>(null);
const loading = ref(false);
const days = ref(7);

async function load() {
  loading.value = true;
  try {
    data.value = await dashboardTokenUsage({ days: days.value });
  } catch {
    // 拦截器已提示
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load();
});

defineExpose({ load });

function changeDays(v: number) {
  days.value = v;
  void load();
}

/** 千分位 */
const nf = (v?: number): string => (v ?? 0).toLocaleString('zh-CN');

/** 总 tokens（prompt + completion） */
const totalTokens = computed(() => {
  const t = data.value?.totals;
  return (t?.prompt ?? 0) + (t?.completion ?? 0);
});

/** 趋势柱高度：按最大值归一化 */
const trendMax = computed(() => {
  const vals = (data.value?.trend ?? []).map((d) => d.prompt + d.completion);
  return Math.max(1, ...vals);
});

/** 数据来源标注：全实测 / 含估算 / 全估算 / mock 无用量 */
const quality = computed(() => {
  const q = data.value?.quality;
  if (!q) return { text: '-', color: 'default' as const };
  const providers = q.providers ?? [];
  if (q.measuredCalls === 0 && q.estimatedCalls === 0) {
    return { text: '暂无调用', color: 'default' as const };
  }
  if (
    providers.includes('mock') &&
    q.measuredCalls === 0 &&
    q.estimatedCalls === 0
  ) {
    return { text: 'mock（无真实用量）', color: 'warning' as const };
  }
  if (q.estimatedCalls > 0 && q.measuredCalls > 0) {
    return {
      text: `混合：实测 ${q.measuredCalls} 次 / 估算 ${q.estimatedCalls} 次`,
      color: 'warning' as const,
    };
  }
  if (q.estimatedCalls > 0) {
    return {
      text: `估算（网关未返回 usage，${q.estimatedCalls} 次）`,
      color: 'warning' as const,
    };
  }
  return {
    text: `实测（响应体真实 usage，${q.measuredCalls} 次）`,
    color: 'success' as const,
  };
});

const dayOptions = [
  { label: '近 7 天', value: 7 },
  { label: '近 30 天', value: 30 },
];

const modelColumns = [
  { title: '模型', dataIndex: 'model', key: 'model' },
  { title: 'provider', dataIndex: 'provider', key: 'provider', width: 100 },
  { title: '调用', dataIndex: 'calls', key: 'calls', width: 80 },
  { title: '输入 tokens', dataIndex: 'prompt', key: 'prompt', width: 120 },
  {
    title: '输出 tokens',
    dataIndex: 'completion',
    key: 'completion',
    width: 120,
  },
  { title: '失败', dataIndex: 'failedCalls', key: 'failedCalls', width: 70 },
  {
    title: '平均延迟',
    dataIndex: 'avgLatencyMs',
    key: 'avgLatencyMs',
    width: 100,
  },
];

const purposeColumns = [
  { title: '用途', dataIndex: 'purpose', key: 'purpose' },
  { title: '调用', dataIndex: 'calls', key: 'calls', width: 80 },
  { title: '输入 tokens', dataIndex: 'prompt', key: 'prompt', width: 120 },
  {
    title: '输出 tokens',
    dataIndex: 'completion',
    key: 'completion',
    width: 120,
  },
  { title: '失败', dataIndex: 'failedCalls', key: 'failedCalls', width: 70 },
  {
    title: '平均延迟',
    dataIndex: 'avgLatencyMs',
    key: 'avgLatencyMs',
    width: 100,
  },
];

const errorColumns = [
  { title: '用途', dataIndex: 'purpose', key: 'purpose', width: 120 },
  { title: '模型', dataIndex: 'model', key: 'model', width: 140 },
  { title: '错误', dataIndex: 'error', key: 'error', ellipsis: true },
  { title: '时间', key: 'createdAt', width: 180 },
];
</script>

<template>
  <Card size="small" title="AI 消耗">
    <template #extra>
      <Space>
        <Tag :color="quality.color" class="!mr-0">
          数据来源：{{ quality.text }}
        </Tag>
        <Segmented
          :value="days"
          :options="dayOptions"
          @change="(v) => changeDays(v as number)"
        />
      </Space>
    </template>

    <!-- 估算数据必须显式警告（设计 §E：不得把估算当精确用量展示） -->
    <Alert
      v-if="quality.color === 'warning'"
      class="mb-3"
      type="warning"
      show-icon
      message="部分或全部 token 为估算值"
      description="LLM 网关未在响应体中返回 usage 时，系统按字符数估算 tokens。该数字仅供趋势参考，不可用于计费对账。"
    />

    <Row :gutter="16" class="mb-3">
      <Col :span="6">
        <Statistic
          title="今日 tokens"
          :value="(data?.today.prompt ?? 0) + (data?.today.completion ?? 0)"
        />
        <div class="mt-1 text-xs text-muted-foreground">
          输入 {{ nf(data?.today.prompt) }} · 输出
          {{ nf(data?.today.completion) }}
        </div>
      </Col>
      <Col :span="6">
        <Statistic
          title="今日调用"
          :value="data?.today.calls ?? 0"
          suffix="次"
        />
        <div class="mt-1 text-xs text-muted-foreground">
          失败 {{ data?.today.failedCalls ?? 0 }} 次
        </div>
      </Col>
      <Col :span="6">
        <Statistic title="区间 tokens" :value="totalTokens" />
        <div class="mt-1 text-xs text-muted-foreground">
          近 {{ days }} 天累计
        </div>
      </Col>
      <Col :span="6">
        <Statistic
          title="区间调用"
          :value="data?.totals.calls ?? 0"
          suffix="次"
        />
        <div class="mt-1 text-xs text-muted-foreground">
          失败 {{ data?.totals.failedCalls ?? 0 }} 次
        </div>
      </Col>
    </Row>

    <!-- 趋势（自绘柱状图，复用首页手法，不引入图表库） -->
    <div class="mb-4">
      <div class="mb-1 text-xs text-muted-foreground">
        tokens 趋势（近 {{ days }} 天，输入 + 输出）
      </div>
      <div class="flex h-16 items-end gap-1">
        <Tooltip
          v-for="d in data?.trend ?? []"
          :key="d.date"
          :title="`${d.date}：${nf(d.prompt + d.completion)} tokens / ${d.calls} 次调用`"
        >
          <div
            class="w-4 rounded-t bg-primary/70"
            :style="{
              height: `${Math.max(4, ((d.prompt + d.completion) / trendMax) * 64)}px`,
            }"
          />
        </Tooltip>
      </div>
    </div>

    <Row :gutter="16">
      <Col :span="12">
        <div class="mb-1 text-sm">按模型</div>
        <Table
          v-if="(data?.byModel.length ?? 0) > 0"
          :columns="modelColumns"
          :data-source="data?.byModel ?? []"
          :pagination="false"
          row-key="model"
          size="small"
        />
        <Empty v-else description="区间内无调用" />
      </Col>
      <Col :span="12">
        <div class="mb-1 text-sm">按用途</div>
        <Table
          v-if="(data?.byPurpose.length ?? 0) > 0"
          :columns="purposeColumns"
          :data-source="data?.byPurpose ?? []"
          :pagination="false"
          row-key="purpose"
          size="small"
        />
        <Empty v-else description="区间内无调用" />
      </Col>
    </Row>

    <div v-if="(data?.recentErrors.length ?? 0) > 0" class="mt-4">
      <div class="mb-1 text-sm">最近失败调用</div>
      <Table
        :columns="errorColumns"
        :data-source="data?.recentErrors ?? []"
        :pagination="{ pageSize: 5, size: 'small' }"
        row-key="createdAt"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'createdAt'">
            <TimeTag :time="record.createdAt" />
          </template>
        </template>
      </Table>
    </div>
  </Card>
</template>
