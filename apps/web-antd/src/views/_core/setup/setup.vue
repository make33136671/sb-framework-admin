<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { resetAllStores } from '@vben/stores';

import {
  Alert,
  Button,
  Card,
  Checkbox,
  Descriptions,
  DescriptionsItem,
  Divider,
  Input,
  InputPassword,
  message,
  Radio,
  RadioGroup,
  Result,
  Space,
  Spin,
  Steps,
  Tag,
} from 'ant-design-vue';

import {
  checkSetupStatusApi,
  getDeployHintsApi,
  installApi,
  testDatabaseApi,
  testRedisApi,
} from '#/api';

defineOptions({ name: 'Setup' });

const router = useRouter();

// === 状态 ===
const currentStep = ref(0);
const installed = ref(false);
const installing = ref(false);
const installResult = ref<null | { message: string; success: boolean; data?: any }>(null);

// 数据库
const dbType = ref('MySql');
const dbServer = ref('127.0.0.1');
const dbPort = ref('3306');
const dbName = ref((() => { const n = extractNameFromDomain(extractRootDomain(window.location.hostname)); return n.charAt(0).toUpperCase() + n.slice(1); })());
const dbUser = ref('root');
const dbPassword = ref('');
const dbTestResult = ref<null | { message: string; success: boolean; data?: any }>(null);
const dbTesting = ref(false);
const wipeDatabase = ref(false);

// 缓存
const enableCache = ref(false);
const cacheProvider = ref('Memory');
const redisConnection = ref('');
const redisTestResult = ref<null | { message: string; success: boolean }>(null);
const redisTesting = ref(false);

// 时区
const timeZone = ref('Asia/Shanghai');
const commonTimeZones = [
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Taipei',
  'Asia/Bangkok',
  'Asia/Ho_Chi_Minh',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Pacific/Auckland',
  'Australia/Sydney',
  'UTC',
];

// 应用
const productCn = ref('管理系统');
const corsAllowAll = ref(true);
const corsOrigins = ref<string[]>(
  /^(\d{1,3}\.){3}\d{1,3}$/.test(extractRootDomain(window.location.hostname)) || window.location.hostname === 'localhost'
    ? []
    : [`https://${extractRootDomain(window.location.hostname)}`, `https://*.${extractRootDomain(window.location.hostname)}`]
);
const corsOriginInput = ref('');

// 主域名 + 产品品牌
function extractRootDomain(hostname: string): string {
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname === 'localhost') {
    return hostname;
  }
  const parts = hostname.split('.');
  return parts.length > 2 ? parts.slice(-2).join('.') : hostname;
}

// 从域名提取产品英文名：去掉后缀(.com等)和子域名，只保留主体
function extractNameFromDomain(domain: string): string {
  if (!domain || /^(\d{1,3}\.){3}\d{1,3}$/.test(domain) || domain === 'localhost') {
    return 'sb';
  }
  const parts = domain.split('.');
  // 取倒数第二段（主体部分），如 example.com → example
  const name = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  // 只保留小写字母和数字
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'sb';
}

const defaultDomain = extractRootDomain(window.location.hostname);
const primaryDomain = ref(defaultDomain);
const productEn = ref(extractNameFromDomain(defaultDomain));
const logoBase64 = ref('');
const logoPreviewUrl = ref('');
const cachePrefix = ref(`${productEn.value}:`);

// 站点路径（默认基于英文名）
const _initName = productEn.value;
const sitePaths = ref([
  { type: 'admin', path: `/www/wwwroot/${_initName}_admin` },
  { type: 'h5', path: `/www/wwwroot/${_initName}_h5` },
]);

// 云端中心地址（授权 / 备份等所有云端功能共用）
const cloudServerUrl = ref('https://cloud.saibo.club');

// 密码
const passwordStorageMode = ref('Encrypted');

// 管理员
const adminUsername = ref('admin');
const adminPassword = ref('');
const adminPasswordConfirm = ref('');
const adminDisplayName = ref('超级管理员');

// === 步骤定义 ===
const stepItems = [
  { title: '产品' },
  { title: '数据库' },
  { title: '缓存' },
  { title: '部署' },
  { title: '密码' },
  { title: '管理员' },
  { title: '确认' },
];

// === 计算 ===
const dbTypeLabel = computed(() =>
  dbType.value === 'PostgreSql' ? 'PostgreSQL' : 'MySQL',
);

// === Docker 模式标记 ===
const isDocker = ref(false);

// === 初始化 ===
onMounted(async () => {
  try {
    const res = await checkSetupStatusApi();
    if (res.code === 0 && res.data?.installed) {
      installed.value = true;
    }
  } catch {}

  try {
    const res = await getDeployHintsApi();
    if (res.code === 0 && res.data) {
      const hints = res.data;
      if (hints.isDocker) {
        isDocker.value = true;
        if (hints.database) {
          dbType.value = hints.database.dbType;
          dbServer.value = hints.database.server;
          dbPort.value = hints.database.port;
          dbName.value = hints.database.database;
          dbUser.value = hints.database.user;
          dbPassword.value = hints.database.password;
        }
        sitePaths.value = [
          { type: 'admin', path: hints.adminPath || '/app/admin-ui' },
          { type: 'h5', path: hints.h5Path || '/app/user-ui' },
        ];
      } else if (hints.adminPath || hints.h5Path) {
        sitePaths.value = [
          { type: 'admin', path: hints.adminPath || '' },
          { type: 'h5', path: hints.h5Path || '' },
        ];
      }
    }
  } catch {}
});

// === 数据库类型切换 ===
function onDbTypeChange(val: string) {
  if (isDocker.value && val !== 'PostgreSql') return;
  dbType.value = val;
  if (val === 'PostgreSql' && dbPort.value === '3306') {
    dbPort.value = '5432';
  } else if (val === 'MySql' && dbPort.value === '5432') {
    dbPort.value = '3306';
  }
}

// === CORS ===
function addCorsOrigin() {
  const v = corsOriginInput.value.trim();
  if (v && !corsOrigins.value.includes(v)) {
    corsOrigins.value.push(v);
  }
  corsOriginInput.value = '';
}

function removeCorsOrigin(index: number) {
  corsOrigins.value.splice(index, 1);
}

// === 主域名联动 ===
function onPrimaryDomainChange() {
  const domain = primaryDomain.value.trim();
  // 联动英文名
  const name = extractNameFromDomain(domain);
  productEn.value = name;
  onProductEnChange();
  // 联动 CORS 默认来源
  if (domain && !corsOrigins.value.length) {
    corsOrigins.value = [`https://${domain}`, `https://*.${domain}`];
  }
}

// === 产品英文名联动 ===
function onProductEnChange() {
  const name = productEn.value.toLowerCase().replace(/[^a-z0-9]/g, '');
  productEn.value = name;
  // 联动数据库名（首字母大写）— Docker 模式使用容器预设值，跳过
  if (name && !isDocker.value) {
    dbName.value = name.charAt(0).toUpperCase() + name.slice(1);
  }
  // 联动缓存前缀
  cachePrefix.value = name ? `${name}:` : 'sb:';
  // 联动站点路径 — Docker 模式使用容器预设路径，跳过
  if (!isDocker.value) {
    sitePaths.value.forEach(s => {
      s.path = `/www/wwwroot/${name}_${s.type}`;
    });
  }
}

// === Logo 上传 ===
function handleLogoUpload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const allowed = ['image/png', 'image/jpeg', 'image/x-icon', 'image/vnd.microsoft.icon'];
  if (!allowed.includes(file.type)) {
    message.error('仅支持 PNG、JPG、ICO 格式');
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    message.error('Logo 文件不能超过 2MB');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    logoBase64.value = e.target?.result as string;
    logoPreviewUrl.value = logoBase64.value;
  };
  reader.readAsDataURL(file);
}

// === 站点路径 ===
function addSitePath() {
  sitePaths.value.push({ type: '', path: '' });
}

function removeSitePath(index: number) {
  sitePaths.value.splice(index, 1);
}

// === 验证 ===
function validateStep(step: number): boolean {
  // Step 0: 产品信息
  if (step === 0) {
    if (!productEn.value || !/^[a-z][a-z0-9]{1,19}$/.test(productEn.value)) {
      message.warning('产品英文名称只允许小写字母和数字，2-20字符，字母开头');
      return false;
    }
  }
  // Step 1: 数据库
  if (step === 1) {
    if (!dbServer.value || !dbPort.value || !dbName.value || !dbUser.value) {
      message.warning('请填写完整的数据库配置');
      return false;
    }
  }
  // Step 5: 管理员
  if (step === 5) {
    if (!adminUsername.value) {
      message.warning('请输入管理员用户名');
      return false;
    }
    if (!adminPassword.value || adminPassword.value.length < 6) {
      message.warning('密码至少6位');
      return false;
    }
    if (adminPassword.value !== adminPasswordConfirm.value) {
      message.warning('两次密码不一致');
      return false;
    }
  }
  return true;
}

function nextStep() {
  if (!validateStep(currentStep.value)) return;
  if (currentStep.value < 6) {
    currentStep.value++;
  }
}

function prevStep() {
  if (currentStep.value > 0) {
    currentStep.value--;
  }
}

// === API 调用 ===
async function testDb() {
  dbTesting.value = true;
  dbTestResult.value = null;
  try {
    const r = await testDatabaseApi({
      dbType: dbType.value,
      server: dbServer.value,
      port: dbPort.value,
      database: dbName.value,
      user: dbUser.value,
      password: dbPassword.value,
    });
    dbTestResult.value = {
      success: r.code === 0,
      message: r.message,
      data: r.data,
    };
    // 重置抹除选项
    wipeDatabase.value = false;
  } catch (e: any) {
    dbTestResult.value = {
      success: false,
      message: `请求失败: ${e.message}`,
    };
  } finally {
    dbTesting.value = false;
  }
}

async function testRedis() {
  redisTesting.value = true;
  redisTestResult.value = null;
  try {
    const r = await testRedisApi({
      connection: redisConnection.value || `${dbServer.value}:6379`,
      instanceName: cachePrefix.value,
    });
    redisTestResult.value = {
      success: r.code === 0,
      message: r.message,
    };
  } catch (e: any) {
    redisTestResult.value = {
      success: false,
      message: `请求失败: ${e.message}`,
    };
  } finally {
    redisTesting.value = false;
  }
}

async function doInstall() {
  installing.value = true;
  installResult.value = null;
  try {
    const payload = {
      database: {
        dbType: dbType.value,
        server: dbServer.value,
        port: dbPort.value,
        database: dbName.value,
        user: dbUser.value,
        password: dbPassword.value,
      },
      enableCache: enableCache.value,
      cacheProvider: cacheProvider.value,
      redis:
        enableCache.value && cacheProvider.value === 'Redis'
          ? {
              connection: redisConnection.value || `${dbServer.value}:6379`,
              instanceName: cachePrefix.value,
            }
          : null,
      wipeDatabase: wipeDatabase.value,
      passwordStorageMode: passwordStorageMode.value,
      productCn: productCn.value || '管理系统',
      timeZone: timeZone.value || 'Asia/Shanghai',
      corsAllowAll: corsAllowAll.value,
      corsOrigins: corsAllowAll.value ? [] : corsOrigins.value,
      adminUsername: adminUsername.value,
      adminPassword: adminPassword.value,
      adminDisplayName: adminDisplayName.value || '超级管理员',
      productEn: productEn.value || 'sb',
      primaryDomain: primaryDomain.value || defaultDomain,
      cachePrefix: cachePrefix.value || 'sb:',
      logoBase64: logoBase64.value || undefined,
      cloudServerUrl: cloudServerUrl.value.trim() || undefined,
      deployProjects: sitePaths.value
        .filter(s => s.type && s.path)
        .map(s => ({ name: s.type, key: s.type, path: s.path })),
    };
    const r = await installApi(payload);
    installResult.value = {
      success: r.code === 0,
      message: r.message,
      data: r.data,
    };
    // 安装成功后延迟检测服务器重启
    if (r.code === 0) {
      // 安装完成即进入新系统, 清除所有历史登录态 (accessToken / userInfo / 菜单路由等)
      // 避免浏览器残留的旧 token 让后续进入 /auth/license 或 / 时看起来"已登录"但实际 401
      resetAllStores();
      setTimeout(() => checkServerReady(), 3000);
    }
  } catch (e: any) {
    installResult.value = {
      success: false,
      message: `请求失败: ${e.message}`,
    };
  } finally {
    installing.value = false;
  }
}

function retryInstall() {
  installResult.value = null;
  currentStep.value = 0;
}

// === 安装成功后：重启检测 ===
const serverReady = ref(false);
const serverChecking = ref(false);

async function checkServerReady() {
  serverChecking.value = true;
  const maxAttempts = 30; // 最多等 30 秒
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await checkSetupStatusApi();
      if (res.code === 0 && res.data?.installed) {
        serverReady.value = true;
        serverChecking.value = false;
        return;
      }
    } catch {
      // 服务器还没启动，继续等
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  serverChecking.value = false;
}

// 用 router.push 保证 hash / history 两种路由模式下 URL 都正确
// (生产环境 VITE_ROUTER_HISTORY=hash, 直接 window.location.href='/auth/license'
// 会走到非 hash 形式的 URL, 页面虽然加载但 vue-router 识别不到预期路由)
function goHome() {
  router.push('/');
}

function goLicense() {
  router.push('/auth/license');
}

// === 配置导入导出 ===
function exportConfig() {
  const config = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    database: {
      dbType: dbType.value,
      server: dbServer.value,
      port: dbPort.value,
      database: dbName.value,
      user: dbUser.value,
      password: dbPassword.value,
    },
    cache: {
      enabled: enableCache.value,
      provider: cacheProvider.value,
      redis: {
        connection: redisConnection.value || `${dbServer.value}:6379`,
        instanceName: cachePrefix.value,
      },
    },
    app: {
      productCn: productCn.value || '管理系统',
      productEn: productEn.value || 'sb',
      primaryDomain: primaryDomain.value || defaultDomain,
      timeZone: timeZone.value || 'Asia/Shanghai',
      cachePrefix: cachePrefix.value || 'sb:',
      corsAllowAll: corsAllowAll.value,
      corsOrigins: [...corsOrigins.value],
      passwordStorageMode: passwordStorageMode.value,
      cloudServerUrl: cloudServerUrl.value || '',
    },
    admin: {
      username: adminUsername.value,
      displayName: adminDisplayName.value || '超级管理员',
      password: adminPassword.value,
    },
  };
  const blob = new Blob([JSON.stringify(config, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'setup-config.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importConfig() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.addEventListener('change', (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener('load', (ev) => {
      try {
        const config = JSON.parse(ev.target?.result as string);
        if (!config.version || !config.database) {
          message.error('无效的配置文件格式');
          return;
        }
        fillFormFromConfig(config);
        message.success('配置已导入');
      } catch (err: any) {
        message.error(`解析失败: ${err.message}`);
      }
    });
    reader.readAsText(file);
  });
  input.click();
}

function fillFormFromConfig(config: any) {
  const db = config.database || {};
  if (db.dbType) onDbTypeChange(db.dbType);
  if (db.server) dbServer.value = db.server;
  if (db.port) dbPort.value = db.port;
  if (db.database) dbName.value = db.database;
  if (db.user) dbUser.value = db.user;
  if (db.password !== undefined) dbPassword.value = db.password;

  const cache = config.cache || {};
  enableCache.value = !!cache.enabled;
  if (cache.provider) cacheProvider.value = cache.provider;
  if (cache.redis?.connection) redisConnection.value = cache.redis.connection;
  if (cache.redis?.instanceName)
    cachePrefix.value = cache.redis.instanceName;

  const app = config.app || {};
  if (app.productCn) productCn.value = app.productCn;
  if (app.productEn) productEn.value = app.productEn;
  if (app.primaryDomain) primaryDomain.value = app.primaryDomain;
  if (app.cachePrefix) cachePrefix.value = app.cachePrefix;
  if (app.corsAllowAll !== undefined) corsAllowAll.value = app.corsAllowAll;
  if (Array.isArray(app.corsOrigins)) corsOrigins.value = [...app.corsOrigins];
  if (app.passwordStorageMode)
    passwordStorageMode.value = app.passwordStorageMode;
  if (app.cloudServerUrl) cloudServerUrl.value = app.cloudServerUrl;
  if (app.timeZone) timeZone.value = app.timeZone;

  const admin = config.admin || {};
  if (admin.username) adminUsername.value = admin.username;
  if (admin.displayName) adminDisplayName.value = admin.displayName;
  if (admin.password !== undefined) {
    adminPassword.value = admin.password;
    adminPasswordConfirm.value = admin.password;
  }
}
</script>

<template>
  <div class="setup-page">
    <!-- Header -->
    <div class="setup-header">
      <h1>系统安装向导</h1>
      <p>按照步骤完成系统初始化配置</p>
    </div>

    <div class="setup-container">
      <!-- 已安装状态 -->
      <Card v-if="installed" class="setup-card">
        <Result status="success" title="系统已安装" sub-title="系统已完成安装配置。">
          <template #extra>
            <Button type="primary" @click="router.push('/auth/login')">
              前往登录
            </Button>
          </template>
        </Result>
      </Card>

      <!-- 安装中 -->
      <template v-else-if="installing">
        <Card class="setup-card">
          <div class="install-loading">
            <Spin size="large" />
            <h3>正在安装...</h3>
            <p>正在创建数据库表、写入初始数据和更新配置文件，请稍候</p>
          </div>
        </Card>
      </template>

      <!-- 安装结果 -->
      <template v-else-if="installResult">
        <Card class="setup-card">
          <Result
            v-if="installResult.success"
            status="success"
            title="系统安装完成"
          >
            <template #subTitle>
              <div style="display: flex; gap: 8px; align-items: center; justify-content: center;">
                <template v-if="serverReady">
                  <span style="color: var(--ant-color-success);">&#10003;</span> 系统初始化完成
                </template>
                <template v-else>
                  <Spin size="small" /> 系统正在启动...
                </template>
              </div>
            </template>
            <template #extra>
              <Space>
                <Button type="primary" :disabled="!serverReady" @click="goHome">前往首页</Button>
                <Button :disabled="!serverReady" @click="goLicense">前往授权</Button>
              </Space>
            </template>
          </Result>
          <Result
            v-else
            status="error"
            :title="installResult.message"
            sub-title="安装过程中发生错误"
          >
            <template #extra>
              <Button type="primary" @click="retryInstall">返回重试</Button>
            </template>
          </Result>
        </Card>
      </template>

      <!-- 安装向导 -->
      <template v-else>
        <!-- 工具栏 -->
        <div class="setup-toolbar">
          <Space>
            <Button @click="importConfig">导入配置</Button>
            <Button @click="exportConfig">导出配置</Button>
          </Space>
        </div>

        <!-- 步骤条 -->
        <Card class="setup-card steps-card">
          <Steps :current="currentStep" :items="stepItems" size="small" />
        </Card>

        <!-- Step 1: 数据库配置 -->
        <Card v-if="currentStep === 1" class="setup-card">
          <h3>数据库配置</h3>
          <p class="step-desc">
            配置 {{ dbTypeLabel }} 数据库连接信息
          </p>

          <div class="form-item">
            <label>数据库类型</label>
            <RadioGroup :value="dbType" @change="(e: any) => onDbTypeChange(e.target.value)">
              <Radio v-if="!isDocker" value="MySql">MySQL</Radio>
              <Radio value="PostgreSql">PostgreSQL</Radio>
            </RadioGroup>
          </div>

          <div class="form-row">
            <div class="form-item">
              <label>服务器地址</label>
              <Input v-model:value="dbServer" placeholder="127.0.0.1" />
            </div>
            <div class="form-item">
              <label>端口</label>
              <Input v-model:value="dbPort" :placeholder="dbType === 'PostgreSql' ? '5432' : '3306'" />
            </div>
          </div>

          <div class="form-item">
            <label>数据库名称</label>
            <Input v-model:value="dbName" placeholder="Saibo" />
          </div>

          <div class="form-row">
            <div class="form-item">
              <label>用户名</label>
              <Input v-model:value="dbUser" placeholder="root" />
            </div>
            <div class="form-item">
              <label>密码</label>
              <InputPassword v-model:value="dbPassword" placeholder="数据库密码" />
            </div>
          </div>

          <Button :loading="dbTesting" @click="testDb">测试连接</Button>
          <Alert
            v-if="dbTestResult"
            class="test-alert"
            :type="dbTestResult.success ? 'success' : 'error'"
            :message="dbTestResult.message"
            show-icon
          />

          <!-- 数据库已存在时：抹除选项 -->
          <template v-if="dbTestResult?.success && dbTestResult.data?.dbExists">
            <Alert
              class="test-alert"
              type="warning"
              show-icon
            >
              <template #message>
                <div style="display: flex; gap: 8px; align-items: center;">
                  <label style=" display: flex; gap: 6px; align-items: center; margin: 0;cursor: pointer;">
                    <input type="checkbox" :checked="wipeDatabase" @change="wipeDatabase = !wipeDatabase" />
                    <strong>抹除现有数据，重新安装</strong>
                  </label>
                </div>
              </template>
              <template #description>
                <span v-if="wipeDatabase" style="color: var(--ant-color-error);">
                  将删除数据库中所有现有表和数据，此操作不可逆！
                </span>
                <span v-else>
                  不勾选则在现有数据库上安装，已有的同名表会被保留（可能导致数据冲突）
                </span>
              </template>
            </Alert>
          </template>

          <Divider />
          <div class="step-actions">
            <Button @click="prevStep">上一步</Button>
            <Button type="primary" @click="nextStep">下一步</Button>
          </div>
        </Card>

        <!-- Step 2: 缓存配置 -->
        <Card v-if="currentStep === 2" class="setup-card">
          <h3>缓存配置</h3>
          <p class="step-desc">选择是否启用缓存，默认不启用</p>

          <div class="form-item">
            <label>启用缓存</label>
            <RadioGroup v-model:value="enableCache">
              <Radio :value="false">不启用（默认）</Radio>
              <Radio :value="true">启用缓存</Radio>
            </RadioGroup>
          </div>

          <template v-if="enableCache">
            <div class="form-item">
              <label>缓存提供程序</label>
              <RadioGroup v-model:value="cacheProvider">
                <Radio value="Memory">Memory（内存）</Radio>
                <Radio value="Redis">Redis</Radio>
              </RadioGroup>
            </div>

            <template v-if="cacheProvider === 'Redis'">
              <div class="form-item">
                <label>Redis 连接字符串</label>
                <Input v-model:value="redisConnection" :placeholder="`${dbServer}:6379`" />
              </div>
              <Button :loading="redisTesting" @click="testRedis">
                测试连接
              </Button>
              <Alert
                v-if="redisTestResult"
                class="test-alert"
                :type="redisTestResult.success ? 'success' : 'error'"
                :message="redisTestResult.message"
                show-icon
              />
            </template>
          </template>

          <div class="form-item">
            <label>缓存 Key 前缀</label>
            <Input v-model:value="cachePrefix" :placeholder="`${productEn}:`" />
            <div class="form-hint">缓存键前缀，默认基于产品英文名。多项目共享 Redis 时用于隔离</div>
          </div>

          <Divider />
          <div class="step-actions">
            <Button @click="prevStep">上一步</Button>
            <Button type="primary" @click="nextStep">下一步</Button>
          </div>
        </Card>

        <!-- Step 3: 部署配置 -->
        <Card v-if="currentStep === 3" class="setup-card">
          <h3>部署配置</h3>
          <p class="step-desc">配置跨域策略和前端站点部署路径</p>

          <div class="form-item">
            <label>CORS 跨域策略</label>
            <RadioGroup v-model:value="corsAllowAll">
              <Radio :value="true">允许所有来源</Radio>
              <Radio :value="false">指定来源</Radio>
            </RadioGroup>
          </div>

          <template v-if="!corsAllowAll">
            <div class="form-item">
              <label>允许的来源</label>
              <div class="cors-input-row">
                <Input v-model:value="corsOriginInput" placeholder="例如: https://example.com" @press-enter="addCorsOrigin" />
                <Button @click="addCorsOrigin">添加</Button>
              </div>
              <div v-if="corsOrigins.length" class="cors-tags">
                <Tag v-for="(origin, i) in corsOrigins" :key="origin" closable @close="removeCorsOrigin(i)">{{ origin }}</Tag>
              </div>
            </div>
          </template>

          <Divider />

          <div class="form-item">
            <label>站点路径配置</label>
            <div class="form-hint" style="margin-bottom: 8px;">配置前端站点部署路径，安装时自动创建 storage 软连接</div>
            <div v-for="(site, idx) in sitePaths" :key="idx" style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
              <Input v-model:value="site.type" placeholder="类型 (admin/h5)" style="width: 120px;" />
              <Input v-model:value="site.path" placeholder="站点根目录路径" style="flex: 1;" />
              <Button danger size="small" @click="removeSitePath(idx)">删除</Button>
            </div>
            <Button size="small" @click="addSitePath">+ 添加站点</Button>
          </div>

          <Divider />

          <div class="form-item">
            <label>云端中心地址</label>
            <Input v-model:value="cloudServerUrl" placeholder="例如: https://cloud.saibo.club" />
            <div class="form-hint">授权 / 数据库备份 等所有云端服务的统一根地址（只填一次）。只填基地址，不要带 /api/xxx 子路径。留空表示不启用云端功能。</div>
          </div>

          <Divider />
          <div class="step-actions">
            <Button @click="prevStep">上一步</Button>
            <Button type="primary" @click="nextStep">下一步</Button>
          </div>
        </Card>

        <!-- Step 0: 产品信息 -->
        <Card v-if="currentStep === 0" class="setup-card">
          <h3>产品信息</h3>
          <p class="step-desc">配置产品品牌信息、主域名、跨域策略和站点部署路径</p>

          <div class="form-item">
            <label>主域名</label>
            <Input v-model:value="primaryDomain" placeholder="example.com" @change="onPrimaryDomainChange" />
            <div class="form-hint">系统主域名，用于 CORS、授权绑定和产品英文名推导。自动识别当前访问域名（去掉子域名前缀）</div>
          </div>

          <div class="form-item">
            <label>产品英文名称 <span style="color: var(--ant-color-error);">*</span></label>
            <Input v-model:value="productEn" placeholder="小写字母+数字，如 sb" @change="onProductEnChange" />
            <div class="form-hint">默认从主域名提取。用于数据库名、路径前缀、缓存前缀、授权标识。仅小写字母和数字，字母开头，2-20 字符</div>
          </div>

          <div class="form-item">
            <label>产品中文名称</label>
            <Input v-model:value="productCn" placeholder="管理系统" />
          </div>

          <div class="form-item">
            <label>产品 Logo</label>
            <div style="display: flex; gap: 16px; align-items: center;">
              <div v-if="logoPreviewUrl" class="logo-preview">
                <img :src="logoPreviewUrl" style="max-width: 100%; max-height: 100%;" />
              </div>
              <input type="file" accept=".png,.jpg,.jpeg,.ico" @change="handleLogoUpload" />
            </div>
            <div class="form-hint">支持 PNG/JPG/ICO，建议 512x512 以上正方形图片，最大 2MB。将自动生成 favicon 和各尺寸图标</div>
          </div>

          <div class="form-item">
            <label>系统时区</label>
            <select v-model="timeZone" style="width: 100%; padding: 6px 8px; color: var(--ant-color-text); background: var(--ant-color-bg-container); border: 1px solid var(--ant-color-border); border-radius: 6px;">
              <option v-for="tz in commonTimeZones" :key="tz" :value="tz">{{ tz }}</option>
            </select>
            <div class="form-hint">系统业务时间基准时区，影响日期显示和时间计算</div>
          </div>

          <Divider />
          <div class="step-actions">
            <div />
            <Button type="primary" @click="nextStep">下一步</Button>
          </div>
        </Card>

        <!-- Step 3: 密码存储方式 -->
        <Card v-if="currentStep === 4" class="setup-card">
          <h3>密码存储方式</h3>
          <p class="step-desc">选择密码的存储方式（安装后不可修改）</p>

          <Alert
            class="password-warning"
            type="warning"
            show-icon
          >
            <template #message>
              <strong>重要提示：此选择安装后将无法修改</strong>
            </template>
            <template #description>
              <ul class="warning-list">
                <li>选择"加密"后，所有密码均采用BCrypt加密存储（推荐生产环境）</li>
                <li>选择"明文"后，密码以明文形式存储（仅用于开发/测试，不安全）</li>
                <li>修改此设置会导致已有密码无法验证，请谨慎选择</li>
              </ul>
            </template>
          </Alert>

          <div class="form-item">
            <label>密码存储方式</label>
            <RadioGroup v-model:value="passwordStorageMode">
              <Radio value="Encrypted">加密（推荐）</Radio>
              <Radio value="PlainText">明文</Radio>
            </RadioGroup>
          </div>

          <Divider />
          <div class="step-actions">
            <Button @click="prevStep">上一步</Button>
            <Button type="primary" @click="nextStep">下一步</Button>
          </div>
        </Card>

        <!-- Step 4: 管理员配置 -->
        <Card v-if="currentStep === 5" class="setup-card">
          <h3>超级管理员</h3>
          <p class="step-desc">设置系统初始管理员账号</p>

          <div class="form-item">
            <label>用户名</label>
            <Input v-model:value="adminUsername" placeholder="admin" />
          </div>
          <div class="form-item">
            <label>密码（至少6位）</label>
            <InputPassword v-model:value="adminPassword" placeholder="管理员密码" />
          </div>
          <div class="form-item">
            <label>确认密码</label>
            <InputPassword v-model:value="adminPasswordConfirm" placeholder="再次输入密码" />
          </div>
          <div class="form-item">
            <label>显示名称</label>
            <Input v-model:value="adminDisplayName" placeholder="超级管理员" />
          </div>

          <Divider />
          <div class="step-actions">
            <Button @click="prevStep">上一步</Button>
            <Button type="primary" @click="nextStep">下一步</Button>
          </div>
        </Card>

        <!-- Step 6: 确认摘要 -->
        <Card v-if="currentStep === 6" class="setup-card">
          <h3>确认安装信息</h3>
          <p class="step-desc">请确认以下配置无误后执行安装</p>

          <Descriptions bordered :column="1" size="small">
            <DescriptionsItem label="数据库类型">
              {{ dbTypeLabel }}
            </DescriptionsItem>
            <DescriptionsItem label="数据库地址">
              {{ dbServer }}:{{ dbPort }}
            </DescriptionsItem>
            <DescriptionsItem label="数据库名称">
              {{ dbName }}
            </DescriptionsItem>
            <DescriptionsItem label="数据库用户">
              {{ dbUser }}
            </DescriptionsItem>
            <DescriptionsItem v-if="wipeDatabase" label="抹除数据">
              <Tag color="red">是 - 将删除所有现有数据</Tag>
            </DescriptionsItem>
            <DescriptionsItem label="缓存方式">
              {{ enableCache ? cacheProvider : '未启用' }}
            </DescriptionsItem>
            <DescriptionsItem v-if="enableCache && cacheProvider === 'Redis'" label="Redis 连接">
              {{ redisConnection || `${dbServer}:6379` }}
            </DescriptionsItem>
            <DescriptionsItem label="应用名称">
              {{ productCn || '管理系统' }}
            </DescriptionsItem>
            <DescriptionsItem label="产品英文名">
              {{ productEn || 'sb' }}
            </DescriptionsItem>
            <DescriptionsItem label="主域名">
              {{ primaryDomain || defaultDomain }}
            </DescriptionsItem>
            <DescriptionsItem label="产品 Logo">
              <img
                v-if="logoPreviewUrl"
                :src="logoPreviewUrl"
                alt="Logo 预览"
                style="
                  max-width: 120px;
                  max-height: 40px;
                  vertical-align: middle;
                  background: var(--ant-color-bg-container);
                  border: 1px solid var(--ant-color-border);
                  border-radius: 4px;
                "
              />
              <span v-else style="color: var(--ant-color-text-tertiary);">使用默认 Logo</span>
            </DescriptionsItem>
            <DescriptionsItem label="系统时区">
              {{ timeZone }}
            </DescriptionsItem>
            <DescriptionsItem label="缓存前缀">
              {{ cachePrefix || 'sb:' }}
            </DescriptionsItem>
            <DescriptionsItem label="CORS 策略">
              {{ corsAllowAll ? '允许所有来源' : corsOrigins.join(', ') || '无' }}
            </DescriptionsItem>
            <DescriptionsItem label="密码存储方式">
              {{ passwordStorageMode === 'Encrypted' ? '加密' : '明文' }}
            </DescriptionsItem>
            <DescriptionsItem label="管理员账号">
              {{ adminUsername }}
            </DescriptionsItem>
            <DescriptionsItem label="显示名称">
              {{ adminDisplayName || '超级管理员' }}
            </DescriptionsItem>
            <DescriptionsItem label="云端中心地址">
              {{ cloudServerUrl || '未配置' }}
            </DescriptionsItem>
            <DescriptionsItem label="站点路径">
              <div v-for="site in sitePaths.filter(s => s.type && s.path)" :key="site.type">
                {{ site.type }}: {{ site.path }}
              </div>
              <span v-if="!sitePaths.some(s => s.type && s.path)" style="color: var(--ant-color-text-tertiary);">未配置</span>
            </DescriptionsItem>
          </Descriptions>

          <Divider />
          <div class="step-actions">
            <Button @click="prevStep">上一步</Button>
            <Button type="primary" @click="doInstall">确认安装</Button>
          </div>
        </Card>
      </template>
    </div>
  </div>
</template>

<style scoped>
.setup-page {
  min-height: 100vh;
  background: var(--ant-color-bg-layout);
}

/* 头部用主色 + 深变体渐变，亮暗模式下都是深底白字 */
.setup-header {
  padding: 40px 20px 50px;
  color: #fff;
  text-align: center;
  background: linear-gradient(
    135deg,
    var(--ant-color-primary-active) 0%,
    var(--ant-color-primary) 50%,
    var(--ant-color-primary-hover) 100%
  );
}

.setup-header h1 {
  margin-bottom: 8px;
  font-size: 28px;
}

.setup-header p {
  font-size: 14px;
  opacity: 0.7;
}

.setup-container {
  max-width: 700px;
  padding: 0 16px;
  margin: -20px auto 40px;
}

.setup-toolbar {
  display: flex;
  justify-content: center;
  margin-bottom: 16px;
}

.setup-card {
  margin-bottom: 20px;
}

.steps-card :deep(.ant-card-body) {
  padding: 20px 24px;
}

.step-desc {
  margin-bottom: 24px;
  font-size: 13px;
  color: var(--ant-color-text-tertiary);
}

.form-item {
  margin-bottom: 18px;
}

.form-item label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--ant-color-text-secondary);
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.test-alert {
  margin-top: 12px;
}

.step-actions {
  display: flex;
  justify-content: space-between;
}

.cors-input-row {
  display: flex;
  gap: 8px;
}

.cors-tags {
  margin-top: 8px;
}

.password-warning {
  margin-bottom: 20px;
}

.warning-list {
  padding-left: 20px;
  margin: 4px 0 0;
}

.warning-list li {
  font-size: 13px;
}

.install-loading {
  padding: 40px 0;
  text-align: center;
}

.install-loading h3 {
  margin-top: 20px;
  margin-bottom: 8px;
}

.install-loading p {
  font-size: 14px;
  color: var(--ant-color-text-tertiary);
}

.form-hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--ant-color-text-tertiary);
}

.logo-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  overflow: hidden;
  border: 1px solid var(--ant-color-border);
  border-radius: 8px;
}
</style>
