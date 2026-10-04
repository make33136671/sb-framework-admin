<script lang="ts" setup>
import type { TaskDetail } from '#/api/core/dramafloow';

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
  message,
  Popconfirm,
  Progress,
  Space,
  Table,
  Tag,
} from 'ant-design-vue';

import {
  taskCancel,
  taskDelete,
  taskGet,
  taskRegenerate,
  taskUpdate,
} from '#/api/core/dramafloow';
import { TaskRouteBadge } from '#/components/TaskRouteBadge';
import { TimeTag } from '#/components/TimeTag';
import { requiredCapabilityText } from '#/composables/useAiProviders';
import { enumText } from '#/composables/useEnumText';
import { taskStatusColor } from '#/composables/useTaskStream';
import { wallNow } from '#/utils/wallTime';

import {
  elapsedSecondsOf,
  formatElapsed,
  formatTokens,
  isLiveStatus,
} from './taskDisplay';
import TaskLogPanel from './TaskLogPanel.vue';
import TaskPreviewPanel from './TaskPreviewPanel.vue';

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

/** 每秒走字：在飞任务的「已耗时」实时刷新（不再推进的任务会自行冻结）
 *  ⚠️ 必须用 `wallNow()`：后端时间戳是项目时区墙上时间，混用绝对时刻会偏一个时区。 */
const nowTick = ref(wallNow());
let tickTimer: null | ReturnType<typeof setInterval> = null;
onMounted(() => {
  tickTimer = setInterval(() => {
    nowTick.value = wallNow();
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
  return ['approved', 'done', 'failed', 'rejected'].includes(s ?? '');
});

/** 是否仍在推进（决定「已耗时」走字 vs 冻结、是否显示「进行中」） */
const isLive = computed(() => isLiveStatus(detail.value?.status));

/** 心跳超时（>20s）→ 疑似卡住 */
const stuck = computed(() => {
  const d = detail.value;
  if (!d) return false;
  if (!isLiveStatus(d.status)) return false;
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
          {{ enumText.taskStatus(detail.status) }}
        </Tag>
        <Tag v-if="stuck" color="error" class="!mr-0">疑似卡住（心跳超时）</Tag>
        <span class="text-xs text-muted-foreground">
          #{{ detail.id }} · {{ enumText.taskType(detail.type) }} · v{{
            detail.version
          }}
        </span>
        <div class="flex-1"></div>
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

      <!-- 产物预览（已产出的给图/视频，未产出的给**等待占位符**）+ 当前提示词 + 调用的工作流。
           放在最上部：用户打开详情第一眼要回答的就是「出来了吗 / 长什么样 / 还差什么」。 -->
      <div class="mb-4 rounded-md border border-border p-3">
        <TaskPreviewPanel :loading="loading" :preview="detail.preview" />
      </div>

      <Descriptions bordered size="small" :column="2" class="mb-4">
        <Descriptions.Item label="类型">
          {{ enumText.taskType(detail.type) }}
        </Descriptions.Item>
        <Descriptions.Item label="剧目">
          <a v-if="detail.dramaId" @click="openDrama(detail.dramaId)">
            {{ detail.dramaName || `#${detail.dramaId}` }}
          </a>
          <span v-else class="text-muted-foreground">-</span>
        </Descriptions.Item>
        <Descriptions.Item label="AI 服务 / 路由">
          <!-- 成本感知调度 §6.4：路由徽标（🏠 本地 / ☁ 云端）+ 上云原因 tooltip + 金额 -->
          <div class="mb-1">
            <TaskRouteBadge
              :cost-yuan="detail.costYuan"
              :off-peak="detail.offPeak"
              :reason="detail.routeReason"
              :reason-text="detail.routeReasonText"
              :route="detail.route"
            />
          </div>
          <template v-if="detail.providerName">
            {{ detail.providerName }}
            <span class="text-xs text-muted-foreground">
              （需要 {{ requiredCapabilityText(detail.type) }}）
            </span>
          </template>
          <template
            v-else-if="requiredCapabilityText(detail.type).includes('无需')"
          >
            <span class="text-muted-foreground">
              {{ requiredCapabilityText(detail.type) }}
            </span>
          </template>
          <template v-else>
            <span class="text-muted-foreground">
              自动（默认服务）· 需要 {{ requiredCapabilityText(detail.type) }}
            </span>
          </template>
        </Descriptions.Item>
        <Descriptions.Item label="关联实体">
          {{ detail.refEntityType }} #{{ detail.refEntityId ?? '-' }}
        </Descriptions.Item>
        <Descriptions.Item label="变体进度">
          {{ detail.currentVariant }}
        </Descriptions.Item>
        <Descriptions.Item label="已耗时">
          <span class="tabular-nums">{{ elapsedText }}</span>
          <span v-if="isLive" class="ml-1 text-xs text-muted-foreground">
            （进行中）
          </span>
          <span v-else class="ml-1 text-xs text-muted-foreground">
            （已停止计时）
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
              {{ enumText.taskStatus(record.status) }}
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
            <Tag class="!mr-0">{{ enumText.jobStatus(record.status) }}</Tag>
          </template>
        </template>
      </Table>
      <Empty v-else description="暂无作业" />

      <!-- 生图交互日志（时间线：作业提交/完成/失败 + 提示词快照 + 任务状态与错误） -->
      <div class="mt-4 mb-2 text-sm font-medium">
        生图交互日志（{{ (detail.logs ?? []).length }}）
      </div>
      <TaskLogPanel :loading="loading" :logs="detail.logs" />
    </template>

    <Empty v-else-if="loading" description="加载中…" />
  </Drawer>
</template>
