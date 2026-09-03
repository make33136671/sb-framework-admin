<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';

import {
  Button,
  Card,
  Descriptions,
  Modal,
  Progress,
  Table,
  Tag,
} from 'ant-design-vue';

import { getCacheInfo, postClearAllCache, postClearCacheByPrefix } from './api';

interface CacheCategory {
  prefix: string;
  name: string;
  description: string;
  count: number;
}

interface SlowlogEntry {
  id: number;
  timestamp: number;
  duration_us: number;
  command: string;
}

interface CacheStats {
  redis_version?: string;
  endpoint?: string;
  database_id?: number;
  instance_name?: string;
  instance_keys?: number;
  dbsize?: number;
  used_memory_human?: string;
  used_memory_peak_human?: string;
  maxmemory_human?: string;
  uptime_in_seconds?: number;
  keyspace_hits?: number;
  keyspace_misses?: number;
  hit_rate?: number;
  instantaneous_ops_per_sec?: number;
  connected_clients?: number;
  total_commands_processed?: number;
  slowlog?: SlowlogEntry[];
}

interface CacheInfo {
  provider: string;
  stats: CacheStats | null;
  categories: CacheCategory[];
  uncategorized: number;
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
    content: '确定要清空当前系统所有缓存吗?(只清当前命名空间下的 key)',
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
    content: `确定要清空「${name}」缓存吗?`,
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

function formatUptime(s?: number) {
  if (!s || s <= 0) return '—';
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} 天 ${h} 小时`;
  if (h > 0) return `${h} 小时 ${m} 分`;
  return `${m} 分`;
}

function formatNumber(n?: number) {
  if (n === undefined || n === null) return '—';
  return n.toLocaleString();
}

function formatSlowlogTime(ts: number) {
  return new Date(ts * 1000).toLocaleString();
}

function formatDuration(us: number) {
  if (us >= 1000) return `${(us / 1000).toFixed(2)} ms`;
  return `${us} µs`;
}

const isRedis = computed(() => cacheInfo.value?.provider === 'Redis');
const isEnabled = computed(
  () => cacheInfo.value && cacheInfo.value.provider !== 'Disabled',
);
const hasStats = computed(() => cacheInfo.value?.stats != null);

const slowlogColumns = [
  {
    title: '时间',
    dataIndex: 'timestamp',
    width: 180,
    customRender: ({ text }: any) => formatSlowlogTime(text),
  },
  {
    title: '耗时',
    dataIndex: 'duration_us',
    width: 100,
    customRender: ({ text }: any) => formatDuration(text),
  },
  { title: '命令', dataIndex: 'command', ellipsis: true },
];

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
        <Descriptions :column="{ xs: 1, sm: 2, lg: 3 }" bordered size="small">
          <Descriptions.Item label="状态">
            <Tag :color="isEnabled ? 'success' : 'default'">
              {{ isEnabled ? '已启用' : '未启用' }}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="驱动">
            <Tag color="blue">
              {{ cacheInfo.provider
              }}<template v-if="isRedis && cacheInfo.stats?.redis_version">
                {{ cacheInfo.stats.redis_version }}
              </template>
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item v-if="hasStats" label="命名空间">
            <Tag v-if="cacheInfo.stats?.instance_name">
              {{ cacheInfo.stats.instance_name }}
            </Tag>
            <span v-else style="color: var(--ant-color-text-tertiary)">(无前缀)</span>
          </Descriptions.Item>

          <template v-if="isRedis">
            <Descriptions.Item label="连接">
              {{ cacheInfo.stats?.endpoint }}
              <Tag style="margin-left: 8px">
                DB {{ cacheInfo.stats?.database_id }}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="当前实例 key">
              <span
                v-if="(cacheInfo.stats?.instance_keys ?? -1) < 0"
                style="color: var(--ant-color-text-tertiary)"
                >—</span>
              <span v-else>{{
                formatNumber(cacheInfo.stats?.instance_keys)
              }}</span>
            </Descriptions.Item>
            <Descriptions.Item label="Redis 总 key">
              {{ formatNumber(cacheInfo.stats?.dbsize) }}
              <span
                v-if="
                  (cacheInfo.stats?.dbsize ?? 0) >
                  (cacheInfo.stats?.instance_keys ?? 0)
                "
                style="
                  margin-left: 4px;
                  font-size: 12px;
                  color: var(--ant-color-text-tertiary);
                "
              >
                (含其他系统)
              </span>
            </Descriptions.Item>

            <Descriptions.Item label="已用内存">
              {{ cacheInfo.stats?.used_memory_human ?? '—' }}
              <span
                v-if="
                  cacheInfo.stats?.maxmemory_human &&
                  cacheInfo.stats.maxmemory_human !== '0B'
                "
                style="margin-left: 4px; color: var(--ant-color-text-tertiary)"
              >
                / {{ cacheInfo.stats.maxmemory_human }}
              </span>
            </Descriptions.Item>
            <Descriptions.Item label="内存峰值">
              {{ cacheInfo.stats?.used_memory_peak_human ?? '—' }}
            </Descriptions.Item>
            <Descriptions.Item label="运行时长">
              {{ formatUptime(cacheInfo.stats?.uptime_in_seconds) }}
            </Descriptions.Item>

            <Descriptions.Item label="命中率">
              <div style="display: flex; gap: 8px; align-items: center">
                <Progress
                  :percent="cacheInfo.stats?.hit_rate ?? 0"
                  size="small"
                  :status="
                    (cacheInfo.stats?.hit_rate ?? 0) < 80
                      ? 'exception'
                      : 'normal'
                  "
                  style="min-width: 80px; max-width: 120px"
                />
                <span
                  style="font-size: 12px; color: var(--ant-color-text-tertiary)"
                >
                  {{ formatNumber(cacheInfo.stats?.keyspace_hits) }} /
                  {{ formatNumber(cacheInfo.stats?.keyspace_misses) }}
                </span>
              </div>
            </Descriptions.Item>
            <Descriptions.Item label="ops/sec">
              {{ formatNumber(cacheInfo.stats?.instantaneous_ops_per_sec) }}
            </Descriptions.Item>
            <Descriptions.Item label="客户端连接">
              {{ formatNumber(cacheInfo.stats?.connected_clients) }}
            </Descriptions.Item>
          </template>
        </Descriptions>
      </div>

      <div
        v-else
        style="
          padding: 16px;
          color: var(--ant-color-text-tertiary);
          text-align: center;
        "
      >
        无法获取缓存信息
      </div>
    </Card>

    <!-- 缓存操作 -->
    <Card v-if="cacheInfo && isEnabled" title="缓存操作">
      <template #extra>
        <Button type="primary" danger @click="handleClearAll">
          清空当前命名空间
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
              gap: 16px;
              align-items: center;
              justify-content: space-between;
            "
          >
            <div style="flex: 1; min-width: 0">
              <div style="font-size: 15px; font-weight: 500">
                {{ cat.name }}
                <Tag color="blue" style="margin-left: 8px">
                  {{ formatNumber(cat.count) }} keys
                </Tag>
              </div>
              <div
                style="
                  margin-top: 4px;
                  font-size: 13px;
                  color: var(--ant-color-text-tertiary);
                "
              >
                {{ cat.description }}
                <Tag style="margin-left: 8px">{{ cat.prefix }}*</Tag>
              </div>
            </div>
            <Button
              danger
              :disabled="cat.count === 0"
              :loading="clearingPrefix === cat.prefix"
              @click="handleClearByPrefix(cat.prefix, cat.name)"
            >
              清空
            </Button>
          </div>
        </Card>

        <Card
          v-if="cacheInfo.uncategorized > 0"
          size="small"
          style="background: var(--ant-color-fill-tertiary)"
        >
          <div
            style="
              display: flex;
              align-items: center;
              justify-content: space-between;
            "
          >
            <div>
              <div style="font-size: 15px; font-weight: 500">
                未分类
                <Tag style="margin-left: 8px">
                  {{ formatNumber(cacheInfo.uncategorized) }} keys
                </Tag>
              </div>
              <div
                style="
                  margin-top: 4px;
                  font-size: 13px;
                  color: var(--ant-color-text-tertiary);
                "
              >
                不在已知分类前缀下的其他 key(通常是业务运行时缓存)
              </div>
            </div>
          </div>
        </Card>
      </div>
    </Card>

    <!-- 慢查询 -->
    <Card
      v-if="
        isRedis &&
        cacheInfo?.stats?.slowlog &&
        cacheInfo.stats.slowlog.length > 0
      "
      title="慢查询(Redis SLOWLOG)"
    >
      <Table
        :columns="slowlogColumns"
        :data-source="cacheInfo.stats.slowlog"
        :pagination="false"
        size="small"
        row-key="id"
      />
    </Card>

    <!-- 缓存未启用提示 -->
    <Card v-if="cacheInfo && !isEnabled">
      <div
        style="
          padding: 24px;
          color: var(--ant-color-text-tertiary);
          text-align: center;
        "
      >
        当前系统未启用缓存,无需清理
      </div>
    </Card>
  </div>
</template>
