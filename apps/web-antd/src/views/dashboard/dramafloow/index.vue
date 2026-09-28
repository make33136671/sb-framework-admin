<script lang="ts" setup>
/**
 * DramaFlow 生产仪表盘（契约 §9 五指标 + NightReport）
 *
 * 五指标：throughput / rejectRate / reviewBacklog / gpu / eta
 * 实时：队列与健康走 WS（useTaskStream），指标每 30s 轮询刷新。
 */
import { onMounted, onUnmounted, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Alert,
  Badge,
  Card,
  Col,
  Empty,
  Row,
  Statistic,
  Table,
  Tag,
  Tooltip,
} from 'ant-design-vue';

import type { DashboardMetrics, NightReport } from '#/api/core/dramafloow';

import { dashboardMetrics, dashboardNightReport } from '#/api/core/dramafloow';
import { useTaskStream } from '#/composables/useTaskStream';
import { TimeTag } from '#/components/TimeTag';

const stream = useTaskStream();

const metrics = ref<null | DashboardMetrics>(null);
const report = ref<null | NightReport>(null);
const loading = ref(false);
let timer: null | ReturnType<typeof setInterval> = null;

async function load() {
  loading.value = true;
  try {
    const [m, r] = await Promise.all([
      dashboardMetrics(),
      dashboardNightReport(),
    ]);
    metrics.value = m;
    report.value = r;
  } catch {
    // 拦截器已提示
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load();
  timer = setInterval(() => void load(), 30_000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});

/** 百分比展示（后端返回 0–1 小数） */
function pct(v?: number): string {
  return `${((v ?? 0) * 100).toFixed(1)}%`;
}

const reportColumns = [
  { title: '原因', dataIndex: 'name', key: 'name' },
  { title: '编码', dataIndex: 'code', key: 'code', width: 140 },
  { title: '次数', dataIndex: 'count', key: 'count', width: 90 },
];
</script>

<template>
  <Page
    title="DramaFlow 生产台"
    description="短剧全链路：洗稿 → 分镜 → 素材 → 片段 → 成片"
  >
    <!-- 实时队列/健康（WS） -->
    <Card class="mb-4" size="small">
      <div class="flex flex-wrap items-center gap-6 text-sm">
        <span class="flex items-center gap-2">
          <Badge :status="stream.connected.value ? 'success' : 'error'" />
          实时通道 {{ stream.connected.value ? '已连接' : '未连接' }}
        </span>
        <template v-if="stream.queue.value">
          <span>队列深度 {{ stream.queue.value.depth }}</span>
          <span>在飞 t2i {{ stream.queue.value.inFlightT2i }}</span>
          <span>在飞 i2v {{ stream.queue.value.inFlightI2v }}</span>
          <Tag
            :color="stream.queue.value.windowOpen ? 'success' : 'default'"
            class="!mr-0"
          >
            GPU 窗口 {{ stream.queue.value.window }}
            {{ stream.queue.value.windowOpen ? '（开放）' : '（关闭）' }}
          </Tag>
          <Tag v-if="stream.queue.value.paused" color="warning" class="!mr-0">
            已暂停：{{ stream.queue.value.reason || '背压' }}
          </Tag>
        </template>
        <template v-if="stream.health.value">
          <span>
            ComfyUI
            <Tag
              :color="
                stream.health.value.comfyui === 'ok' ? 'success' : 'error'
              "
              class="!mr-0"
            >
              {{ stream.health.value.comfyui }}
            </Tag>
          </span>
          <span>LLM：{{ stream.health.value.llm || '-' }}</span>
        </template>
      </div>
    </Card>

    <!-- 五指标 -->
    <Row :gutter="16" class="mb-4">
      <Col :span="6">
        <Card size="small">
          <Statistic
            title="吞吐（今日完成）"
            :value="metrics?.throughput.today ?? 0"
            suffix="任务"
          />
          <div class="mt-1 text-xs text-muted-foreground">
            近 7 天 {{ metrics?.throughput.week ?? 0 }} 个
          </div>
        </Card>
      </Col>
      <Col :span="6">
        <Card size="small">
          <Statistic
            title="驳回率（近 7 天）"
            :value="(metrics?.rejectRate.image ?? 0) * 100"
            :precision="1"
            suffix="%"
          />
          <div class="mt-1 text-xs text-muted-foreground">
            图 {{ pct(metrics?.rejectRate.image) }} · 视频
            {{ pct(metrics?.rejectRate.video) }}
          </div>
        </Card>
      </Col>
      <Col :span="6">
        <Card size="small">
          <Statistic
            title="待审积压"
            :value="metrics?.reviewBacklog.pending ?? 0"
            suffix="项"
          />
          <div class="mt-1 text-xs text-muted-foreground">
            最久 {{ metrics?.reviewBacklog.oldestHours ?? 0 }} 小时 · 图
            {{ metrics?.reviewBacklog.byKind.image ?? 0 }} / 剧
            {{ metrics?.reviewBacklog.byKind.drama ?? 0 }}
          </div>
        </Card>
      </Col>
      <Col :span="6">
        <Card size="small">
          <Statistic
            title="GPU 负载"
            :value="metrics?.gpu.inFlight ?? 0"
            suffix="在飞"
          />
          <div class="mt-1 text-xs text-muted-foreground">
            队列 {{ metrics?.gpu.queue ?? 0 }} ·
            {{ metrics?.gpu.windowOpen ? '窗口开放' : '窗口关闭' }}
            （{{ metrics?.gpu.window }}）
          </div>
        </Card>
      </Col>
    </Row>

    <!-- ETA -->
    <Card class="mb-4" size="small" title="剩余工时预估">
      <div class="flex items-center gap-6">
        <Statistic
          title="剩余任务"
          :value="metrics?.eta.remainingTasks ?? 0"
          suffix="个"
        />
        <Statistic
          title="预计耗时"
          :value="metrics?.eta.estHours ?? 0"
          :precision="1"
          suffix="小时"
        />
        <div class="flex-1">
          <div class="mb-1 text-xs text-muted-foreground">
            今日吞吐趋势（近 7 天）
          </div>
          <div class="flex h-12 items-end gap-2">
            <Tooltip
              v-for="(v, i) in metrics?.throughput.trend ?? []"
              :key="i"
              :title="`${v} 个任务`"
            >
              <div
                class="w-6 rounded-t bg-primary/70"
                :style="{
                  height: `${Math.max(4, (v / Math.max(1, Math.max(...(metrics?.throughput.trend ?? [1])))) * 48)}px`,
                }"
              />
            </Tooltip>
          </div>
        </div>
      </div>
    </Card>

    <!-- 昨夜批产报告 -->
    <Card size="small" title="昨夜批产报告">
      <template v-if="report">
        <div class="mb-3 text-xs text-muted-foreground">
          窗口
          <TimeTag :time="report.window.start" />
          ~
          <TimeTag :time="report.window.end" />
        </div>
        <Row :gutter="16" class="mb-4">
          <Col :span="4"
            ><Statistic title="提交" :value="report.submitted"
          /></Col>
          <Col :span="4"
            ><Statistic title="完成" :value="report.completed"
          /></Col>
          <Col :span="4"><Statistic title="失败" :value="report.failed" /></Col>
          <Col :span="4"
            ><Statistic title="驳回" :value="report.rejected"
          /></Col>
          <Col :span="4"
            ><Statistic title="任务数" :value="report.taskCount"
          /></Col>
          <Col :span="4">
            <div class="text-sm text-muted-foreground">耗时（分钟）</div>
            <div class="text-xs">
              中位 {{ report.durationMinutes.median }} · P90
              {{ report.durationMinutes.p90 }} · 最大
              {{ report.durationMinutes.max }}
            </div>
          </Col>
        </Row>

        <div class="mb-1 text-sm">Top 驳回原因</div>
        <Table
          v-if="report.topRejectReasons.length > 0"
          :columns="reportColumns"
          :data-source="report.topRejectReasons"
          :pagination="false"
          row-key="reasonId"
          size="small"
        />
        <Empty v-else description="昨夜无驳回记录" />
      </template>
      <Empty v-else description="暂无批产记录" />
    </Card>

    <Alert
      v-if="loading && !metrics"
      class="mt-4"
      message="正在加载指标…"
      type="info"
      show-icon
    />
  </Page>
</template>
