import { useAppConfig } from '@vben/hooks';
import { useAccessStore } from '@vben/stores';

import { api } from '#/api/request';

const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);

/** 上传成功后回传给业务的元数据 */
export interface UploadDetail {
  /** 服务端相对路径，如 /storage/uploads/abc.png */
  fileName: string;
  /** 服务端绝对 URL（带 host） */
  absfileName: string;
  /** 原始文件名 */
  name: string;
  /** 字节数 */
  size: number;
}

/** GET /admin/Upload/Config 返回值 */
export interface UploadConfigData {
  /** 文件大小上限（MB） */
  maxFileSizeMB: number;
  /** 切片阈值（MB），> 此值走切片 */
  chunkThresholdMB: number;
  /** 切片并发线程数 */
  maxConcurrent: number;
  /** 允许的扩展名列表（小写、含点） */
  allowedExtensions: string[];
  /** URL 前缀（带 scheme 与 host） */
  urlPrefix: string;
}

/** ChunkInit 返回值 */
export interface ChunkInitResult {
  /** 'instant'=秒传 / 'new'=新建 / 'resume'=续传 */
  status: 'instant' | 'new' | 'resume';
  /** 上传会话 id（new/resume 时返回） */
  uploadId?: string;
  /** 每片大小（字节） */
  chunkSize?: number;
  /** 总分片数 */
  totalChunks?: number;
  /** 已上传分片下标列表（resume 时返回） */
  uploadedChunks?: number[];
  /** 秒传场景：相对路径 */
  fileName?: string;
  /** 秒传场景：绝对 URL */
  absfileName?: string;
  /** 秒传场景：原始文件名 */
  name?: string;
  /** 秒传场景：字节数 */
  size?: number;
}

/**
 * 拉取上传配置（前端缓存使用，参考 useUploadConfig.ts）
 */
export async function getUploadConfigApi(): Promise<UploadConfigData> {
  return api.get('/Upload/Config', { quiet: true });
}

/**
 * 直传文件（小文件场景，由 useDirectUpload 调用）
 */
export async function directUploadApi(file: File): Promise<UploadDetail> {
  const formData = new FormData();
  formData.append('file', file);
  return api.post('/Upload/Direct', formData, { quiet: true });
}

/**
 * 初始化分片上传
 */
export async function chunkInitApi(params: {
  fileName: string;
  fileMd5: string;
  fileSize: number;
}): Promise<ChunkInitResult> {
  return api.post('/Upload/ChunkInit', params, { quiet: true });
}

/**
 * 合并分片（返回最终文件元数据）
 */
export async function chunkMergeApi(uploadId: string): Promise<UploadDetail> {
  return api.post('/Upload/ChunkMerge', { uploadId }, { quiet: true });
}

/**
 * 查询切片上传进度（含已上传分片列表）
 */
export async function chunkProgressApi(uploadId: string) {
  return api.get('/Upload/ChunkProgress', { params: { uploadId } });
}

/**
 * 上传单个分片（用 XMLHttpRequest 以支持上传进度回调）
 */
export function chunkUploadApi(
  uploadId: string,
  chunkIndex: number,
  chunk: Blob,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('uploadId', uploadId);
    formData.append('chunkIndex', chunkIndex.toString());
    formData.append('chunk', chunk);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const body = JSON.parse(xhr.responseText);
          if (body?.code === 0) resolve();
          else reject(new Error(body?.message || '分片上传失败'));
        } catch {
          reject(new Error('响应解析失败'));
        }
      } else {
        reject(new Error(`HTTP ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('网络错误'));
    xhr.ontimeout = () => reject(new Error('请求超时'));

    const accessStore = useAccessStore();
    const token = accessStore.accessToken;

    xhr.open('POST', `${apiURL}/Upload/ChunkUpload`);
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }
    xhr.send(formData);
  });
}
