<script lang="ts" setup>
import type { StageVersion } from '#/api/core/dramafloow';

/**
 * ArtifactTrace —— 横向的「溯源面板」（横向结构 P5）
 *
 * 用户明确要求（docs/主流程定义.md §4）：
 *   「要显示他们用到了哪些素材 / 产出了哪些产物 / 每一个版本 生成和产出情况」
 *   「提交给系统的关键词 都要记录下来」
 *
 * 这些数据**全都在库里**（Task / TaskVersion / Job / LlmCallLog），
 * 后端 `Stage/Rows` 已聚合返回，本组件只负责展示。
 *
 * 为什么把「关键词」单独做一个可复制区块：用户要的是**能拿走**的关键词
 * （去别的工具复现），所以用 pre + 复制按钮，而不是折在表格里。
 */
import { ref } from 'vue';

import { Button, Empty, Table, Tag, Tooltip } from 'ant-design-vue';

import { TimeTag } from '#/components/TimeTag';

const props = defineProps<{
  /** 该横向的执行历史（每次 = 一个 task；每 task 含若干尝试轮） */
  versions: StageVersion[];
}>();

const expandedKeys = ref<number[]>([]);

function toggle(taskId: number) {
  expandedKeys.value = expandedKeys.value.includes(taskId)
    ? expandedKeys.value.filter((k) => k !== taskId)
    : [...expandedKeys.value, taskId];
}

const COLUMNS = [
  { dataIndex: 'version', key: 'version', title: '轮次', width: 70 },
  { dataIndex: 'type', key: 'type', title: '任务类型', width: 120 },
  { dataIndex: 'status', key: 'status', title: '状态', width: 110 },
  { dataIndex: 'progress', key: 'progress', title: '进度', width: 80 },
  { dataIndex: 'startedAt', key: 'startedAt', title: '开始', width: 150 },
  { dataIndex: 'finishedAt', key: 'finishedAt', title: '结束', width: 150 },
  { key: 'action', title: '', width: 80 },
];

function statusColor(s: string): string {
  if (s === 'done') return 'success';
  if (s === 'failed') return 'error';
  if (s === 'rejected') return 'warning';
  if (s === 'pending_review') return 'warning';
  return 'processing';
}

/** 关键词留档：尝试轮里的 promptSnapshot（后端原样给出 JSON 或纯文本） */
function prettyPrompt(raw?: null | string): string {
  if (!raw) return '';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    // 非 JSON（如 t2i 的纯提示词文本）→ 原样展示
    return raw;
  }
}

async function copyPrompt(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // 剪贴板不可用（非 https / 无权限）→ 静默失败，用户可手动选中复制
  }
}

const props_ = props;
</script>

<template>
  <div>
    <Empty
      v-if="props_.versions.length === 0"
      :image="Empty.PRESENTED_IMAGE_SIMPLE"
      description="该横向还没有执行记录"
    />

    <template v-else>
      <Table
        :columns="COLUMNS"
        :data-source="props_.versions"
        :pagination="false"
        :row-key="(r: StageVersion) => r.taskId"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'version'">
            v{{ record.version }}
          </template>
          <template v-else-if="column.key === 'type'">
            <Tag class="!mr-0">{{ record.type }}</Tag>
          </template>
          <template v-else-if="column.key === 'status'">
            <Tag :color="statusColor(record.status)">{{ record.status }}</Tag>
          </template>
          <template v-else-if="column.key === 'progress'">
            {{ record.progress }}%
          </template>
          <template v-else-if="column.key === 'startedAt'">
            <TimeTag :time="record.startedAt" />
          </template>
          <template v-else-if="column.key === 'finishedAt'">
            <TimeTag :time="record.finishedAt" />
          </template>
          <template v-else-if="column.key === 'action'">
            <Button size="small" type="link" @click="toggle(record.taskId)">
              {{ expandedKeys.includes(record.taskId) ? '收起' : '关键词' }}
            </Button>
          </template>
        </template>

        <!-- 展开行：每次尝试的关键词留档 -->
        <template #expandedRowRender="{ record }">
          <div v-if="expandedKeys.includes(record.taskId)" class="space-y-2">
            <div
              v-if="record.error"
              class="rounded bg-destructive/10 p-2 text-xs text-destructive"
            >
              失败原因：{{ record.error }}
            </div>

            <div
              v-for="a in record.attempts"
              :key="a.versionNo"
              class="rounded border p-2"
            >
              <div class="mb-1 flex flex-wrap items-center gap-2 text-xs">
                <Tag class="!mr-0">第 {{ a.versionNo }} 次尝试</Tag>
                <Tag :color="statusColor(a.status)">{{ a.status }}</Tag>
                <span v-if="a.seed !== null && a.seed !== undefined">
                  seed: {{ a.seed }}
                </span>
                <TimeTag :time="a.submittedAt" />
                <span class="flex-1"></span>
                <Tooltip title="复制关键词">
                  <Button
                    size="small"
                    type="link"
                    @click="copyPrompt(prettyPrompt(a.promptSnapshot))"
                  >
                    复制
                  </Button>
                </Tooltip>
              </div>

              <div v-if="a.failReason" class="mb-1 text-xs text-destructive">
                {{ a.failReason }}
              </div>

              <!-- 提交给系统的关键词（用户明确要求全记录） -->
              <pre
                v-if="a.promptSnapshot"
                class="max-h-60 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap"
                >{{ prettyPrompt(a.promptSnapshot) }}</pre
              >
              <div v-else class="text-xs text-muted-foreground">
                （本次尝试未记录关键词）
              </div>
            </div>

            <div
              v-if="record.attempts.length === 0"
              class="text-xs text-muted-foreground"
            >
              该次执行还没有尝试轮记录
            </div>
          </div>
        </template>
      </Table>
    </template>
  </div>
</template>
