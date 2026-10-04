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
}>();

const selectedIndex = ref(0);
const rejectOpen = ref(false);
const rejectReasonId = ref<number | undefined>(undefined);
const rejectNote = ref('');
const submitting = ref(false);

const selected = computed(() => props.candidates[selectedIndex.value]);

/** 单张候选图的可访问 URL（统一走 utils/media，兼容 media_root 变更） */
const imageUrl = (filePath?: string): string => toStorageUrl(filePath);

function select(i: number) {
  if (i < 0 || i >= props.candidates.length) return;
  selectedIndex.value = i;
}

async function approve() {
  const c = selected.value;
  if (!c || props.readonly) return;
  submitting.value = true;
  try {
    await assetApprove(c.id);
    emit('changed');
  } finally {
    submitting.value = false;
  }
}

function openReject() {
  if (!selected.value || props.readonly) return;
  rejectReasonId.value = props.reasons[0]?.id;
  rejectNote.value = '';
  rejectOpen.value = true;
}

async function confirmReject() {
  const c = selected.value;
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
  <div v-if="candidates.length === 0">
    <Empty description="暂无候选（可点击「生成」入队 t2i 任务）" />
  </div>

  <div v-else class="flex flex-col gap-3">
    <!-- 候选缩略图一行 -->
    <div class="flex flex-wrap items-start gap-3">
      <div
        v-for="(c, i) in candidates"
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
      </div>
    </div>

    <!-- 选中候选详情 + 操作 -->
    <div v-if="selected" class="rounded-md border border-border p-3">
      <div class="mb-2 text-xs text-muted-foreground">
        seed {{ selected.seed }} · {{ selected.width }}×{{ selected.height }}
        <template v-if="selected.rejectNote">
          · 丢弃备注：{{ selected.rejectNote }}
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
