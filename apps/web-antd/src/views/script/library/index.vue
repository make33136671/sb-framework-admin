<script lang="ts" setup>
/**
 * 剧本仓库（契约 §5.1 Script）
 *
 * 展示各剧目的剧本版本清单（append-only，只增不改）；
 * 原始稿只能在剧目详情首次录入（不变量：source_text 不可变）。
 */
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';

import { Button, Card, Empty, Spin, Table, Tag } from 'ant-design-vue';

import { dramaList, scriptVersionList } from '#/api/core/dramafloow';
import { TimeTag } from '#/components/TimeTag';

const router = useRouter();

interface Row {
  createdAt: string;
  dramaId: number;
  dramaName: string;
  episodeCount: number;
  hasRewritten: boolean;
  id: number;
  model?: string;
  status: string;
  version: number;
}

const rows = ref<Row[]>([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const dramas = await dramaList({ page: 1, pageSize: 200 });
    const all: Row[] = [];
    for (const d of dramas.items) {
      const versions = await scriptVersionList(d.id).catch(() => []);
      for (const v of versions) {
        all.push({
          ...v,
          dramaId: d.id,
          dramaName: d.name,
        });
      }
    }
    rows.value = all.sort(
      (a, b) => b.dramaId - a.dramaId || b.version - a.version,
    );
  } catch {
    // 拦截器已提示
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());

function openDrama(row: Row) {
  router.push({ name: 'DramaDetail', query: { id: row.dramaId } });
}

const columns = [
  { title: '剧目', dataIndex: 'dramaName', minWidth: 160 },
  { title: '版本', dataIndex: 'version', width: 80 },
  { title: '集数', dataIndex: 'episodeCount', width: 70 },
  { title: '模型', dataIndex: 'model', width: 120 },
  { title: '状态', key: 'status', width: 100 },
  { title: '已改写', key: 'rewritten', width: 90 },
  { title: '创建时间', key: 'createdAt', width: 170 },
  { title: '操作', key: 'action', width: 100 },
];
</script>

<template>
  <Page
    title="剧本仓库"
    description="各剧目剧本版本（原始稿不可变，改写只新增版本）"
  >
    <Card size="small">
      <template #title>
        <div class="flex items-center gap-3">
          <span>剧本版本</span>
          <Button size="small" @click="load">刷新</Button>
        </div>
      </template>

      <Spin :spinning="loading">
        <Table
          v-if="rows.length > 0"
          :columns="columns"
          :data-source="rows"
          :pagination="{ pageSize: 20 }"
          row-key="id"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'status'">
              <Tag
                :color="
                  record.status === 'done'
                    ? 'success'
                    : record.status === 'rewriting'
                      ? 'processing'
                      : 'default'
                "
                class="!mr-0"
              >
                {{ record.status }}
              </Tag>
            </template>
            <template v-else-if="column.key === 'rewritten'">
              <Tag
                :color="record.hasRewritten ? 'success' : 'default'"
                class="!mr-0"
              >
                {{ record.hasRewritten ? '是' : '否' }}
              </Tag>
            </template>
            <template v-else-if="column.key === 'createdAt'">
              <TimeTag :time="record.createdAt" />
            </template>
            <template v-else-if="column.key === 'action'">
              <Button
                size="small"
                type="link"
                @click="openDrama(record as Row)"
              >
                查看剧目
              </Button>
            </template>
          </template>
        </Table>
        <Empty v-else description="暂无剧本（在剧目详情录入原始稿）" />
      </Spin>
    </Card>
  </Page>
</template>
