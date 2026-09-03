import type { ThreadState, UploadDetail } from './types';

import { reactive, ref } from 'vue';

import SparkMD5 from 'spark-md5';

import { chunkInitApi, chunkMergeApi, chunkUploadApi } from '#/api/core/upload';

/**
 * 计算文件 MD5（增量分片，不阻塞 UI）
 */
async function hashFile(
  file: File,
  onProgress?: (p: number) => void,
): Promise<string> {
  const spark = new SparkMD5.ArrayBuffer();
  const chunkSize = 2 * 1024 * 1024;
  let offset = 0;
  while (offset < file.size) {
    const slice = file.slice(offset, offset + chunkSize);
    const buffer = await slice.arrayBuffer();
    spark.append(buffer);
    offset += chunkSize;
    onProgress?.(Math.min(Math.round((offset / file.size) * 100), 100));
  }
  return spark.end();
}

/**
 * 单文件切片上传 hook
 *
 * 流程：计算 MD5 → 初始化（秒传/续传/新建）→ 并发分片上传 → 合并
 */
export function useChunkUpload(options?: { maxConcurrent?: number }) {
  /** 上传总进度 0-100 */
  const progress = ref(0);
  /** 当前状态 */
  const status = ref<
    | 'cancelled'
    | 'done'
    | 'error'
    | 'hashing'
    | 'idle'
    | 'merging'
    | 'uploading'
  >('idle');
  /** MD5 计算进度 */
  const hashProgress = ref(0);
  /** 错误信息 */
  const errorMsg = ref('');

  let isCancelled = false;
  const maxConcurrent = options?.maxConcurrent ?? 4;

  /** 4 个 worker 线程的可观察状态（用于 UI 展示分片进度环） */
  const threads = reactive<ThreadState[]>(
    Array.from({ length: maxConcurrent }, (_, i) => ({
      id: i,
      chunkIndex: -1,
      progress: 0,
      status: 'idle' as const,
    })),
  );

  /** 重置所有线程状态 */
  function resetThreads() {
    for (const t of threads) {
      t.chunkIndex = -1;
      t.progress = 0;
      t.status = 'idle';
    }
  }

  /**
   * 上传单个文件
   */
  async function upload(file: File): Promise<UploadDetail> {
    isCancelled = false;
    progress.value = 0;
    hashProgress.value = 0;
    errorMsg.value = '';
    resetThreads();

    try {
      status.value = 'hashing';
      const md5 = await hashFile(file, (p) => (hashProgress.value = p));
      if (isCancelled) throw new Error('已取消');

      status.value = 'uploading';
      const init = await chunkInitApi({
        fileName: file.name,
        fileMd5: md5,
        fileSize: file.size,
      });

      // 秒传
      if (init.status === 'instant') {
        progress.value = 100;
        status.value = 'done';
        return {
          fileName: init.fileName!,
          absfileName: init.absfileName!,
          name: init.name ?? file.name,
          size: init.size ?? file.size,
        };
      }

      const uploadId = init.uploadId!;
      const chunkSize = init.chunkSize!;
      const totalChunks = init.totalChunks!;
      const uploaded = new Set(init.uploadedChunks);

      // 构建待上传队列
      const queue: number[] = [];
      for (let i = 0; i < totalChunks; i++) {
        if (!uploaded.has(i)) queue.push(i);
      }
      let completed = uploaded.size;
      const updateProgress = () => {
        progress.value = Math.round((completed / totalChunks) * 100);
      };
      updateProgress();

      // 并发 worker（每个 worker 把自己状态写到 threads[i]，UI 可观察）
      const workers = Array.from({ length: maxConcurrent }, (_, threadId) =>
        (async () => {
          const thread = threads[threadId];
          if (!thread) return;
          while (queue.length > 0) {
            if (isCancelled) {
              thread.status = 'idle';
              return;
            }
            const idx = queue.shift();
            if (idx === undefined) break;
            thread.chunkIndex = idx;
            thread.status = 'uploading';
            thread.progress = 0;
            const start = idx * chunkSize;
            const end = Math.min(start + chunkSize, file.size);
            const blob = file.slice(start, end);
            await chunkUploadApi(uploadId, idx, blob, (pct) => {
              thread.progress = pct;
            });
            completed++;
            thread.progress = 100;
            updateProgress();
          }
          thread.status = 'done';
          thread.progress = 0;
        })(),
      );
      await Promise.all(workers);

      if (isCancelled) throw new Error('已取消');

      status.value = 'merging';
      const merged = await chunkMergeApi(uploadId);
      progress.value = 100;
      status.value = 'done';
      return merged;
    } catch (error: any) {
      if (error?.message === '已取消') {
        status.value = 'cancelled';
      } else {
        status.value = 'error';
        errorMsg.value = error?.message || '上传失败';
      }
      throw error;
    }
  }

  /**
   * 取消上传（worker 在下次 chunk 边界检查标记退出）
   */
  function cancel() {
    isCancelled = true;
  }

  return {
    progress,
    status,
    hashProgress,
    errorMsg,
    threads,
    upload,
    cancel,
  };
}
