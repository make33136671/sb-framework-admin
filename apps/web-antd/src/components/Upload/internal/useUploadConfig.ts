import { ref } from 'vue';

import { getUploadConfigApi } from '#/api/core/upload';

/** 默认配置兜底（后端拉取失败时使用） */
const DEFAULT_CONFIG = {
  maxFileSizeMB: 2048,
  chunkThresholdMB: 10,
  maxConcurrent: 4,
  allowedExtensions: [] as string[],
  urlPrefix: window.location.origin,
};

/** 模块级缓存：应用生命周期内只拉一次 */
const cache = ref<null | typeof DEFAULT_CONFIG>(null);
let pending: null | Promise<typeof DEFAULT_CONFIG> = null;

/**
 * 获取上传配置（应用生命周期内只拉一次，并发调用共享同一 Promise）
 */
export function useUploadConfig() {
  /**
   * 同步取当前缓存（未加载完成时返回默认值兜底）
   */
  function get(): typeof DEFAULT_CONFIG {
    return cache.value ?? DEFAULT_CONFIG;
  }

  /**
   * 异步加载配置（只发起一次请求，后续调用复用 Promise）
   */
  async function load(): Promise<typeof DEFAULT_CONFIG> {
    if (cache.value) return cache.value;
    if (pending) return pending;
    pending = (async () => {
      try {
        const data = await getUploadConfigApi();
        cache.value = {
          maxFileSizeMB: data.maxFileSizeMB ?? DEFAULT_CONFIG.maxFileSizeMB,
          chunkThresholdMB:
            data.chunkThresholdMB ?? DEFAULT_CONFIG.chunkThresholdMB,
          maxConcurrent: data.maxConcurrent ?? DEFAULT_CONFIG.maxConcurrent,
          allowedExtensions:
            data.allowedExtensions ?? DEFAULT_CONFIG.allowedExtensions,
          urlPrefix: data.urlPrefix || DEFAULT_CONFIG.urlPrefix,
        };
        return cache.value;
      } catch (error) {
        console.warn('[Upload] 拉取配置失败，使用默认值', error);
        cache.value = { ...DEFAULT_CONFIG };
        return cache.value;
      } finally {
        pending = null;
      }
    })();
    return pending;
  }

  return { get, load };
}
