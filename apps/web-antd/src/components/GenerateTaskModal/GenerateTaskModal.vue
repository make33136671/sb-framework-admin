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
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';

import {
  Alert,
  Button,
  Descriptions,
  DescriptionsItem,
  Input,
  InputNumber,
  message,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
} from 'ant-design-vue';

import {
  assetGeneratePrompts,
  assetRequirementList,
  assetRequirementSaveDescription,
  assetRequirementSavePrompts,
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

// ───────────────── 角色描述（可改 · 可保存）─────────────────
//
// 用户 2026-10-07 要求：
// > 「在这里我希望看到这个角色的描述信息 可以改 改了之后 显示保存按钮
// >   这个保存是只保存角色描述信息」
//
// `description` 是**库里当前值**，`descDraft` 是编辑中的草稿。
// 分离两者的理由：只有草稿 ≠ 库里值时才显示「保存」按钮，
// 保存成功后把草稿回写为库里值，按钮自动收起 —— 用户一眼能看出"存没存过"。
const description = ref('');
const descDraft = ref('');
const savingDesc = ref(false);

/** 草稿与库中值不一致 → 才显示「保存」 */
const descDirty = computed(
  () => descDraft.value.trim() !== description.value.trim(),
);

// ───────────────── 提示词（第 ③ 层）的保存 ─────────────────
//
// 用户 2026-10-07 报障：
// > 「生成角色提示词…不会保存 重新打开这个页面 提示词又变回去了」
//
// 生成结果原先只活在前端表单里、关掉就丢。现在：
//   · 生成成功后**自动保存**（用户不必再点一次保存）；
//   · 用户手改后显示「保存」按钮，可手动落库。
// 与"角色描述"同样是"库中值 vs 草稿"的对比模型。
const savedPrompt = ref('');
const savedNegative = ref('');
const savingPrompts = ref(false);

/** 提示词被改过（与库中值不同）→ 显示保存按钮 */
const promptsDirty = computed(
  () =>
    form.subjectPrompt.trim() !== savedPrompt.value.trim() ||
    form.subjectNegative.trim() !== savedNegative.value.trim(),
);

// ───────────────── 一键生成提示词（AI 下达 + 实时等待）─────────────────
//
// 用户 2026-10-07 要求：
// > 「然后有 一键生成提示词 也是AI下达任务 并且这里做上实时等待
// >   就是 按钮 点击一次 在按钮内部加一个 loadding 并且问题改成等待中,点击取消」
//
// 实现要点：
//   · 用 AbortController 真正中断 HTTP —— 服务端会因连接断开而停止等待，
//     GPU 不会被白占（这是"取消"该有的语义，不只是前端把转圈藏起来）。
//   · 组件卸载 / 弹窗关闭时**必须** abort，否则请求悬空、
//     且回来时会往已关闭的弹窗里写值。
const generating = ref(false);
let generateAbort: AbortController | null = null;

/** 是否处于"用户主动取消"导致的结束（用于区分取消与失败，不弹错误） */
function isCanceled(err: unknown): boolean {
  const e = err as { code?: string; name?: string };
  return e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED';
}

// 剧本风格提示词（第 2 层）—— 只读展示，让用户知道会自动拼上什么
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
    // 先填**视图模板**（第 ③ 层的默认内容）……
    form.subjectPrompt = ctx.subjectPrompt ?? '';
    form.subjectNegative = ctx.subjectNegative ?? '';
    // 「每视图 1 张」是批量补齐的默认；单视图手动生成也默认 1 张，用户可改
    form.candidateCount = 1;
    form.seed = undefined;
    form.providerId = undefined;
    dramaStyle.value = { positive: null, negative: null };
    description.value = '';
    descDraft.value = '';
    savedPrompt.value = '';
    savedNegative.value = '';

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

      // 角色描述：取该视图所属需求的 description。
      // 用 requirementId 精确命中（而不是按角色名猜）—— 同一角色有 7 个视图需求，
      // 按名字取会拿到"随便哪一个"，用户会看到与当前视图无关的描述。
      const mine = requirements.value.find(
        (r) => r.id === (ctx.requirementId ?? form.refEntityId),
      );
      description.value = mine?.description ?? '';
      descDraft.value = description.value;

      // ……再让**已保存的提示词**覆盖视图模板（有的话）。
      // ⚠️ 顺序不能反：视图 spec 是"从没生成过"时的默认内容，
      //    而库里存的是用户上次生成/手改后的定稿 —— 后者优先。
      //    这正是"重开页面提示词变回去了"的修复点：以前只填 spec，
      //    用户生成的提示词从没被读回来过。
      if (mine?.subjectPrompt) form.subjectPrompt = mine.subjectPrompt;
      if (mine?.subjectNegative) form.subjectNegative = mine.subjectNegative;

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

/**
 * 保存角色描述（**只**保存描述，不动 key/kind/name/spec）。
 *
 * 走 `RequirementSaveDescription` 而不是 `RequirementSave`：
 * 后者会按 name 重算 key，而 key 是视图/候选/任务的关联锚点（详见 api 注释）。
 */
async function saveDescription() {
  const ctx = props.context;
  if (!ctx) return;
  const reqId = ctx.requirementId ?? form.refEntityId;
  if (!reqId) {
    message.warning('该视图没有关联素材需求，无法保存描述');
    return;
  }
  savingDesc.value = true;
  try {
    await assetRequirementSaveDescription({
      id: reqId,
      description: descDraft.value.trim(),
    });
    // 保存成功 → 库中值 = 草稿 → descDirty 自动变 false，按钮收起
    description.value = descDraft.value.trim();
    // 同步到列表缓存，避免下次打开弹窗又读到旧描述
    const mine = requirements.value.find((r) => r.id === reqId);
    if (mine) mine.description = description.value;
  } catch {
    // 拦截器已提示
  } finally {
    savingDesc.value = false;
  }
}

/**
 * 保存第 ③ 层提示词（正向 + 反向）。成功返回 true。
 *
 * 空串照传（= 清空该层）：用户把框删空的意图就是"这层不要"，
 * 若当成"不修改"就永远清不掉（后端也是整值覆盖语义）。
 */
async function savePrompts(): Promise<boolean> {
  const ctx = props.context;
  if (!ctx) return false;
  const reqId = ctx.requirementId ?? form.refEntityId;
  if (!reqId) {
    message.warning('该视图没有关联素材需求，无法保存提示词');
    return false;
  }
  savingPrompts.value = true;
  try {
    await assetRequirementSavePrompts({
      id: reqId,
      subjectPrompt: form.subjectPrompt.trim(),
      subjectNegative: form.subjectNegative.trim(),
    });
    savedPrompt.value = form.subjectPrompt.trim();
    savedNegative.value = form.subjectNegative.trim();
    // 同步列表缓存，避免下次打开又读到旧值
    const mine = requirements.value.find((r) => r.id === reqId);
    if (mine) {
      mine.subjectPrompt = savedPrompt.value;
      mine.subjectNegative = savedNegative.value;
    }
    return true;
  } catch {
    // 拦截器已提示
    return false;
  } finally {
    savingPrompts.value = false;
  }
}

/**
 * 一键生成提示词：正向走 PE-T2I（真机），反向走规则推导。
 *
 * 生成结果**只回填输入框**，不自动出图 —— 用户可以先改再点「提交生成」
 * （用户 2026-10-07 确认："只回填到输入框，不自动出图"）。
 */
async function generatePrompts() {
  const ctx = props.context;
  if (!ctx) return;
  const reqId = ctx.requirementId ?? form.refEntityId;
  if (!reqId) {
    message.warning('该视图没有关联素材需求，无法生成提示词');
    return;
  }

  generateAbort?.abort();
  const ac = new AbortController();
  generateAbort = ac;
  generating.value = true;

  try {
    const r = await assetGeneratePrompts(
      {
        requirementId: reqId,
        // 传**未保存**的草稿：用户改完描述直接点生成，应当立刻用上新描述，
        // 不该被"还没点保存"挡住（否则用户会以为改了没用）。
        brief: descDraft.value.trim() || null,
        // 视图构图约束（纯灰底 + 无场景）：不传模型会自造背景，
        // 而 7 视图必须是无背景立绘（用户 2026-10-07 报障）。
        // 用 ctx.subjectPrompt 的**原始视图 spec**，而不是 form.subjectPrompt ——
        // 后者可能已被上次生成的英文描述覆盖，用它当约束就自我循环了。
        viewPrompt: ctx.subjectPrompt ?? null,
        // 视图专有反向约束（如 "full body, wide shot"）附在规则反向词之后
        viewNegative: form.subjectNegative.trim() || null,
      },
      { signal: ac.signal },
    );

    if (r.positivePrompt) {
      form.subjectPrompt = r.positivePrompt;
    }
    if (r.negativePrompt) {
      form.subjectNegative = r.negativePrompt;
    }

    if (r.positiveError) {
      // 反向是纯规则、算得出来；正向失败时明确告知，别让用户以为"生成了"却缺一半
      message.warning(`反向提示词已生成；正向未生成：${r.positiveError}`);
    } else if (r.whRatio) {
      message.success(`提示词已生成（建议画幅 ${r.whRatio}）`);
    } else {
      message.success('提示词已生成');
    }

    // 生成成功即**自动落库** —— 这是"重开页面又变回去"的修复关键。
    // 放在 message 之后：先让用户看到生成成功，保存失败再单独提示，
    // 不会因为保存问题把"其实已经生成出来了"这件事盖掉。
    const ok = await savePrompts();
    if (!ok) {
      message.warning(
        '提示词已生成，但**保存失败** —— 关闭窗口后会丢失，请重试保存',
      );
    }
  } catch (err) {
    if (isCanceled(err)) {
      // 用户主动取消 —— 这不是失败，不该弹红色错误
      message.info('已取消生成');
    } else {
      message.error(`提示词生成失败：${(err as Error)?.message || '未知错误'}`);
    }
  } finally {
    generating.value = false;
    if (generateAbort === ac) generateAbort = null;
  }
}

/** 取消等待（再点一次「等待中，点击取消」触发） */
function cancelGenerate() {
  generateAbort?.abort();
}

// 弹窗关闭 / 组件卸载时必须中断：
// 否则请求悬空，且回来后会往已关闭的弹窗写值。
onBeforeUnmount(() => generateAbort?.abort());
watch(
  () => props.context,
  (ctx, prev) => {
    if (prev && !ctx) generateAbort?.abort();
  },
);

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
              <div class="mb-1 flex items-center justify-between">
                <span class="text-sm">
                  角色描述
                  <span class="text-xs text-muted-foreground">
                    （提示词生成的事实源，可改）
                  </span>
                </span>
                <!-- 只有改过才显示「保存」：一眼看出存没存过 -->
                <Button
                  v-if="descDirty"
                  :loading="savingDesc"
                  size="small"
                  type="primary"
                  @click="saveDescription"
                >
                  保存
                </Button>
                <span v-else class="text-xs text-muted-foreground">
                  已保存
                </span>
              </div>
              <Input.TextArea
                v-model:value="descDraft"
                :rows="4"
                placeholder="如：女性，25岁，身高约165cm，纤细匀称；肤色白皙……"
              />
              <div class="mt-1 text-xs text-muted-foreground">
                「保存」只更新这段描述，不会改动角色名 / 视图结构。
              </div>
            </div>

            <!-- 一键生成提示词：正向走 PE-T2I 真机，反向走规则推导 -->
            <div class="col-span-2">
              <Button
                v-if="!generating"
                :disabled="false"
                block
                type="dashed"
                @click="generatePrompts"
              >
                一键生成提示词（AI 下达 · 正向 + 反向）
              </Button>
              <!--
                等待态按用户要求做成"按钮内 loading + 文案改成等待中,点击取消"：
                同一个按钮再点一次即取消，不需要额外的取消按钮。
              -->
              <Button
                v-else
                block
                danger
                loading
                type="default"
                @click="cancelGenerate"
              >
                等待中，点击取消
              </Button>
              <div class="mt-1 text-xs text-muted-foreground">
                正向由 110 ComfyUI 上的 PE-T2I 生成（约 1 分钟，首次更久）；
                反向按角色描述规则推导。生成后可直接修改再提交。
              </div>
            </div>

            <div class="col-span-2">
              <div class="mb-1 flex items-center justify-between">
                <span class="text-sm">
                  角色 / 视图特有提示词（第 ③ 层，自动叠加到前两层之上）
                </span>
                <!-- 生成后自动保存过；只有用户手改过才需要再点保存 -->
                <Button
                  v-if="promptsDirty"
                  :loading="savingPrompts"
                  size="small"
                  type="primary"
                  @click="savePrompts"
                >
                  保存
                </Button>
                <span v-else class="text-xs text-muted-foreground">
                  已保存
                </span>
              </div>
              <Input.TextArea
                v-model:value="form.subjectPrompt"
                :rows="5"
                placeholder="如：head-and-shoulders portrait, facing camera directly, plain light gray background (#F0F0F0)"
              />
            </div>

            <div class="col-span-2">
              <div class="mb-1 text-sm">角色 / 视图特有反向提示词</div>
              <Input.TextArea
                v-model:value="form.subjectNegative"
                :rows="3"
                placeholder="如：full body, wide shot, turned head"
              />
              <div class="mt-1 text-xs text-muted-foreground">
                提示词会随本视图保存，下次打开自动带回（无需重新生成）。
              </div>
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
