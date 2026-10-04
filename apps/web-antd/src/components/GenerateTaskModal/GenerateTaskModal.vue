<script lang="ts" setup>
import type {
  AssetRequirementItem,
  TaskSubmitResult,
} from '#/api/core/dramafloow';

/**
 * GenerateTaskModal —— **当前窗口内**的 AI 任务执行弹窗（用户 2026-10-04 要求）
 *
 * > 「手动操作的时候 点击去生成 直接在当前窗口 弹出 AI任务的执行窗口」
 *
 * 与旧行为（跳转到 `/dramafloow/tasks/submit` 整页）的区别：
 *   · **不离开当前页面** —— 角色视图的上下文（哪个角色、哪个视图）不丢；
 *   · 「提交」前**不建任何任务**（沿用既有语义：关掉 = 什么都没发生）；
 *   · 所有参数都有默认（沿用统一入口的"零必填"原则），点开直接提交即可。
 *
 * ⚠️ 弹窗**不自己写 toast**：`api/request.ts` 的拦截器已按 code 自动弹，
 * 再写一遍就是双 toast（项目规范 Conventions §1）。
 */
import { computed, reactive, ref, watch } from 'vue';

import {
  Alert,
  Button,
  Descriptions,
  DescriptionsItem,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
} from 'ant-design-vue';

import {
  assetRequirementList,
  dramaGet,
  taskSizes,
  taskSubmit,
} from '#/api/core/dramafloow';
import { AiProviderSelect } from '#/components/AiProviderSelect';

/** 弹窗打开时由调用方传入的预填上下文（来自角色视图的某个格子） */
export interface GenerateContext {
  dramaId: number;
  /** 角色名（仅用于标题展示） */
  characterName: string;
  /** 视图中文名 */
  viewLabel: string;
  /** 归属的素材需求 id（产物挂回该视图） */
  requirementId?: null | number;
  requirementKey?: string;
  /** 第 3 层正向：视图 spec */
  subjectPrompt?: string;
  /** 第 3 层反向：通用底线 + 视图专有 */
  subjectNegative?: string;
  width?: null | number;
  height?: null | number;
}

const props = defineProps<{
  /** null = 关闭 */
  context: GenerateContext | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  /** 已提交任务（父组件据此刷新列表 / 打开任务抽屉） */
  (e: 'submitted', payload: { taskId: number }): void;
}>();

const open = computed(() => props.context !== null);

/**
 * 表单：**每个字段都有默认值**（"什么都不改也能生成"）。
 *
 * ⚠️ 可空选项一律用 `undefined` 而非 `null`：antd 的 Select / InputNumber
 * 不接受 null 作为绑定值（类型上是 SelectValue / ValueType）。
 */
const form = reactive({
  refEntityId: undefined as number | undefined,
  subjectPrompt: '',
  subjectNegative: '',
  candidateCount: 1,
  width: 320,
  height: 320,
  seed: undefined as string | undefined,
  providerId: undefined as number | undefined,
});

const requirements = ref<AssetRequirementItem[]>([]);
const loadingReqs = ref(false);
const submitting = ref(false);
const result = ref<null | TaskSubmitResult>(null);
const sizeSource = ref('');
/** 剧本风格提示词（第 2 层）—— 只读展示，让用户知道会自动拼上什么 */
const dramaStyle = ref<{ negative: null | string; positive: null | string }>({
  positive: null,
  negative: null,
});

const sizePresets = [
  { label: '小图 320×320', value: '320x320' },
  { label: '小图竖版 320×560（全身立姿）', value: '320x560' },
  { label: '正方形 1024×1024', value: '1024x1024' },
  { label: '竖版 768×1344（全身立姿）', value: '768x1344' },
  { label: '横版 1344×768（场景）', value: '1344x768' },
  { label: '自定义', value: 'custom' },
];

const sceneKey = ref('320x320');

const requirementOptions = computed(() =>
  requirements.value.map((r) => ({
    label: `${r.key}${r.spec ? '' : '（无规格）'}`,
    value: r.id,
  })),
);

/**
 * 打开弹窗 / 切换上下文 → 重载归属列表与系统默认尺寸。
 *
 * 尺寸默认值**必须问后端**（`taskSizes` 按「视图覆盖 → 通用默认 → 代码兜底」
 * 解析）：用户要求「数值不是写死 是数据库」，前端自己定默认值的话，
 * 用户在设置页改完这里不会变 —— 且不会报错。
 */
watch(
  () => props.context,
  async (ctx) => {
    result.value = null;
    if (!ctx) return;

    form.refEntityId = ctx.requirementId ?? undefined;
    form.subjectPrompt = ctx.subjectPrompt ?? '';
    form.subjectNegative = ctx.subjectNegative ?? '';
    // 「每视图 1 张」是批量补齐的默认；单视图手动生成也默认 1 张，用户可改
    form.candidateCount = 1;
    form.seed = undefined;
    form.providerId = undefined;
    dramaStyle.value = { positive: null, negative: null };

    // 先用上下文里的尺寸兜底，随后被系统设置覆盖（若后端有解析结果）
    form.width = ctx.width ?? 320;
    form.height = ctx.height ?? 320;
    sceneKey.value = `${form.width}x${form.height}`;

    loadingReqs.value = true;
    try {
      const [sizes, reqs, detail] = await Promise.all([
        taskSizes().catch(() => null),
        assetRequirementList({ dramaId: ctx.dramaId, pageSize: 500 }),
        dramaGet(ctx.dramaId).catch(() => null),
      ]);

      // 尺寸：优先用**该视图**的系统设置（有的话），否则保留上下文里的视图兜底
      if (sizes) {
        const isViewSized = Boolean(ctx.width && ctx.height);
        if (isViewSized) {
          sizeSource.value = `${ctx.viewLabel} 视图默认`;
        } else {
          form.width = sizes.defaultWidth;
          form.height = sizes.defaultHeight;
          sizeSource.value = sizes.defaultSource;
        }
        sceneKey.value = `${form.width}x${form.height}`;
      }

      requirements.value = reqs.items.filter((r) => r.kind !== 'text');

      const d = detail?.drama as unknown as {
        styleNegativePrompt?: null | string;
        stylePrompt?: null | string;
      };
      dramaStyle.value = {
        positive: d?.stylePrompt ?? null,
        negative: d?.styleNegativePrompt ?? null,
      };
    } catch {
      // 拦截器已提示
    } finally {
      loadingReqs.value = false;
    }
  },
  { immediate: true },
);

watch(sceneKey, (k) => {
  if (k === 'custom') return;
  const [w, h] = k.split('x').map(Number);
  if (w && h) {
    form.width = w;
    form.height = h;
    sizeSource.value = '';
  }
});

/** 最终正向提示词的构成预览（前端只做说明，实际拼装以后端为准） */
const promptPlan = computed(() => {
  const parts: string[] = ['① 工作流默认（后端按所选工作流自动取）'];
  if (dramaStyle.value.positive) parts.push('② 剧目风格（已配置）');
  else parts.push('② 剧目风格（未配置，将跳过）');
  if (form.subjectPrompt.trim())
    parts.push('③ 角色/视图特有（已填入本视图约束）');
  else parts.push('③ 角色/视图特有（未填写，将跳过）');
  return parts;
});

async function submit() {
  const ctx = props.context;
  if (!ctx) return;
  submitting.value = true;
  try {
    result.value = await taskSubmit({
      dramaId: ctx.dramaId,
      type: 't2i',
      refEntityType: form.refEntityId ? 'asset_requirement' : null,
      refEntityId: form.refEntityId ?? null,
      subjectPrompt: form.subjectPrompt.trim() || null,
      subjectNegative: form.subjectNegative.trim() || null,
      candidateCount: form.candidateCount,
      width: form.width,
      height: form.height,
      seed: form.seed ?? null,
      providerId: form.providerId ?? null,
    });
    if (result.value?.taskId) {
      emit('submitted', { taskId: result.value.taskId });
    }
  } catch {
    // 拦截器已提示
  } finally {
    submitting.value = false;
  }
}

function close() {
  emit('close');
}
</script>

<template>
  <Modal
    :confirm-loading="submitting"
    :footer="null"
    :open="open"
    :title="
      context
        ? `生成图片 —— ${context.characterName} / ${context.viewLabel}`
        : '生成图片'
    "
    :width="760"
    @cancel="close"
  >
    <template v-if="context">
      <!-- 提交成功回执：留在弹窗里，用户可以直接关掉或再生成一张 -->
      <template v-if="result">
        <Alert
          class="mb-3"
          show-icon
          type="success"
          :message="`任务已入队（task ${result.taskId} / v${result.version}）`"
        />
        <Descriptions :column="1" bordered size="small">
          <DescriptionsItem label="提示词构成">
            <span class="text-xs">{{ result.layers }}</span>
          </DescriptionsItem>
          <DescriptionsItem label="实际正向提示词">
            <div class="break-all text-xs">{{ result.positivePrompt }}</div>
          </DescriptionsItem>
          <DescriptionsItem label="实际反向提示词">
            <div class="break-all text-xs">{{ result.negativePrompt }}</div>
          </DescriptionsItem>
        </Descriptions>
        <div class="mt-3 flex justify-end gap-2">
          <Button @click="result = null">再生成一张</Button>
          <Button type="primary" @click="close">关闭</Button>
        </div>
      </template>

      <template v-else>
        <Alert class="mb-3" show-icon type="info">
          <template #message>
            产物会挂回「{{
              context.requirementKey || context.viewLabel
            }}」这个视图
          </template>
          <template #description>
            <span class="text-xs">
              所有参数已按默认填好，直接点「提交生成」即可。
              <b>提交前不会创建任何任务</b>，关掉窗口等于什么都没发生。
            </span>
          </template>
        </Alert>

        <Spin :spinning="loadingReqs">
          <div class="grid grid-cols-2 gap-3">
            <div class="col-span-2">
              <div class="mb-1 text-sm">归属素材需求（产物挂回哪个视图）</div>
              <Select
                v-model:value="form.refEntityId"
                :loading="loadingReqs"
                :options="requirementOptions"
                allow-clear
                placeholder="不选 = 独立任务，出图不挂回任何素材"
                show-search
                style="width: 100%"
              />
            </div>

            <div class="col-span-2">
              <div class="mb-1 text-sm">
                角色 / 视图特有提示词（第 ③ 层，自动叠加到前两层之上）
              </div>
              <Input.TextArea
                v-model:value="form.subjectPrompt"
                :rows="3"
                placeholder="如：head-and-shoulders portrait, facing camera directly, plain light gray background (#F0F0F0)"
              />
            </div>

            <div class="col-span-2">
              <div class="mb-1 text-sm">角色 / 视图特有反向提示词</div>
              <Input.TextArea
                v-model:value="form.subjectNegative"
                :rows="2"
                placeholder="如：full body, wide shot, turned head"
              />
            </div>
          </div>

          <Alert class="mt-3" type="info" show-icon>
            <template #message>提交时实际会拼成</template>
            <template #description>
              <ul class="m-0 pl-4 text-xs">
                <li v-for="(p, i) in promptPlan" :key="i">{{ p }}</li>
              </ul>
              <div class="mt-1 text-xs">
                剧目风格：
                <template v-if="dramaStyle.positive">
                  <Tag color="green">已配置</Tag>{{ dramaStyle.positive }}
                </template>
                <template v-else>
                  <Tag>未配置</Tag>该层会被跳过（不会拼出空段）
                </template>
              </div>
            </template>
          </Alert>

          <div class="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div class="md:col-span-2">
              <div class="mb-1 text-sm">尺寸预设</div>
              <Select
                v-model:value="sceneKey"
                :options="sizePresets"
                style="width: 100%"
              />
              <div v-if="sizeSource" class="mt-1 text-xs text-muted-foreground">
                默认值来自：{{ sizeSource }}
              </div>
            </div>
            <div>
              <div class="mb-1 text-sm">宽</div>
              <InputNumber
                v-model:value="form.width"
                :max="2048"
                :min="256"
                style="width: 100%"
                @change="sceneKey = 'custom'"
              />
            </div>
            <div>
              <div class="mb-1 text-sm">高</div>
              <InputNumber
                v-model:value="form.height"
                :max="2048"
                :min="256"
                style="width: 100%"
                @change="sceneKey = 'custom'"
              />
            </div>
            <div>
              <div class="mb-1 text-sm">生成张数</div>
              <InputNumber
                v-model:value="form.candidateCount"
                :max="8"
                :min="1"
                style="width: 100%"
              />
            </div>
            <div>
              <div class="mb-1 text-sm">种子（留空自动）</div>
              <!--
                用文本输入而非 InputNumber：用户实测可用的 seed 超出 int32，
                且 antd InputNumber 按 JS number 处理，超过 2^53 会静默丢精度。
              -->
              <Input
                v-model:value="form.seed as any"
                placeholder="十进制整数"
                style="width: 100%"
              />
            </div>
            <div class="md:col-span-2">
              <div class="mb-1 text-sm">出图线路</div>
              <AiProviderSelect
                v-model:value="form.providerId"
                task-type="t2i"
              />
            </div>
          </div>
        </Spin>

        <div class="mt-4 flex justify-end">
          <Space>
            <Button @click="close">取消</Button>
            <Button :loading="submitting" type="primary" @click="submit">
              提交生成
            </Button>
          </Space>
        </div>
      </template>
    </template>
  </Modal>
</template>
