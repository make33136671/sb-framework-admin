/**
 * 安装向导 API
 * 使用 fetch 直接请求，不走 auth 拦截器（安装时没有认证）
 */
import { useAppConfig } from '@vben/hooks';

const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);

interface ApiResult<T = any> {
  code: number;
  data: T;
  message: string;
}

async function setupFetch<T = any>(
  url: string,
  data?: Record<string, any>,
): Promise<ApiResult<T>> {
  const res = await fetch(`${apiURL}${url}`, {
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
