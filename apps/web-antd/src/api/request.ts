/**
 * Unified API client - 只使用 GET 和 POST
 *
 * api.get(url, { params })                - 静默查询，返回解包后的 data
 * api.post(url, data)                     - 带 loading + toast，返回解包后的 data，失败抛异常
 * api.post(url, data, { quiet: true })    - 静默 POST（登录/上传等，不显示 loading 和成功提示）
 * api.post(url, data, { silent: true })   - 完全静默（不显示任何提示，包括错误），调用方自行 try-catch
 * api.raw.post(url, data)                 - 原始请求（refreshToken/logout 用）
 */
import { useAppConfig } from '@vben/hooks';
import { preferences } from '@vben/preferences';
import {
  authenticateResponseInterceptor,
  defaultResponseInterceptor,
  errorMessageResponseInterceptor,
  RequestClient,
} from '@vben/request';
import { useAccessStore } from '@vben/stores';

import { message } from 'ant-design-vue';

import { useAuthStore } from '#/store';

import { refreshTokenApi } from './core';

const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);

function formatToken(token: null | string) {
  return token ? `Bearer ${token}` : null;
}

async function doReAuthenticate() {
  console.warn('Access token or refresh token is invalid or expired.');
  const accessStore = useAccessStore();
  const authStore = useAuthStore();
  accessStore.setAccessToken(null);
  if (
    preferences.app.loginExpiredMode === 'modal' &&
    accessStore.isAccessChecked
  ) {
    accessStore.setLoginExpired(true);
  } else {
    await authStore.logout();
  }
}

async function doRefreshToken() {
  const accessStore = useAccessStore();
  const resp = await refreshTokenApi();
  const newToken = resp.data;
  accessStore.setAccessToken(newToken);
  return newToken;
}

// ---- Internal: main client (responseReturn: body) ----

const _client = new RequestClient({
  baseURL: apiURL,
  responseReturn: 'body',
});

_client.addRequestInterceptor({
  fulfilled: async (config) => {
    // 接口源约定:framework controller 全部 [FromForm](见 docs/AI_Conventions.md "接口源约定" 一节)。
    // vben RequestClient 在 axios.create({ headers: { 'Content-Type': 'application/json...' } })
    // 烤进了实例默认 header,这里必须**显式**处理两条路径,不能只"跳过覆盖":
    //   - plain object → 设 form-urlencoded,axios v1 自动序列化为 username=admin&password=111111
    //   - FormData → **delete** Content-Type,让浏览器在发请求时自动加 multipart/form-data + boundary
    //     (只跳过覆盖不够,因为 axios 默认已经把 application/json 写进 config.headers,后端会拿到错误的 JSON Content-Type)
    if (config.data instanceof FormData) {
      delete config.headers['Content-Type'];
    } else {
      config.headers['Content-Type'] =
        'application/x-www-form-urlencoded;charset=utf-8';
    }
    const accessStore = useAccessStore();
    config.headers.Authorization = formatToken(accessStore.accessToken);
    config.headers['Accept-Language'] = preferences.app.locale;
    return config;
  },
});

_client.addResponseInterceptor(
  defaultResponseInterceptor({
    codeField: 'code',
    dataField: 'data',
    successCode: 0,
  }),
);

_client.addResponseInterceptor(
  authenticateResponseInterceptor({
    client: _client,
    doReAuthenticate,
    doRefreshToken,
    enableRefreshToken: preferences.app.enableRefreshToken,
    formatToken,
  }),
);

// 503 setup_required 拦截：系统未安装时跳转安装向导
_client.addResponseInterceptor({
  rejected: (error: any) => {
    const { response } = error;
    if (response?.status === 503 && response?.data?.type === 'setup_required') {
      // 使用 location 跳转，兼容 hash / history 两种路由模式
      const base = window.location.pathname;
      const hash = window.location.hash;
      if (hash) {
        window.location.hash = '#/setup';
      } else {
        window.location.href = `${base}#/setup`;
      }
      return new Promise(() => {});
    }
    return Promise.reject(error);
  },
});

// 注：原先这里有一段「403 + license_invalid → 跳 /auth/license」的授权拦截器。
// 本项目未启用授权体系（框架 0.5.x 已移除授权），且 /auth/license 页面与路由已一并删除，
// 保留该拦截只会把用户跳到一个不存在的页面，故移除。

_client.addResponseInterceptor(
  errorMessageResponseInterceptor((msg: string, error) => {
    if ((error?.config as any)?._silent) return;
    const responseData = error?.response?.data ?? {};
    const errorMessage = responseData?.error ?? responseData?.message ?? '';
    message.error(errorMessage || msg);
  }),
);

// ---- Internal: raw client (auth headers only) ----

const _rawClient = new RequestClient({ baseURL: apiURL });

_rawClient.addRequestInterceptor({
  fulfilled: async (config) => {
    const accessStore = useAccessStore();
    config.headers.Authorization = formatToken(accessStore.accessToken);
    return config;
  },
});

// ---- Unified API ----

interface ApiOptions {
  params?: Record<string, any>;
  /** 静默模式：不显示 loading 和成功提示（GET 默认 true，POST 默认 false） */
  quiet?: boolean;
  /**
   * 中断信号：传入后可用 AbortController 取消请求。
   *
   * 为什么需要它：AI 提示词生成是**长耗时**请求（PE-T2I 是 9.4B 模型，
   * 冷启要把 18.9 GB 权重读进显存，实测 50s+）。用户必须能在等待中取消，
   * 否则一旦点了就只能干等；且服务端也会因连接断开而停止等待，
   * 不会白占 GPU。
   *
   * ⚠️ 取消会让 axios 抛 `CanceledError`（不是业务异常）—— 调用方要单独识别，
   * 否则会把"用户主动取消"当成"生成失败"弹一个红色错误。
   */
  signal?: AbortSignal;
  /** 完全静默：不显示任何提示（含错误），调用方自行 try-catch 处理 */
  silent?: boolean;
  /**
   * 本次请求的超时（毫秒）。不传则用 axios 客户端的默认值 **10 秒**。
   *
   * ⚠️ 为什么必须能单独覆盖（2026-10-07 真机踩坑）：
   * `RequestClient` 的默认超时是 **10s**（packages/effects/request 的
   * `timeout: 10_000`）。而 AI 提示词生成要调 110 上的 PE-T2I（9.4B），
   * 冷启要把 17.9 GB 权重读进显存，**实测 52–56 秒**。
   * 于是出现极迷惑的现象：
   *   · ComfyUI 控制台**跑通了**（Prompt executed in 55.99 seconds）；
   *   · 前端却报超时（10s 就断了）。
   * 两边都没错，是**前端根本没等到**。
   *
   * 故长耗时接口必须显式调大；不要改全局默认值 —— 那会让真正卡死的
   * 普通接口也一起等下去（用户点一下要干等几分钟才看到错误）。
   */
  timeout?: number;
}

async function request<T = any>(
  method: 'GET' | 'POST',
  url: string,
  data?: any,
  options?: ApiOptions,
): Promise<T> {
  const silent = options?.silent ?? false;
  const quiet = silent || (options?.quiet ?? method === 'GET');
  let hideLoading: (() => void) | undefined;
  if (!quiet) hideLoading = message.loading('');

  let body: any;
  try {
    const config: any = {
      params: options?.params,
      signal: options?.signal,
    };
    // 只在调用方显式给了才设置，否则沿用客户端默认（不要写 undefined，
    // 那会覆盖掉 axios 实例上的默认值）
    if (options?.timeout !== undefined) config.timeout = options.timeout;
    if (silent) config._silent = true;
    body = await (method === 'GET'
      ? _client.get(url, config)
      : _client.post(url, data, config));
  } catch (error) {
    hideLoading?.();
    throw error;
  }

  hideLoading?.();

  if (body?.code === 0) {
    if (!quiet) message.success(body.message || '操作成功');
    return body.data as T;
  }

  if (!silent) message.error(body?.message || '操作失败');
  throw new Error(body?.message || '操作失败');
}

export const api = {
  /** GET 请求 - 默认静默（无 loading、无 toast） */
  get<T = any>(url: string, options?: ApiOptions): Promise<T> {
    return request<T>('GET', url, undefined, options);
  },

  /** POST 请求 - 默认带 loading + toast，失败抛异常 */
  post<T = any>(url: string, data?: any, options?: ApiOptions): Promise<T> {
    return request<T>('POST', url, data, options);
  },

  /** 原始请求 - 无业务处理，用于 refreshToken / logout */
  raw: {
    post<T = any>(url: string, data?: any): Promise<T> {
      return _rawClient.post(url, data);
    },
  },
};
