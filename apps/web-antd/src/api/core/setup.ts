/**
 * 安装向导 API
 * 使用 fetch 直接请求，不走 auth 拦截器（安装时没有认证）
 * Setup 端点挂在 /admin/ 下，与业务接口共用 baseURL，nginx 统一反代
 */
import { useAppConfig } from '@vben/hooks';

const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);

const setupApiURL = apiURL;

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

export async function getDeployHintsApi() {
  return setupFetch<{
    isDocker?: boolean;
    apiPath: string;
    adminPath: string;
    h5Path: string;
    database?: {
      dbType: string;
      server: string;
      port: string;
      database: string;
      user: string;
      password: string;
    };
  }>('/Setup/DeployHints');
}
