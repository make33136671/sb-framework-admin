/**
 * 安装向导 API
 * 使用 fetch 直接请求，不走 auth 拦截器（安装时没有认证）
 */
import { useAppConfig } from '@vben/hooks';

const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);

// Setup 接口在新版 SB.Framework 挂在 /api/ 下（业务接口在 /admin/），
// 业务 baseURL 末尾的 /admin 替换成 /api 给 Setup 用，兼容 prod 同 host 反代
const setupApiURL = apiURL.replace(/\/admin\/?$/, '/api');

interface ApiResult<T = any> {
  code: number;
  data: T;
  message: string;
}

async function setupFetch<T = any>(
  url: string,
  data?: Record<string, any>,
): Promise<ApiResult<T>> {
  const res = await fetch(`${setupApiURL}${url}`, {
    method: data !== undefined ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
  return res.json();
}

export async function checkSetupStatusApi() {
  return setupFetch<{ installed: boolean }>('/Setup/Status');
}

export async function testDatabaseApi(config: Record<string, any>) {
  return setupFetch('/Setup/TestDatabase', config);
}

export async function testRedisApi(config: Record<string, any>) {
  return setupFetch('/Setup/TestRedis', config);
}

export async function installApi(request: Record<string, any>) {
  return setupFetch('/Setup/Install', request);
}
