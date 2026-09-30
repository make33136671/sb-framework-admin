<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import {
  Alert,
  Button,
  Checkbox,
  Col,
  DatePicker,
  Descriptions,
  DescriptionsItem,
  Form,
  FormItem,
  Input,
  message,
  Row,
  Space,
  Tag,
} from 'ant-design-vue';
import dayjs from 'dayjs';

import { issueLicense, type IssueLicenseRequest } from './api';

/**
 * 签发授权共享组件.
 * 顶部展示客户端硬件/域名身份, 下方四项验证复选框 (默认全勾).
 * Product / Domains / ClientKey / HardwareId 自动从 client 预填.
 */
interface ClientInfo {
  id: number;
  productEn?: string;
  productCn?: string;
  domain?: string; // 客户声明的正式域名 (PrimaryDomain)
  lastActualDomain?: string; // 最近一次浏览器实际访问域名
  clientKey?: string;
  hardwareId?: string;
  machineName?: string;
  osDescription?: string;
  processorCount?: number;
  macAddresses?: string;
  serverIP?: string;
  createdTime?: string;
  lastVerifyTime?: string;
  verifyCount?: number;
}

interface Props {
  client?: ClientInfo;
}

const props = defineProps<Props>();
const emit = defineEmits<{ (e: 'success', data: any): void }>();

const enableProduct = ref(true);
const enableDomain = ref(true);
const enableClientKey = ref(true);
const enableHardwareId = ref(true);

// 到期后行为: 默认全 false (= 全禁用), 两个互斥
const allowAdminAfterExpiry = ref(false);
const allowClientApiAfterExpiry = ref(false);
const bothExpiryAllowed = computed(
  () => allowAdminAfterExpiry.value && allowClientApiAfterExpiry.value,
);

const expiresAt = ref<string>('');

// 快捷选择到期时间
const quickOptions = [
  { label: '7天', days: 7 },
  { label: '半月', days: 15 },
  { label: '1月', months: 1 },
  { label: '3月', months: 3 },
  { label: '6月', months: 6 },
  { label: '1年', years: 1 },
  { label: '2年', years: 2 },
  { label: '3年', years: 3 },
];

function setQuick(opt: { days?: number; months?: number; years?: number }) {
  let d = dayjs();
  if (opt.days) d = d.add(opt.days, 'day');
  if (opt.months) d = d.add(opt.months, 'month');
  if (opt.years) d = d.add(opt.years, 'year');
  expiresAt.value = d.format('YYYY-MM-DDTHH:mm:ss');
}

// 每秒更新的当前时间，驱动倒计时
const now = ref(dayjs());
const ticker = setInterval(() => {
  now.value = dayjs();
}, 1000);
onBeforeUnmount(() => clearInterval(ticker));

// 选择到期时间后显示距今剩余时间
const remainingText = computed(() => {
  if (!expiresAt.value) return '';
  const target = dayjs(expiresAt.value);
  if (!target.isValid() || target.isBefore(now.value)) return '已过期';

  const n = now.value;
  let years = target.year() - n.year();
  let months = target.month() - n.month();
  let days = target.date() - n.date();
  let hours = target.hour() - n.hour();
  let minutes = target.minute() - n.minute();
  let seconds = target.second() - n.second();

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
    const prevMonth = target.subtract(1, 'month');
    days += prevMonth.daysInMonth();
    months--;
  }
  if (months < 0) {
    months += 12;
    years--;
  }

  const pad2 = (n: number) => String(n).padStart(2, '0');
  const pad4 = (n: number) => String(n).padStart(4, '0');
  const units = [
    { v: years, l: '年', pad: pad4 },
    { v: months, l: '月', pad: pad2 },
    { v: days, l: '日', pad: pad2 },
    { v: hours, l: '时', pad: pad2 },
    { v: minutes, l: '分', pad: pad2 },
    { v: seconds, l: '秒', pad: pad2 },
  ];
  const start = units.findIndex((u) => u.v > 0);
  if (start === -1) return '00秒';
  return units
    .slice(start)
    .map((u) => `${u.pad(u.v)}${u.l}`)
    .join(' ');
});

const product = ref<string>('');
const domainInput = ref<string>('');
// 初始化域名(从客户端预填), 不可真正删除, 只能切换 deleted 标记防误操作
const initialDomains = ref<Array<{ deleted: boolean; domain: string }>>([]);
// 用户后续手动添加的域名
const extraDomains = ref<string[]>([]);
const clientKey = ref<string>('');
const hardwareId = ref<string>('');
const submitting = ref(false);

// 提交时实际使用的域名: 初始域名中未被标记删除的 + 全部额外域名
const submitDomains = computed(() => [
  ...initialDomains.value.filter((d) => !d.deleted).map((d) => d.domain),
  ...extraDomains.value,
]);

// 声明域名 vs 实际访问域名不一致提示
const domainMismatch = computed(() => {
  const d = props.client?.domain?.trim();
  const a = props.client?.lastActualDomain?.trim();
  return d && a && d.toLowerCase() !== a.toLowerCase();
});

/** 剥离端口号: "localhost:6013" → "localhost" */
function stripPort(d: string): string {
  const s = d.trim().toLowerCase();
  const idx = s.lastIndexOf(':');
  if (idx > 0 && /^\d+$/.test(s.slice(idx + 1))) return s.slice(0, idx);
  return s;
}

// 从 props.client 预填: product / 初始化域名(去重) / clientKey / hardwareId
watch(
  () => props.client,
  (c) => {
    if (!c) return;
    product.value = c.productEn ?? '';
    const ds = new Set<string>();
    if (c.domain) ds.add(stripPort(c.domain));
    if (c.lastActualDomain) ds.add(stripPort(c.lastActualDomain));
    initialDomains.value = [...ds]
      .filter(Boolean)
      .map((d) => ({ domain: d, deleted: false }));
    extraDomains.value = [];
    clientKey.value = c.clientKey ?? '';
    hardwareId.value = c.hardwareId ?? '';
  },
  { immediate: true },
);

function addDomain() {
  const v = stripPort(domainInput.value);
  if (v && !submitDomains.value.includes(v)) {
    extraDomains.value.push(v);
    // 通配输入联动: *.foo.com 同时把裸域 foo.com 加进列表, 让用户直观看到授权覆盖范围
    if (v.startsWith('*.')) {
      const bare = v.slice(2);
      if (bare && !submitDomains.value.includes(bare))
        extraDomains.value.push(bare);
    }
  }
  domainInput.value = '';
}

function removeExtraDomain(i: number) {
  extraDomains.value.splice(i, 1);
}

function toggleInitialDomain(i: number) {
  const item = initialDomains.value[i];
  if (item) item.deleted = !item.deleted;
}

/** 一键通配: api.dev.example.com → *.example.com (取末尾两段) */
function toWildcard(d: string): string {
  if (d.startsWith('*.')) return d;
  const parts = d.split('.');
  if (parts.length < 2) return d;
  return `*.${parts.slice(-2).join('.')}`;
}

/** 追加通配: 保留原域名, 把通配符版本加到额外域名列表(不替换, 可逆)
 *  同时把通配对应的裸域也补进列表, 让用户直观看到 "通配 + 裸域" 双覆盖 */
function appendWildcard(d: string) {
  const w = toWildcard(d);
  if (w !== d && !submitDomains.value.includes(w)) extraDomains.value.push(w);
  const bare = w.slice(2);
  if (bare && bare !== d && !submitDomains.value.includes(bare))
    extraDomains.value.push(bare);
}

/** +通配 按钮是否应该显示:
 *  - 已通配 (*.foo.com): 不显示, 已是通配
 *  - 裸域 (foo.com, 仅 2 段): 不显示, 后端 DomainExpander 会自动展开成 foo.com + *.foo.com
 *  - 子域 (api.foo.com, 3+ 段): 显示, 让用户能手动追加 *.foo.com + foo.com */
function showAppendWildcardBtn(domain: string): boolean {
  if (domain.startsWith('*.')) return false;
  return domain.split('.').length > 2;
}

const productValid = computed(
  () =>
    !enableProduct.value || /^[a-z][a-z0-9]{1,19}$/.test(product.value.trim()),
);

function fmtTime(v?: string) {
  if (!v) return '-';
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function handleSubmit() {
  if (!props.client?.id) {
    message.error('缺少客户 ID');
    return;
  }
  if (!expiresAt.value) {
    message.error('请选择到期时间');
    return;
  }
  if (enableProduct.value && !productValid.value) {
    message.error('产品名格式错误: 仅小写字母+数字, 字母开头, 2-20 字符');
    return;
  }
  if (enableDomain.value && submitDomains.value.length === 0) {
    message.error('请至少添加一个授权域名, 或取消勾选验证域名');
    return;
  }
  if (enableClientKey.value && !clientKey.value.trim()) {
    message.error('请填写 ClientKey, 或取消勾选');
    return;
  }
  if (enableHardwareId.value && !hardwareId.value.trim()) {
    message.error('请填写 HardwareId, 或取消勾选');
    return;
  }
  if (bothExpiryAllowed.value) {
    message.error('到期后行为: 管理与客户端不能同时勾选, 否则等于无到期限制');
    return;
  }

  const req: IssueLicenseRequest = {
    clientId: props.client.id,
    expiresAt: new Date(expiresAt.value).toISOString(),
    productEn: enableProduct.value ? product.value.trim() : undefined,
    domains: enableDomain.value ? submitDomains.value : undefined,
    clientKey: enableClientKey.value ? clientKey.value.trim() : undefined,
    hardwareId: enableHardwareId.value ? hardwareId.value.trim() : undefined,
    allowAdminAfterExpiry: allowAdminAfterExpiry.value,
    allowClientApiAfterExpiry: allowClientApiAfterExpiry.value,
  };

  submitting.value = true;
  try {
    // toast 由 axios 拦截器统一弹
    const res = await issueLicense(req);
    emit('success', res);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <Row :gutter="24" class="issue-form-row">
    <!-- 左列: 客户端身份信息 (只读展示) -->
    <Col :xs="24" :md="12" class="issue-form-info">
      <div class="issue-form-section-title">客户端信息</div>
      <Descriptions
        v-if="props.client"
        bordered
        size="small"
        :column="1"
        :label-style="{ width: '110px', whiteSpace: 'nowrap' }"
      >
        <DescriptionsItem label="产品中文名">
          {{ props.client.productCn || '—' }}
        </DescriptionsItem>
        <DescriptionsItem label="产品英文名">
          <span style="font-family: monospace">{{
            props.client.productEn || '—'
          }}</span>
        </DescriptionsItem>
        <DescriptionsItem label="声明域名">
          {{ props.client.domain || '—' }}
        </DescriptionsItem>
        <DescriptionsItem label="实际访问域名">
          <span
            :style="
              domainMismatch
                ? 'color: var(--ant-color-warning); font-weight: 500'
                : ''
            "
          >
            {{ props.client.lastActualDomain || '—' }}
          </span>
        </DescriptionsItem>
        <DescriptionsItem label="ClientKey">
          <span style="font-family: monospace; word-break: break-all">{{
            props.client.clientKey || '—'
          }}</span>
        </DescriptionsItem>
        <DescriptionsItem label="HardwareId">
          <span style="font-family: monospace; word-break: break-all">{{
            props.client.hardwareId || '—'
          }}</span>
        </DescriptionsItem>
        <DescriptionsItem label="机器名">
          {{ props.client.machineName || '—' }}
        </DescriptionsItem>
        <DescriptionsItem label="CPU 核心">
          {{ props.client.processorCount || '—' }}
        </DescriptionsItem>
        <DescriptionsItem label="操作系统">
          <span style="font-size: 12px">{{
            props.client.osDescription || '—'
          }}</span>
        </DescriptionsItem>
        <DescriptionsItem label="MAC 地址">
          <span
            style="
              font-family: monospace;
              font-size: 12px;
              word-break: break-all;
            "
            >{{ props.client.macAddresses || '—' }}</span
          >
        </DescriptionsItem>
        <DescriptionsItem label="服务器 IP">
          {{ props.client.serverIP || '—' }}
        </DescriptionsItem>
        <DescriptionsItem label="验证次数">
          {{ props.client.verifyCount ?? 0 }}
        </DescriptionsItem>
        <DescriptionsItem label="首次注册">
          {{ fmtTime(props.client.createdTime) }}
        </DescriptionsItem>
        <DescriptionsItem label="最近验证">
          {{ fmtTime(props.client.lastVerifyTime) }}
        </DescriptionsItem>
      </Descriptions>

      <!-- 域名不一致提示 -->
      <Alert
        v-if="domainMismatch"
        type="warning"
        show-icon
        style="margin-top: 16px"
        :message="`声明域名 ${props.client?.domain} 和实际访问 ${props.client?.lastActualDomain} 不一致`"
        description="客户可能还在测试域名/IP 部署, 右侧域名输入框已默认把两个都勾进来, 可按实际情况保留或删除."
      />
    </Col>

    <!-- 右列: 签发表单 -->
    <Col :xs="24" :md="12" class="issue-form-action">
      <div class="issue-form-section-title">签发参数</div>
      <Form layout="vertical">
        <FormItem label="到期时间" required>
          <DatePicker
            v-model:value="expiresAt"
            :show-time="{ defaultValue: dayjs('23:59:59', 'HH:mm:ss') }"
            value-format="YYYY-MM-DDTHH:mm:ss"
            style="width: 100%"
          />
          <div style="margin-top: 8px">
            <Space wrap :size="4">
              <Button
                v-for="opt in quickOptions"
                :key="opt.label"
                size="small"
                @click="setQuick(opt)"
              >
                {{ opt.label }}
              </Button>
            </Space>
          </div>
          <div
            v-if="remainingText"
            style="
              margin-top: 6px;
              font-size: 13px;
              color: var(--ant-color-text-secondary);
            "
          >
            授权时长：<span
              style="font-weight: 500; color: var(--ant-color-primary)"
              >{{ remainingText }}</span
            >
          </div>
        </FormItem>

        <FormItem>
          <Checkbox v-model:checked="enableProduct">
            验证产品名 (仅小写字母+数字, 2-20 字符, 字母开头)
          </Checkbox>
          <Input
            v-if="enableProduct"
            v-model:value="product"
            placeholder="产品英文名 (客户端 ProductEn, 不是授权服务器自己的)"
            style="margin-top: 8px"
          />
          <Alert
            v-if="enableProduct && !props.client?.productEn"
            type="warning"
            show-icon
            style="margin-top: 8px"
            message="客户端尚未上报产品名"
            description="请填入客户端自己的 ProductEn, 不要填授权服务器自己的. 客户端发起过一次 Check 或 Verify 之后此字段会自动预填."
          />
        </FormItem>

        <FormItem>
          <Checkbox v-model:checked="enableDomain">
            验证授权域名 (支持通配符 *.example.com)
          </Checkbox>
          <div v-if="enableDomain" style="margin-top: 8px">
            <div style="display: flex; gap: 8px">
              <Input
                v-model:value="domainInput"
                placeholder="回车添加域名, 如 example.com / *.x.com / api.y.com"
                @press-enter="addDomain"
              />
              <Button @click="addDomain">添加</Button>
            </div>
            <div style="margin-top: 8px">
              <!-- 初始化域名(从客户端预填): 不可真正删除, 只能切换"标记删除"防误操作 -->
              <Tag
                v-for="(d, i) in initialDomains"
                :key="`init-${d.domain}`"
                :closable="false"
                :class="{ 'domain-tag-deleted': d.deleted }"
                :color="d.deleted ? 'default' : 'blue'"
                style="margin-bottom: 4px"
              >
                <span
                  :style="
                    d.deleted
                      ? 'text-decoration: line-through; opacity: 0.65'
                      : ''
                  "
                  >{{ d.domain }}</span
                >
                <Button
                  v-if="!d.deleted && showAppendWildcardBtn(d.domain)"
                  size="small"
                  style="padding: 0 6px; margin-left: 4px"
                  @click="appendWildcard(d.domain)"
                >
                  +通配
                </Button>
                <Button
                  size="small"
                  :type="d.deleted ? 'primary' : 'default'"
                  style="padding: 0 6px; margin-left: 4px"
                  @click="toggleInitialDomain(i)"
                >
                  {{ d.deleted ? '恢复' : '标记删除' }}
                </Button>
              </Tag>
              <!-- 用户后续添加的域名: 普通可关闭 Tag -->
              <Tag
                v-for="(d, i) in extraDomains"
                :key="`extra-${d}`"
                closable
                style="margin-bottom: 4px"
                @close="removeExtraDomain(i)"
              >
                {{ d }}
                <Button
                  v-if="showAppendWildcardBtn(d)"
                  size="small"
                  style="padding: 0 6px; margin-left: 4px"
                  @click="appendWildcard(d)"
                >
                  +通配
                </Button>
              </Tag>
            </div>
            <div
              style="
                margin-top: 4px;
                font-size: 12px;
                color: var(--ant-color-text-secondary);
              "
            >
              初始化域名只能"标记删除"防误操作; 子域 (api.foo.com) 旁的 +通配
              按钮会一并追加 *.foo.com 和裸域 foo.com (可逆). 裸域 foo.com
              不显示 +通配 — 签发时后端会自动展开为 foo.com + *.foo.com.
            </div>
          </div>
        </FormItem>

        <FormItem>
          <Checkbox v-model:checked="enableClientKey">验证 ClientKey</Checkbox>
          <Input
            v-if="enableClientKey"
            v-model:value="clientKey"
            placeholder="ClientKey (UUID)"
            style="margin-top: 8px"
          />
        </FormItem>

        <FormItem>
          <Checkbox v-model:checked="enableHardwareId">
            验证 HardwareId
          </Checkbox>
          <Input
            v-if="enableHardwareId"
            v-model:value="hardwareId"
            placeholder="HardwareId (SHA256)"
            style="margin-top: 8px"
          />
        </FormItem>

        <FormItem label="到期后行为">
          <div
            style="
              margin-bottom: 8px;
              font-size: 12px;
              color: var(--ant-color-text-secondary);
            "
          >
            授权过期后是否保留以下功能 (白名单路径如登录/授权页始终可用):
          </div>
          <Space direction="vertical" :size="4">
            <Checkbox v-model:checked="allowAdminAfterExpiry">
              到期后管理后台仍可用 (/admin/* 非白名单)
            </Checkbox>
            <Checkbox v-model:checked="allowClientApiAfterExpiry">
              到期后客户端 API 仍可用 (/api/* 非白名单)
            </Checkbox>
          </Space>
          <Alert
            v-if="bothExpiryAllowed"
            type="error"
            show-icon
            style="margin-top: 8px"
            message="两个都勾等于无到期限制, 没有意义"
            description="请至少留一项被拦截 (默认两个都不勾 = 到期全禁用)"
          />
          <div
            v-else
            style="
              margin-top: 6px;
              font-size: 12px;
              color: var(--ant-color-text-tertiary);
            "
          >
            当前策略:
            <span
              style="font-weight: 500; color: var(--ant-color-text-secondary)"
            >
              {{
                allowAdminAfterExpiry
                  ? '到期后仅管理后台可用'
                  : allowClientApiAfterExpiry
                    ? '到期后仅客户端 API 可用'
                    : '到期后全部禁用 (默认)'
              }}
            </span>
          </div>
        </FormItem>

        <FormItem>
          <Button
            type="primary"
            :loading="submitting"
            :disabled="bothExpiryAllowed"
            @click="handleSubmit"
          >
            生成授权
          </Button>
        </FormItem>
      </Form>
    </Col>
  </Row>
</template>

<style scoped>
.issue-form-row {
  /* 左右两列高度独立, 长信息列不被右侧表单拉伸 */
  align-items: flex-start;
}

.issue-form-info {
  /* 右边添加细分隔线视觉区隔信息区与操作区 */
  border-right: 1px dashed var(--ant-color-split);
}

@media (max-width: 768px) {
  .issue-form-info {
    padding-bottom: 16px;
    margin-bottom: 16px;

    /* 小屏堆叠时分隔线改为下边线 */
    border-right: none;
    border-bottom: 1px dashed var(--ant-color-split);
  }
}

.issue-form-section-title {
  padding-bottom: 8px;
  margin-bottom: 12px;
  font-size: 14px;
  font-weight: 500;
  color: var(--ant-color-text);
  border-bottom: 1px solid var(--ant-color-border-secondary);
}
</style>
