<script lang="ts" setup>
import type {
  UploadDetail,
  UploadItem,
  UploadProps,
  UploadSlotScope,
} from './internal/types';

import { computed, onMounted, ref, watch } from 'vue';

import { message } from 'ant-design-vue';

import UploadUi from './internal/UploadUi.vue';
import { useChunkUpload } from './internal/useChunkUpload';
import { useDirectUpload } from './internal/useDirectUpload';
import { useUploadConfig } from './internal/useUploadConfig';
import { useUploadQueue } from './internal/useUploadQueue';

defineOptions({ name: 'SmartUpload' });

const props = withDefaults(
  defineProps<UploadProps & { forceMode?: 'auto' | 'chunk' | 'direct' }>(),
  {
    value: () => '' as any,
    type: 'file',
    maxConcurrent: 0,
    accept: '',
    disabled: false,
    forceMode: 'auto',
  },
);

const emit = defineEmits<{
  change: [d: UploadDetail | UploadDetail[]];
  error: [e: Error];
  success: [d: UploadDetail | UploadDetail[]];
  'update:value': [v: string | string[]];
}>();

defineSlots<{
  /** 完全自定义 UI；不提供时使用 UploadUi */
  default?: (scope: UploadSlotScope) => any;
  /** 在默认 UI 旁追加内容 */
  extra?: (scope: UploadSlotScope) => any;
}>();

/** 是否多文件类型 */
const isMulti = computed(() => (props.type ?? 'file').endsWith('s'));

/** 实际 maxCount（单 = 1，多 = 默认 Infinity） */
const effectiveMaxCount = computed(() => {
  if (props.maxCount && props.maxCount > 0) return props.maxCount;
  return isMulti.value ? Infinity : 1;
});

/** 配置（mount 时拉一次缓存） */
const cfg = useUploadConfig();
onMounted(() => cfg.load());

/** 实际 accept（props > 后端 > 类型默认） */
const effectiveAccept = computed(() => {
  if (props.accept) return props.accept;
  const list = cfg.get().allowedExtensions;
  if (list && list.length > 0) return list.join(',');
  if (props.type?.startsWith('image')) return 'image/*';
  if (props.type?.startsWith('video')) return 'video/*';
  return '*';
});

/** 内部列表 */
const items = ref<UploadItem[]>([]);

/**
 * 把 v-model 值同步为 items（status='done' 占位）
 */
function syncFromValue(v: string | string[]) {
  const list = Array.isArray(v) ? v : v ? [v] : [];
  const existingFileNames = new Set(
    items.value.filter((i) => i.fileName).map((i) => i.fileName),
  );
  const incoming: UploadItem[] = [];
  for (const url of list) {
    if (existingFileNames.has(url)) continue;
    const name = url.split('/').pop()?.split('?')[0] || url;
    const prefix = cfg.get().urlPrefix;
    incoming.push({
      uid: `init-${url}`,
      status: 'done',
      progress: 100,
      fileName: url,
      absfileName: prefix + url,
      name,
    });
  }
  items.value = [
    // done 项按 list 过滤（外部清空时同步移除）；进行中的项（queued/hashing/
    // uploading/error）一律保留——它们 fileName 未填，否则 emitChange 触发
    // syncFromValue 时会把后续排队中的文件全删掉，造成"多选只传一个"
    ...items.value.filter((i) =>
      i.status === 'done' ? list.includes(i.fileName ?? '') : true,
    ),
    ...incoming,
  ];
}

watch(
  () => props.value,
  (v) => syncFromValue(v as any),
  { immediate: true },
);

/**
 * 把当前 items 反向同步为 v-model 值 + emit change
 */
function emitChange() {
  const dones = items.value.filter((i) => i.status === 'done');
  if (isMulti.value) {
    const fileNames = dones.map((i) => i.fileName ?? '');
    const details: UploadDetail[] = dones.map((i) => ({
      fileName: i.fileName ?? '',
      absfileName: i.absfileName ?? '',
      name: i.name,
      size: i.size ?? 0,
    }));
    emit('update:value', fileNames);
    emit('change', details);
  } else {
    const first = dones[0];
    emit('update:value', first?.fileName ?? '');
    if (first) {
      emit('change', {
        fileName: first.fileName ?? '',
        absfileName: first.absfileName ?? '',
        name: first.name,
        size: first.size ?? 0,
      });
    }
  }
}

/**
 * 决定单文件走哪个 hook（按 forceMode 或文件大小）
 */
function pickHook(file: File): 'chunk' | 'direct' {
  if (props.forceMode === 'direct') return 'direct';
  if (props.forceMode === 'chunk') return 'chunk';
  const threshold = cfg.get().chunkThresholdMB * 1024 * 1024;
  return file.size > threshold ? 'chunk' : 'direct';
}

/**
 * 校验文件（accept + maxFileSize）
 */
function validate(file: File): null | string {
  const accept = effectiveAccept.value;
  // 仅当 accept 为扩展名列表（非 image/* 等 MIME 通配）时做客户端校验
  if (
    accept &&
    accept !== '*' &&
    !accept.includes('/') &&
    accept.includes('.')
  ) {
    const ext = `.${(file.name.split('.').pop() ?? '').toLowerCase()}`;
    const accepted = accept.split(',').map((s) => s.trim().toLowerCase());
    if (!accepted.includes(ext)) return `不支持的文件类型: ${ext}`;
  }
  const maxBytes = cfg.get().maxFileSizeMB * 1024 * 1024;
  if (file.size > maxBytes) {
    return `文件超过 ${cfg.get().maxFileSizeMB} MB 限制`;
  }
  return null;
}

/**
 * 添加文件入队（用户点选 / 拖拽 / 程序化均经此）
 */
function addFiles(files: File[]) {
  for (const file of files) {
    if (items.value.length >= effectiveMaxCount.value) {
      message.error(`最多 ${effectiveMaxCount.value} 个文件`);
      break;
    }
    const err = validate(file);
    if (err) {
      message.error(err);
      continue;
    }
    items.value.push({
      uid: `new-${Date.now()}-${Math.random()}`,
      status: 'queued',
      progress: 0,
      file,
      name: file.name,
      size: file.size,
    });
  }
}

/** 排队消费：同时仅 1 个文件上传 */
useUploadQueue(items, async (item) => {
  if (!item.file) return;
  const mode = pickHook(item.file);
  const hook =
    mode === 'chunk'
      ? useChunkUpload({
          maxConcurrent: props.maxConcurrent || cfg.get().maxConcurrent || 4,
        })
      : useDirectUpload();

  item.status = 'uploading';
  item.cancel = () => hook.cancel();
  // 切片 hook 暴露的 threads reactive 数组直接挂到 item，模板可观察分片进度
  if (mode === 'chunk') {
    item.threads = (hook as ReturnType<typeof useChunkUpload>).threads;
  }

  // 进度桥接
  const stopProgress = watch(hook.progress, (p) => (item.progress = p));
  // 状态桥接（仅切片 hook 有 'hashing' 阶段）
  const stopStatus = watch(hook.status as any, (s: string) => {
    if (s === 'hashing') item.status = 'hashing';
    else if (s === 'uploading') item.status = 'uploading';
  });

  try {
    const detail = await hook.upload(item.file);
    item.status = 'done';
    item.fileName = detail.fileName;
    item.absfileName = detail.absfileName;
    item.size = detail.size;
    item.name = detail.name || item.name;
    emit('success', detail);
    emitChange();
  } catch (error: any) {
    if (error?.message === '已取消') {
      // 静默：cancel/remove 已经处理 UI
    } else {
      item.status = 'error';
      item.error = error?.message || '上传失败';
      emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  } finally {
    stopProgress();
    stopStatus();
  }
});

/**
 * Slot 暴露的 cancel：取消上传中且从列表移除（G1 语义）
 */
function cancel(uid: string) {
  const it = items.value.find((i) => i.uid === uid);
  it?.cancel?.();
  items.value = items.value.filter((i) => i.uid !== uid);
  emitChange();
}

/**
 * Slot 暴露的 retry：失败项重置为 queued 重新入队
 */
function retry(uid: string) {
  const it = items.value.find((i) => i.uid === uid);
  if (!it || !it.file) return;
  it.status = 'queued';
  it.progress = 0;
  it.error = undefined;
}

/**
 * Slot 暴露的 remove：上传中先取消再移除；其它直接移除
 */
function remove(uid: string) {
  const it = items.value.find((i) => i.uid === uid);
  if (it?.status === 'uploading') {
    it.cancel?.();
  }
  items.value = items.value.filter((i) => i.uid !== uid);
  emitChange();
}

/** 父组件可通过 ref 调用的方法 */
defineExpose({
  /** 取消所有进行中的上传 */
  cancelAll() {
    items.value
      .filter((i) => i.status === 'uploading')
      .forEach((i) => i.cancel?.());
  },
  /** 清空整个列表 */
  clear() {
    items.value
      .filter((i) => i.status === 'uploading')
      .forEach((i) => i.cancel?.());
    items.value = [];
    emitChange();
  },
  /** 程序化添加文件 */
  addFiles,
});

/** Slot scope */
const slotScope = computed<UploadSlotScope>(() => ({
  items: items.value,
  addFiles,
  cancel,
  retry,
  remove,
}));
</script>

<template>
  <slot v-if="$slots.default" v-bind="slotScope"></slot>
  <template v-else>
    <UploadUi
      :items="items"
      :type="props.type ?? 'file'"
      :accept="effectiveAccept"
      :max-count="effectiveMaxCount"
      :disabled="props.disabled ?? false"
      @pick="addFiles"
      @cancel="cancel"
      @retry="retry"
      @remove="remove"
    />
    <slot name="extra" v-bind="slotScope"></slot>
  </template>
</template>
