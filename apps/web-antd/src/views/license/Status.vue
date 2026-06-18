<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

import { IconifyIcon } from '@vben/icons';

import {
  Alert,
  Card,
  Col,
  Descriptions,
  DescriptionsItem,
  Row,
  Tag,
} from 'ant-design-vue';

import { TimeProgress } from '#/components/TimeProgress';
import { TimeTag } from '#/components/TimeTag';
import { TimezoneDisplay } from '#/components/TimezoneDisplay';

import { getStatus } from './api';
import LicenseUpdatePanel from './LicenseUpdatePanel.vue';

const statusData = ref<any>(null);
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

async function fetchStatus() {
  try {
    statusData.value = await getStatus();
  } catch {}
}

// 后端 expiresAt 是 UTC 时间(无时区后缀), 需补 Z 让浏览器按 UTC 解析
// 否则会被当作本地时间, 算出的倒计时会差几小时
const expiresAtDate = computed<Date | null>(() => {
  const raw = statusData.value?.expiresAt;
  if (!raw) return null;
  const hasTz = typeof raw === 'string' && /[Zz]|[+-]\d\d:?\d\d$/.test(raw);
  const iso = hasTz ? raw : `${raw}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
});

// 程序时区 (appsettings.json 的 TimeZone, 由 AppTime 初始化)
const appTimeZone = computed<string>(
  () => statusData.value?.appTimeZone || 'UTC',
);

// 服务器操作系统时区
const serverTimeZone = computed<string>(
  () => statusData.value?.serverTimeZone || '-',
);

// 按指定 IANA 时区提取日期/时间字段
// 用于 remainingTime 差值计算和 expiresAtFormatted 格式化, 统一按程序时区来
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
      month: get('month'), // 1-12
      day: get('day'),
      hour: hour === 24 ? 0 : hour, // en-US locale 午夜会返回 24, 保险兜底
      minute: get('minute'),
      second: get('second'),
    };
  } catch {
    // 无效时区 id 时 fallback 到本地时区
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

// 精确日历差(从 now 到 expiresAt), 每秒更新
// 所有字段按 appTimeZone 解读, 避免跨时区误差
const remainingTime = computed(() => {
  const expires = expiresAtDate.value;
  if (!expires) return null;
  const fromDate = new Date(now.value);
  if (expires.getTime() <= fromDate.getTime()) {
    return {
      expired: true,
      years: 0,
      months: 0,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
    };
  }
  const from = partsInTimeZone(fromDate, appTimeZone.value);
  const to = partsInTimeZone(expires, appTimeZone.value);
  let years = to.year - from.year;
  let months = to.month - from.month;
  let days = to.day - from.day;
  let hours = to.hour - from.hour;
  let minutes = to.minute - from.minute;
  let seconds = to.second - from.second;

  if (seconds < 0) {
    seconds += 60;
    minutes--;
  }
  if (minutes < 0) {
    minutes += 60;
    hours--;
  }
  if (hours < 0) {
    hours += 24;
    days--;
  }
  if (days < 0) {
    // 借位: 用 expires 所在月的上一个月的天数补齐
    // new Date(year, month, 0) 返回上个月最后一天 (月份 0-indexed, 所以传 to.month 即当前月-1+1)
    const prevMonthLastDay = new Date(to.year, to.month - 1, 0).getDate();
    days += prevMonthLastDay;
    months--;
  }
  if (months < 0) {
    months += 12;
    years--;
  }
  return { expired: false, years, months, days, hours, minutes, seconds };
});

// 统一的 padding helper, 保证剩余时间和到期时间字符一模一样对齐
const pad2 = (n: number) => String(n).padStart(2, '0');
const pad4 = (n: number) => String(n).padStart(4, '0');

function fmtDateTime(v: string | null | undefined): string {
  if (!v) return '-';
  const hasTz = /[Zz]|[+-]\d\d:?\d\d$/.test(v);
  const d = new Date(hasTz ? v : `${v}Z`);
  if (Number.isNaN(d.getTime())) return '-';
  const p = partsInTimeZone(d, appTimeZone.value);
  return `${pad4(p.year)}-${pad2(p.month)}-${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`;
}

// 到期时间按程序时区格式化 "YYYY 年 MM 月 DD 日 HH 时 mm 分 ss 秒"
// 年 4 位, 月日时分秒各 2 位, 不足补 0
const expiresAtFormatted = computed(() => {
  const d = expiresAtDate.value;
  if (!d) return '-';
  const p = partsInTimeZone(d, appTimeZone.value);
  return `${pad4(p.year)} 年 ${pad2(p.month)} 月 ${pad2(p.day)} 日 ${pad2(p.hour)} 时 ${pad2(p.minute)} 分 ${pad2(p.second)} 秒`;
});

// 剩余时间格式化, 用和 expiresAtFormatted 完全相同的字符串生成方式,
// 保证两行字符长度、空格位置一致, 视觉上严格上下对齐
const remainingTimeText = computed(() => {
  const rt = remainingTime.value;
  if (!rt) return '-';
  if (rt.expired) return '已过期';
  return `${pad4(rt.years)} 年 ${pad2(rt.months)} 月 ${pad2(rt.days)} 日 ${pad2(rt.hours)} 时 ${pad2(rt.minutes)} 分 ${pad2(rt.seconds)} 秒`;
});

// LicenseUpdatePanel 更新成功回调 - 重新拉取授权状态刷新本页显示
async function onUpdateSuccess() {
  await fetchStatus();
}

// 当前浏览器访问的 host
const currentHost = computed(() => window.location.host);

/** host 是否在 Key 的允许域名列表中. null = 未启用域名验证或 host 为空 */
function isHostAllowed(host: string | null | undefined): boolean | null {
  if (!host) return null;
  const list: string[] = statusData.value?.licenseDomains ?? [];
  const h = host.toLowerCase().split(':')[0];
  if (list.length === 0) {
    const d = statusData.value?.licenseDomain;
    if (!d) return null;
    return d.toLowerCase() === h;
  }
  return list.some((p) => {
    const pat = p.toLowerCase();
    if (pat.startsWith('*.')) return h.endsWith('.' + pat.slice(2));
    return h === pat;
  });
}

// 配置域名 (PrimaryDomain) 是否被 Key 授权 → 决定生产部署能不能跑
const configDomainAllowed = computed<boolean | null>(() =>
  isHostAllowed(statusData.value?.domain?.trim()),
);

// 当前浏览器访问域名是否被 Key 授权 → 帮 dev/调试场景快速判断当前访问点是否覆盖
const currentHostAllowed = computed<boolean | null>(() =>
  isHostAllowed(currentHost.value),
);

// Key 签发的产品名 和 系统当前配置的产品英文名 是否不一致 (如不一致授权验证会失败)
const licenseProductMismatch = computed(() => {
  const lp = statusData.value?.licenseProduct;
  const sp = statusData.value?.productEn;
  return lp && sp && lp.toLowerCase() !== sp.toLowerCase();
});

// 产品身份：优先 statusData，后退 __APP_INFO__（和 /auth/license 保持一致）
const appInfo = (window as any).__APP_INFO__ || {};
const appLogo = computed<string>(() => appInfo.logo || '/storage/images/logo.png');
const productCnText = computed<string>(
  () => statusData.value?.productCn || appInfo.nameCn || '管理系统',
);
const productEnText = computed<string>(
  () => statusData.value?.productEn || appInfo.nameEn || '',
);
const domainText = computed<string>(
  () => statusData.value?.domain || appInfo.domain || '',
);

onMounted(() => {
  fetchStatus();
  timer = setInterval(() => {
    now.value = Date.now();
  }, 1000);
});

onUnmounted(() => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
});
</script>

<template>
  <div style="padding: 24px">
    <Row :gutter="24">
      <!-- 授权状态卡片: 3 行 4 列 -->
      <Col :span="24" style="margin-bottom: 24px">
        <Card title="授权状态">
          <template v-if="statusData?.isEnabled === false" #extra>
            <Tag color="error">授权验证未开启</Tag>
          </template>
          <Descriptions
            bordered
            :column="2"
            size="small"
            :label-style="{ width: '140px', whiteSpace: 'nowrap' }"
          >
            <!-- 第 1 行: 产品名称（带 Logo 缩略图，兜底 __APP_INFO__） | 授权状态 -->
            <DescriptionsItem label="产品名称">
              <div style="display: flex; align-items: center; gap: 10px">
                <img
                  :src="appLogo"
                  :alt="productCnText"
                  style="
                    height: 32px;
                    width: 32px;
                    object-fit: contain;
                    border-radius: 4px;
                    flex-shrink: 0;
                  "
                />
                <div style="min-width: 0">
                  <div style="font-weight: 500; line-height: 1.3">{{ productCnText }}</div>
                  <div
                    v-if="productEnText"
                    style="
                      color: var(--ant-color-text-tertiary);
                      font-size: 12px;
                      line-height: 1.3;
                    "
                  >
                    {{ productEnText }}
                  </div>
                </div>
              </div>
            </DescriptionsItem>
            <DescriptionsItem label="授权状态">
              <Tag v-if="statusData?.isValid" color="green">有效</Tag>
              <Tag
                v-else-if="statusData?.isExpired"
                color="orange"
              >
                已过期
              </Tag>
              <Tag
                v-else-if="statusData?.isEnabled === false"
                color="blue"
              >
                未启用
              </Tag>
              <Tag v-else color="red">无效</Tag>
            </DescriptionsItem>

            <!-- 第 2 行: 剩余时间 (整行进度条, 中心倒计时, 从签发到到期做进度) -->
            <DescriptionsItem label="剩余时间" :span="2">
              <TimeProgress
                :start-time="statusData?.issuedAt"
                :end-time="statusData?.expiresAt"
                size="large"
                variant="glossy"
                center-text="remaining"
                :show-remaining="false"
                :show-expires="false"
              />
            </DescriptionsItem>

            <!-- 第 3 行: 签发时间 | 到期时间 -->
            <DescriptionsItem label="签发时间">
              <TimeTag
                color="cyan"
                :time="fmtDateTime(statusData?.issuedAt)"
                :timezone="appTimeZone"
              />
            </DescriptionsItem>
            <DescriptionsItem label="到期时间">
              <TimeTag
                :color="remainingTime?.expired ? 'red' : 'blue'"
                :time="fmtDateTime(statusData?.expiresAt)"
                :timezone="appTimeZone"
              />
            </DescriptionsItem>

            <!-- 第 4 行: 配置域名（兜底 __APP_INFO__.domain） + 当前访问域名 (各自独立判断"已授权/未授权") -->
            <DescriptionsItem label="配置域名">
              <span :style="configDomainAllowed === false ? 'color: var(--ant-color-error); font-weight: 500' : ''">
                {{ domainText || '-' }}
              </span>
              <Tag v-if="configDomainAllowed === true" color="green" style="margin-left: 6px">已授权</Tag>
              <Tag v-else-if="configDomainAllowed === false" color="red" style="margin-left: 6px">未授权</Tag>
            </DescriptionsItem>

            <DescriptionsItem label="当前访问域名">
              <span :style="currentHostAllowed === false ? 'color: var(--ant-color-error); font-weight: 500' : ''">
                {{ currentHost }}
              </span>
              <Tag v-if="currentHostAllowed === true" color="green" style="margin-left: 6px">已授权</Tag>
              <Tag v-else-if="currentHostAllowed === false" color="red" style="margin-left: 6px">未授权</Tag>
            </DescriptionsItem>

            <!-- 第 5 行: 授权允许域名 (整行, 多 tag 撑得开) -->
            <DescriptionsItem label="授权允许域名" :span="2">
              <template v-if="statusData?.licenseDomains?.length">
                <Tag v-for="d in statusData.licenseDomains" :key="d" color="blue" style="margin-bottom: 2px">{{ d }}</Tag>
              </template>
              <span v-else-if="statusData?.licenseDomain" style="font-family: monospace">{{ statusData.licenseDomain }}</span>
              <span v-else style="color: var(--ant-color-text-tertiary)">未限定 (不验证)</span>
            </DescriptionsItem>

            <!-- 第 5 行: 云端中心地址 | 启用的验证项 -->
            <DescriptionsItem label="云端中心地址">
              {{ statusData?.cloudServerUrl || '-' }}
            </DescriptionsItem>
            <DescriptionsItem label="启用的验证项">
              <Tag v-if="statusData?.requiresProduct" color="blue">产品名</Tag>
              <Tag v-if="statusData?.requiresDomain" color="blue">域名</Tag>
              <Tag v-if="statusData?.requiresClientKey" color="blue">ClientKey</Tag>
              <Tag v-if="statusData?.requiresHardwareId" color="blue">HardwareId</Tag>
              <span v-if="!statusData?.requiresProduct && !statusData?.requiresDomain && !statusData?.requiresClientKey && !statusData?.requiresHardwareId" style="color: var(--ant-color-text-tertiary)">
                仅验证到期时间
              </span>
            </DescriptionsItem>

            <!-- 第 6 行: 到期后行为 (独占整行) -->
            <DescriptionsItem label="到期后行为" :span="2">
              <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
                <span style="display: inline-flex; align-items: center; gap: 4px;">
                  <IconifyIcon
                    :icon="statusData?.allowClientApiAfterExpiry ? 'ant-design:check-circle-filled' : 'ant-design:close-circle-filled'"
                    :style="{
                      color: statusData?.allowClientApiAfterExpiry ? 'hsl(var(--success))' : 'hsl(var(--destructive))',
                      fontSize: '16px',
                    }"
                  />
                  客户端{{ statusData?.allowClientApiAfterExpiry ? '可用' : '不可用' }}
                </span>
                <span style="display: inline-flex; align-items: center; gap: 4px;">
                  <IconifyIcon
                    :icon="statusData?.allowAdminAfterExpiry ? 'ant-design:check-circle-filled' : 'ant-design:close-circle-filled'"
                    :style="{
                      color: statusData?.allowAdminAfterExpiry ? 'hsl(var(--success))' : 'hsl(var(--destructive))',
                      fontSize: '16px',
                    }"
                  />
                  管理端{{ statusData?.allowAdminAfterExpiry ? '可用' : '不可用' }}
                </span>
                <span style="color: var(--ant-color-text-tertiary); font-size: 12px;">
                  (登录页/授权管理始终可访问)
                </span>
              </div>
            </DescriptionsItem>

            <!-- 第 7 行: 服务器时区 | 程序时区 -->
            <DescriptionsItem label="服务器时区">
              <TimezoneDisplay :timezone="serverTimeZone" />
            </DescriptionsItem>
            <DescriptionsItem label="程序时区">
              <TimezoneDisplay :timezone="appTimeZone" />
            </DescriptionsItem>
          </Descriptions>

          <!-- Key 绑定的产品/域名 和系统配置不一致的警示 -->
          <Alert
            v-if="licenseProductMismatch"
            type="warning"
            show-icon
            style="margin-top: 16px"
            :message="`授权 Key 签发给产品 '${statusData?.licenseProduct}', 但当前系统配置产品名是 '${statusData?.productEn}'`"
            description="这会导致授权验证失败. 请重新签发授权 Key, 或修改系统配置里的 ProductEn 让两者一致."
          />
        </Card>
      </Col>

      <!-- 客户端标识 -->
      <Col :span="24" style="margin-bottom: 24px">
        <Card title="客户端标识">
          <Descriptions
            bordered
            :column="2"
            size="small"
            :label-style="{ width: '140px', whiteSpace: 'nowrap' }"
          >
            <!-- 行 1: ClientKey 独占 -->
            <DescriptionsItem label="ClientKey" :span="2">
              <span
                style="
                  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco,
                    Consolas, monospace;
                  word-break: break-all;
                "
              >
                {{ statusData?.identity?.clientKey || '-' }}
              </span>
            </DescriptionsItem>

            <!-- 行 2: HardwareId 独占 -->
            <DescriptionsItem label="HardwareId" :span="2">
              <span
                style="
                  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco,
                    Consolas, monospace;
                  word-break: break-all;
                "
              >
                {{ statusData?.identity?.hardwareId || '-' }}
              </span>
            </DescriptionsItem>

            <!-- 行 3: 机器名 | CPU 核心数 -->
            <DescriptionsItem label="机器名">
              <span style="white-space: nowrap;">
                {{ statusData?.identity?.hardwareInfo?.machineName || '-' }}
              </span>
            </DescriptionsItem>
            <DescriptionsItem label="CPU 核心数">
              {{ statusData?.identity?.hardwareInfo?.processorCount || '-' }}
            </DescriptionsItem>

            <!-- 行 4: 操作系统 独占 -->
            <DescriptionsItem label="操作系统" :span="2">
              <span style="word-break: break-word;">
                {{ statusData?.identity?.hardwareInfo?.osDescription || '-' }}
              </span>
            </DescriptionsItem>

            <!-- 行 5: MAC 地址 独占 -->
            <DescriptionsItem v-if="statusData?.identity?.hardwareInfo?.macAddresses?.length" label="MAC 地址" :span="2">
              <span style="font-family: monospace;">
                {{ statusData.identity.hardwareInfo.macAddresses.join(', ') }}
              </span>
            </DescriptionsItem>
          </Descriptions>
        </Card>
      </Col>

      <!-- 操作区域 - 使用复用的 LicenseUpdatePanel 组件, 和 /auth/license 过期页保持一致 -->
      <Col :span="24">
        <Card title="授权操作">
          <LicenseUpdatePanel
            :status-data="statusData"
            @success="onUpdateSuccess"
          />
        </Card>
      </Col>
    </Row>
  </div>
</template>
