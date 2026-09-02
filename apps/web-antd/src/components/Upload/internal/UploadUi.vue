<script lang="ts" setup>
import { computed, ref } from 'vue';

import { useElementSize } from '@vueuse/core';

import { Button, Image, Modal, Progress, Upload } from 'ant-design-vue';

import type { UploadItem, UploadType } from './types';

const props = defineProps<{
  /** 列表项 */
  items: UploadItem[];
  /** 类型预设 */
  type: UploadType;
  /** accept 字符串 */
  accept: string;
  /** 数量上限 */
  maxCount: number;
  /** 是否禁用 */
  disabled: boolean;
}>();

const emit = defineEmits<{
  /** 用户选择文件后触发 */
  pick: [files: File[]];
  /** 取消单项上传 */
  cancel: [uid: string];
  /** 重试单项 */
  retry: [uid: string];
  /** 移除单项 */
  remove: [uid: string];
}>();

/** 是否多文件类型 */
const isMulti = computed(() => /s$/.test(props.type));
/** 是否图片类型 */
const isImage = computed(
  () => props.type === 'image' || props.type === 'images',
);
/** 是否视频类型 */
const isVideo = computed(
  () => props.type === 'video' || props.type === 'videos',
);
/** 是否文件类型 */
const isFile = computed(() => props.type === 'file' || props.type === 'files');

/** 是否还能添加（未达到 maxCount） */
const canAdd = computed(
  () => props.items.length < props.maxCount && !props.disabled,
);

/** 视频预览弹窗状态 */
const videoPreviewUrl = ref('');
const videoPreviewVisible = ref(false);

/**
 * 打开视频预览弹窗
 */
function openVideoPreview(url: string) {
  videoPreviewUrl.value = url;
  videoPreviewVisible.value = true;
}

/**
 * antd Upload before-upload 钩子：截获用户选择的文件转发给父组件
 */
function handleBeforeUpload(file: File) {
  emit('pick', [file]);
  return false; // 阻止 antd 默认上传
}

/**
 * 触发文件下载（用 a 标签 download 属性）
 */
function triggerDownload(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

/** 监听组件最外层容器宽度，用于按比例计算 spinner / thread 圆环大小 */
const wrapperRef = ref<HTMLElement | null>(null);
const { width: wrapperWidth } = useElementSize(wrapperRef);

/**
 * 主进度圆环 / 哈希 spinner 大小：横向紧凑布局，固定 64-80 区间
 */
const spinnerSize = computed(() => {
  const w = wrapperWidth.value || 320;
  if (w < 360) return 64;
  return 80;
});

/** 主圆环边框宽度：随 size 等比缩放，最小 3 */
const spinnerBorderWidth = computed(() =>
  Math.max(Math.round(spinnerSize.value / 22), 3),
);

/** 内层虚线 spinner 边框宽度：稍小 */
const spinnerInnerBorderWidth = computed(() =>
  Math.max(spinnerBorderWidth.value - 5, 2),
);

/**
 * thread 圆环大小：环内放居中百分比 + 底部 #N，需要更大（44-60）
 */
const threadSize = computed(() => {
  const w = wrapperWidth.value || 320;
  if (w < 360) return 44;
  return 60;
});

/**
 * 单个 file-row 高度：横向紧凑布局（header ~28 + main row(spinner) + padding+gap）
 */
const rowMinHeight = computed(() => spinnerSize.value + 28 + 8 + 24);

/**
 * 整个 UploadUi 容器最小高度。
 * - image / video 单文件：缩略图本身固定 100x100
 * - images / videos 多文件：默认 320 高度（约 3 行缩略图）
 * - file / files：按 item 数量动态计算，无 item 时仅留按钮高度
 */
const containerHeight = computed(() => {
  if (props.type === 'image' || props.type === 'video') return 100;
  if (props.type === 'images' || props.type === 'videos') return 320;
  // file / files: rows + 按钮（如果可加）+ 间距
  const count = props.items.length;
  const rowsH = count * rowMinHeight.value;
  const buttonH = canAdd.value ? 36 : 0;
  const blocks = count + (canAdd.value ? 1 : 0);
  const gaps = blocks > 1 ? (blocks - 1) * 8 : 0;
  return Math.max(40, rowsH + buttonH + gaps);
});

/**
 * 格式化字节数为可读字符串
 */
function formatSize(bytes?: number): string {
  if (!bytes) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
</script>

<template>
  <div
    ref="wrapperRef"
    class="upload-ui"
    :class="`upload-ui--${type}`"
    :style="
      isFile
        ? { minHeight: `${containerHeight}px` }
        : { height: `${containerHeight}px` }
    "
  >
    <!-- 图片 / 视频：方形卡片网格 -->
    <template v-if="isImage || isVideo">
      <div class="grid">
        <div
          v-for="item in items"
          :key="item.uid"
          class="card card--media"
          :class="{ 'card--error': item.status === 'error' }"
        >
          <!-- 图片缩略图 -->
          <Image
            v-if="isImage && item.absfileName"
            :src="item.absfileName"
            :width="100"
            :height="100"
            :preview="{ mask: '预览' }"
          />
          <!-- 视频缩略图 -->
          <div
            v-else-if="isVideo && item.absfileName"
            class="video-thumb"
            @click="openVideoPreview(item.absfileName!)"
          >
            <video :src="item.absfileName" muted />
            <div class="video-thumb__icon">▶</div>
          </div>

          <!-- 哈希中遮罩（炫酷大圆环） -->
          <div
            v-if="item.status === 'hashing'"
            class="overlay overlay--hashing"
          >
            <div class="hashing-spinner hashing-spinner--card">
              <div class="hashing-spinner__inner" />
            </div>
            <span class="hashing-text">计算指纹...</span>
          </div>
          <!-- 上传中遮罩 -->
          <div
            v-else-if="item.status === 'uploading' || item.status === 'queued'"
            class="overlay"
          >
            <Progress
              type="circle"
              :percent="item.progress"
              :size="56"
              status="active"
            />
          </div>
          <!-- 错误遮罩 -->
          <div v-if="item.status === 'error'" class="overlay overlay--error">
            <span class="error-text">{{ item.error || '上传失败' }}</span>
          </div>

          <!-- 操作按钮（hover 显示） -->
          <div class="actions">
            <Button
              v-if="item.status === 'uploading'"
              danger
              size="small"
              @click="emit('cancel', item.uid)"
              >取消</Button
            >
            <Button
              v-else-if="item.status === 'error'"
              type="primary"
              size="small"
              @click="emit('retry', item.uid)"
              >重试</Button
            >
            <Button size="small" @click="emit('remove', item.uid)">删除</Button>
          </div>
        </div>

        <!-- + 添加按钮 -->
        <Upload
          v-if="canAdd"
          :show-upload-list="false"
          :before-upload="handleBeforeUpload"
          :accept="accept"
          :multiple="isMulti"
          :disabled="disabled"
        >
          <div class="card card--add">
            <span class="plus">+</span>
            <span class="plus-text">{{
              isImage ? '上传图片' : '上传视频'
            }}</span>
          </div>
        </Upload>
      </div>
    </template>

    <!-- 文件类型：横向紧凑列表（圆环 | 信息+切片 | 操作） -->
    <template v-if="isFile">
      <div class="file-list">
        <div
          v-for="item in items"
          :key="item.uid"
          class="file-row"
          :class="{ 'file-row--error': item.status === 'error' }"
          :style="{ minHeight: `${rowMinHeight}px` }"
        >
          <!-- 左：进度圆环 -->
          <div class="file-progress">
            <div
              v-if="item.status === 'hashing'"
              class="hashing-spinner-wrap"
              :style="{
                width: `${spinnerSize}px`,
                height: `${spinnerSize}px`,
              }"
            >
              <div
                class="hashing-spinner"
                :style="{ borderWidth: `${spinnerBorderWidth}px` }"
              >
                <div
                  class="hashing-spinner__inner"
                  :style="{ borderWidth: `${spinnerInnerBorderWidth}px` }"
                />
              </div>
              <span class="progress-center-text">指纹</span>
            </div>
            <Progress
              v-else
              type="circle"
              :percent="item.progress"
              :size="spinnerSize"
              :status="
                item.status === 'error'
                  ? 'exception'
                  : item.status === 'done'
                    ? 'success'
                    : 'active'
              "
            >
              <template #default="{ percent }">
                <div class="progress-center-content">
                  <div
                    v-if="item.status === 'uploading'"
                    class="progress-center-content__percent"
                  >
                    {{ percent }}%
                  </div>
                  <div v-else class="progress-center-content__label">
                    {{
                      item.status === 'queued'
                        ? '等待'
                        : item.status === 'done'
                          ? '完成'
                          : item.status === 'error'
                            ? '失败'
                            : ''
                    }}
                  </div>
                </div>
              </template>
            </Progress>
          </div>

          <!-- 中：文件名 + 大小 + 切片状态 -->
          <div class="file-body">
            <div class="file-header">
              <div class="file-name">{{ item.name }}</div>
              <div class="file-sub">
                <span>{{ formatSize(item.size) }}</span>
                <span v-if="item.status === 'error'" class="err">
                  · {{ item.error || '上传失败' }}
                </span>
              </div>
            </div>

            <div
              v-if="
                item.threads &&
                item.threads.length > 0 &&
                (item.status === 'hashing' ||
                  item.status === 'uploading' ||
                  item.status === 'queued')
              "
              class="thread-row"
            >
              <div v-for="th in item.threads" :key="th.id" class="thread-item">
                <Progress
                  type="circle"
                  :size="threadSize"
                  :percent="th.progress"
                  :status="
                    th.status === 'uploading'
                      ? 'active'
                      : th.status === 'done'
                        ? 'success'
                        : 'normal'
                  "
                >
                  <template #format="percent">
                    <div class="thread-inner">
                      <div class="thread-inner__percent">
                        {{
                          th.status === 'done'
                            ? '✓'
                            : th.status === 'uploading'
                              ? `${percent}%`
                              : '·'
                        }}
                      </div>
                      <div class="thread-inner__index">
                        #{{ th.chunkIndex }}
                      </div>
                    </div>
                  </template>
                </Progress>
              </div>
            </div>
          </div>

          <!-- 右：操作按钮 -->
          <div class="row-actions">
            <Button
              v-if="item.status === 'done' && item.absfileName"
              size="small"
              @click="triggerDownload(item.absfileName!, item.name)"
              >下载</Button
            >
            <Button
              v-if="item.status === 'uploading'"
              danger
              size="small"
              @click="emit('cancel', item.uid)"
              >取消</Button
            >
            <Button
              v-if="item.status === 'error'"
              type="primary"
              size="small"
              @click="emit('retry', item.uid)"
              >重试</Button
            >
            <Button danger size="small" @click="emit('remove', item.uid)"
              >删除</Button
            >
          </div>
        </div>

        <Upload
          v-if="canAdd"
          :show-upload-list="false"
          :before-upload="handleBeforeUpload"
          :accept="accept"
          :multiple="isMulti"
          :disabled="disabled"
        >
          <Button :disabled="disabled" type="dashed" block>+ 上传文件</Button>
        </Upload>
      </div>
    </template>

    <!-- 视频预览弹窗 -->
    <Modal
      v-model:open="videoPreviewVisible"
      :footer="null"
      width="720px"
      destroy-on-close
    >
      <video
        :src="videoPreviewUrl"
        controls
        autoplay
        style="width: 100%; max-height: 70vh"
      />
    </Modal>
  </div>
</template>

<style scoped>
/* 整个组件容器尺寸锁定（width 跟随父，height 由 :style 设置） */
.upload-ui {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.grid {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  gap: 8px;
  align-content: flex-start;
  min-height: 0;
  overflow-y: auto;
}

.card {
  position: relative;
  width: 100px;
  height: 100px;
  overflow: hidden;
  background: hsl(var(--muted) / 30%);
  border: 1px dashed hsl(var(--border));
  border-radius: 4px;
}

.card--add {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: hsl(var(--muted-foreground));
  cursor: pointer;

  /* 用 currentColor 让边框跟随文字色，亮/暗模式下都有对比，hover 自动同步变 primary */
  border-color: currentcolor;
  border-width: 1.5px;
}

.card--add:hover {
  color: hsl(var(--primary));
}

/* 单图/单视频：按钮缩到 64x64 并在 100x100 容器内居中（之前按钮 100x100 占满，
 * 看起来贴顶贴左；缩小后加号自然成为容器中心点）。多图保持 100x100 与缩略图同尺寸。 */
.upload-ui--image .grid,
.upload-ui--video .grid {
  place-content: center center;
  align-items: center;
}

.upload-ui--image .card--add,
.upload-ui--video .card--add {
  width: 64px;
  height: 64px;
}

.card--error {
  border-color: hsl(var(--destructive));
}

.plus {
  font-size: 24px;
  line-height: 1;
}

.plus-text {
  margin-top: 4px;
  font-size: 12px;
}

.video-thumb {
  position: relative;
  width: 100%;
  height: 100%;
  cursor: pointer;
}

/* 图片/视频缩略图按原比例显示（contain 不裁剪不拉伸；ant Image 渲染 .ant-image-img） */
.card--media :deep(.ant-image-img),
.card--media :deep(img) {
  object-fit: contain;
}

.video-thumb video {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.video-thumb__icon {
  position: absolute;
  top: 50%;
  left: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  color: white;
  background: rgb(0 0 0 / 50%);
  border-radius: 50%;
  transform: translate(-50%, -50%);
}

.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 45%);
}

.overlay--error {
  padding: 4px;
  font-size: 12px;
  color: white;
  text-align: center;
  background: rgb(255 77 79 / 85%);
}

.error-text {
  word-break: break-all;
}

.actions {
  position: absolute;
  right: 4px;
  bottom: 4px;
  left: 4px;
  display: flex;
  gap: 4px;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s;
}

.card:hover .actions {
  opacity: 1;
}

.file-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow-y: auto;
}

/* '+ 上传文件' 按钮所在 Upload 容器始终撑满宽度 */
.file-list :deep(.ant-upload-wrapper),
.file-list :deep(.ant-upload-wrapper .ant-upload),
.file-list :deep(.ant-upload-wrapper .ant-upload-select) {
  display: block;
  width: 100%;
}

/* '+ 上传文件' 按钮始终保持在 file-list 最底部 */
.file-list > :last-child {
  margin-top: auto;
}

/* 文件 row：横向紧凑布局（圆环 | 文件信息+切片 | 操作） */
.file-row {
  display: flex;
  gap: 16px;
  align-items: center;
  padding: 12px 14px;
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
}

.file-row--error {
  border-color: hsl(var(--destructive));
}

.file-progress {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
}

.file-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.file-header {
  display: flex;
  gap: 12px;
  align-items: baseline;
  justify-content: space-between;
}

.file-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
  color: hsl(var(--foreground));
  white-space: nowrap;
}

.file-sub {
  flex-shrink: 0;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}

.file-sub .err {
  color: hsl(var(--destructive));
}

/* 圆环中央自定义文字（hashing spinner 用） */
.hashing-spinner-wrap {
  position: relative;
  flex-shrink: 0;
}

.hashing-spinner-wrap .hashing-spinner {
  width: 100%;
  height: 100%;
}

.progress-center-text {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 2;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
  white-space: nowrap;
  pointer-events: none;
  transform: translate(-50%, -50%);
  animation: hashing-pulse 1.6s ease-in-out infinite;
}

/* antd Progress 中央自定义内容（uploading/queued/done/error 用） */
.progress-center-content {
  display: flex;
  flex-direction: column;
  gap: 1px;
  align-items: center;
}

.progress-center-content__label {
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
}

.progress-center-content__percent {
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.row-actions {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  gap: 6px;
  align-items: stretch;
  align-self: stretch;
  justify-content: center;
  min-width: 64px;
}

.overlay--hashing {
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}

/* 缩略图遮罩内（深色半透明背景）：白色文字 */
.overlay--hashing .hashing-text {
  font-size: 12px;
  color: white;
}

/* ===== 炫酷双层圆环（外圈快速 + 内圈反向慢速 + glow） ===== */

.hashing-spinner {
  position: relative;
  flex-shrink: 0;
  border-color: rgb(24 144 255 / 15%);
  border-style: solid;
  border-top-color: hsl(var(--primary));
  border-radius: 50%;
  filter: drop-shadow(0 0 16px hsl(var(--primary)));
  animation: hashing-spin 1.1s linear infinite;
}

.hashing-spinner__inner {
  position: absolute;
  inset: 8%;
  border-color: hsl(var(--primary));
  border-style: dashed;
  border-top-color: transparent;
  border-radius: 50%;
  opacity: 0.55;
  animation: hashing-spin 2.2s linear infinite reverse;
}

/* card: 缩略图遮罩 (100x100) 内（缩略图本身固定 100，spinner 也固定） */
.hashing-spinner--card {
  width: 80px;
  height: 80px;
  border-width: 5px;
}

.hashing-spinner--card .hashing-spinner__inner {
  border-width: 2px;
}

/*
 * 文件 row 内的 spinner 尺寸由模板 :style 动态绑定（基于容器宽度按比例计算），
 * 不在此固定。border-width / border-style 由公共 .hashing-spinner 选择器提供。
 */

/* 缩略图遮罩内（深色半透明背景）：白色调 */
.overlay--hashing .hashing-spinner {
  border-color: rgb(255 255 255 / 18%);
  border-top-color: rgb(255 255 255 / 95%);
  filter: drop-shadow(0 0 12px rgb(255 255 255 / 60%));
}

.overlay--hashing .hashing-spinner__inner {
  border-color: rgb(255 255 255 / 70%);
  border-top-color: transparent;
}

@keyframes hashing-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes hashing-pulse {
  0%,
  100% {
    opacity: 0.6;
  }

  50% {
    opacity: 1;
  }
}

/* 切片 worker 进度环行（在文件名下方紧凑排列） */
.thread-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.thread-item {
  display: flex;
  align-items: center;
}

/* 切片圆环：覆盖 antd-progress-text 撑满圆环内部
 * 百分比 flex 居中主导，#N 绝对定位贴底
 * 注意 antd 默认给 .ant-progress-text 加了 translateY(-50%)，
 * 配合 top:50% 让单行文本居中——我们改成 inset:0 撑满后必须把
 * transform 一起清掉，否则整个 text 块会被往上顶半个圆环 */
.thread-item :deep(.ant-progress-text) {
  position: absolute !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  margin: 0 !important;
  transform: none !important;
}

.thread-inner {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.thread-inner__percent {
  font-size: 14px;
  font-weight: 600;
  color: var(--ant-color-text);
}

.thread-inner__index {
  position: absolute;
  bottom: 18%;
  left: 50%;
  font-size: 8px;
  font-weight: 400;
  line-height: 1;
  color: var(--ant-color-text-tertiary);
  white-space: nowrap;
  transform: translateX(-50%);
}
</style>
