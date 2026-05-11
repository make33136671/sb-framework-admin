import { watch, type Ref } from 'vue';

import type { UploadItem } from './types';

/**
 * 多文件排队消费器
 *
 * 监听 items 数组：当没有 status='uploading' 的项时，挑下一个 'queued' 项
 * 调用 runUpload。runUpload 负责把 status 改为 'uploading' / 'done' / 'error'。
 *
 * 同时仅 1 个文件在传（文件维度排队）；单个文件内部的并发由 useChunkUpload
 * 自己的 worker 池负责。
 */
export function useUploadQueue(
  items: Ref<UploadItem[]>,
  runUpload: (item: UploadItem) => Promise<void>,
) {
  let processing = false;

  async function tick() {
    if (processing) return;
    const hasUploading = items.value.some((i) => i.status === 'uploading');
    if (hasUploading) return;
    const next = items.value.find((i) => i.status === 'queued');
    if (!next) return;
    processing = true;
    try {
      await runUpload(next);
    } finally {
      processing = false;
      // 立即检查下一个
      tick();
    }
  }

  // 深度监听：状态变化、新项加入都触发
  watch(
    () => items.value.map((i) => `${i.uid}:${i.status}`).join(','),
    () => tick(),
    { immediate: true },
  );
}
