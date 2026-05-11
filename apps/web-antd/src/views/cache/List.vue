<script lang="ts" setup>
import { onMounted, ref } from 'vue';

import { Button, Card, Descriptions, Modal, Space, Tag } from 'ant-design-vue';

import { getCacheInfo, postClearAllCache, postClearCacheByPrefix } from './api';

interface CacheCategory {
  prefix: string;
  name: string;
  description: string;
}

interface CacheInfo {
  provider: string;
  categories: CacheCategory[];
}

const cacheInfo = ref<CacheInfo | null>(null);
const loading = ref(false);
const clearingPrefix = ref('');

async function loadCacheInfo() {
  loading.value = true;
  try {
    cacheInfo.value = await getCacheInfo();
  } catch {
    cacheInfo.value = null;
  } finally {
    loading.value = false;
  }
}

function handleClearAll() {
  Modal.confirm({
    title: '确认清空',
    content: '确定要清空所有缓存吗？',
    okText: '确定',
    cancelText: '取消',
    async onOk() {
      await postClearAllCache();
      loadCacheInfo();
    },
  });
}

function handleClearByPrefix(prefix: string, name: string) {
  Modal.confirm({
    title: '确认清空',
    content: `确定要清空「${name}」缓存吗？`,
    okText: '确定',
    cancelText: '取消',
    async onOk() {
      clearingPrefix.value = prefix;
      try {
        await postClearCacheByPrefix(prefix);
        loadCacheInfo();
      } finally {
        clearingPrefix.value = '';
      }
    },
  });
}

onMounted(loadCacheInfo);
</script>

<template>
  <div style="display: flex; flex-direction: column; gap: 16px">
      <!-- 缓存状态 -->
      <Card title="缓存状态" :loading="loading">
        <template #extra>
          <Button @click="loadCacheInfo">刷新</Button>
        </template>

        <div v-if="cacheInfo">
          <Descriptions :column="2" bordered size="small">
            <Descriptions.Item label="缓存状态">
              <Tag
                :color="cacheInfo.provider === 'Disabled' ? 'default' : 'success'"
              >
                {{ cacheInfo.provider === 'Disabled' ? '未启用' : '已启用' }}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="缓存驱动">
              <Tag color="blue">{{ cacheInfo.provider }}</Tag>
            </Descriptions.Item>
          </Descriptions>
        </div>

        <div
          v-else
          style="text-align: center; padding: 16px; color: #999"
        >
          无法获取缓存信息
        </div>
      </Card>

      <!-- 缓存操作 -->
      <Card
        v-if="cacheInfo && cacheInfo.provider !== 'Disabled'"
        title="缓存操作"
      >
        <template #extra>
          <Button type="primary" danger @click="handleClearAll">
            清空全部缓存
          </Button>
        </template>

        <div style="display: flex; flex-direction: column; gap: 12px">
          <Card
            v-for="cat in cacheInfo.categories"
            :key="cat.prefix"
            size="small"
          >
            <div
              style="
                display: flex;
                align-items: center;
                justify-content: space-between;
              "
            >
              <div>
                <div style="font-weight: 500; font-size: 15px">
                  {{ cat.name }}
                </div>
                <div style="color: #999; font-size: 13px; margin-top: 4px">
                  {{ cat.description }}
                  <Tag style="margin-left: 8px">{{ cat.prefix }}*</Tag>
                </div>
              </div>
              <Button
                danger
                :loading="clearingPrefix === cat.prefix"
                @click="handleClearByPrefix(cat.prefix, cat.name)"
              >
                清空
              </Button>
            </div>
          </Card>
        </div>
      </Card>

      <!-- 缓存未启用提示 -->
      <Card v-if="cacheInfo && cacheInfo.provider === 'Disabled'">
        <div style="text-align: center; padding: 24px; color: #999">
          当前系统未启用缓存，无需清理
        </div>
      </Card>
  </div>
</template>
