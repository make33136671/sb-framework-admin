<script lang="ts" setup>
import type { TaskDetail } from '#/api/core/dramafloow';

/**
 * 子任务详情**内容**（抽屉与「任务执行窗口」弹窗共用）
 *
 * 用途：在任意列表页点「详情」即可查看单个子任务的完整信息，并直接操作：
 *   - 查看：状态/进度/错误/版本快照（task_version）/ComfyUI 作业（job）/心跳
 *   - 重新生成：任何状态都能再跑一版（开新版本、保留历史）
 *   - 取消：在飞/排队任务
 *   - 删除：已结束任务（保留记录可追溯）
 *   - 手动修改：备注(error) 与进度(progress)
 *
 * ## 为什么内容单独拆一个文件
 *
 * 同一份内容要能以**两种外框**呈现（见 `TaskDrawer.vue`）：
 *   · 抽屉 —— 列表页点「详情」（右侧滑出）；
 *   · 弹窗 —— 提交生成后原地弹出的「任务执行窗口」。
 *
 * 这里刻意**只保留一份内容实现**：它带着 WS 订阅、兜底轮询、参数表单等有状态逻辑，
 * 复制一份必然两边漂移（改了抽屉忘了弹窗），而这类漂移**不会报错** ——
 * 表现是两个入口看到的任务状态/日志不一致，排查时极难联想到"其实有两份实现"。
 *
 * 本组件**不关心**自己长在抽屉还是弹窗里，只负责内容与数据（含实时刷新）。
 *
 * 契约注意：控制器全部 [FromForm]，api 层已统一处理；此处不写 toast（拦截器已弹）。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import {
  Button,
  Descriptions,
  Empty,
  Input,
  InputNumber,
  message,
  Popconfirm,
  Progress,
  Select,
  Space,
  Switch,
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
import { AiProviderSelect } from '#/components/AiProviderSelect';
import { TaskRouteBadge } from '#/components/TaskRouteBadge';
import { TimeTag } from '#/components/TimeTag';
import { requiredCapabilityText } from '#/composables/useAiProviders';
import { enumText } from '#/composables/useEnumText';
import { taskStatusColor, useTaskStream } from '#/composables/useTaskStream';
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

const loading = ref(false);
const detail = ref<null | TaskDetail>(null);
const acting = ref(false);

/**
 * 是否有任务在展示（= 外框是否打开）。
 *
 * 内容组件不知道外框开没开，用 `taskId !== null` 表达同一件事 ——
 * WS 重拉与兜底轮询都靠它短路（外框关掉后不该继续打接口）。
 */
const open = computed(() => props.taskId !== null);

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

// ─────────────────────── 执行中实时刷新（用户诉求）───────────────────────
// 用户原话：「如果任务执行中 虽然显示等待图 但实际上这个页面是需要刷新的
//          即使图片生成完了也不会立即显示」。
//
// 根因：抽屉只在 taskId 变化时 load() 一次，**不订阅自己这个任务的 WS topic** ——
// 而 WS（useTaskStream）其实一直在推 task:<id> 事件（编排器每次落状态都会推）。
// 修法两条腿（缺一不可）：
//   ① WS 订阅 task:<id>：事件到达即重拉详情 → 图出来**立刻**可见（主路径）；
//   ② 兜底轮询：WS 断线/未连上时，任务在跑期间每 5s 拉一次（保证"最终会显示"）。
// 只在「仍在推进」时轮询；任务定型后立即停止，不会空转打接口。

/** 静默重拉：不置 loading，避免每次刷新都把内容区闪成骨架 */
async function refreshQuietly(id: number) {
  try {
    detail.value = await taskGet(id);
  } catch {
    // 静默失败：下一轮再试（不打扰用户）
  }
}

const stream = useTaskStream();
let pollTimer: null | ReturnType<typeof setInterval> = null;

/** 任务定型（不再推进）→ 停止轮询 */
function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function ensurePolling(id: number) {
  stopPolling();
  // WS 已连上时仍保留轮询：WS 只推「状态/进度」变化，产物的 file_path 落库
  // 与状态更新之间存在极短窗口，轮询能兜住这个窗口（成本可忽略：每 5s 一次）。
  pollTimer = setInterval(() => {
    if (!open.value || !isLive.value) {
      stopPolling();
      return;
    }
    void refreshQuietly(id);
  }, 5000);
}

watch(
  () => props.taskId,
  (id) => {
    // ⚠️ 这里**不能**写 `open.value = ...`：`open` 现在是 computed（派生自 taskId），
    // 外框的开合由本 watch 唯一决定，不需要也不该再存一份状态。
    stopPolling();
    if (id === null) {
      // 关闭时退订，避免无谓的事件与内存占用
      if (subscribedId !== null) {
        stream.unsubscribeTask(subscribedId);
        subscribedId = null;
      }
      return;
    }
    void load(id);
    // 订阅本任务的实时事件（重开时先退订上一个）
    if (subscribedId !== null) stream.unsubscribeTask(subscribedId);
    stream.subscribeTask(id);
    subscribedId = id;
    ensurePolling(id);
  },
  { immediate: true },
);

/** 当前已订阅的 task topic（避免重复订阅/漏退订） */
let subscribedId: null | number = null;

// WS 事件到达 → 静默重拉。**监听整个 taskMap**：只要本任务有任意事件就刷新，
// 不做细粒度 diff —— 详情是一个整体，局部更新容易漏字段（进度/产物/日志）。
watch(
  () => (props.taskId === null ? null : stream.taskMap.value[props.taskId]),
  (e) => {
    if (!e || !open.value) return;
    void refreshQuietly(e.id);
  },
);

onUnmounted(() => {
  stopPolling();
  if (subscribedId !== null) {
    stream.unsubscribeTask(subscribedId);
    subscribedId = null;
  }
});

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

// ─────────────────── 提交式重新生成（用户诉求）───────────────────
// 用户原话：「这里只有 一个重新生成 但我想要的是**任务提交形式**的：改完关键词
//          和生成几张图 这些参数 提交任务再去生成。我还想加入 一些更详细的参数
//          例如分辨率 高宽这些」。
//
// 形态：把这些参数收进一个可折叠表单，填完点「提交生成」→ 开**新版本任务**
// （历史版本与产物保留），参数随任务落库（OptionsJson）由编排器读取。

/** 参数面板展开态（默认收起，不干扰"只想重跑一次"的常用路径） */
const showParams = ref(false);
const pCandidateCount = ref<number | undefined>(undefined);
const pWidth = ref<number | undefined>(1024);
const pHeight = ref<number | undefined>(1024);
const pUsePrompt = ref(false);
const pPrompt = ref('');
const pNegative = ref('');
const pProviderId = ref<number | undefined>(undefined);

/** 分辨率预设（全部对齐 64 的倍数；覆盖短剧常见比例）。
 *  只提供常用档位，具体出多大受**模型与提示词**影响 —— 换模型后哪些档位效果好会变，
 *  故不在此写死"推荐值"，由使用者按当前模型自行选择。 */
const SIZE_PRESETS = [
  { label: '320×320 小图（快速试参）', value: '320x320' },
  { label: '1024×1024 方形', value: '1024x1024' },
  { label: '768×1344 竖屏 9:16', value: '768x1344' },
  { label: '832×1216 竖屏 2:3', value: '832x1216' },
  { label: '1216×832 横屏 3:2', value: '1216x832' },
  { label: '1344×768 横屏 16:9', value: '1344x768' },
  { label: '512×512 小图', value: '512x512' },
];

const sizePreset = computed({
  get: () => {
    const hit = SIZE_PRESETS.find(
      (p) => p.value === `${pWidth.value}x${pHeight.value}`,
    );
    return hit ? hit.value : 'custom';
  },
  set: (v: string) => {
    const [w, h] = v.split('x').map(Number);
    if (w && h) {
      pWidth.value = w;
      pHeight.value = h;
    }
  },
});

/** 参数是否有改动（决定按钮文案与是否提示"将按新参数生成"） */
const paramsDirty = computed(
  () =>
    pCandidateCount.value !== undefined ||
    pProviderId.value !== undefined ||
    (pUsePrompt.value && pPrompt.value.trim() !== '') ||
    pNegative.value.trim() !== '',
);

/** 把表单归一成请求参数：**未填的一律不传**，让后端走"回落旧行为" */
function buildParams() {
  if (!paramsDirty.value) return undefined;
  return {
    candidateCount: pCandidateCount.value,
    width: pWidth.value,
    height: pHeight.value,
    promptOverride: pUsePrompt.value ? pPrompt.value.trim() : undefined,
    negativePrompt: pNegative.value.trim() || undefined,
    providerId: pProviderId.value,
  };
}

async function doRegenerate() {
  const d = detail.value;
  if (!d) return;
  // 参数面板开着但用户勾了"自定义提示词"却没写内容 → 提前拦下，
  // 否则会静默回到 LLM 生成，与用户预期不符（他以为用的是自己写的）
  if (pUsePrompt.value && !pPrompt.value.trim()) {
    message.warning('已勾选「自定义提示词」，但内容为空（留空将改用 AI 生成）');
    return;
  }
  acting.value = true;
  try {
    const r = await taskRegenerate(d.id, undefined, buildParams());
    // 回显**后端钳制/对齐后的真实值**：用户设 700 实际生效 704，
    // 不说清楚他会以为"设置了没生效"（这是本项目常见的困惑来源）
    const a = r?.applied;
    if (a && (a.width || a.candidateCount)) {
      const bits: string[] = [];
      if (a.candidateCount) bits.push(`${a.candidateCount} 张`);
      if (a.width && a.height) bits.push(`${a.width}×${a.height}`);
      if (a.hasPromptOverride) bits.push('自定义提示词');
      message.success(`已提交：${bits.join(' · ')}（任务 #${r.taskId}）`);
    }
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
            <!-- 提交式生成：展开可改提示词/张数/分辨率/模型（默认收起） -->
            <Button
              v-if="detail.type === 't2i'"
              size="small"
              @click="showParams = !showParams"
            >
              {{ showParams ? '收起参数' : '参数…' }}
            </Button>
            <Button
              size="small"
              type="primary"
              :loading="acting"
              @click="doRegenerate"
            >
              {{ paramsDirty ? '提交生成' : '重新生成' }}
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
  
        <!-- 提交式参数表单（用户诉求：改关键词/张数/分辨率后「提交任务再去生成」） -->
        <div
          v-if="showParams && detail.type === 't2i'"
          class="mb-4 rounded-md border border-border p-3"
        >
          <div class="mb-2 text-sm font-medium">
            提交生成参数
            <span class="ml-1 text-xs font-normal text-muted-foreground">
              留空 = 沿用原参数（AI 生成提示词 / 系统默认张数与尺寸）
            </span>
          </div>
  
          <div class="mb-3 flex flex-wrap items-center gap-3">
            <span class="text-xs text-muted-foreground">生成张数</span>
            <InputNumber
              v-model:value="pCandidateCount"
              :max="8"
              :min="1"
              placeholder="默认 3"
              size="small"
              style="width: 110px"
            />
            <span class="text-xs text-muted-foreground">1–8 张</span>
  
            <span class="ml-2 text-xs text-muted-foreground">分辨率</span>
            <Select
              v-model:value="sizePreset"
              :options="[...SIZE_PRESETS, { label: '自定义…', value: 'custom' }]"
              size="small"
              style="width: 200px"
            />
            <InputNumber
              v-model:value="pWidth"
              :max="2048"
              :min="256"
              :step="64"
              size="small"
              style="width: 100px"
            />
            <span class="text-xs">×</span>
            <InputNumber
              v-model:value="pHeight"
              :max="2048"
              :min="256"
              :step="64"
              size="small"
              style="width: 100px"
            />
            <span class="text-xs text-muted-foreground">
              256–2048，自动对齐 64 的倍数
            </span>
          </div>
  
          <div class="mb-3 flex flex-wrap items-center gap-3">
            <span class="text-xs text-muted-foreground">执行模型</span>
            <!-- 复用既有选择器（按 taskType 过滤出具备该能力的模型，避免选到不能出图的线路） -->
            <AiProviderSelect
              v-model:value="pProviderId"
              :disabled="acting"
              task-type="t2i"
            />
          </div>
  
          <div class="mb-3">
            <div class="mb-1 flex items-center gap-2">
              <Switch v-model:checked="pUsePrompt" size="small" />
              <span class="text-xs text-muted-foreground">
                自定义提示词（开启后**不再调用 AI 生成**，直接用你写的；多张仅
                seed 不同）
              </span>
            </div>
            <Input.TextArea
              v-model:value="pPrompt"
              :disabled="!pUsePrompt"
              :rows="3"
              placeholder="例如：an adult woman in a Regency gown, standing in a garden, soft natural light, painterly illustration"
            />
          </div>
  
          <div>
            <div class="mb-1 text-xs text-muted-foreground">
              负面提示词（可选；工作流有 negative 占位符时生效）
            </div>
            <Input
              v-model:value="pNegative"
              placeholder="例如：blurry, extra fingers, watermark"
              size="small"
            />
          </div>
  
          <div v-if="paramsDirty" class="mt-2 text-xs text-muted-foreground">
            提交后将**新开一个版本**（v{{ (detail.version ?? 0) + 1 }}），
            历史版本与产物保留。
          </div>
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

  <Empty v-else description="加载中…" />
</template>
