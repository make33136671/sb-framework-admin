/** 上传组件支持的预设类型 */
export type UploadType =
  | 'image'
  | 'images'
  | 'video'
  | 'videos'
  | 'file'
  | 'files';

/** 三组件共用的 props 定义 */
export interface UploadProps {
  /** v-model:value，单文件 string，多文件 string[]，存相对路径 */
  value?: string | string[];
  /** 类型预设 */
  type?: UploadType;
  /** 文件数量上限：单 = 1，多 = Infinity（业务方可覆盖） */
  maxCount?: number;
  /** 切片并发线程数（覆盖后端配置） */
  maxConcurrent?: number;
  /** 浏览器选择对话框 accept；不设按类型默认 / 后端 allowedExtensions fallback */
  accept?: string;
  /** 禁用所有交互 */
  disabled?: boolean;
}

/** 上传成功后回传给业务的元数据（与后端 UploadDetail 对齐） */
export interface UploadDetail {
  /** 服务端相对路径 */
  fileName: string;
  /** 服务端绝对 URL */
  absfileName: string;
  /** 原始文件名 */
  name: string;
  /** 字节数 */
  size: number;
}

/** 切片上传单个 worker 线程的状态（仅切片场景） */
export interface ThreadState {
  /** 线程 id（0..maxConcurrent-1） */
  id: number;
  /** 当前在传的分片索引；-1 表示空闲 */
  chunkIndex: number;
  /** 当前分片上传进度 0-100 */
  progress: number;
  /** 线程状态 */
  status: 'idle' | 'uploading' | 'done';
}

/** 内部维护的列表项（通过 default slot scope 暴露给业务） */
export interface UploadItem {
  /** 内部唯一 id */
  uid: string;
  /** 当前状态 */
  status: 'queued' | 'hashing' | 'uploading' | 'done' | 'error' | 'cancelled';
  /** 进度 0-100 */
  progress: number;
  /** 用户选择的本地 File（done 后保留以便重试） */
  file?: File;
  /** 服务端返回的相对路径 */
  fileName?: string;
  /** 服务端返回的绝对 URL */
  absfileName?: string;
  /** 显示名（File.name 或从 URL 解析） */
  name: string;
  /** 字节数 */
  size?: number;
  /** 失败时的错误 message */
  error?: string;
  /** 取消函数（uploading 时由 hook 注入） */
  cancel?: () => void;
  /** 切片上传 worker 状态数组（仅切片场景） */
  threads?: ThreadState[];
}

/** 默认 UI 模板的 slot scope */
export interface UploadSlotScope {
  /** 当前列表 */
  items: UploadItem[];
  /** 程序化添加文件 */
  addFiles: (files: File[]) => void;
  /** 取消单项上传（uploading 时） */
  cancel: (uid: string) => void;
  /** 重试单项（error 时） */
  retry: (uid: string) => void;
  /** 移除单项 */
  remove: (uid: string) => void;
}
