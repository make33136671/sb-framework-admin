import { ref } from 'vue';

import { useAppConfig } from '@vben/hooks';
import { useAccessStore } from '@vben/stores';

import type { UploadDetail } from './types';

const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);

/**
 * 单文件直传 hook（XMLHttpRequest 实现，支持上传进度回调与 abort 取消）
 *
 * 跟 useChunkUpload 暴露相同形状（progress / status / errorMsg / upload / cancel）
 * 以便上层 SmartUpload 统一调度。
 */
export function useDirectUpload() {
  /** 上传进度 0-100 */
  const progress = ref(0);
  /** 当前状态 */
  const status = ref<'idle' | 'uploading' | 'done' | 'error' | 'cancelled'>(
    'idle',
  );
  /** 错误信息 */
  const errorMsg = ref('');

  let xhr: null | XMLHttpRequest = null;

  /**
   * 上传单个文件，成功返回服务端响应数据，失败/取消则 throw
   */
  async function upload(file: File): Promise<UploadDetail> {
    return new Promise((resolve, reject) => {
      progress.value = 0;
      status.value = 'uploading';
      errorMsg.value = '';

      xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append('file', file);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          progress.value = Math.round((event.loaded / event.total) * 100);
        }
      };

      xhr.onload = () => {
        if (xhr!.status >= 200 && xhr!.status < 300) {
          try {
            const body = JSON.parse(xhr!.responseText);
            if (body?.code === 0) {
              progress.value = 100;
              status.value = 'done';
              resolve(body.data as UploadDetail);
            } else {
              status.value = 'error';
              errorMsg.value = body?.message || '上传失败';
              reject(new Error(errorMsg.value));
            }
          } catch {
            status.value = 'error';
            errorMsg.value = '响应解析失败';
            reject(new Error(errorMsg.value));
          }
        } else {
          status.value = 'error';
          errorMsg.value = `HTTP ${xhr!.status}`;
          reject(new Error(errorMsg.value));
        }
      };

      xhr.onerror = () => {
        status.value = 'error';
        errorMsg.value = '网络错误';
        reject(new Error(errorMsg.value));
      };

      xhr.onabort = () => {
        status.value = 'cancelled';
        reject(new Error('已取消'));
      };

      const accessStore = useAccessStore();
      const token = accessStore.accessToken;
      xhr.open('POST', `${apiURL}/Upload/Direct`);
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }
      xhr.send(formData);
    });
  }

  /**
   * 取消当前上传（abort XHR；onabort 回调会 reject 上传 Promise）
   */
  function cancel() {
    if (xhr) {
      xhr.abort();
      xhr = null;
    }
  }

  return { progress, status, errorMsg, upload, cancel };
}
