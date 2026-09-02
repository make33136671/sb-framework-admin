<script lang="ts" setup>
import { onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Empty,
  Pagination,
  Popconfirm,
  Spin,
  Tag,
} from 'ant-design-vue';

import { TimeTag } from '#/components/TimeTag';

import { getRecordList, revokeLicense } from './api';
import { deriveVerifyMode } from './utils';

// 浏览器本地时区, 给 TimeTag 显示用
const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const loading = ref(false);
const records = ref<any[]>([]);
const total = ref(0);
const currentPage = ref(1);
const pageSize = ref(10);

// 后端 DateTime 字段为 UTC, 但序列化时不带 Z 后缀, 需要手动补上避免被当本地时间解析
const fmtTime = (v: null | string | undefined): string => {
  if (!v) return '';
  const hasTz = /[Zz]|[+-]\d\d:?\d\d$/.test(v);
  const d = new Date(hasTz ? v : `${v}Z`);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

function isExpired(row: any): boolean {
  if (!row.expiresAt) return false;
  const v = String(row.expiresAt);
  const hasTz = /[Zz]|[+-]\d\d:?\d\d$/.test(v);
  const t = new Date(hasTz ? v : `${v}Z`).getTime();
  return Number.isFinite(t) && t < Date.now();
}

function parseJson(raw: string | null | undefined): string {
  if (!raw) return '-';
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.length > 0 ? arr.join(', ') : '-';
  } catch {
    return String(raw);
  }
}

function shortId(val: string | null | undefined, len = 20): string {
  if (!val) return '-';
  return val.length > len ? `${val.slice(0, len)}...` : val;
}

function postExpiryLabel(row: any): { text: string; color: string } {
  if (row.allowAdminAfterExpiry && row.allowClientApiAfterExpiry)
    return { text: '全部可用 (异常)', color: 'red' };
  if (row.allowAdminAfterExpiry)
    return { text: '仅管理后台可用', color: 'orange' };
  if (row.allowClientApiAfterExpiry)
    return { text: '仅客户端 API 可用', color: 'blue' };
  return { text: '全部禁用', color: 'default' };
}

async function fetchData() {
  loading.value = true;
  try {
    const res = await getRecordList({
      page: currentPage.value,
      pageSize: pageSize.value,
    });
    records.value = res.items ?? res.rows ?? [];
    total.value = res.total ?? 0;
  } finally {
    loading.value = false;
  }
}

function handlePageChange(page: number, size: number) {
  currentPage.value = page;
  pageSize.value = size;
  fetchData();
}

async function handleRevoke(row: any) {
  // toast 由 axios 拦截器统一弹
  await revokeLicense(row.id);
  fetchData();
}

onMounted(fetchData);
</script>

<template>
  <Page auto-content-height>
    <div class="record-list-wrapper">
      <div class="record-toolbar">
        <span class="record-total">共 {{ total }} 条授权记录</span>
        <Button @click="fetchData">刷新</Button>
      </div>

      <Spin :spinning="loading">
        <div v-if="records.length === 0 && !loading" style="padding: 60px 0">
          <Empty description="暂无授权记录" />
        </div>

        <div class="record-cards">
          <Card
            v-for="row in records"
            :key="row.id"
            class="record-card"
            size="small"
          >
            <template #title>
              <div class="card-title-row">
                <span class="card-title-text">
                  <span style="font-weight: 600">
                    {{ row.client?.productCn || row.productEn || '-' }}
                  </span>
                  <span class="card-title-sub">
                    {{
                      row.client?.productEn ? `(${row.client.productEn})` : ''
                    }}
                  </span>
                  <Tag
                    v-if="row.client?.isDeleted"
                    color="default"
                    style="margin-left: 6px"
                    >客户已删除</Tag
                  >
                </span>
                <span class="card-title-tags">
                  <Tag v-if="row.status === 0" color="green">有效</Tag>
                  <Tag v-else color="red">已吊销</Tag>
                  <Tag :color="row.isDownloaded ? 'blue' : 'default'">
                    {{ row.isDownloaded ? '已下载' : '未下载' }}
                  </Tag>
                  <Popconfirm
                    v-if="row.status === 0"
                    title="确定吊销此授权？"
                    @confirm="handleRevoke(row)"
                  >
                    <Button danger size="small">吊销</Button>
                  </Popconfirm>
                </span>
              </div>
            </template>

            <Descriptions
              bordered
              size="small"
              :column="{ xs: 1, sm: 2, md: 2, lg: 2, xl: 3, xxl: 3 }"
              :label-style="{ width: '110px', whiteSpace: 'nowrap' }"
            >
              <DescriptionsItem label="记录 ID">{{ row.id }}</DescriptionsItem>
              <DescriptionsItem label="验证模式">
                <Tag :color="deriveVerifyMode(row).color">{{
                  deriveVerifyMode(row).text
                }}</Tag>
              </DescriptionsItem>
              <DescriptionsItem label="产品标识">
                <span class="mono-text">{{ row.productEn || '-' }}</span>
              </DescriptionsItem>

              <DescriptionsItem label="绑定域名" :span="3">
                <span class="mono-text-sm">{{ parseJson(row.domains) }}</span>
              </DescriptionsItem>

              <DescriptionsItem
                label="ClientKey"
                :span="row.hardwareId ? 1 : 2"
              >
                <span class="mono-text-sm" :title="row.clientKey">
                  {{ shortId(row.clientKey, 32) }}
                </span>
              </DescriptionsItem>
              <DescriptionsItem
                label="HardwareId"
                :span="row.clientKey ? 2 : 1"
              >
                <span class="mono-text-sm" :title="row.hardwareId">
                  {{ shortId(row.hardwareId, 32) }}
                </span>
              </DescriptionsItem>

              <DescriptionsItem label="签发时间">
                <TimeTag
                  color="cyan"
                  :time="fmtTime(row.issuedAt)"
                  :timezone="localTimezone"
                />
              </DescriptionsItem>
              <DescriptionsItem label="到期时间">
                <TimeTag
                  :color="row.status === 0 && isExpired(row) ? 'red' : 'blue'"
                  :time="fmtTime(row.expiresAt)"
                  :timezone="localTimezone"
                />
              </DescriptionsItem>
              <DescriptionsItem label="生成时间">
                <TimeTag
                  color="default"
                  :time="fmtTime(row.createdTime)"
                  :timezone="localTimezone"
                />
              </DescriptionsItem>

              <DescriptionsItem label="到期后行为" :span="3">
                <Tag :color="postExpiryLabel(row).color">
                  {{ postExpiryLabel(row).text }}
                </Tag>
                <span
                  v-if="parseJson(row.allowedRoutes) !== '-'"
                  class="mono-text-sm"
                  style="margin-left: 8px"
                >
                  自定义放行: {{ parseJson(row.allowedRoutes) }}
                </span>
              </DescriptionsItem>
            </Descriptions>

            <!-- 客户信息 -->
            <template v-if="row.client">
              <div class="client-section-title">客户环境</div>
              <Descriptions
                bordered
                size="small"
                :column="{ xs: 1, sm: 2, md: 2, lg: 2, xl: 3, xxl: 3 }"
                :label-style="{ width: '110px', whiteSpace: 'nowrap' }"
              >
                <DescriptionsItem label="声明域名">
                  <span class="mono-text">{{ row.client.domain || '-' }}</span>
                </DescriptionsItem>
                <DescriptionsItem label="实际域名">
                  <span
                    class="mono-text"
                    :class="{
                      'warn-text':
                        row.client.lastActualDomain &&
                        row.client.lastActualDomain !== row.client.domain,
                    }"
                  >
                    {{ row.client.lastActualDomain || '-' }}
                  </span>
                </DescriptionsItem>
                <DescriptionsItem label="服务器 IP">
                  <span class="mono-text">{{
                    row.client.serverIP || '-'
                  }}</span>
                </DescriptionsItem>

                <DescriptionsItem label="机器名">{{
                  row.client.machineName || '-'
                }}</DescriptionsItem>
                <DescriptionsItem label="操作系统" :span="2">{{
                  row.client.osDescription || '-'
                }}</DescriptionsItem>

                <DescriptionsItem label="CPU 核心">{{
                  row.client.processorCount ?? '-'
                }}</DescriptionsItem>
                <DescriptionsItem label="MAC 地址" :span="2">
                  <span class="mono-text-sm">{{
                    row.client.macAddresses || '-'
                  }}</span>
                </DescriptionsItem>

                <DescriptionsItem label="最后心跳">
                  <TimeTag
                    v-if="row.client.lastHeartbeat"
                    color="green"
                    :time="fmtTime(row.client.lastHeartbeat)"
                    :timezone="localTimezone"
                  />
                  <span v-else style="color: var(--ant-color-text-tertiary)"
                    >-</span
                  >
                </DescriptionsItem>
                <DescriptionsItem label="客户备注" :span="2">{{
                  row.client.remark || '-'
                }}</DescriptionsItem>
              </Descriptions>
            </template>
          </Card>
        </div>

        <div v-if="total > 0" class="record-pagination">
          <Pagination
            v-model:current="currentPage"
            v-model:page-size="pageSize"
            :total="total"
            :show-size-changer="true"
            :show-total="(t: number) => `共 ${t} 条`"
            :page-size-options="['10', '20', '50']"
            @change="handlePageChange"
          />
        </div>
      </Spin>
    </div>
  </Page>
</template>

<style scoped>
.record-list-wrapper {
  padding: 0 4px;
}

.record-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.record-total {
  font-size: 14px;
  color: var(--ant-color-text-secondary);
}

.record-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.record-card {
  border-radius: 8px;
}

.record-card :deep(.ant-card-head) {
  min-height: 40px;
  padding: 0 16px;
}

.record-card :deep(.ant-card-head-title) {
  padding: 8px 0;
}

.record-card :deep(.ant-card-body) {
  padding: 12px 16px;
}

.card-title-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}

.card-title-text {
  font-size: 14px;
}

.card-title-sub {
  margin-left: 6px;
  color: var(--ant-color-text-tertiary);
}

.card-title-tags {
  display: flex;
  gap: 4px;
  align-items: center;
}

.client-section-title {
  padding-top: 10px;
  margin: 12px 0 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--ant-color-text-tertiary);
  border-top: 1px dashed var(--ant-color-border);
}

.record-pagination {
  display: flex;
  justify-content: flex-end;
  padding-bottom: 8px;
  margin-top: 16px;
}

.mono-text {
  font-family: monospace;
}

.mono-text-sm {
  font-family: monospace;
  font-size: 12px;
}

.warn-text {
  color: var(--ant-color-warning);
}
</style>
