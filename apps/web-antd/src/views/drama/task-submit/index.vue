<script lang="ts" setup>
import type { AssetRequirementItem, DramaItem } from '#/api/core/dramafloow';

/**
 * AI 生成下发 —— **统一入口页面**（用户 2026-10-04 要求）。
 *
 * > 「AI 生成的统一入口 我的想法是一个标准接口 他有固定的输入参数 然后这个统一入口的
 * >  意思是 所有的参数都有默认 调用方传过来的时候 会覆盖这些参数 没覆盖的就随默认走
 * >  就算是没有调用方 我自己新建生成 点开什么也不改 也可以生成」
 *
 * ## 三个必须守住的语义
 *
 * 1. **零必填**（除归属）：所有字段都预填默认值，用户点开直接提交就能出图。
 *    归属（剧目）是唯一必须选的 —— 后端要靠它把产物挂回素材需求，否则图生成了也不知道给谁。
 *
 * 2. **跳转 ≠ 提交**：从角色视图「去生成」跳过来只**预填参数**，
 *    用户点「提交」才真正建任务；中途关掉页面 = 什么都没发生（用户明确要求）。
 *
 * 3. **提示词分层要可见**：从角色视图跳来时，正向框里填的是**视图特有那段**（第 3 层），
 *    前两层（工作流默认 / 剧目风格）由后端自动补齐，并在页面上**显式告知** ——
 *    否则用户会以为"我看到的这条就是最终提示词"，而实际还会拼上两段他没看见的内容。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';

import {
  Alert,
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Input,
  InputNumber,
  message,
  Result,
  Select,
  Space,
  Tag,
} from 'ant-design-vue';

import {
  assetRequirementList,
  dramaGet,
  dramaList,
  taskSizes,
  taskSubmit,
} from '#/api/core/dramafloow';
import { AiProviderSelect } from '#/components/AiProviderSelect';

const route = useRoute();
const router = useRouter();

/** 提交表单：**每个字段都有默认值**（"什么都不改也能生成"）。
 *
 * ⚠️ 可空的选项字段一律用 `undefined` 而非 `null`：antd 的 Select/InputNumber
 * 不接受 `null` 作为绑定值（类型上是 SelectValue / ValueType），
 * 传 null 会在编译期报错、运行期表现为"清不掉选项"。
 */
const form = reactive({
  dramaId: undefined as number | undefined,
  /** 归属的素材需求（选了才会把产物挂回该视图） */
  refEntityId: undefined as number | undefined,
  /** 第 3 层：角色/视图特有的正向约束 */
  subjectPrompt: '',
  /** 第 3 层反向 */
  subjectNegative: '',
  /** 显式覆盖正向（非空则跳过三层拼装） */
  prompt: '',
  /** 显式覆盖反向 */
  negativePrompt: '',
  candidateCount: 3,
  width: 320,
  height: 320,
  seed: undefined as string | undefined,
  providerId: undefined as number | undefined,
});

/** 从角色视图跳来时带过来的视图信息（用于页面提示，不参与提交） */
const fromView = reactive({
  active: false,
  viewLabel: '',
  characterName: '',
  requirementKey: '',
});

const dramas = ref<DramaItem[]>([]);
const requirements = ref<AssetRequirementItem[]>([]);
const loadingDramas = ref(false);
const loadingReqs = ref(false);
const submitting = ref(false);
const result = ref<null | {
  layers: string;
  negativePrompt: string;
  positivePrompt: string;
  taskId: number;
  usedFallbackNegative: boolean;
  usedFallbackPositive: boolean;
  version: number;
}>(null);

/** 当前剧目的风格提示词（第 2 层）—— 只读展示，让用户知道会自动拼上什么 */
const dramaStyle = ref<{ negative: null | string; positive: null | string }>({
  positive: null,
  negative: null,
});

const sceneOptions = [
  // 小图置顶并作为**兜底默认**（真正的默认值来自后端系统设置，见 loadSizes）。
  // 小尺寸出图快、省显存，适合调提示词/试种子的迭代阶段。
  { label: '小图 320×320', value: '320x320' },
  { label: '小图竖版 320×560（全身立姿）', value: '320x560' },
  { label: '正方形 1024×1024', value: '1024x1024' },
  { label: '竖版 768×1344（全身立姿）', value: '768x1344' },
  { label: '横版 1344×768（场景）', value: '1344x768' },
  { label: '自定义', value: 'custom' },
];

const sceneKey = ref('320x320');

/**
 * 载入**当前生效**的生图尺寸（后端按「视图覆盖 → 通用默认 → 代码兜底」解析）。
 *
 * 为什么要问后端、不在前端写死：用户要求「数值不是写死 是数据库」「我随时能在系统设置里改」。
 * 前端若自己定默认值，用户在设置页改完下发页不会变 —— 且不会报错。
 */
const sizeSource = ref('');

async function loadSizes() {
  try {
    const s = await taskSizes();
    form.width = s.defaultWidth;
    form.height = s.defaultHeight;
    sizeSource.value = s.defaultSource;
    sceneKey.value = `${s.defaultWidth}x${s.defaultHeight}`;
  } catch {
    // 拦截器已提示；保持内置兜底值，不阻塞页面
  }
}

watch(sceneKey, (k) => {
  if (k === 'custom') return;
  const [w, h] = k.split('x').map(Number);
  if (w && h) {
    form.width = w;
    form.height = h;
    sizeSource.value = '';
  }
});

/** 选了剧目 → 载入它的素材需求（供归属选择）与风格提示词（第 2 层） */
watch(
  () => form.dramaId,
  async (id) => {
    form.refEntityId = undefined;
    requirements.value = [];
    dramaStyle.value = { positive: null, negative: null };
    if (!id) return;

    loadingReqs.value = true;
    try {
      const [reqs, detail] = await Promise.all([
        assetRequirementList({ dramaId: id, pageSize: 500 }),
        dramaGet(id),
      ]);
      // 只列角色/场景/道具需求（文本类需求不产图）
      requirements.value = reqs.items.filter((r) => r.kind !== 'text');
      const d = detail.drama as unknown as {
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
);

const requirementOptions = computed(() =>
  requirements.value.map((r) => ({
    label: `${r.key}${r.spec ? '' : '（无规格）'}`,
    value: r.id,
  })),
);

async function loadDramas() {
  loadingDramas.value = true;
  try {
    const res = await dramaList({ page: 1, pageSize: 200 });
    dramas.value = res.items;
  } catch {
    // 拦截器已提示
  } finally {
    loadingDramas.value = false;
  }
}

/**
 * 应用路由上带来的预填参数（来自角色视图的「去生成」）。
 *
 * ⚠️ 这里**只填表单，不提交** —— 用户点提交才建任务。
 */
async function applyRouteParams() {
  const q = route.query;
  const dramaId = q.dramaId ? Number(q.dramaId) : null;
  if (!dramaId) return;

  form.dramaId = dramaId;
  // 等需求列表载入后才能选中归属
  const refId = q.refEntityId ? Number(q.refEntityId) : null;
  if (refId) {
    // watch(dramaId) 是异步的，轮询等它就绪（最多 ~1.5s）
    for (let i = 0; i < 30; i++) {
      if (requirements.value.some((r) => r.id === refId)) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    form.refEntityId = refId;
  }

  if (q.subjectPrompt) form.subjectPrompt = String(q.subjectPrompt);
  if (q.subjectNegative) form.subjectNegative = String(q.subjectNegative);
  if (q.width) form.width = Number(q.width);
  if (q.height) form.height = Number(q.height);
  if (q.candidateCount) form.candidateCount = Number(q.candidateCount);
  // 「沿用此种子再生成」带过来的种子 —— 传了后端就**真的**用它（历史缺陷已修）
  if (q.seed) form.seed = String(q.seed); // 字符串原样带过来，不转 Number（避免超 2^53 丢精度）

  fromView.active = true;
  fromView.viewLabel = q.viewLabel ? String(q.viewLabel) : '';
  fromView.characterName = q.characterName ? String(q.characterName) : '';
  fromView.requirementKey = q.requirementKey ? String(q.requirementKey) : '';
}

onMounted(async () => {
  // 先取系统设置里的生效尺寸，再应用路由带来的覆盖（后者优先级更高）
  await loadSizes();
  await loadDramas();
  await applyRouteParams();
});

/** 最终正向提示词的构成预览（前端只做说明，实际拼装以后端为准） */
const promptPlan = computed(() => {
  const parts: string[] = [];
  if (form.prompt.trim()) {
    parts.push('调用方指定（跳过自动拼装）');
  } else {
    parts.push('① 工作流默认（后端按所选工作流自动取）');
    if (dramaStyle.value.positive) parts.push('② 剧目风格（已配置）');
    else parts.push('② 剧目风格（未配置，将跳过）');
    if (form.subjectPrompt.trim()) parts.push('③ 角色/视图特有（已填写）');
    else parts.push('③ 角色/视图特有（未填写，将跳过）');
  }
  return parts;
});

async function submit() {
  if (!form.dramaId) {
    message.warning('请先选择剧目');
    return;
  }
  submitting.value = true;
  try {
    result.value = await taskSubmit({
      dramaId: form.dramaId,
      type: 't2i',
      refEntityType: form.refEntityId ? 'asset_requirement' : null,
      refEntityId: form.refEntityId ?? null,
      // 传了 prompt 就是显式覆盖；没传则后端按三层拼装
      prompt: form.prompt.trim() || null,
      negativePrompt: form.negativePrompt.trim() || null,
      subjectPrompt: form.subjectPrompt.trim() || null,
      subjectNegative: form.subjectNegative.trim() || null,
      candidateCount: form.candidateCount,
      width: form.width,
      height: form.height,
      seed: form.seed ?? null,
      providerId: form.providerId ?? null,
    });
  } catch {
    // 拦截器已提示
  } finally {
    submitting.value = false;
  }
}

function resetForAnother() {
  result.value = null;
}
</script>

<template>
  <Page
    title="AI 生成下发"
    description="统一生成入口：所有参数都有默认，什么都不改也能提交"
  >
    <!-- 提交成功后的回执 -->
    <Card v-if="result" class="mb-3">
      <Result
        status="success"
        :title="`任务已入队（task ${result.taskId} / v${result.version}）`"
      >
        <template #subTitle>
          <span class="text-xs">
            提示词构成：{{ result.layers }}
            <template v-if="result.usedFallbackPositive"
              >（正向落到了内置兜底）</template
            >
          </span>
        </template>
        <template #extra>
          <Space>
            <Button type="primary" @click="resetForAnother">再下发一个</Button>
            <Button @click="router.push({ name: 'DramaTaskList' })">
              去任务列表
            </Button>
          </Space>
        </template>
        <Descriptions :column="1" bordered size="small">
          <DescriptionsItem label="实际正向提示词">
            <div class="break-all text-xs">{{ result.positivePrompt }}</div>
          </DescriptionsItem>
          <DescriptionsItem label="实际反向提示词">
            <div class="break-all text-xs">{{ result.negativePrompt }}</div>
          </DescriptionsItem>
        </Descriptions>
      </Result>
    </Card>

    <template v-else>
      <!-- 从角色视图跳来的提示：让用户知道"这些是自动带过来的" -->
      <Alert v-if="fromView.active" class="mb-3" show-icon type="info">
        <template #message>
          已从角色视图带入参数：<b>{{ fromView.characterName }}</b> /
          {{ fromView.viewLabel || fromView.requirementKey }}
        </template>
        <template #description>
          <span class="text-xs">
            下面已预填好该视图的提示词与尺寸。<b>点「提交」才会真正下发任务</b>，
            直接关掉本页不会产生任何任务。前两层提示词（工作流默认 /
            剧目风格）提交时由后端自动拼上。
          </span>
        </template>
      </Alert>

      <!-- ① 归属 -->
      <Card class="mb-3" size="small" title="① 归属（决定图归属到哪）">
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <div class="mb-1 text-sm">
              剧目 <span class="text-destructive">*</span>
            </div>
            <Select
              v-model:value="form.dramaId"
              :loading="loadingDramas"
              :options="
                dramas.map((d) => ({
                  label: `${d.name}（${d.code}）`,
                  value: d.id,
                }))
              "
              placeholder="选择剧目"
              show-search
              style="width: 100%"
              :filter-option="
                (input: string, opt: any) => String(opt.label).includes(input)
              "
            />
            <div class="mt-1 text-xs text-muted-foreground">
              唯一必须选的项：没有归属，产物不知道要挂给谁
            </div>
          </div>
          <div>
            <div class="mb-1 text-sm">素材需求（可选，绑回某视图）</div>
            <Select
              v-model:value="form.refEntityId"
              :loading="loadingReqs"
              :options="requirementOptions"
              :disabled="!form.dramaId"
              allow-clear
              placeholder="不选 = 独立任务，出图不挂回任何素材"
              show-search
              style="width: 100%"
            />
            <div class="mt-1 text-xs text-muted-foreground">
              选中后出图会自动成为该需求的候选，可走既有审核/定稿流程
            </div>
          </div>
        </div>
      </Card>

      <!-- ② 提示词 -->
      <Card class="mb-3" size="small" title="② 提示词">
        <div class="mb-3">
          <div class="mb-1 text-sm">
            角色/视图特有提示词（第 ③ 层，自动叠加到前两层之上）
          </div>
          <Input.TextArea
            v-model:value="form.subjectPrompt"
            :rows="3"
            placeholder="如：head-and-shoulders portrait, facing camera directly, plain light gray background (#F0F0F0)"
          />
        </div>
        <div class="mb-3">
          <div class="mb-1 text-sm">角色/视图特有反向提示词</div>
          <Input.TextArea
            v-model:value="form.subjectNegative"
            :rows="2"
            placeholder="如：full body, wide shot, turned head"
          />
        </div>

        <Alert class="mb-3" type="info" show-icon>
          <template #message>提交时实际会拼成（加粗部分由后端自动补）</template>
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

        <div class="mb-3">
          <div class="mb-1 text-sm">
            显式覆盖正向（填了就<b>只用它</b>，不再自动拼三层）
          </div>
          <Input.TextArea
            v-model:value="form.prompt"
            :rows="3"
            placeholder="留空 = 走上面的三层自动拼装"
          />
        </div>
        <div>
          <div class="mb-1 text-sm">显式覆盖反向（填了只用它）</div>
          <Input.TextArea
            v-model:value="form.negativePrompt"
            :rows="2"
            placeholder="留空 = 自动拼装"
          />
        </div>
      </Card>

      <!-- ③ 出图参数 -->
      <Card class="mb-3" size="small" title="③ 出图参数">
        <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div>
            <div class="mb-1 text-sm">尺寸预设</div>
            <Select
              v-model:value="sceneKey"
              :options="sceneOptions"
              style="width: 100%"
            />
            <!-- 回显默认值来自哪一级（视图设置 / 通用默认 / 代码兜底）：
                 用户在系统设置里改了值却"没看到生效"时，这里能直接看出原因 -->
            <div v-if="sizeSource" class="mt-1 text-xs text-muted-foreground">
              默认值来自系统设置：{{ sizeSource }}
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
              用文本输入而非 InputNumber：用户实测可用的 seed（如 593103825222986）
              超出 int32；且 antd InputNumber 内部按 JS number 处理，**超过 2^53 会静默丢精度** ——
              表现为"我填的种子"与"实际用的种子"不一致，且没有任何提示。
              字符串输入逐字传后端（后端 Seeds 只接受十进制非负整数，超范围明确报错）。
            -->
            <Input
              v-model:value="form.seed as any"
              placeholder="十进制整数，如 593103825222986"
              style="width: 100%"
            />
          </div>
          <div class="md:col-span-2">
            <div class="mb-1 text-sm">出图线路</div>
            <AiProviderSelect v-model:value="form.providerId" task-type="t2i" />
          </div>
        </div>
      </Card>

      <div class="flex justify-end gap-2">
        <Button :loading="submitting" type="primary" @click="submit">
          提交生成
        </Button>
      </div>
    </template>
  </Page>
</template>
