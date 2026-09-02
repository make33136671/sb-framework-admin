<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { AuthenticationToolbar } from '@vben/layouts';
import { useAccessStore } from '@vben/stores';

import {
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Spin,
  Tag,
} from 'ant-design-vue';

import { api } from '#/api/request';
import { TimeTag } from '#/components/TimeTag';
import { TimezoneDisplay } from '#/components/TimezoneDisplay';
import LicenseUpdatePanel from '#/views/license/LicenseUpdatePanel.vue';

const router = useRouter();
const accessStore = useAccessStore();
// hasToken 用 computed 响应式跟踪 accessStore.accessToken
// 这样 verifyLogin() 检测到 token 无效后调 setAccessToken(null), UI 会自动切到"前往登录"
const hasToken = computed(() => !!accessStore.accessToken);
// 首次进入时是否已完成 token 有效性验证, 完成前不渲染右侧操作区, 避免"看起来可操作实际 401"的闪烁
const tokenChecked = ref(false);
const statusData = ref<any>(null);
const licenseMessage = ref(
  sessionStorage.getItem('license_message') || '系统授权已过期',
);

// 未配置公钥
const isMissingPublicKey = computed(() => {
  const d = statusData.value;
  return (
    d &&
    d.isEnabled &&
    !d.isValid &&
    !d.isExpired &&
    d.message?.includes('未配置公钥')
  );
});

async function fetchStatus() {
  try {
    statusData.value = await api.get('/Verification/Status', { params: {} });
  } catch {}
}

// 用 fetch 绕开 api.get 的 authenticateResponseInterceptor
// 目的: 让 401 时只清除本地 token + 更新 UI, 不要被拦截器劫持跳去登录页 (因为本页就是未授权态的入口, 期望用户留在这里看到"前往登录"按钮)
// 如果旧 token 无效 (典型场景: 安装向导刚完成, localStorage 里还残留着上一次安装的 token), 清除后 hasToken computed 自动变 false, 右侧切到"前往登录"
async function verifyLogin() {
  const token = accessStore.accessToken;
  if (!token) {
    tokenChecked.value = true;
    return;
  }
  try {
    const baseURL = (import.meta as any).env?.VITE_GLOB_API_URL || '/admin';
    const resp = await fetch(`${baseURL}/Auth/GetInfo`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.status === 401 || resp.status === 403) {
      // token 无效 → 清除, UI 自动切到"前往登录"
      accessStore.setAccessToken(null);
    }
    // 其他状态 (200 / 网络异常 / 5xx) 都保留 token, 让用户仍可操作
  } catch {
    // 网络错误: 保持现状, 不破坏用户可能已有的有效 token
  } finally {
    tokenChecked.value = true;
  }
}

// 程序时区
const appTimeZone = computed<string>(
  () => statusData.value?.appTimeZone || 'UTC',
);

// 到期日期 UTC → Date 对象
const expiresAtDate = computed<Date | null>(() => {
  const raw = statusData.value?.expiresAt;
  if (!raw) return null;
  const hasTz = typeof raw === 'string' && /[Zz]|[+-]\d\d:?\d\d$/.test(raw);
  const iso = hasTz ? raw : `${raw}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
});

function partsInTimeZone(d: Date, timeZone: string) {
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(d);
    const get = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value ?? 0);
    const hour = get('hour');
    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour: hour === 24 ? 0 : hour,
      minute: get('minute'),
      second: get('second'),
    };
  } catch {
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      hour: d.getHours(),
      minute: d.getMinutes(),
      second: d.getSeconds(),
    };
  }
}

// 到期时间按程序时区格式化 (无空格紧凑版, 避免在 Descriptions 单元格里换行)
const expiresAtFormatted = computed(() => {
  const d = expiresAtDate.value;
  if (!d) return '-';
  const p = partsInTimeZone(d, appTimeZone.value);
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const pad4 = (n: number) => String(n).padStart(4, '0');
  return `${pad4(p.year)}年${pad2(p.month)}月${pad2(p.day)}日${pad2(p.hour)}时${pad2(p.minute)}分${pad2(p.second)}秒`;
});

// 用 router.push 而不是 window.location.href, 兼容 hash / history 两种路由模式
// (hash 模式下 window.location.href='/auth/login' 会走到裸路径, 页面虽加载但 vue-router hash 为空会兜底回首页)
function goLogin() {
  router.push({ path: '/auth/login', query: { redirect: '/auth/license' } });
}

function handleLogout() {
  accessStore.setAccessToken(null);
  sessionStorage.removeItem('license_message');
  window.location.href = '/auth/login';
}

const productDisplay = computed(() => {
  const d = statusData.value;
  if (d?.productCn) return d.productCn;
  const appInfo = (window as any).__APP_INFO__;
  if (appInfo?.nameCn) return appInfo.nameCn;
  return '管理系统';
});

// 产品基本信息：优先取 statusData（来自后端 /Verification/Status），
// 后退到 __APP_INFO__（来自 /storage/app-info.json，安装向导生成）
// 这样即使未启用授权（statusData 为空）也能展示产品身份
const appInfo = (window as any).__APP_INFO__ || {};
const appLogo = computed<string>(
  () => appInfo.logo || '/storage/images/logo.png',
);
const productCnText = computed<string>(
  () => statusData.value?.productCn || appInfo.nameCn || '管理系统',
);
const productEnText = computed<string>(
  () => statusData.value?.productEn || appInfo.nameEn || '',
);
const domainText = computed<string>(
  () => statusData.value?.domain || appInfo.domain || '',
);

// LicenseUpdatePanel 更新成功回调 - 跳首页让用户重新进入系统
function onUpdateSuccess() {
  setTimeout(() => {
    window.location.href = '/';
  }, 1500);
}

onMounted(() => {
  // /admin/Verification/Status 是 AllowAnonymous, 无论是否登录都可访问
  fetchStatus();
  // 并行验证 token 有效性 (决定右侧是显示"前往登录"还是 LicenseUpdatePanel)
  verifyLogin();
});
</script>

<template>
  <div
    style="
      position: relative;
      min-height: 100vh;
      background: var(--ant-color-bg-layout);
    "
  >
    <!-- 左上角: 产品名 + 过期 Tag + (登录状态下) 退出按钮 -->
    <div
      style="
        position: absolute;
        top: 16px;
        left: 24px;
        z-index: 5;
        display: flex;
        gap: 12px;
        align-items: center;
      "
    >
      <span
        style="font-size: 18px; font-weight: 600; color: var(--ant-color-text)"
      >
        {{ productDisplay }}
      </span>
      <Tag v-if="statusData && isMissingPublicKey" color="red" style="margin: 0"
        >未配置公钥</Tag
      >
      <Tag v-else-if="statusData" color="orange" style="margin: 0"
        >授权已过期</Tag
      >
      <Button v-if="hasToken" size="small" @click="handleLogout">
        退出登录
      </Button>
    </div>

    <!-- 右上角: vben 内置工具条(调色板/布局/语言/亮暗模式) -->
    <AuthenticationToolbar />

    <!-- 中间内容区 -->
    <div
      style="
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        padding: 72px 24px 24px;
      "
    >
      <Card style="width: 100%; max-width: 1100px">
        <!-- 左右布局: 左 (标题 + 授权信息) / 右获取授权 -->
        <!-- 关键: 右侧容器 min-height 预留离线 tab 的最大高度, 切换 tab 不跳动 -->
        <div
          style="
            display: flex;
            flex-wrap: wrap;
            gap: 32px;
            align-items: flex-start;
          "
        >
          <!-- 左侧: 授权状态标题 + 授权详情（产品身份合到表格里）-->
          <div style="flex: 1 1 360px; min-width: 300px">
            <!-- 授权状态标题 (有 statusData 时才显示, 没启用授权就跳过)-->
            <div
              v-if="statusData"
              style="margin-bottom: 24px; text-align: center"
            >
              <div
                :style="{
                  fontSize: '56px',
                  lineHeight: '1',
                  color: isMissingPublicKey ? '#ff4d4f' : '#faad14',
                  marginBottom: '16px',
                }"
              >
                {{ isMissingPublicKey ? '⛔' : '⚠' }}
              </div>
              <h2
                style="
                  margin: 0 0 8px;
                  font-size: 22px;
                  font-weight: 600;
                  color: var(--ant-color-text);
                "
              >
                {{ isMissingPublicKey ? '未配置 RSA 公钥' : '系统授权已到期' }}
              </h2>
              <p
                style="
                  margin: 0;
                  font-size: 14px;
                  color: var(--ant-color-text-secondary);
                "
              >
                {{
                  isMissingPublicKey
                    ? '请在 appsettings.json 中配置 LicenseConfig:PublicKeyXml 后重启服务'
                    : '请联系管理员续期授权'
                }}
              </p>
            </div>
            <Descriptions
              v-if="statusData"
              bordered
              :column="1"
              size="small"
              :label-style="{ width: '110px', whiteSpace: 'nowrap' }"
            >
              <DescriptionsItem label="产品名称">
                <div style="display: flex; gap: 10px; align-items: center">
                  <img
                    :src="appLogo"
                    :alt="productCnText"
                    style="
                      flex-shrink: 0;
                      width: 32px;
                      height: 32px;
                      object-fit: contain;
                      border-radius: 4px;
                    "
                  />
                  <div style="min-width: 0">
                    <div style="font-weight: 500; line-height: 1.3">
                      {{ productCnText }}
                    </div>
                    <div
                      v-if="productEnText"
                      style="
                        font-size: 12px;
                        line-height: 1.3;
                        color: var(--ant-color-text-tertiary);
                      "
                    >
                      {{ productEnText }}
                    </div>
                  </div>
                </div>
              </DescriptionsItem>
              <DescriptionsItem label="授权状态">
                <Tag v-if="statusData.isValid" color="green">有效</Tag>
                <Tag v-else-if="statusData.isExpired" color="orange"
                  >已到期</Tag
                >
                <Tag v-else color="red">无效</Tag>
              </DescriptionsItem>
              <DescriptionsItem label="到期时间">
                <TimeTag
                  :color="statusData.isExpired ? 'red' : 'blue'"
                  :time="expiresAtFormatted"
                  :timezone="appTimeZone"
                />
              </DescriptionsItem>
              <DescriptionsItem label="配置域名">
                {{ domainText || '-' }}
              </DescriptionsItem>
              <DescriptionsItem
                v-if="
                  statusData.licenseDomains?.length || statusData.licenseDomain
                "
                label="授权允许域名"
              >
                <Tag
                  v-for="d in statusData.licenseDomains || [
                    statusData.licenseDomain,
                  ]"
                  :key="d"
                  color="blue"
                  style="margin-bottom: 2px"
                  >{{ d }}</Tag
                >
              </DescriptionsItem>
              <DescriptionsItem label="启用验证项">
                <Tag v-if="statusData.requiresProduct" color="blue">产品名</Tag>
                <Tag v-if="statusData.requiresDomain" color="blue">域名</Tag>
                <Tag v-if="statusData.requiresClientKey" color="blue"
                  >ClientKey</Tag
                >
                <Tag v-if="statusData.requiresHardwareId" color="blue"
                  >HardwareId</Tag
                >
                <span
                  v-if="
                    !statusData.requiresProduct &&
                    !statusData.requiresDomain &&
                    !statusData.requiresClientKey &&
                    !statusData.requiresHardwareId
                  "
                  style="font-size: 12px; color: var(--ant-color-text-tertiary)"
                >
                  仅验证到期
                </span>
              </DescriptionsItem>
              <DescriptionsItem label="机器名">
                {{ statusData.identity?.hardwareInfo?.machineName || '-' }}
              </DescriptionsItem>
              <DescriptionsItem label="操作系统">
                <span style="font-size: 12px; overflow-wrap: break-word">
                  {{ statusData.identity?.hardwareInfo?.osDescription || '-' }}
                </span>
              </DescriptionsItem>
              <DescriptionsItem label="CPU 核心">
                {{ statusData.identity?.hardwareInfo?.processorCount || '-' }}
              </DescriptionsItem>
              <DescriptionsItem
                v-if="statusData.identity?.hardwareInfo?.macAddresses?.length"
                label="MAC 地址"
              >
                <span style="font-family: monospace; font-size: 12px">
                  {{ statusData.identity.hardwareInfo.macAddresses.join(', ') }}
                </span>
              </DescriptionsItem>
              <DescriptionsItem label="程序时区">
                <TimezoneDisplay :timezone="appTimeZone" />
              </DescriptionsItem>
            </Descriptions>

            <!-- statusData 为空（未启用授权 / 接口未响应）时，只显示产品身份单行表格 -->
            <Descriptions
              v-else
              bordered
              :column="1"
              size="small"
              :label-style="{ width: '110px', whiteSpace: 'nowrap' }"
            >
              <DescriptionsItem label="产品名称">
                <div style="display: flex; gap: 10px; align-items: center">
                  <img
                    :src="appLogo"
                    :alt="productCnText"
                    style="
                      flex-shrink: 0;
                      width: 32px;
                      height: 32px;
                      object-fit: contain;
                      border-radius: 4px;
                    "
                  />
                  <div style="min-width: 0">
                    <div style="font-weight: 500; line-height: 1.3">
                      {{ productCnText }}
                    </div>
                    <div
                      v-if="productEnText"
                      style="
                        font-size: 12px;
                        line-height: 1.3;
                        color: var(--ant-color-text-tertiary);
                      "
                    >
                      {{ productEnText }}
                    </div>
                  </div>
                </div>
              </DescriptionsItem>
              <DescriptionsItem v-if="domainText" label="配置域名">
                {{ domainText }}
              </DescriptionsItem>
            </Descriptions>
            <p
              v-if="!statusData"
              style="
                margin-top: 12px;
                font-size: 13px;
                color: var(--ant-color-text-secondary);
              "
            >
              {{ licenseMessage.replace(/\s*UTC\s*$/, '') }}
            </p>
          </div>

          <!-- 右侧: 获取授权 -->
          <!-- 布局规则:
               - 验证 token 中 (!tokenChecked): 用 flex 居中显示 Spin loading
               - 验证完成: LicenseUpdatePanel 始终渲染 (absolute 定位占满右侧),
                 未登录时由 LicenseUpdatePanel 内部显示"需要登录"蒙板, 用户点蒙板上的按钮触发 goLogin -->
          <div
            :style="{
              flex: '1 1 420px',
              minWidth: '0',
              minHeight: tokenChecked ? '540px' : 'auto',
              position: 'relative',
              display: !tokenChecked ? 'flex' : undefined,
              alignItems: !tokenChecked ? 'center' : undefined,
              justifyContent: !tokenChecked ? 'center' : undefined,
              borderLeft: '1px solid var(--ant-color-border)',
              paddingLeft: '32px',
            }"
          >
            <!-- 验证 token 中: 避免旧 token 造成的"看起来可操作但实际 401"闪烁 -->
            <div
              v-if="!tokenChecked"
              style="padding: 40px 0; text-align: center"
            >
              <Spin size="large" />
              <p
                style="
                  margin-top: 16px;
                  font-size: 14px;
                  color: var(--ant-color-text-secondary);
                "
              >
                正在检测登录状态...
              </p>
            </div>

            <!-- 已验证: 始终渲染 LicenseUpdatePanel
                 未登录时 login-required=true, 组件内部会覆盖"需要登录"蒙板,
                 用户仍能看到操作面板轮廓, 但必须主动点蒙板上的"前往登录"按钮 -->
            <LicenseUpdatePanel
              v-else
              :status-data="statusData"
              :login-required="!hasToken"
              success-button-text="授权有效，点击进入系统"
              style="position: absolute; inset: 0"
              @success="onUpdateSuccess"
              @login="goLogin"
            />
          </div>
        </div>
      </Card>
    </div>
  </div>
</template>
