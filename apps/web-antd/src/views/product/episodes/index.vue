<script lang="ts" setup>
/**
 * 成片列表（契约 §5.1 Product）
 * 选剧目 → 集列表（最新版本）+ 渲染/发布/下架 + 播放器。
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import { Page } from '@vben/common-ui';

import {
  Button,
  Card,
  Empty,
  Select,
  Space,
  Spin,
  Table,
  Tag,
} from 'ant-design-vue';

import type { DramaItem, ProductEpisodeItem } from '#/api/core/dramafloow';
import {
  dramaList,
  productEpisodeList,
  productPublish,
  productRender,
  productUnpublish,
} from '#/api/core/dramafloow';
import { EpisodePlayer } from '#/components/EpisodePlayer';
import { TimeTag } from '#/components/TimeTag';
import { useTaskStream } from '#/composables/useTaskStream';

const stream = useTaskStream();
const route = useRoute();

const dramas = ref<DramaItem[]>([]);
const dramaId = ref<number | undefined>(
  route.query.id ? Number(route.query.id) : undefined,
);
const episodes = ref<ProductEpisodeItem[]>([]);
const clipDone = ref(0);
const loading = ref(false);
const selected = ref<null | ProductEpisodeItem>(null);

async function loadDramas() {
  const res = await dramaList({ page: 1, pageSize: 200 });
  dramas.value = res.items;
  if (!dramaId.value && dramas.value.length > 0) {
    dramaId.value = dramas.value[0]!.id;
  }
}

async function loadEpisodes() {
  if (!dramaId.value) return;
  loading.value = true;
  try {
    const res = await productEpisodeList(dramaId.value);
    episodes.value = res.episodes;
    clipDone.value = res.clipDone;
    selected.value =
      res.episodes.find((e) => e.status === 'done') ?? res.episodes[0] ?? null;
  } catch {
    // 拦截器已提示
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await loadDramas();
  await loadEpisodes();
  if (dramaId.value) stream.subscribeDrama(dramaId.value);
});

watch(dramaId, async (v, old) => {
  if (old) stream.unsubscribeDrama(old);
  if (v) stream.subscribeDrama(v);
  selected.value = null;
  await loadEpisodes();
});

async function render() {
  if (!dramaId.value) return;
  await productRender(dramaId.value);
  await loadEpisodes();
}

async function publish(row: ProductEpisodeItem) {
  await productPublish(row.id);
  await loadEpisodes();
}

async function unpublish(row: ProductEpisodeItem) {
  await productUnpublish(row.id);
  await loadEpisodes();
}

const columns = [
  { title: '集', dataIndex: 'episodeNo', width: 60 },
  { title: '版本', dataIndex: 'version', width: 70 },
  { title: '状态', key: 'status', width: 100 },
  { title: '时长(秒)', dataIndex: 'durationSec', width: 90 },
  { title: '大小', key: 'size', width: 100 },
  { title: '发布状态', key: 'published', width: 170 },
  { title: '操作', key: 'action', width: 150 },
];

const sizeText = computed(() => (b?: number) => {
  if (!b) return '-';
  const mb = b / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
});
</script>

<template>
  <Page class="df-page" title="成片" description="片段合并成集 → 发布">
    <Card class="mb-4" size="small">
      <div class="flex flex-wrap items-center gap-3">
        <span class="text-sm">剧目</span>
        <Select
          v-model:value="dramaId"
          class="min-w-[220px]"
          placeholder="选择剧目"
          :options="dramas.map((d) => ({ label: d.name, value: d.id }))"
        />
        <Button type="primary" :disabled="!dramaId" @click="render">
          渲染成片
        </Button>
        <Button :disabled="!dramaId" @click="loadEpisodes">刷新</Button>
        <span class="text-xs text-muted-foreground">
          已完成片段 {{ clipDone }} 个
        </span>
      </div>
    </Card>

    <div class="grid grid-cols-3 gap-4">
      <Card class="col-span-2" size="small" title="集列表">
        <Spin :spinning="loading">
          <Table
            v-if="episodes.length > 0"
            :columns="columns"
            :data-source="episodes"
            :pagination="false"
            :row-class-name="
              (r: ProductEpisodeItem) =>
                r.id === selected?.id ? 'bg-primary/10' : ''
            "
            row-key="id"
            size="small"
            @row-click="(r: ProductEpisodeItem) => (selected = r)"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'status'">
                <Tag
                  :color="
                    record.status === 'done'
                      ? 'success'
                      : record.status === 'failed'
                        ? 'error'
                        : 'processing'
                  "
                  class="!mr-0"
                >
                  {{
                    record.status === 'done'
                      ? '已完成'
                      : record.status === 'failed'
                        ? '失败'
                        : '渲染中'
                  }}
                </Tag>
              </template>
              <template v-else-if="column.key === 'size'">
                {{ sizeText(record.sizeBytes) }}
              </template>
              <template v-else-if="column.key === 'published'">
                <TimeTag v-if="record.publishedAt" :time="record.publishedAt" />
                <Tag v-else color="default" class="!mr-0">未发布</Tag>
              </template>
              <template v-else-if="column.key === 'action'">
                <Space>
                  <Button
                    v-if="record.status === 'done' && !record.publishedAt"
                    size="small"
                    type="link"
                    @click.stop="publish(record as ProductEpisodeItem)"
                  >
                    发布
                  </Button>
                  <Button
                    v-if="record.publishedAt"
                    size="small"
                    type="link"
                    danger
                    @click.stop="unpublish(record as ProductEpisodeItem)"
                  >
                    下架
                  </Button>
                </Space>
              </template>
            </template>
          </Table>
          <Empty
            v-else
            description="尚无成片（需先有已完成片段后点击「渲染成片」）"
          />
        </Spin>
      </Card>

      <Card class="col-span-1" size="small" title="预览">
        <EpisodePlayer
          v-if="selected"
          :video-path="selected.videoPath"
          :cover-path="selected.coverPath"
          :episode-no="selected.episodeNo"
          :duration-sec="selected.durationSec"
          :size-bytes="selected.sizeBytes"
          :status="selected.status"
        />
        <Empty v-else description="选择左侧某集预览" />
      </Card>
    </div>
  </Page>
</template>
