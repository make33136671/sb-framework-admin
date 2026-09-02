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

// 授权无效拦截：403 + license_invalid → 跳转授权页面
// 如果已经在 /auth/license 页面(比如 license.vue 自己 fetchStatus 被拦),
// 只更新 sessionStorage message, 不重复跳转, 避免死循环
_client.addResponseInterceptor({
  rejected: (error: any) => {
    const data = error?.response?.data;
    if (error?.response?.status === 403 && data?.type === 'license_invalid') {
      sessionStorage.setItem('license_message', data.message || '');
      if (!window.location.pathname.startsWith('/auth/license')) {
        window.location.href = '/auth/license';
      }
      return new Promise(() => {});
    }
    return Promise.reject(error);
  },
});

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
  /** 完全静默：不显示任何提示（含错误），调用方自行 try-catch 处理 */
  silent?: boolean;
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
    const config: any = { params: options?.params };
    if (silent) config._silent = true;
    if (method === 'GET') {
      body = await _client.get(url, config);
    } else {
      body = await _client.post(url, data, config);
    }
  } catch (e) {
    hideLoading?.();
    throw e;
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
