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
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
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

/**
 * 安装前生成品牌 Logo（系统未安装时调用）。
 * 后端按产品名推导单字标并渲染品牌图标，返回 base64 预览图（与安装后 images/logo.png 一致）。
 */
export interface GeneratedLogoSpec {
  accentFrom: string;
  accentTo: string;
  darkBg: string;
  generatedAt: string;
  lightBg: string;
  monoColor: string;
  monogram: string;
  productCn: string;
  productEn: string;
}

export async function generateLogoApi(
  params: {
    productCn?: string;
    productEn?: string;
  } = {},
) {
  return setupFetch<{
    logoBase64: string;
    spec: GeneratedLogoSpec;
  }>('/Setup/GenerateLogo', params);
}

export async function installApi(request: Record<string, any>) {
  return setupFetch('/Setup/Install', request);
}

export async function getDeployHintsApi() {
  return setupFetch<{
    adminPath: string;
    apiPath: string;
    database?: {
      database: string;
      dbType: string;
      password: string;
      port: string;
      server: string;
      user: string;
    };
    h5Path: string;
    isDocker?: boolean;
  }>('/Setup/DeployHints');
}
