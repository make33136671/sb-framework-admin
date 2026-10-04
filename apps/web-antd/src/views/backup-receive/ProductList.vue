<script setup lang="ts">
import type { BackupProductSummary } from './api';

import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import {
  Button,
  Card,
  Form,
  FormItem,
  Input,
  Space,
  Table,
  Tag,
} from 'ant-design-vue';

import { api } from '#/api/request';
import { TimeTag } from '#/components/TimeTag';

import { getProductList, toServerUrl } from './api';

// 程序时区：从后端 /Verification/Status 取 appTimeZone（即服务端 appsettings.TimeZone）
// 这样表格里所有时间都是"按服务端配置时区显示"，跟服务端日志/调度对齐
const appTimeZone = ref<string>('UTC');
async function loadAppTimeZone() {
  try {
    const data = await api.get<any>('/Verification/Status', { params: {} });
    if (data?.appTimeZone) appTimeZone.value = data.appTimeZone;
  } catch {
    /* 拿不到就保持 UTC，TimeTag 会显示 UTC +0 让用户知道 */
  }
}

const router = useRouter();
const loading = ref(false);
const products = ref<BackupProductSummary[]>([]);
const keyword = ref('');

async function load() {
  loading.value = true;
  try {
    products.value = (await getProductList()) || [];
  } finally {
    loading.value = false;
  }
}

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase();
  if (!k) return products.value;
  return products.value.filter((p) => {
    return (
      p.productEn?.toLowerCase().includes(k) ||
      p.productCn?.toLowerCase().includes(k) ||
      p.primaryDomain?.toLowerCase().includes(k) ||
      p.clientIps?.some((ip) => ip.toLowerCase().includes(k))
    );
  });
});

function reset() {
  keyword.value = '';
}

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function fmtTime(t?: string) {
  if (!t) return '-';
  // ⚠️ 后端输出的时间**已是项目时区（Asia/Shanghai）的墙上时间**，不带时区语义
  // （契约见后端 ApiTime：DB 用 AppTime.Now 写入，即北京时间）。
  // 旧实现「补 Z 当 UTC 解析 + 再用 Asia/Shanghai 格式化」= 多加 8 小时（用户实测反馈）。
  // 正确做法：直接按字符串展示，就是北京时间。
  const m = String(t).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
  if (m) return `${m[1]} ${m[2]}`;
  return t;
}

function goDetail(productEn: string) {
  router.push({ path: '/backup-receive/detail', query: { productEn } });
}

const columns = [
  { title: '产品', key: 'product', minWidth: 280 },
  { title: '备份份数', key: 'backupCount', width: 100 },
  { title: '总大小', key: 'totalSize', width: 110 },
  { title: '最近备份', key: 'latestBackupTime', width: 180 },
  { title: '客户端 IP', key: 'clientIps', width: 200 },
  { title: '操作', key: 'action', width: 100, fixed: 'right' as const },
];

onMounted(() => {
  loadAppTimeZone();
  load();
});
</script>

<template>
  <div style="padding: 24px">
    <Card>
      <Form layout="inline" style="margin-bottom: 16px" @submit.prevent>
        <FormItem label="搜索">
          <Input
            v-model:value="keyword"
            placeholder="产品名 / 域名 / 客户端 IP"
            allow-clear
            style="width: 280px"
            @press-enter="() => {}"
          />
        </FormItem>
        <FormItem>
          <Space>
            <Button type="primary" @click="() => {}">查询</Button>
            <Button @click="reset">重置</Button>
            <Button @click="load">刷新</Button>
          </Space>
        </FormItem>
      </Form>

      <Table
        :columns="columns"
        :data-source="filtered"
        :loading="loading"
        row-key="productEn"
        size="middle"
        :pagination="false"
        :scroll="{ x: 1200 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'product'">
            <div style="display: flex; gap: 12px; align-items: center">
              <img
                v-if="record.logoPath"
                :src="toServerUrl(record.logoPath)"
                :alt="record.productCn"
                style="
                  flex-shrink: 0;
                  width: 40px;
                  height: 40px;
                  object-fit: contain;
                  border: 1px solid var(--ant-color-border-secondary);
                  border-radius: 4px;
                "
              />
              <div
                v-else
                style="
                  display: flex;
                  flex-shrink: 0;
                  align-items: center;
                  justify-content: center;
                  width: 40px;
                  height: 40px;
                  font-size: 18px;
                  color: var(--ant-color-text-quaternary);
                  border: 1px solid var(--ant-color-border-secondary);
                  border-radius: 4px;
                "
              >
                ?
              </div>
              <div style="min-width: 0">
                <div
                  style="
                    font-weight: 500;
                    line-height: 1.4;
                    color: var(--ant-color-text);
                  "
                >
                  {{ record.productCn || record.productEn || '-' }}
                </div>
                <div
                  style="
                    font-size: 12px;
                    line-height: 1.4;
                    color: var(--ant-color-text-tertiary);
                  "
                >
                  {{ record.productEn }}
                </div>
                <div v-if="record.primaryDomain" style="margin-top: 2px">
                  <Tag color="geekblue" style="margin: 0; font-size: 11px">
                    {{ record.primaryDomain }}
                  </Tag>
                </div>
              </div>
            </div>
          </template>
          <template v-else-if="column.key === 'backupCount'">
            <Tag color="blue">{{ record.backupCount }}</Tag>
          </template>
          <template v-else-if="column.key === 'totalSize'">
            {{ fmtSize(record.totalSize) }}
          </template>
          <template v-else-if="column.key === 'latestBackupTime'">
            <TimeTag
              :time="fmtTime(record.latestBackupTime)"
              :timezone="appTimeZone"
              color="blue"
            />
          </template>
          <template v-else-if="column.key === 'clientIps'">
            <div
              style="
                display: flex;
                flex-direction: column;
                gap: 4px;
                align-items: flex-start;
              "
            >
              <Tag
                v-for="ip in record.clientIps"
                :key="ip"
                color="cyan"
                style="margin: 0"
              >
                {{ ip }}
              </Tag>
            </div>
          </template>
          <template v-else-if="column.key === 'action'">
            <Button
              type="primary"
              size="small"
              @click="goDetail(record.productEn)"
            >
              查看
            </Button>
          </template>
        </template>
      </Table>
    </Card>
  </div>
</template>
