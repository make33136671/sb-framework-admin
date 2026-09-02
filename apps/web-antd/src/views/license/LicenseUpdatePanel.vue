<script setup lang="ts">
/**
 * 授权更新面板 — 两种方式的 Tabs 组件
 *
 * 在线授权: 填授权服务器地址 → 调 /Verification/CheckUpdate 走网络获取
 * 离线授权: 展示客户端身份信息供复制 → 粘贴管理员生成的 Key → 调 /Verification/ApplyKey 本地应用
 *
 * 用法:
 *   <LicenseUpdatePanel :status-data="statusData" @success="onSuccess" />
 *
 * Props:
 *   statusData - LicenseStatus 接口返回的完整数据，用于预填 serverUrl 和客户端身份信息
 *
 * Events:
 *   success - 授权更新成功（在线下载或离线应用）后触发，由父组件决定跳转/刷新
 */
import { computed, ref, watch } from 'vue';

import {
  Alert,
  Button,
  Descriptions,
  DescriptionsItem,
  Input,
  message,
  Modal,
  TabPane,
  Tabs,
  Tag,
  Textarea,
} from 'ant-design-vue';

import { api } from '#/api/request';

interface Props {
  statusData: any;
  // 授权应用成功后 Modal 底部按钮的文案, 默认 "确定"
  // 在过期页 (license.vue) 传入 "授权有效，点击进入系统" 以引导用户进入系统
  successButtonText?: string;
  // 未登录态: 为 true 时覆盖"请先登录"蒙板, 阻止用户直接操作
  // 点击蒙板上的"前往登录"按钮会 emit 'login', 由父组件决定跳转方式
  loginRequired?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  successButtonText: '确定',
  loginRequired: false,
});

const emit = defineEmits<{
  (e: 'success'): void;
  (e: 'login'): void;
}>();

const loading = ref(false);

// 未配置公钥时显示蒙板
const isMissingPublicKey = computed(() => {
  const d = props.statusData;
  return (
    d &&
    d.isEnabled &&
    !d.isValid &&
    !d.isExpired &&
    d.message?.includes('未配置公钥')
  );
});

// 授权服务器地址 — localStorage 持久化, 刷新后不丢
const serverUrl = ref<string>(localStorage.getItem('license_server_url') || '');

// 离线授权 Key 输入框
const licenseKeyInput = ref('');

// statusData 载入后, 如果本地还没填过 serverUrl, 用后端返回的 cloudServerUrl 预填
watch(
  () => props.statusData?.cloudServerUrl,
  (newUrl) => {
    if (newUrl && !serverUrl.value) {
      serverUrl.value = newUrl;
    }
  },
  { immediate: true },
);

// 客户端身份信息 — 离线授权时 copy 给管理员生成 Key 用
// product / productCn / domain 都从系统配置取 (后端 GetStatus 已统一从 AppSettings 读,
// 不再依赖当前 License Key 里的内容), actualDomain 是前端实际访问的浏览器 host
const clientInfoText = computed<string>(() => {
  const identity = props.statusData?.identity;
  if (!identity) return '';
  const info = {
    productEn: props.statusData?.productEn ?? '',
    productCn: props.statusData?.productCn ?? '',
    clientKey: identity.clientKey ?? '',
    hardwareId: identity.hardwareId ?? '',
    domain: props.statusData?.domain ?? '', // 系统配置的 PrimaryDomain
    actualDomain: window.location.host, // 浏览器实际访问的域名
    machineName: identity.hardwareInfo?.machineName ?? '',
  };
  return JSON.stringify(info, null, 2);
});

// 授权结果弹窗（在线查询 / 离线应用 共用）
const queryResult = ref<any>(null);
const queryVisible = ref(false);
const applyLoading = ref(false);
// 应用授权失败时的错误信息, 显示在 Modal 表格和按钮之间 (不用全局 message 弹条)
const applyError = ref<string>('');

const fmtTime = (v: string) => {
  if (!v) return '-';
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

async function handleCheckUpdate() {
  if (!serverUrl.value.trim()) {
    message.warning('请填写授权服务器地址');
    return;
  }
  localStorage.setItem('license_server_url', serverUrl.value.trim());
  loading.value = true;
  try {
    // actualDomain 是浏览器实际访问的 host, 后端会把它和 appsettings.PrimaryDomain 一起
    // 发给授权服务器, 便于识别"配置声明域名 vs 实际运行域名"不一致的场景
    const actualDomain = window.location.host;
    const data: any = await api.post(
      `/Verification/CheckUpdate?serverUrl=${encodeURIComponent(serverUrl.value.trim())}&actualDomain=${encodeURIComponent(actualDomain)}`,
      {},
      { quiet: true },
    );
    // 当前授权被吊销 → 提示并刷新
    if (data?.currentRevoked) {
      message.error('当前授权已被服务器吊销，系统将进入无授权状态');
      setTimeout(() => {
        emit('success');
      }, 1500);
    }

    if (data?.available) {
      queryResult.value = data;
      queryVisible.value = true;
    } else if (!data?.currentRevoked) {
      message.info(data?.message || '暂无可用的新授权');
    }
    // 失败 toast 由 axios 拦截器统一弹
  } finally {
    loading.value = false;
  }
}

async function handleApplyFromServer() {
  applyError.value = '';
  applyLoading.value = true;
  try {
    await api.post(
      `/Verification/ApplyLicense?recordId=${queryResult.value.recordId}&serverUrl=${encodeURIComponent(serverUrl.value.trim())}`,
      {},
    );
    queryResult.value = { ...queryResult.value, applied: true };
  } catch (e: any) {
    applyError.value = e?.message || '应用失败';
  } finally {
    applyLoading.value = false;
  }
}

async function handleApplyKey() {
  if (!licenseKeyInput.value.trim()) {
    message.warning('请粘贴管理员生成的授权 Key');
    return;
  }
  loading.value = true;
  try {
    const data: any = await api.post(
      `/Verification/ApplyKey?licenseKey=${encodeURIComponent(licenseKeyInput.value.replace(/[\s\n\r]/g, ''))}`,
      {},
    );
    queryResult.value = { ...data, offline: true, applied: true };
    queryVisible.value = true;
    // 失败 toast 由 axios 拦截器统一弹
  } finally {
    loading.value = false;
  }
}

async function copyClientInfo() {
  try {
    await navigator.clipboard.writeText(clientInfoText.value);
    message.success('客户端身份信息已复制');
  } catch {
    message.error('复制失败，请手动选择文本复制');
  }
}
</script>

<template>
  <div style="position: relative; height: 100%; padding: 0 20px">
    <!-- 未配置公钥蒙板 -->
    <div v-if="isMissingPublicKey" class="overlay-mask">
      <div class="overlay-content">
        <svg
          viewBox="0 0 24 24"
          width="48"
          height="48"
          fill="none"
          stroke="#ff4d4f"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          style="
            display: block;
            margin-right: auto;
            margin-bottom: 12px;
            margin-left: auto;
          "
        >
          <path d="M12 9v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
        <div class="overlay-title" style="color: #ff4d4f">未配置 RSA 公钥</div>
        <div class="overlay-desc">
          请在 appsettings.json 中配置 LicenseConfig:PublicKeyXml 后重启服务
        </div>
      </div>
    </div>

    <!-- 未登录蒙板: 覆盖整个面板, 用户看得见底下操作面板轮廓, 但必须先点"前往登录" -->
    <div v-else-if="loginRequired" class="overlay-mask">
      <div class="overlay-content">
        <div
          style="
            margin-bottom: 12px;
            font-size: 48px;
            line-height: 1;
            opacity: 0.6;
          "
        >
          🔒
        </div>
        <div class="overlay-title">需要管理员登录</div>
        <div class="overlay-desc" style="margin-bottom: 20px">
          登录后可进行授权更新操作
        </div>
        <Button type="primary" size="large" @click="emit('login')">
          前往登录
        </Button>
      </div>
    </div>

    <Tabs default-active-key="online">
      <!-- 在线授权 -->
      <TabPane key="online" tab="在线授权">
        <div style="padding: 16px 0">
          <label
            style="
              display: block;
              margin-bottom: 8px;
              font-size: 14px;
              color: var(--ant-color-text);
            "
          >
            授权服务器地址
          </label>
          <Input
            v-model:value="serverUrl"
            placeholder="例如: https://license.example.com"
            allow-clear
            size="large"
            style="margin-bottom: 16px"
          />
          <div style="text-align: center">
            <Button
              :loading="loading"
              type="primary"
              size="large"
              @click="handleCheckUpdate"
            >
              查询授权
            </Button>
          </div>
        </div>
      </TabPane>

      <!-- 离线授权 -->
      <TabPane key="offline" tab="离线授权">
        <div style="padding: 16px 0">
          <label
            style="
              display: block;
              margin-bottom: 8px;
              font-size: 14px;
              color: var(--ant-color-text);
            "
          >
            客户端身份信息（复制后发给管理员生成授权 Key）
          </label>
          <Textarea
            :value="clientInfoText"
            readonly
            :auto-size="{ minRows: 4, maxRows: 6 }"
            style="
              margin-bottom: 8px;
              font-family:
                ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
              font-size: 12px;
            "
          />
          <div style="margin-bottom: 16px; text-align: right">
            <Button size="small" @click="copyClientInfo">复制</Button>
          </div>

          <label
            style="
              display: block;
              margin-bottom: 8px;
              font-size: 14px;
              color: var(--ant-color-text);
            "
          >
            授权 Key（粘贴管理员生成的授权字符串）
          </label>
          <Textarea
            v-model:value="licenseKeyInput"
            placeholder="例如: eyJQcm9kdWN0Ijoi...=.xYz..."
            :auto-size="{ minRows: 3, maxRows: 6 }"
            style="
              margin-bottom: 16px;
              font-family:
                ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
              font-size: 12px;
            "
          />
          <div style="text-align: center">
            <Button
              :loading="loading"
              type="primary"
              size="large"
              @click="handleApplyKey"
            >
              应用授权
            </Button>
          </div>
        </div>
      </TabPane>
    </Tabs>

    <!-- 授权信息弹窗（在线查询 / 离线应用 共用）
         展示完整 Payload 内容, 让用户在点"应用"前能完整预览:
         产品/域名/绑定的ClientKey+HardwareId/启用的验证项/时间
         在线查询阶段就展示这些, 是因为: 用户如果看到 Key 绑定的和本机实际不一致 (比如
         HardwareId 对不上、产品名错了), 可以提前中止, 避免应用后立即失效还要清除. -->
    <Modal
      v-model:open="queryVisible"
      :title="queryResult?.offline ? '离线授权' : '查询到可用授权'"
      :footer="null"
      width="560px"
      @cancel="
        applyError = '';
        queryResult?.applied && emit('success');
      "
    >
      <Descriptions
        v-if="queryResult"
        bordered
        size="small"
        :column="1"
        :label-style="{ width: '110px', whiteSpace: 'nowrap' }"
        style="margin-bottom: 20px"
      >
        <DescriptionsItem label="来源">
          <Tag v-if="queryResult.offline" color="purple">离线授权</Tag>
          <Tag v-else color="cyan">在线授权</Tag>
        </DescriptionsItem>

        <!-- 所有授权元信息字段都始终展示 (即使 Payload 里没绑定也显示"未绑定"),
             让用户能一眼确认 Key 到底绑了哪些项, 不要用 v-if 隐藏. -->

        <DescriptionsItem label="产品">
          <span v-if="queryResult.productEn" style="font-family: monospace">{{
            queryResult.productEn
          }}</span>
          <span v-else style="color: var(--ant-color-text-tertiary)"
            >未绑定（不验证产品）</span
          >
        </DescriptionsItem>

        <!-- 授权域名: 优先展示 domains 数组 (新 Key, 支持通配符), fallback 到 domain 单值 (老 Key) -->
        <DescriptionsItem label="授权域名">
          <template v-if="queryResult.domains?.length">
            <Tag
              v-for="d in queryResult.domains"
              :key="d"
              color="blue"
              style="margin-bottom: 2px"
              >{{ d }}</Tag
            >
          </template>
          <span v-else-if="queryResult.domain" style="font-family: monospace">{{
            queryResult.domain
          }}</span>
          <span v-else style="color: var(--ant-color-text-tertiary)"
            >未限定（不验证域名）</span
          >
        </DescriptionsItem>

        <!-- 绑定 ClientKey: 客户端会用本机 ClientKey 和此值比对, 不匹配授权失效 -->
        <DescriptionsItem label="绑定 ClientKey">
          <span
            v-if="queryResult.clientKey"
            style="
              font-family:
                ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
              font-size: 12px;
              word-break: break-all;
            "
          >
            {{ queryResult.clientKey }}
          </span>
          <span v-else style="color: var(--ant-color-text-tertiary)"
            >未绑定（不验证 ClientKey）</span
          >
        </DescriptionsItem>

        <!-- 绑定 HardwareId: 同上, 客户端按本机 HardwareId 比对 -->
        <DescriptionsItem label="绑定 HardwareId">
          <span
            v-if="queryResult.hardwareId"
            style="
              font-family:
                ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
              font-size: 12px;
              word-break: break-all;
            "
          >
            {{ queryResult.hardwareId }}
          </span>
          <span v-else style="color: var(--ant-color-text-tertiary)"
            >未绑定（不验证 HardwareId）</span
          >
        </DescriptionsItem>

        <!-- 启用的验证项: 上面 4 行的摘要汇总, 一眼看清这个 Key 到底验哪些 -->
        <DescriptionsItem label="验证项目">
          <Tag v-if="queryResult.requiresProduct" color="blue">产品名</Tag>
          <Tag v-if="queryResult.requiresDomain" color="blue">域名</Tag>
          <Tag v-if="queryResult.requiresClientKey" color="blue">ClientKey</Tag>
          <Tag v-if="queryResult.requiresHardwareId" color="blue"
            >HardwareId</Tag
          >
          <span
            v-if="
              !queryResult.requiresProduct &&
              !queryResult.requiresDomain &&
              !queryResult.requiresClientKey &&
              !queryResult.requiresHardwareId
            "
            style="color: var(--ant-color-text-tertiary)"
          >
            仅验证到期时间（宽松授权）
          </span>
        </DescriptionsItem>

        <DescriptionsItem label="签发时间">
          <span style="font-family: monospace">{{
            fmtTime(queryResult.issuedAt)
          }}</span>
        </DescriptionsItem>
        <DescriptionsItem label="到期时间">
          <span
            style="font-family: monospace; font-weight: 500; color: #1677ff"
            >{{ fmtTime(queryResult.expiresAt) }}</span
          >
        </DescriptionsItem>

        <!-- 到期后行为: 签发授权时勾选的策略 -->
        <DescriptionsItem label="到期后行为">
          <Tag
            v-if="
              queryResult.allowAdminAfterExpiry &&
              queryResult.allowClientApiAfterExpiry
            "
            color="red"
          >
            全部可用 (异常)
          </Tag>
          <Tag v-else-if="queryResult.allowAdminAfterExpiry" color="orange">
            仅管理后台可用
          </Tag>
          <Tag v-else-if="queryResult.allowClientApiAfterExpiry" color="blue">
            仅客户端 API 可用
          </Tag>
          <Tag v-else color="default">全部禁用</Tag>
          <template v-if="queryResult.allowedRoutes?.length">
            <span
              style="
                margin-left: 8px;
                font-size: 12px;
                color: var(--ant-color-text-tertiary);
              "
              >自定义放行:</span
            >
            <Tag
              v-for="r in queryResult.allowedRoutes"
              :key="r"
              color="default"
              style="margin-bottom: 2px; font-family: monospace"
              >{{ r }}</Tag
            >
          </template>
        </DescriptionsItem>

        <DescriptionsItem v-if="!queryResult.offline" label="已下载">
          <Tag v-if="queryResult.isDownloaded" color="green">是</Tag>
          <Tag v-else color="default">否</Tag>
        </DescriptionsItem>

        <DescriptionsItem label="状态">
          <Tag v-if="queryResult.applied" color="green">已应用</Tag>
          <Tag v-else-if="queryResult.isCurrent" color="blue">当前使用中</Tag>
          <Tag v-else color="orange">可更新</Tag>
        </DescriptionsItem>
      </Descriptions>

      <!-- 应用失败错误提示: 表格和按钮之间, 便于用户对照表格信息排查原因 -->
      <Alert
        v-if="applyError"
        type="error"
        show-icon
        :message="applyError"
        style="margin-bottom: 16px"
      />

      <div style="text-align: center">
        <Button
          v-if="queryResult.applied"
          type="primary"
          size="large"
          @click="
            queryVisible = false;
            emit('success');
          "
        >
          {{ props.successButtonText }}
        </Button>
        <Button v-else-if="queryResult.isCurrent" disabled size="large">
          当前已是最新授权
        </Button>
        <Button
          v-else
          type="primary"
          size="large"
          :loading="applyLoading"
          @click="handleApplyFromServer"
        >
          应用此授权
        </Button>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
/* 通用蒙板样式: 未配置公钥 / 未登录 两种阻断态共用 */
.overlay-mask {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  background: rgb(240 240 240 / 75%);
  border-radius: 8px;
  backdrop-filter: blur(4px);
}

.overlay-content {
  padding: 24px;
  text-align: center;
}

.overlay-title {
  margin-bottom: 10px;
  font-size: 22px;
  font-weight: 600;
  color: var(--ant-color-text);
}

.overlay-desc {
  max-width: 360px;
  font-size: 16px;
  line-height: 1.6;
  color: rgb(0 0 0 / 65%);
}

:global(.dark) .overlay-mask {
  background: rgb(30 30 30 / 75%);
}

:global(.dark) .overlay-desc {
  color: rgb(255 255 255 / 65%);
}
</style>
