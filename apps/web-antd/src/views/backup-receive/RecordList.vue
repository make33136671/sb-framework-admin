<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { Button, Card, Empty, message, Modal, Space, Spin, Table, Tag } from 'ant-design-vue';

import { type BackupRemoteRecord, getDownloadUrl, getRecordList, postDelete, toServerUrl } from './api';

const route = useRoute();
const router = useRouter();

const productEn = ref<string>((route.query.productEn as string) || '');
const loading = ref(false);
const records = ref<BackupRemoteRecord[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const productCn = ref('');
const logoPath = ref<string | null>(null);

async function load() {
  if (!productEn.value) return;
  loading.value = true;
  try {
    const res = (await getRecordList({
      productEn: productEn.value,
      page: page.value,
      pageSize: pageSize.value,
    })) as { items: BackupRemoteRecord[]; total: number };
    records.value = res.items || [];
    total.value = res.total || 0;
    if (records.value.length > 0) {
      productCn.value = records.value[0].productCn;
      logoPath.value = records.value[0].logoPath ?? null;
    }
  } finally {
    loading.value = false;
  }
}

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function fmtTime(t?: string) {
  if (!t) return '-';
  const hasTz = /[Zz]|[+-]\d\d:?\d\d$/.test(t);
  const d = new Date(hasTz ? t : `${t}Z`);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('zh-CN', { hour12: false });
}

function download(id: number) {
  // 后端 Download 接口要 admin token，这里直接打开 URL 由 axios 拦截器加 header 比较麻烦，
  // 简化用 window.open + 浏览器 cookie/header（vben 走 token，这里需要 a 标签下载，先用同源 cookie）
  // 更稳的做法是 axios responseType=blob 拿到二进制后构造 URL，下面这样实现
  void downloadAsBlob(id);
}

async function downloadAsBlob(id: number) {
  try {
    const url = getDownloadUrl(id);
    const token = (await import('@vben/stores')).useAccessStore().accessToken;
    const resp = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const fileName = records.value.find((r) => r.id === id)?.fileName || `backup_${id}.zip`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    console.error('download failed', e);
  }
}

const columns = [
  { title: '文件名', dataIndex: 'fileName', key: 'fileName' },
  { title: '客户端 IP', dataIndex: 'clientIp', key: 'clientIp', width: 140 },
  { title: '大小', dataIndex: 'fileSize', key: 'fileSize', width: 110 },
  { title: '客户端备份时间', dataIndex: 'backupTime', key: 'backupTime', width: 180 },
  { title: '服务端接收时间', dataIndex: 'receivedTime', key: 'receivedTime', width: 180 },
  { title: 'MD5', dataIndex: 'md5', key: 'md5', width: 250 },
  { title: '操作', key: 'action', width: 160, fixed: 'right' as const },
];

function confirmDelete(record: BackupRemoteRecord) {
  Modal.confirm({
    title: '删除云端备份',
    content: `确定删除 ${record.productEn} / ${record.fileName}? 此操作不可恢复。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      // toast 由 axios 拦截器自动弹后端 message
      await postDelete(record.id);
      await load();
    },
  });
}

onMounted(load);
</script>

<template>
  <div style="padding: 24px;">
    <Button style="margin-bottom: 16px;" @click="router.back()">← 返回产品列表</Button>

    <Card>
      <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 16px;">
        <img
          v-if="logoPath"
          :src="toServerUrl(logoPath)"
          :alt="productCn"
          style="
            width: 48px;
            height: 48px;
            object-fit: contain;
            border-radius: 6px;
            border: 1px solid var(--ant-color-border-secondary);
          "
        />
        <div>
          <div style="font-size: 18px; font-weight: 600;">
            {{ productCn || productEn }}
          </div>
          <div style="color: var(--ant-color-text-tertiary); font-size: 12px;">
            {{ productEn }} · 共 {{ total }} 份备份
          </div>
        </div>
      </div>

      <Spin :spinning="loading">
        <Empty
          v-if="!loading && records.length === 0"
          description="此产品暂无备份记录"
        />
        <Table
          v-else
          :columns="columns"
          :data-source="records"
          :pagination="{
            current: page,
            pageSize,
            total,
            onChange: (p: number) => {
              page = p;
              load();
            },
          }"
          row-key="id"
          size="middle"
          :scroll="{ x: 1200 }"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'fileSize'">
              {{ fmtSize(record.fileSize) }}
            </template>
            <template v-else-if="column.key === 'backupTime'">
              {{ fmtTime(record.backupTime) }}
            </template>
            <template v-else-if="column.key === 'receivedTime'">
              {{ fmtTime(record.receivedTime) }}
            </template>
            <template v-else-if="column.key === 'md5'">
              <span style="font-family: monospace; font-size: 11px;">{{ record.md5 || '-' }}</span>
            </template>
            <template v-else-if="column.key === 'clientIp'">
              <Tag color="blue">{{ record.clientIp }}</Tag>
            </template>
            <template v-else-if="column.key === 'action'">
              <Space>
                <Button type="primary" size="small" @click="download(record.id)">
                  下载
                </Button>
                <Button danger size="small" @click="confirmDelete(record)">
                  删除
                </Button>
              </Space>
            </template>
          </template>
        </Table>
      </Spin>
    </Card>
  </div>
</template>
