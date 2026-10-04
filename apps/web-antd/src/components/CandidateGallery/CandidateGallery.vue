<script lang="ts" setup>
import type { AssetCandidateItem, ReasonItem } from '#/api/core/dramafloow';

/**
 * CandidateGallery —— 候选图对比 + 通过/丢弃（契约 §5.1 Review/Asset）
 *
 * 键盘流（契约 §8）：1/2/3 选中第 N 个候选、A 通过、R 丢弃。
 * 图片走 /storage 反代（vite dev 已代理到后端 media_root）。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';

import {
  Button,
  Empty,
  Image,
  Input,
  Modal,
  Select,
  Space,
  Tag,
} from 'ant-design-vue';

import {
  assetApprove,
  assetReject,
  assetToLibrary,
} from '#/api/core/dramafloow';
import { toStorageUrl } from '#/utils/media';

interface Props {
  candidates: AssetCandidateItem[];
  reasons: ReasonItem[];
  /** 是否允许通过/丢弃（需求已通过时可只读查看） */
  readonly?: boolean;
  /** 是否显示键盘提示 */
  showKeyboardHint?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  readonly: false,
  showKeyboardHint: true,
});

const emit = defineEmits<{
  (e: 'changed'): void;
  /**
   * 「用这个种子再生成」（用户要求：「下次想生成相同的图 还可以沿用以前的种子 保证风格统一」）。
   *
   * 组件**不自己跳转**：它不知道自己在哪个上下文里被用（素材详情 / 审核队列），
   * 由调用方决定跳去下发页还是就地重生成。这里只把选中的候选上报。
   */
  (e: 'reuseSeed', candidate: AssetCandidateItem): void;
}>();

const selectedIndex = ref(0);
const rejectOpen = ref(false);
const rejectReasonId = ref<number | undefined>(undefined);
const rejectNote = ref('');
const submitting = ref(false);

/**
 * 排序后的候选（用户要求：「待审核的候选图 排在最前面」）。
 *
 * 为什么在**组件内**排序而不是改数据源：调用方（素材详情、审核队列）传进来的顺序
 * 有各自语义（审核队列按任务/时间组织），不该被本组件的展示偏好改写。
 *
 * 排序键（稳定，同级保持原相对顺序 —— `toSorted` 保证稳定性）：
 *   1. **待审 pending 最前** ← 用户诉求：待处理的一眼就能看到、能直接操作
 *   2. 已通过 approved（已定稿，通常只有一张，放中间便于对照）
 *   3. 生成失败 failed（无图可看，价值低）
 *   4. 已丢弃 rejected 最后
 *
 * ⚠️ `selectedIndex` 索引的是**这个排好序的数组**，不是 props 原数组 ——
 * 所以下面所有取候选的地方都必须走 `sortedCandidates`，混用会"点这张选中那张"。
 */
const sortedCandidates = computed(() => {
  const rank = (s: string) =>
    s === 'pending'
      ? 0
      : s === 'approved'
        ? 1
        : s === 'failed'
          ? 2
          : s === 'rejected'
            ? 3
            : 4; // 未知状态排最后，不抢占待审的位置
  return props.candidates.toSorted((a, b) => rank(a.status) - rank(b.status));
});

/** 待审数量（给调用方/文案用，也便于界面提示"还有 N 张待处理"） */
const pendingCount = computed(
  () => props.candidates.filter((c) => c.status === 'pending').length,
);

const selected = computed(() => sortedCandidates.value[selectedIndex.value]);

/** 单张候选图的可访问 URL（统一走 utils/media，兼容 media_root 变更） */
const imageUrl = (filePath?: string): string => toStorageUrl(filePath);

function select(i: number) {
  if (i < 0 || i >= sortedCandidates.value.length) return;
  selectedIndex.value = i;
}

async function approve() {
  const c = selected.value;
  if (!c || props.readonly) return;
  await approveOne(c);
}

/** 通过**指定的那一张**（供「图下按钮」直接调用，不必先点选）。
 *
 *  为什么参数是"候选"而不是复用"当前选中"：要让每张图下面的按钮**操作它自己**。
 *  否则用户点第 3 张图下的「通过」，实际通过的却是"当前选中"的另一张，
 *  且没有任何提示 —— 这类「操作错对象」比直接报错更糟（用户以为通过了 A，实际通过的是 B）。 */
async function approveOne(c: AssetCandidateItem) {
  if (props.readonly || submitting.value) return;
  submitting.value = true;
  try {
    await assetApprove(c.id);
    emit('changed');
  } finally {
    submitting.value = false;
  }
}

function openReject() {
  const c = selected.value;
  if (!c || props.readonly) return;
  openRejectFor(c);
}

/** 待丢弃的候选（`confirmReject` 用它，保证「哪张图的按钮丢哪张」）。
 *  键盘流 R 走 selected，鼠标点图下按钮走这里，两条路径都不串。 */
const rejectTarget = ref<AssetCandidateItem | null>(null);

/** 打开丢弃弹窗（针对指定候选） */
function openRejectFor(c: AssetCandidateItem) {
  if (props.readonly || submitting.value) return;
  rejectTarget.value = c;
  rejectReasonId.value = props.reasons[0]?.id;
  rejectNote.value = '';
  rejectOpen.value = true;
}

async function confirmReject() {
  // 优先用「图下按钮点的那张」，回退到"当前选中"（键盘流走的是后者）
  const c = rejectTarget.value ?? selected.value;
  if (!c || props.readonly) return;
  submitting.value = true;
  try {
    // reasonId 可为空（用户明确要求「丢弃 但是 原因并不是必填项」）——
    // 快速丢掉明显废图不该被强制先选原因。
    await assetReject(
      c.id,
      rejectReasonId.value ?? null,
      rejectNote.value || undefined,
    );
    rejectOpen.value = false;
    rejectTarget.value = null;
    emit('changed');
  } finally {
    submitting.value = false;
  }
}

async function toLibrary() {
  const c = selected.value;
  if (!c) return;
  await assetToLibrary(c.id);
  emit('changed');
}

function onKeydown(e: KeyboardEvent) {
  // 输入框内不劫持按键
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  switch (e.key) {
    case '1': {
      select(0);
      break;
    }
    case '2': {
      select(1);
      break;
    }
    case '3': {
      select(2);
      break;
    }
    default: {
      if (e.key.toLowerCase() === 'a') void approve();
      else if (e.key.toLowerCase() === 'r') openReject();
    }
  }
}

onMounted(() => {
  if (!props.readonly) window.addEventListener('keydown', onKeydown);
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div v-if="sortedCandidates.length === 0">
    <Empty description="暂无候选（可点击「生成」入队 t2i 任务）" />
  </div>

  <div v-else class="flex flex-col gap-3">
    <!-- 待处理提示：排序把待审排到最前，这里说明"前面这几张是要你处理的" -->
    <div v-if="pendingCount > 0" class="text-xs text-muted-foreground">
      待审核 {{ pendingCount }} 张（已排在最前，可直接在图下通过 / 丢弃）
    </div>

    <!-- 候选缩略图一行 -->
    <div class="flex flex-wrap items-start gap-3">
      <div
        v-for="(c, i) in sortedCandidates"
        :key="c.id"
        class="cursor-pointer rounded-md border p-1 transition-all"
        :class="
          i === selectedIndex
            ? 'border-primary ring-2 ring-primary/40'
            : 'border-border hover:border-primary/50'
        "
        @click="select(i)"
      >
        <Image
          :src="imageUrl(c.filePath)"
          :width="150"
          :height="150"
          class="rounded object-cover"
          :preview="{ src: imageUrl(c.filePath) }"
        />
        <div class="mt-1 flex items-center justify-between gap-2 text-xs">
          <span>#{{ c.variantNo + 1 }}</span>
          <Tag
            :color="
              c.status === 'approved'
                ? 'success'
                : c.status === 'rejected'
                  ? 'error'
                  : c.status === 'failed'
                    ? 'default'
                    : 'warning'
            "
            class="!mr-0"
          >
            {{
              c.status === 'approved'
                ? '已通过'
                : c.status === 'rejected'
                  ? '已丢弃'
                  : c.status === 'failed'
                    ? '生成失败'
                    : '待审'
            }}
          </Tag>
        </div>

        <!-- 图下直接操作（用户要求：「待审核的素材 直接把 通过和丢弃的按钮 放在图片下面」）。
             只在**待审**时出现：已通过/已丢弃/生成失败的图再点没有意义，
             放着一排无效按钮反而让用户以为还能改。
             按钮操作的是**本张**（传 c），不是"当前选中"，避免操作错对象。 -->
        <div
          v-if="!readonly && c.status === 'pending'"
          class="mt-1 flex items-center gap-1"
          @click.stop
        >
          <Button
            :disabled="submitting"
            block
            size="small"
            type="primary"
            @click="approveOne(c)"
          >
            通过
          </Button>
          <Button
            :disabled="submitting"
            block
            danger
            size="small"
            @click="openRejectFor(c)"
          >
            丢弃
          </Button>
        </div>
      </div>
    </div>

    <!-- 选中候选详情 + 操作 -->
    <div v-if="selected" class="rounded-md border border-border p-3">
      <div
        class="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
      >
        <span
          >seed {{ selected.seed }} · {{ selected.width }}×{{
            selected.height
          }}</span
        >
        <!--
          「沿用此种子再生成」：用户要求「下次想生成相同的图 还可以沿用以前的种子 保证风格统一」。
          后端已修好「传入的 seed 被静默忽略」的缺陷，传了就会真的用这个种子。
        -->
        <Button size="small" @click="emit('reuseSeed', selected)">
          沿用此种子再生成
        </Button>
        <template v-if="selected.rejectNote">
          <span>· 丢弃备注：{{ selected.rejectNote }}</span>
        </template>
      </div>
      <div class="mb-3 break-all text-xs">{{ selected.prompt }}</div>

      <Space v-if="!readonly">
        <Button type="primary" :loading="submitting" @click="approve">
          通过<template v-if="showKeyboardHint">（A）</template>
        </Button>
        <Button danger :disabled="submitting" @click="openReject">
          丢弃<template v-if="showKeyboardHint">（R）</template>
        </Button>
        <Button
          v-if="selected.status === 'approved'"
          :disabled="submitting"
          @click="toLibrary"
        >
          入库
        </Button>
      </Space>

      <div
        v-if="showKeyboardHint && !readonly"
        class="mt-2 text-xs text-muted-foreground"
      >
        快捷键：1 / 2 / 3 切换候选，A 通过，R 丢弃
      </div>
    </div>

    <!-- 丢弃弹窗（原因非必填 —— 用户明确要求；但要说明填了有用） -->
    <Modal
      v-model:open="rejectOpen"
      title="丢弃该候选"
      :confirm-loading="submitting"
      @ok="confirmReject"
    >
      <div class="flex flex-col gap-3">
        <div>
          <div class="mb-1 text-sm">
            原因
            <span class="text-muted-foreground">（可选）</span>
          </div>
          <Select
            v-model:value="rejectReasonId"
            allow-clear
            class="w-full"
            placeholder="不选也行；选了能让下一版重生成更准"
            :options="
              reasons.map((r) => ({
                label: `${r.name}${r.fixHint ? ` — ${r.fixHint}` : ''}`,
                value: r.id,
              }))
            "
          />
          <div class="mt-1 text-xs text-muted-foreground">
            填了原因，重生成时会把「上次为什么被否」告诉
            AI（fix_hint），出图更对路。
          </div>
        </div>
        <div>
          <div class="mb-1 text-sm">补充备注（可选）</div>
          <Input.TextArea v-model:value="rejectNote" :rows="3" />
        </div>
      </div>
    </Modal>
  </div>
</template>
