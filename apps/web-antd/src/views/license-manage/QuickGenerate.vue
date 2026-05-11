<script lang="ts" setup>
import { ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Button,
  Card,
  DatePicker,
  Descriptions,
  DescriptionsItem,
  InputNumber,
  message,
  Radio,
  RadioGroup,
  Tag,
  Textarea,
} from 'ant-design-vue';
import dayjs from 'dayjs';

import { quickGenerate } from './api';
import { deriveVerifyMode } from './utils';

const fmtTime = (v: string) => {
  if (!v) return '-';
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

// 步骤
const step = ref<'input' | 'result'>('input');

// 输入
const identityInput = ref('');
const parsedIdentity = ref<any>(null);
const parseError = ref('');
const durationMode = ref<'days' | 'date'>('days');
const days = ref(30);
const expiresDate = ref<any>(null);
const verifyMode = ref(2);

// 结果
const resultData = ref<any>(null);
const loading = ref(false);

function parseIdentity() {
  parseError.value = '';
  parsedIdentity.value = null;
  try {
    const text = identityInput.value.trim();
    if (!text) {
      parseError.value = '请粘贴客户端身份信息';
      return false;
    }
    const obj = JSON.parse(text);
    if (!obj.clientKey && !obj.hardwareId) {
      parseError.value = 'JSON 中缺少 clientKey 或 hardwareId';
      return false;
    }
    parsedIdentity.value = obj;
    return true;
  } catch {
    parseError.value = 'JSON 格式无效';
    return false;
  }
}

async function handleGenerate() {
  if (!parseIdentity()) return;

  const identity = parsedIdentity.value;
  const request: any = {
    productEn: identity.productEn || undefined,
    productCn: identity.productCn || undefined,
    clientKey: identity.clientKey || undefined,
    hardwareId: identity.hardwareId || undefined,
    domain: identity.domain || undefined,
    machineName: identity.machineName || undefined,
    verifyMode: verifyMode.value,
  };

  if (durationMode.value === 'days') {
    request.days = days.value;
  } else {
    const dt = expiresDate.value;
    if (!dt) {
      message.warning('请选择到期时间');
      return;
    }
    request.expiresAt = dt.utc?.()?.format('YYYY-MM-DDTHH:mm:ss[Z]') ?? dt.format('YYYY-MM-DDTHH:mm:ss[Z]');
  }

  loading.value = true;
  try {
    // toast 由 axios 拦截器统一弹
    resultData.value = await quickGenerate(request);
    step.value = 'result';
  } finally {
    loading.value = false;
  }
}

async function copyLicenseKey() {
  try {
    await navigator.clipboard.writeText(resultData.value?.licenseKey || '');
    message.success('授权 Key 已复制');
  } catch {
    message.error('复制失败，请手动选择文本复制');
  }
}

function reset() {
  step.value = 'input';
  resultData.value = null;
  parsedIdentity.value = null;
  parseError.value = '';
  identityInput.value = '';
}
</script>

<template>
  <Page auto-content-height>
    <!-- 输入阶段 -->
    <Card v-if="step === 'input'" title="授权签发" style="max-width: 700px; margin: 0 auto;">
      <div style="margin-bottom: 16px;">
        <div style="margin-bottom: 6px; font-weight: 500;">客户端身份信息</div>
        <Textarea
          v-model:value="identityInput"
          placeholder='粘贴客户端复制的 JSON，例如:
{
  "productEn": "sbsts",
  "productCn": "管理系统",
  "clientKey": "xxx",
  "hardwareId": "xxx",
  "domain": "example.com",
  "machineName": "server-1"
}'
          :auto-size="{ minRows: 6, maxRows: 12 }"
          style="font-family: monospace; font-size: 12px;"
        />
        <div v-if="parseError" style="color: #ff4d4f; margin-top: 4px; font-size: 12px;">{{ parseError }}</div>
      </div>

      <div style="margin-bottom: 16px;">
        <div style="margin-bottom: 6px; font-weight: 500;">有效期</div>
        <RadioGroup v-model:value="durationMode" style="margin-bottom: 8px;">
          <Radio value="days">按天数</Radio>
          <Radio value="date">指定日期</Radio>
        </RadioGroup>
        <div v-if="durationMode === 'days'">
          <InputNumber v-model:value="days" :min="1" :max="36500" addon-after="天" style="width: 180px;" />
        </div>
        <div v-else>
          <DatePicker v-model:value="expiresDate" show-time style="width: 100%;" />
        </div>
      </div>

      <div style="margin-bottom: 24px;">
        <div style="margin-bottom: 6px; font-weight: 500;">验证模式</div>
        <RadioGroup v-model:value="verifyMode">
          <Radio :value="0">仅 ClientKey</Radio>
          <Radio :value="1">仅 HardwareId</Radio>
          <Radio :value="2">双验证</Radio>
        </RadioGroup>
      </div>

      <div style="text-align: center;">
        <Button type="primary" size="large" :loading="loading" @click="handleGenerate">
          生成授权
        </Button>
      </div>
    </Card>

    <!-- 结果阶段 -->
    <Card v-if="step === 'result'" title="授权已生成" style="max-width: 700px; margin: 0 auto;">
      <Descriptions bordered size="small" :column="1" style="margin-bottom: 16px;">
        <DescriptionsItem label="产品">{{ resultData?.productCn ? `${resultData.productCn}（${resultData.productEn}）` : resultData?.productEn || '-' }}</DescriptionsItem>
        <DescriptionsItem label="域名">{{ resultData?.domain || '-' }}</DescriptionsItem>
        <DescriptionsItem label="签发时间">{{ fmtTime(resultData?.issuedAt) }}</DescriptionsItem>
        <DescriptionsItem label="到期时间">{{ fmtTime(resultData?.expiresAt) }}</DescriptionsItem>
        <DescriptionsItem label="验证模式">
          <Tag :color="deriveVerifyMode(resultData).color">{{ deriveVerifyMode(resultData).text }}</Tag>
        </DescriptionsItem>
      </Descriptions>

      <div style="margin-bottom: 8px; font-weight: 500;">授权 Key</div>
      <Textarea
        :value="resultData?.licenseKey || ''"
        readonly
        :auto-size="{ minRows: 3, maxRows: 6 }"
        style="font-family: monospace; font-size: 12px; margin-bottom: 16px;"
      />

      <div style="display: flex; justify-content: center; gap: 12px;">
        <Button type="primary" size="large" @click="copyLicenseKey">复制授权 Key</Button>
        <Button size="large" @click="reset">继续签发</Button>
      </div>
    </Card>
  </Page>
</template>
