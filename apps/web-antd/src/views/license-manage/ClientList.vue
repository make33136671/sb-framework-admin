<script lang="ts" setup>
import type { VxeGridProps } from '#/adapter/vxe-table';

import { onBeforeUnmount, onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Empty,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Tag,
} from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { TimeTag } from '#/components/TimeTag';

import {
  deleteClient,
  getClientList,
  getRecordList,
  revokeLicense,
} from './api';
import IssueForm from './IssueForm.vue';
import { deriveVerifyMode } from './utils';

// 后端 DateTime 字段为 UTC, 但序列化时不带 Z 后缀, 需要手动补上避免被当本地时间解析
const fmtTime = (v: null | string | undefined): string => {
  if (!v) return '';
  const hasTz = /[Zz]|[+-]\d\d:?\d\d$/.test(v);
  const d = new Date(hasTz ? v : `${v}Z`);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

function isExpired(row: any): boolean {
  if (!row.expiresAt) return false;
  const v = String(row.expiresAt);
  const hasTz = /[Zz]|[+-]\d\d:?\d\d$/.test(v);
  const t = new Date(hasTz ? v : `${v}Z`).getTime();
  return Number.isFinite(t) && t < Date.now();
}

function postExpiryLabel(row: any): { color: string; text: string } {
  if (row.allowAdminAfterExpiry && row.allowClientApiAfterExpiry)
    return { text: '全部可用 (异常)', color: 'red' };
  if (row.allowAdminAfterExpiry)
    return { text: '仅管理后台可用', color: 'orange' };
  if (row.allowClientApiAfterExpiry)
    return { text: '仅客户端 API 可用', color: 'blue' };
  return { text: '全部禁用', color: 'default' };
}

const formOptions = {
  schema: [
    {
      label: '搜索',
      fieldName: 'keyword',
      component: 'Input',
      componentProps: { placeholder: '产品名称或域名' },
    },
  ],
  wrapperClass: 'grid-cols-4',
  showCollapseButton: false,
  submitOnChange: false,
  submitOnEnter: true,
};

const gridOptions: VxeGridProps = {
  columns: [
    { field: 'id', title: 'ID', width: 60, visible: false, align: 'left' },
    {
      field: 'productEn',
      title: '产品信息',
      minWidth: 340,
      align: 'left',
      showOverflow: false,
      slots: { default: 'productCard' },
    },
    {
      field: 'createdTime',
      title: '时间 / 状态',
      width: 230,
      align: 'left',
      showOverflow: false,
      slots: { default: 'timeStatusCol' },
    },
    {
      title: '操作',
      width: 100,
      align: 'left',
      showOverflow: false,
      slots: { default: 'action' },
      fixed: 'right',
    },
  ],
  height: 'auto',
  keepSource: true,
  pagerConfig: {},
  proxyConfig: {
    ajax: {
      query: async ({ page }, formValues) => {
        return await getClientList({
          page: page.currentPage,
          pageSize: page.pageSize,
          ...formValues,
        });
      },
    },
  },
  showOverflow: false,
  rowConfig: { isHover: true },
  toolbarConfig: { refresh: true, custom: true },
};

const [Grid, gridApi] = useVbenVxeGrid({ formOptions, gridOptions });

// 签发授权弹窗: 走 IssueForm 共享组件, 支持勾选 Product/Domain/ClientKey/HardwareId 四项
const issueVisible = ref(false);
const issueClient = ref<any>(null);

// 弹窗宽度响应式: 大屏满目标值, 小屏(如 1024 分辨率)按 95vw 收窄, 防止溢出
const issueModalWidth = ref(1080);
const recordModalWidth = ref(1100);
function updateModalWidth() {
  if (typeof window === 'undefined') return;
  const w = Math.floor(window.innerWidth * 0.95);
  issueModalWidth.value = Math.min(1080, w);
  recordModalWidth.value = Math.min(1100, w);
}
onMounted(() => {
  updateModalWidth();
  window.addEventListener('resize', updateModalWidth);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', updateModalWidth);
});

function openIssue(row: any) {
  // 把后端 ClientList 返回的所有身份信息原封传给 IssueForm
  issueClient.value = {
    id: row.id,
    productEn: row.productEn,
    productCn: row.productCn,
    domain: row.domain,
    lastActualDomain: row.lastActualDomain,
    clientKey: row.clientKey,
    hardwareId: row.hardwareId,
    machineName: row.machineName,
    osDescription: row.osDescription,
    processorCount: row.processorCount,
    macAddresses: row.macAddresses,
    serverIP: row.serverIP,
    createdTime: row.createdTime,
    lastVerifyTime: row.lastVerifyTime,
    verifyCount: row.verifyCount,
  };
  issueVisible.value = true;
}

function onIssueSuccess() {
  issueVisible.value = false;
  gridApi.reload();
}

// 软删客户 (toast 由 axios 拦截器统一弹)
async function handleDelete(row: any) {
  await deleteClient(row.id);
  gridApi.reload();
}

// 授权记录弹窗
const recordVisible = ref(false);
const recordLoading = ref(false);
const recordClient = ref<any>(null);
const recordList = ref<any[]>([]);

function parseJson(raw: null | string | undefined): string {
  if (!raw) return '-';
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.length > 0 ? arr.join(', ') : '-';
  } catch {
    return String(raw);
  }
}

function shortId(val: null | string | undefined, len = 24): string {
  if (!val) return '-';
  return val.length > len ? `${val.slice(0, len)}...` : val;
}

async function openRecords(row: any) {
  recordClient.value = row;
  recordVisible.value = true;
  await loadRecords();
}

async function loadRecords() {
  recordLoading.value = true;
  try {
    const res = await getRecordList({
      page: 1,
      pageSize: 100,
      clientId: recordClient.value.id,
    });
    recordList.value = res?.items ?? res ?? [];
  } catch {
    recordList.value = [];
  } finally {
    recordLoading.value = false;
  }
}

async function handleRevoke(record: any) {
  // toast 由 axios 拦截器统一弹
  await revokeLicense(record.id);
  await loadRecords();
  gridApi.reload();
}
</script>

<template>
  <Page auto-content-height>
    <Grid>
      <!-- 产品卡片列 -->
      <template #productCard="{ row }">
        <div class="product-card">
          <div class="product-card-row">
            <div class="product-card-label">产品</div>
            <div class="product-card-value" style="font-weight: 600">
              {{
                row.productCn
                  ? `${row.productCn}（${row.productEn}）`
                  : row.productEn || '-'
              }}
            </div>
          </div>
          <div class="product-card-row">
            <div class="product-card-label">声明域名</div>
            <div class="product-card-value">{{ row.domain || '-' }}</div>
          </div>
          <div
            v-if="row.lastActualDomain"
            class="product-card-row"
            :class="{
              'product-card-row-warn':
                row.domain &&
                row.lastActualDomain &&
                row.domain.toLowerCase() !== row.lastActualDomain.toLowerCase(),
            }"
          >
            <div class="product-card-label">最近访问</div>
            <div class="product-card-value">{{ row.lastActualDomain }}</div>
          </div>
          <div class="product-card-row">
            <div class="product-card-label">机器名</div>
            <div class="product-card-value">{{ row.machineName || '-' }}</div>
            <div class="product-card-label product-card-label-inner">CPU</div>
            <div class="product-card-value" style="flex: none; width: 40px">
              {{ row.processorCount || '-' }}
            </div>
          </div>
          <div class="product-card-row">
            <div class="product-card-label">操作系统</div>
            <div class="product-card-value" style="font-size: 11px">
              {{ row.osDescription || '-' }}
            </div>
          </div>
          <div class="product-card-row">
            <div class="product-card-label">MAC</div>
            <div class="product-card-value" style="font-family: monospace">
              {{ row.macAddresses || '-' }}
            </div>
          </div>
          <div class="product-card-row">
            <div class="product-card-label">CK</div>
            <div
              class="product-card-value"
              style="font-family: monospace; word-break: break-all"
            >
              {{ row.clientKey || '-' }}
            </div>
          </div>
          <div class="product-card-row">
            <div class="product-card-label">HW</div>
            <div
              class="product-card-value"
              style="font-family: monospace; word-break: break-all"
            >
              {{ row.hardwareId || '-' }}
            </div>
          </div>
        </div>
      </template>

      <!-- 时间 + 验证状态合并列 -->
      <template #timeStatusCol="{ row }">
        <div style="padding: 8px 0; line-height: 1.9">
          <div>
            <span style="font-size: 12px; color: var(--ant-color-text-tertiary)"
              >创建　</span
            >
            <TimeTag color="cyan" :time="fmtTime(row.createdTime)" />
          </div>
          <div>
            <span style="font-size: 12px; color: var(--ant-color-text-tertiary)"
              >验证　</span
            >
            <TimeTag
              v-if="row.lastVerifyTime"
              color="blue"
              :time="fmtTime(row.lastVerifyTime)"
            />
            <Tag v-else color="default" style="margin: 0">未验证</Tag>
          </div>
          <div style="margin-top: 2px; font-size: 13px">
            <span
              >验证 <strong>{{ row.verifyCount }}</strong> 次</span
            >
            <Tag v-if="row.status === 0" color="green" style="margin-left: 8px">
              正常
            </Tag>
            <Tag v-else color="red" style="margin-left: 8px">禁用</Tag>
          </div>
        </div>
      </template>

      <!-- 操作列 (按钮竖排, 中号) -->
      <template #action="{ row }">
        <Space direction="vertical" :size="6" style="display: flex">
          <Button type="primary" block @click="openIssue(row)">签发</Button>
          <Button block @click="openRecords(row)">记录</Button>
          <Popconfirm
            title="软删除后列表将不再显示此客户, 历史授权记录保留. 确定?"
            @confirm="handleDelete(row)"
          >
            <Button danger block>删除</Button>
          </Popconfirm>
        </Space>
      </template>
    </Grid>

    <Modal
      v-model:open="issueVisible"
      :title="`签发授权 - ${issueClient?.name || '-'}`"
      :footer="null"
      :width="issueModalWidth"
      destroy-on-close
    >
      <IssueForm
        v-if="issueVisible"
        :client="issueClient"
        @success="onIssueSuccess"
      />
    </Modal>

    <!-- 授权记录弹窗 -->
    <Modal
      v-model:open="recordVisible"
      :title="`授权记录 - ${recordClient?.productCn || recordClient?.domain || ''}`"
      :footer="null"
      :width="recordModalWidth"
    >
      <Spin :spinning="recordLoading">
        <div
          v-if="recordList.length === 0 && !recordLoading"
          style="padding: 40px 0"
        >
          <Empty description="暂无授权记录" />
        </div>
        <div class="modal-record-cards">
          <Card
            v-for="row in recordList"
            :key="row.id"
            class="modal-record-card"
            size="small"
          >
            <template #title>
              <div class="modal-card-title">
                <span>
                  #{{ row.id }}
                  <Tag
                    v-if="row.status === 0"
                    color="green"
                    style="margin-left: 8px"
                    >有效</Tag
                  >
                  <Tag v-else color="red" style="margin-left: 8px">已吊销</Tag>
                  <Tag :color="row.isDownloaded ? 'blue' : 'default'">
                    {{ row.isDownloaded ? '已下载' : '未下载' }}
                  </Tag>
                </span>
                <Popconfirm
                  v-if="row.status === 0"
                  title="吊销后客户端将无法下载此授权，确定？"
                  @confirm="handleRevoke(row)"
                >
                  <Button danger size="small">吊销</Button>
                </Popconfirm>
              </div>
            </template>
            <Descriptions
              bordered
              size="small"
              :column="{ xs: 1, sm: 2, md: 2, lg: 2, xl: 3, xxl: 3 }"
              :label-style="{ width: '110px', whiteSpace: 'nowrap' }"
            >
              <DescriptionsItem label="验证模式">
                <Tag :color="deriveVerifyMode(row).color">
                  {{ deriveVerifyMode(row).text }}
                </Tag>
              </DescriptionsItem>
              <DescriptionsItem label="产品标识">
                <span style="font-family: monospace">{{
                  row.productEn || '-'
                }}</span>
              </DescriptionsItem>
              <DescriptionsItem label="绑定域名">
                <span style="font-family: monospace; font-size: 12px">{{
                  parseJson(row.domains)
                }}</span>
              </DescriptionsItem>

              <DescriptionsItem label="ClientKey" :span="2">
                <span
                  style="font-family: monospace; font-size: 12px"
                  :title="row.clientKey"
                >
                  {{ shortId(row.clientKey, 36) }}
                </span>
              </DescriptionsItem>
              <DescriptionsItem label="HardwareId">
                <span
                  style="font-family: monospace; font-size: 12px"
                  :title="row.hardwareId"
                >
                  {{ shortId(row.hardwareId, 36) }}
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
                  style="
                    margin-left: 8px;
                    font-family: monospace;
                    font-size: 12px;
                  "
                >
                  自定义放行: {{ parseJson(row.allowedRoutes) }}
                </span>
              </DescriptionsItem>
            </Descriptions>
          </Card>
        </div>
      </Spin>
    </Modal>
  </Page>
</template>

<style>
.product-card {
  margin: 10px 0;
  overflow: hidden;
  font-size: 12px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
}

.product-card-row {
  display: flex;
  border-bottom: 1px solid #f0f0f0;
}

.product-card-row:last-child {
  border-bottom: none;
}

/* 声明域名 vs 实际访问域名不一致时, 整行黄色背景提示 */
.product-card-row-warn {
  font-weight: 500;
  color: #d48806;
  background: #fffbe6;
}

.dark .product-card-row-warn {
  color: #ffc53d;
  background: #2b2611;
}

.product-card-label {
  flex-shrink: 0;
  width: 80px;
  padding: 4px 8px;
  color: #999;
  white-space: nowrap;
  background: #fafafa;
  border-right: 1px solid #f0f0f0;
}

.product-card-value {
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  word-break: break-all;
}

.product-card-label-inner {
  border-left: 1px solid #f0f0f0;
}

/* 暗黑模式 */
.dark .product-card {
  border-color: #424242;
}

.dark .product-card-row {
  border-bottom-color: #333;
}

.dark .product-card-label {
  color: #888;
  background: #1f1f1f;
  border-right-color: #333;
}

.dark .product-card-label-inner {
  border-left-color: #333;
}

/* 授权记录弹窗卡片 */
.modal-record-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 70vh;
  padding-right: 4px;
  overflow-y: auto;
}

.modal-record-card {
  border-radius: 8px;
}

.modal-record-card .ant-card-head {
  min-height: 36px;
  padding: 0 12px;
}

.modal-record-card .ant-card-head-title {
  padding: 6px 0;
}

.modal-record-card .ant-card-body {
  padding: 10px 12px;
}

.modal-card-title {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}
</style>
