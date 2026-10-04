<script lang="ts" setup>
import type { TaskPreview, TaskPreviewSlot } from '#/api/core/dramafloow';

/**
 * TaskPreviewPanel —— 任务详情「产物预览」（用户诉求原文：
 * 「能看到预览面板，已经产出的产物 和 正在等待的，要有个占位符的等待图标」）。
 *
 * 三条设计原则（都是需求里点名的）：
 *
 * ① **按「预期产物」铺格，不是只列已有文件**。
 *    后端 preview.expectedCount 给出本任务应有几格（t2i = candidate_count，i2v = 1）。
 *    只列已产出的文件，用户看到的是「3 个格子里的 1 个」，会以为系统漏了 2 个；
 *    铺满预期格、缺的格子显示等待占位符，才是真实状态（「还差几格、每格在等什么」）。
 *
 * ② **等待 ≠ 失败 ≠ 没有**，三种未产出状态的图标/文案必须区分开：
 *    · 等待中（排队 / 生成中 / 等前置候选）→ **转圈占位符**（本组件的主视觉）
 *    · 已失败 → 红色感叹号（不要继续转，否则用户会一直等一个不会来的产物）
 *    · 任务已停止且该格没产出 → 灰色问号 + 「查看日志定位原因」
 *
 * ③ **等待原因用人话**：后端 waitReason 已把「ComfyUI 队列前还有 2 个」拼好，
 *    组件直接展示，不在前端重新猜。
 *
 * 颜色全部走主题 token（hsl(var(--*))），不硬编码；prefers-reduced-motion 下转圈动画由
 * 全局样式关闭。
 */
import { computed, ref } from 'vue';

import { Empty, Image, Tag, Tooltip } from 'ant-design-vue';

import { enumText } from '#/composables/useEnumText';
import { toStorageUrl } from '#/utils/media';

const props = defineProps<{
  loading?: boolean;
  preview: null | TaskPreview | undefined;
}>();

const preview = computed(() => props.preview ?? null);
const slots = computed<TaskPreviewSlot[]>(() => preview.value?.slots ?? []);

/** 面板是否仍在等待（决定是否显示动态转圈）；后端算好，前端不重复判断 */
const waiting = computed(() => preview.value?.waiting === true);

/** 媒体是图还是视频（决定用 Image 还是 <video>） */
const mediaKind = computed(() => preview.value?.mediaKind ?? 'none');

/** 展开的提示词格子（key = variantNo）；点「提示词」就地展开，不弹窗打断 */
const openPrompt = ref<Record<number, boolean>>({});
function togglePrompt(variantNo: number) {
  openPrompt.value = {
    ...openPrompt.value,
    [variantNo]: !openPrompt.value[variantNo],
  };
}

/** 一格的等待图标语义：waiting = 转圈 / failed = 叹号 / idle = 灰问号 */
type SlotState = 'done' | 'failed' | 'idle' | 'waiting';

function slotState(s: TaskPreviewSlot): SlotState {
  if (s.filePath) return 'done';
  if (s.status === 'failed') return 'failed';
  // 等待原因里出现「未产出」= 任务已停止且这格没东西 → 不该再转圈
  const w = s.waitReason ?? '';
  if (w.includes('未产出') || w.includes('已失败')) return 'failed';
  if (w.includes('已停止')) return 'idle';
  return 'waiting';
}

function slotError(s: TaskPreviewSlot): string {
  return s.waitReason ?? '未产出';
}

/** 已完成格子的可访问 URL */
function fileUrl(s: TaskPreviewSlot): string {
  return toStorageUrl(s.filePath);
}

/** 工作流的展示标题 */
const workflowTitle = computed(() => {
  const w = preview.value?.workflow;
  if (!w) return '';
  return w.name ? `${w.name}（${w.key}）` : w.key;
});

/** 工作流来源徽标颜色：走兜底用 warning（**兜底必须显眼**，不变量 9） */
const workflowTagColor = computed(() =>
  preview.value?.workflow?.isFallback ? 'warning' : 'blue',
);
</script>

<template>
  <div class="df-preview">
    <template v-if="preview && preview.mediaKind !== 'none'">
      <!-- ① 顶部：徽标 + 等待原因（一句话说清「现在卡在哪」） -->
      <div class="df-preview__head">
        <span class="text-sm font-medium">
          产物预览
          <span class="text-muted-foreground">
            {{ preview.doneCount }} / {{ preview.expectedCount }}
          </span>
        </span>
        <Tag class="!mr-0" :color="waiting ? 'processing' : 'default'">
          <span v-if="waiting" class="df-wait-dot mr-1"></span>
          {{ waiting ? '生成中' : '已停止' }}
        </Tag>
        <span v-if="preview.waitReason" class="text-xs text-muted-foreground">
          {{ preview.waitReason }}
        </span>
      </div>

      <!-- ② 当前提示词 + 调用的工作流（用户诉求：这两样都要能看到） -->
      <div class="df-preview__meta">
        <div class="df-preview__meta-row">
          <span class="df-preview__meta-label">工作流</span>
          <template v-if="preview.workflow">
            <Tag class="!mr-0" :color="workflowTagColor">
              {{ workflowTitle }}
            </Tag>
            <span class="text-xs text-muted-foreground">
              {{ preview.workflow.sourceText }}
            </span>
          </template>
          <span v-else class="text-xs text-muted-foreground"
            >未解析出工作流</span
          >
        </div>
        <div class="df-preview__meta-row">
          <span class="df-preview__meta-label">当前提示词</span>
          <Tooltip v-if="preview.currentPrompt" :title="preview.currentPrompt">
            <span class="df-preview__prompt">{{ preview.currentPrompt }}</span>
          </Tooltip>
          <span v-else class="text-xs text-muted-foreground">
            尚未生成提示词（任务还没被领取，或提示词生成失败）
          </span>
        </div>
      </div>

      <!-- ③ 产物格子：已产出给图/视频，未产出给**等待占位符** -->
      <div class="df-preview__grid">
        <div
          v-for="s in slots"
          :key="s.variantNo"
          class="df-slot"
          :class="`df-slot--${slotState(s)}`"
        >
          <div class="df-slot__media">
            <!-- 已产出：图片走 /storage 反代；视频用原生 video 控件 -->
            <template v-if="s.filePath">
              <Image
                v-if="mediaKind === 'image'"
                :src="fileUrl(s)"
                :alt="`候选 ${s.variantNo + 1}`"
                class="df-slot__img"
              />
              <video
                v-else
                :src="fileUrl(s)"
                class="df-slot__img"
                controls
                preload="metadata"
              ></video>
            </template>

            <!-- 未产出：等待占位符（转圈 / 叹号 / 灰问号） -->
            <div v-else class="df-slot__placeholder">
              <span
                v-if="slotState(s) === 'waiting'"
                class="df-slot__spinner"
              ></span>
              <span
                v-else-if="slotState(s) === 'failed'"
                class="df-slot__glyph df-slot__glyph--failed"
                >!</span
              >
              <span v-else class="df-slot__glyph df-slot__glyph--idle">?</span>
              <span class="df-slot__reason">{{ slotError(s) }}</span>
            </div>
          </div>

          <!-- 格子脚注：变体号 · seed/尺寸 · 该格提示词（就地展开） -->
          <div class="df-slot__foot">
            <span class="text-xs">
              候选 {{ s.variantNo + 1 }}
              <Tag
                v-if="s.status"
                class="!mr-0 ml-1"
                :color="
                  s.status === 'approved'
                    ? 'success'
                    : s.status === 'rejected' || s.status === 'failed'
                      ? 'error'
                      : 'default'
                "
              >
                {{ enumText.candidateStatus(s.status) }}
              </Tag>
            </span>
            <span class="flex-1"></span>
            <span
              v-if="s.width && s.height"
              class="text-xs text-muted-foreground"
            >
              {{ s.width }}×{{ s.height }}
            </span>
          </div>
          <div class="df-slot__foot2">
            <span v-if="s.seed" class="text-xs text-muted-foreground">
              seed {{ s.seed }}
            </span>
            <span class="flex-1"></span>
            <a
              v-if="s.prompt"
              class="text-xs"
              @click="togglePrompt(s.variantNo)"
            >
              {{ openPrompt[s.variantNo] ? '收起提示词' : '查看提示词' }}
            </a>
          </div>
          <div
            v-if="openPrompt[s.variantNo] && s.prompt"
            class="df-slot__prompt"
          >
            {{ s.prompt }}
          </div>
        </div>
      </div>
    </template>

    <!-- 文本类任务（洗稿/分析/分集/分镜/素材提取/合并）没有视觉产物 -->
    <Empty
      v-else-if="preview"
      :image="Empty.PRESENTED_IMAGE_SIMPLE"
      :description="preview.waitReason || '该任务类型不产出图片/视频'"
    />

    <Empty
      v-else-if="loading"
      :image="Empty.PRESENTED_IMAGE_SIMPLE"
      description="加载中…"
    />
  </div>
</template>

<style scoped>
.df-preview {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.df-preview__head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

/* 等待原因条：淡背景，区别于正文 */
.df-preview__meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  font-size: 12px;
  background: hsl(var(--muted) / 45%);
  border-radius: 6px;
}

.df-preview__meta-row {
  display: flex;
  gap: 8px;
  align-items: baseline;
  min-width: 0;
}

.df-preview__meta-label {
  flex: 0 0 68px;
  color: hsl(var(--muted-foreground));
}

/* 提示词可能很长：单行截断，完整内容在 Tooltip 里 */
.df-preview__prompt {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.df-preview__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
}

.df-slot {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
}

/* 等待中的格子：左侧强调条 + 虚线边框，一眼区分「还没来」与「已经来了」 */
.df-slot--waiting {
  border-style: dashed;
  border-left: 2px solid hsl(var(--primary));
}

.df-slot--failed {
  border-color: hsl(var(--destructive) / 60%);
  border-left: 2px solid hsl(var(--destructive));
}

.df-slot__media {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  overflow: hidden;
  background: hsl(var(--muted) / 40%);
}

.df-slot__img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.df-slot__placeholder {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  justify-content: center;
  padding: 12px;
  text-align: center;
}

/* 转圈占位符（用户点名的「等待图标」）：只用 border 画，不引图标库 */
.df-slot__spinner {
  width: 26px;
  height: 26px;
  border: 2px solid hsl(var(--muted-foreground) / 25%);
  border-top-color: hsl(var(--primary));
  border-radius: 9999px;
  animation: df-slot-spin 0.9s linear infinite;
}

@keyframes df-slot-spin {
  to {
    transform: rotate(360deg);
  }
}

.df-slot__glyph {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  font-size: 16px;
  font-weight: 700;
  border: 2px solid currentcolor;
  border-radius: 9999px;
}

.df-slot__glyph--failed {
  color: hsl(var(--destructive));
}

.df-slot__glyph--idle {
  color: hsl(var(--muted-foreground));
}

.df-slot__reason {
  font-size: 12px;
  line-height: 1.4;
  color: hsl(var(--muted-foreground));
}

.df-slot__foot,
.df-slot__foot2 {
  display: flex;
  gap: 4px;
  align-items: center;
  padding: 4px 8px 0;
}

.df-slot__foot2 {
  padding: 0 8px 6px;
}

.df-slot__prompt {
  max-height: 110px;
  padding: 6px 8px;
  margin: 0 8px 8px;
  overflow-y: auto;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  background: hsl(var(--muted) / 50%);
  border-radius: 4px;
}

/* 顶部「生成中」徽标里的呼吸点（与 df-live-dot 同视觉语言） */
.df-wait-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  vertical-align: middle;
  background: currentcolor;
  border-radius: 9999px;
  animation: df-slot-pulse 1.6s ease-in-out infinite;
}

@keyframes df-slot-pulse {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.3;
  }
}

@media (prefers-reduced-motion: reduce) {
  .df-slot__spinner,
  .df-wait-dot {
    animation: none;
  }
}
</style>
