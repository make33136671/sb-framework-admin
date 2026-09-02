<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { Button, Modal } from 'ant-design-vue';

import { TimeProgress } from '#/components/TimeProgress';
import { api } from '#/api/request';

// 默认阈值（系统设置 license_warning_hours 不存在或接口异常时回退）
// 系统设置值为 0 → 关闭弹窗（永不提醒）
const DEFAULT_WARNING_HOURS = 72;
const SETTING_KEY = 'license_warning_hours';
// 后台授权信息页路径（后端 AdminService.cs 注册：/system/devtools/license）
const LICENSE_PAGE_PATH = '/system/devtools/license';

const router = useRouter();

const open = ref(false);
const issuedAt = ref<Date | null>(null);
const expiresAt = ref<Date | null>(null);
const now = ref(Date.now());
let timer: null | ReturnType<typeof setInterval> = null;

const remaining = computed(() => {
  if (!expiresAt.value) return null;
  const ms = expiresAt.value.getTime() - now.value;
  if (ms <= 0)
    return { days: 0, hours: 0, minutes: 0, seconds: 0, cs: 0, expired: true };
  const total = Math.floor(ms / 1000);
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
    // 2 位毫秒：取百分位（0-99），让末位数字流畅跑动而不是闪 3 位
    cs: Math.floor((ms % 1000) / 10),
    expired: false,
  };
});

const cells = computed(() => [
  { value: remaining.value?.days ?? 0, label: '天' },
  { value: remaining.value?.hours ?? 0, label: '时' },
  { value: remaining.value?.minutes ?? 0, label: '分' },
  { value: remaining.value?.seconds ?? 0, label: '秒' },
  { value: remaining.value?.cs ?? 0, label: '毫秒' },
]);

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function parseUtc(raw: string): Date | null {
  const hasTz = /[Zz]|[+-]\d\d:?\d\d$/.test(raw);
  const d = new Date(hasTz ? raw : `${raw}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function loadWarningHours(): Promise<number> {
  try {
    const data = await api.get<any>('/SystemSetting/GetByKey', {
      params: { key: SETTING_KEY },
    });
    const raw = data?.dataContent;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  } catch {
    // 找不到 / 401 / 网络失败 → 用默认值
  }
  return DEFAULT_WARNING_HOURS;
}

async function checkAndMaybeShow() {
  try {
    // 当前已经在授权信息页 → 不弹（用户已经在看授权信息了，再弹是干扰）
    if (router.currentRoute.value.path === LICENSE_PAGE_PATH) return;
    // 阈值 = 0 → 用户主动关闭提醒，直接退出
    const warningHours = await loadWarningHours();
    if (warningHours <= 0) return;

    const data = await api.get<any>('/Verification/Status', { params: {} });
    // 未启用授权 / 没到期时间 → 不弹
    if (!data?.isEnabled || !data?.expiresAt) return;
    const exp = parseUtc(data.expiresAt);
    if (!exp) return;
    expiresAt.value = exp;
    issuedAt.value = parseUtc(data.issuedAt || '');

    const remainingMs = exp.getTime() - Date.now();
    const thresholdMs = warningHours * 3600 * 1000;
    // 已经过期：交给路由守卫跳 /auth/license，本组件不处理
    // 剩余时间在阈值内才弹
    if (remainingMs > 0 && remainingMs <= thresholdMs) {
      open.value = true;
      // 50ms 刷新（20fps），让 2 位毫秒数字平滑跑动
      timer = setInterval(() => {
        now.value = Date.now();
      }, 50);
    }
  } catch {
    // 接口不可用 / 401 等都静默忽略，不打扰用户
  }
}

function goLicense() {
  open.value = false;
  router.push(LICENSE_PAGE_PATH);
}

// 单页应用切换路由不会触发 onMounted 重跑，需要 watch 路由：
// 用户从别的页跳到授权信息页时，主动关掉已经打开的弹窗
watch(
  () => router.currentRoute.value.path,
  (path) => {
    if (path === LICENSE_PAGE_PATH) open.value = false;
  },
);

onMounted(checkAndMaybeShow);

onUnmounted(() => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
});
</script>

<template>
  <Modal
    v-model:open="open"
    title="系统授权即将到期"
    centered
    :width="560"
    :footer="null"
    :mask-closable="false"
  >
    <div style="padding: 24px 8px 8px">
      <!-- 大字号倒计时：天 时 分 秒 -->
      <div
        style="
          display: flex;
          gap: 16px;
          align-items: flex-end;
          justify-content: center;
          margin-bottom: 12px;
        "
      >
        <template v-for="(item, idx) in cells" :key="idx">
          <div
            style="
              min-width: 72px;
              font-size: 48px;
              font-weight: 700;
              font-variant-numeric: tabular-nums;
              line-height: 1;
              color: var(--ant-color-warning);
              text-align: center;
            "
          >
            {{ pad(item.value) }}
          </div>
          <div
            v-if="idx < cells.length - 1"
            style="
              padding-bottom: 4px;
              font-size: 36px;
              font-weight: 700;
              line-height: 1;
              color: var(--ant-color-text-quaternary);
            "
          >
            :
          </div>
        </template>
      </div>

      <!-- 自研 TimeProgress (默认 elapsed 模式)：进度 = (now - issuedAt) / (expiresAt - issuedAt) -->
      <!-- 进度条接近满 = 时间快用完 = 紧迫；红色填充 + 滚花条强化"快爆"视觉 -->
      <!-- trackColor 用 hsl(var(--muted-foreground) / 0.3)，跟 modal 背景对比明显 -->
      <TimeProgress
        :start-time="issuedAt"
        :end-time="expiresAt"
        size="large"
        variant="flat"
        center-text="none"
        color="hsl(var(--destructive))"
        track-color="hsl(var(--muted-foreground) / 0.3)"
        :show-remaining="false"
        :show-expires="false"
        :striped="true"
      />

      <p
        style="
          margin-top: 24px;
          margin-bottom: 0;
          font-size: 15px;
          color: var(--ant-color-text);
          text-align: center;
        "
      >
        系统授权即将到期，为避免影响使用，请尽快续期。
      </p>

      <div
        style="
          display: flex;
          gap: 12px;
          justify-content: center;
          margin-top: 24px;
        "
      >
        <Button @click="open = false">稍后处理</Button>
        <Button type="primary" @click="goLicense">前往授权信息</Button>
      </div>
    </div>
  </Modal>
</template>
