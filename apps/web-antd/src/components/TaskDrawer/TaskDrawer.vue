<script lang="ts" setup>
/**
 * 子任务详情抽屉（TaskDrawer）
 *
 * 用途：在任意列表页点「详情」即可查看单个子任务的完整信息，并直接操作：
 *   - 查看：状态/进度/错误/版本快照（task_version）/ComfyUI 作业（job）/心跳
 *   - 重新生成：任何状态都能再跑一版（开新版本、保留历史）
 *   - 取消：在飞/排队任务
 *   - 删除：已结束任务（保留记录可追溯）
 *   - 手动修改：备注(error) 与进度(progress)
 *
 * 契约注意：控制器全部 [FromForm]，api 层已统一处理；此处不写 toast（拦截器已弹）。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  Button,
  Descriptions,
  Drawer,
  Empty,
  Input,
  InputNumber,
  Popconfirm,
  Progress,
  Space,
  Table,
  Tag,
  message,
} from 'ant-design-vue';

import type { TaskDetail } from '#/api/core/dramafloow';

import {
  taskCancel,
  taskDelete,
  taskGet,
  taskRegenerate,
  taskUpdate,
} from '#/api/core/dramafloow';
import { TimeTag } from '#/components/TimeTag';
import {
  TASK_STATUS_TEXT,
  TASK_TYPE_TEXT,
  taskStatusColor,
} from '#/composables/useTaskStream';

import { elapsedSecondsOf, formatElapsed, formatTokens } from './taskDisplay';

const props = defineProps<{
  /** 要查看的任务 id；null 表示关闭 */
  taskId: null | number;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  /** 任务状态变化后，通知父组件刷新列表 */
  (e: 'changed'): void;
}>();

const open = ref(false);
const loading = ref(false);
const detail = ref<null | TaskDetail>(null);
const acting = ref(false);

const router = useRouter();

/** 跳到剧目详情（任务属于哪个剧目，一眼可查） */
function openDrama(dramaId: number) {
  if (!dramaId) return;
  router.push({ name: 'DramaDetail', query: { id: dramaId } });
}

/** 每秒走字：在飞任务的「已耗时」实时刷新（终态后停止） */
const nowTick = ref(Date.now());
let tickTimer: null | ReturnType<typeof setInterval> = null;
onMounted(() => {
  tickTimer = setInterval(() => {
    nowTick.value = Date.now();
  }, 1000);
});
onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer);
});

/** 已耗时（在飞走字；结束后固定为实际耗时） */
const elapsedText = computed(() => {
  const d = detail.value;
  if (!d) return '-';
  const sec = elapsedSecondsOf(d, nowTick.value);
  return sec === null ? '-' : formatElapsed(0, sec);
});

/** LLM token 汇总（后端按 llm_call_log.task_id 归集） */
const tokens = computed(() => detail.value?.tokens ?? null);

/** 手动修改的表单（打开时用当前值初始化） */
const editError = ref('');
/** InputNumber 不接受 null，用 undefined 表示空 */
const editProgress = ref<number | undefined>(undefined);

async function load(id: number) {
  loading.value = true;
  try {
    detail.value = await taskGet(id);
    editError.value = detail.value.error ?? '';
    editProgress.value = detail.value.progress ?? 0;
  } catch {
    // 拦截器已提示
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.taskId,
  (id) => {
    open.value = id !== null;
    if (id !== null) void load(id);
  },
  { immediate: true },
);

/** 任务是否已结束（结束后才允许删除） */
const isFinished = computed(() => {
  const s = detail.value?.status;
  return ['done', 'failed', 'rejected', 'approved'].includes(s ?? '');
});

/** 心跳超时（>20s）→ 疑似卡住 */
const stuck = computed(() => {
  const d = detail.value;
  if (!d) return false;
  if (!['preparing', 'generating', 'collecting'].includes(d.status))
    return false;
  const hb = d.heartbeatAt ?? d.updatedAt;
  if (!hb) return false;
  return Date.now() - new Date(hb).getTime() > 20_000;
});

async function doRegenerate() {
  if (!detail.value) return;
  acting.value = true;
  try {
    await taskRegenerate(detail.value.id);
    emit('changed');
    emit('close');
  } finally {
    acting.value = false;
  }
}

async function doCancel() {
  if (!detail.value) return;
  acting.value = true;
  try {
    await taskCancel(detail.value.id);
    await load(detail.value.id);
    emit('changed');
  } finally {
    acting.value = false;
  }
}

async function doDelete() {
  if (!detail.value) return;
  acting.value = true;
  try {
    await taskDelete(detail.value.id);
    emit('changed');
    emit('close');
  } finally {
    acting.value = false;
  }
}

async function doSave() {
  if (!detail.value) return;
  if (
    editProgress.value !== undefined &&
    (editProgress.value < 0 || editProgress.value > 100)
  ) {
    message.warning('进度必须在 0–100 之间');
    return;
  }
  acting.value = true;
  try {
    await taskUpdate({
      id: detail.value.id,
      error: editError.value,
      progress: editProgress.value ?? undefined,
    });
    await load(detail.value.id);
    emit('changed');
  } finally {
    acting.value = false;
  }
}

const versionColumns = [
  { title: '版本', dataIndex: 'versionNo', key: 'versionNo', width: 70 },
  { title: '状态', key: 'status', width: 100 },
  { title: 'seed', dataIndex: 'seed', key: 'seed', width: 90 },
  { title: '提交时间', key: 'submittedAt', width: 170 },
  {
    title: '失败原因',
    dataIndex: 'failReason',
    key: 'failReason',
    ellipsis: true,
  },
  {
    title: '提示词快照',
    dataIndex: 'promptSnapshot',
    key: 'promptSnapshot',
    ellipsis: true,
  },
];

const jobColumns = [
  { title: '作业', dataIndex: 'id', key: 'id', width: 70 },
  { title: '工作流', dataIndex: 'workflowKey', key: 'workflowKey', width: 130 },
  { title: '变体', dataIndex: 'variantNo', key: 'variantNo', width: 70 },
  { title: 'seed', dataIndex: 'seed', key: 'seed', width: 90 },
  { title: '状态', key: 'status', width: 90 },
  {
    title: 'ComfyUI promptId',
    dataIndex: 'comfyuiPromptId',
    key: 'comfyuiPromptId',
    ellipsis: true,
  },
  { title: '错误', dataIndex: 'error', key: 'error', ellipsis: true },
];
</script>

<template>
  <Drawer :open="open" :width="860" title="子任务详情" @close="emit('close')">
    <template v-if="detail">
      <!-- 顶部：状态 + 操作（一行一动作） -->
      <div class="mb-4 flex flex-wrap items-center gap-3">
        <Tag :color="taskStatusColor(detail.status)" class="!mr-0">
          {{ TASK_STATUS_TEXT[detail.status] ?? detail.status }}
        </Tag>
        <Tag v-if="stuck" color="error" class="!mr-0">疑似卡住（心跳超时）</Tag>
        <span class="text-xs text-muted-foreground">
          #{{ detail.id }} ·
          {{ TASK_TYPE_TEXT[detail.type] ?? detail.type }}（{{ detail.type }}）·
          v{{ detail.version }}
        </span>
        <div class="flex-1" />
        <Space>
          <Button
            size="small"
            type="primary"
            :loading="acting"
            @click="doRegenerate"
          >
            重新生成
          </Button>
          <Button
            v-if="!isFinished"
            size="small"
            danger
            :loading="acting"
            @click="doCancel"
          >
            取消
          </Button>
          <Popconfirm
            v-if="isFinished"
            title="确认删除该子任务？"
            description="将保留记录可追溯；在飞任务需先取消。"
            @confirm="doDelete"
          >
            <Button size="small" danger :loading="acting">删除</Button>
          </Popconfirm>
        </Space>
      </div>

      <Progress
        class="mb-4"
        :percent="detail.progress ?? 0"
        :status="detail.status === 'failed' ? 'exception' : 'normal'"
      />

      <Descriptions bordered size="small" :column="2" class="mb-4">
        <Descriptions.Item label="类型">
          {{ TASK_TYPE_TEXT[detail.type] ?? detail.type }}（{{ detail.type }}）
        </Descriptions.Item>
        <Descriptions.Item label="剧目">
          <a v-if="detail.dramaId" @click="openDrama(detail.dramaId)">
            {{ detail.dramaName || `#${detail.dramaId}` }}
          </a>
          <span v-else class="text-muted-foreground">-</span>
        </Descriptions.Item>
        <Descriptions.Item label="关联实体">
          {{ detail.refEntityType }} #{{ detail.refEntityId ?? '-' }}
        </Descriptions.Item>
        <Descriptions.Item label="变体进度">
          {{ detail.currentVariant }}
        </Descriptions.Item>
        <Descriptions.Item label="已耗时">
          <span class="tabular-nums">{{ elapsedText }}</span>
          <span v-if="!isFinished" class="ml-1 text-xs text-muted-foreground">
            （进行中）
          </span>
        </Descriptions.Item>
        <Descriptions.Item label="LLM tokens">
          <template v-if="tokens">
            <span class="tabular-nums">
              {{ formatTokens(tokens.totalTokens) }}
            </span>
            <span class="ml-1 text-xs text-muted-foreground">
              （{{ tokens.calls }} 次调用）
            </span>
            <Tag
              v-if="tokens.estimated"
              class="ml-1 !mr-0"
              color="warning"
              title="网关未返回 usage，按字符数估算"
            >
              估算
            </Tag>
          </template>
          <span v-else class="text-muted-foreground">-</span>
        </Descriptions.Item>
        <Descriptions.Item label="开始">
          <TimeTag v-if="detail.startedAt" :time="detail.startedAt" />
          <span v-else>-</span>
        </Descriptions.Item>
        <Descriptions.Item label="结束">
          <TimeTag v-if="detail.finishedAt" :time="detail.finishedAt" />
          <span v-else>-</span>
        </Descriptions.Item>
        <Descriptions.Item label="心跳">
          <TimeTag v-if="detail.heartbeatAt" :time="detail.heartbeatAt" />
          <span v-else>-</span>
        </Descriptions.Item>
        <Descriptions.Item label="创建">
          <TimeTag :time="detail.createdAt" />
        </Descriptions.Item>
      </Descriptions>

      <!-- 手动修改：备注 + 进度 -->
      <div class="mb-4 rounded-md border border-border p-3">
        <div class="mb-2 text-sm font-medium">手动修改</div>
        <div class="mb-2 flex flex-wrap items-center gap-3">
          <span class="text-xs text-muted-foreground">进度</span>
          <InputNumber
            v-model:value="editProgress"
            :min="0"
            :max="100"
            size="small"
            style="width: 100px"
          />
        </div>
        <Input.TextArea
          v-model:value="editError"
          :rows="2"
          placeholder="备注 / 失败原因（可人工修正）"
        />
        <div class="mt-2">
          <Button size="small" :loading="acting" @click="doSave">保存</Button>
          <span class="ml-2 text-xs text-muted-foreground">
            状态请用「取消 / 重新生成」，以免绕过状态机
          </span>
        </div>
      </div>

      <!-- 版本快照（append-only） -->
      <div class="mb-2 text-sm font-medium">
        版本快照（{{ detail.versions.length }}）
      </div>
      <Table
        v-if="detail.versions.length > 0"
        :columns="versionColumns"
        :data-source="detail.versions"
        :pagination="false"
        row-key="id"
        size="small"
        class="mb-4"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'status'">
            <Tag :color="taskStatusColor(record.status)" class="!mr-0">
              {{ TASK_STATUS_TEXT[record.status] ?? record.status }}
            </Tag>
          </template>
          <template v-else-if="column.key === 'submittedAt'">
            <TimeTag :time="record.submittedAt" />
          </template>
        </template>
      </Table>
      <Empty v-else class="mb-4" description="暂无版本快照" />

      <!-- ComfyUI 作业 -->
      <div class="mb-2 text-sm font-medium">
        作业（{{ detail.jobs.length }}）
      </div>
      <Table
        v-if="detail.jobs.length > 0"
        :columns="jobColumns"
        :data-source="detail.jobs"
        :pagination="false"
        row-key="id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'status'">
            <Tag class="!mr-0">{{ record.status }}</Tag>
          </template>
        </template>
      </Table>
      <Empty v-else description="暂无作业" />
    </template>

    <Empty v-else-if="loading" description="加载中…" />
  </Drawer>
</template>
