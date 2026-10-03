<script lang="ts" setup>
import type { PendingDecisions } from '#/api/core/dramafloow';

/**
 * D 区：待我决策（设计文档 §D）
 *
 * 目标是「首页就能看图、点进去就能决策」：
 * - 图片候选：按 asset_requirement 分组的缩略图（每组最多 3 张，避免首页拉几百张全尺寸图）
 * - 视频：stale/failed 片段（异常复核入口）
 * - 成片：渲染完成未发布（待确认/待发布）
 * - 剧本：待确认的洗稿版本
 *
 * 设计 §1 红线：真正的批量决策仍在决策台（键盘流），本区只做**预览 + 直达**，
 * 不重复实现审核逻辑，避免两套实现漂移。
 * 媒体 URL 一律走 utils/media.ts（历史上这里出过 media_root 变更导致静默不显示的缺陷）。
 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { Badge, Button, Card, Empty, Image, Tabs, Tag } from 'ant-design-vue';

import { dashboardPendingDecisions } from '#/api/core/dramafloow';
import { toStorageUrl } from '#/utils/media';

const router = useRouter();

const data = ref<null | PendingDecisions>(null);
const loading = ref(false);
const activeTab = ref('images');

async function load() {
  loading.value = true;
  try {
    data.value = await dashboardPendingDecisions({
      limit: 12,
      previewsPerGroup: 3,
    });
  } catch {
    // 拦截器已提示
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load();
});

defineExpose({ load });

const counts = computed(() => data.value?.counts);

/** 图片候选缩略图 URL */
const thumb = (filePath?: string): string => toStorageUrl(filePath);

/** 跳决策台（审核队列），定位到该需求 */
function openReview(requirementId?: number) {
  router.push({
    name: 'ReviewQueue',
    query: requirementId ? { requirementId } : {},
  });
}

/** 跳剧目详情的剧本 Tab */
function openDramaScript(dramaId: number) {
  router.push({ name: 'DramaDetail', query: { id: dramaId, tab: 'script' } });
}

/** 跳成片列表 */
function openProduct(dramaId: number) {
  router.push({ name: 'ProductEpisodes', query: { dramaId } });
}

const tabItems = computed(() => [
  {
    key: 'images',
    label: `图片候选（${counts.value?.images ?? 0}）`,
  },
  {
    key: 'videos',
    label: `片段异常（${counts.value?.videos ?? 0}）`,
  },
  {
    key: 'products',
    label: `待发布成片（${counts.value?.products ?? 0}）`,
  },
  {
    key: 'scripts',
    label: `待确认剧本（${counts.value?.scripts ?? 0}）`,
  },
]);
</script>

<template>
  <Card size="small" title="待我决策">
    <template #extra>
      <Button size="small" :loading="loading" @click="load">刷新</Button>
    </template>

    <Tabs v-model:active-key="activeTab" size="small">
      <Tabs.TabPane v-for="t in tabItems" :key="t.key" :tab="t.label">
        <!-- 图片候选：按需求分组 -->
        <template v-if="t.key === 'images'">
          <div
            v-if="(data?.images.length ?? 0) > 0"
            class="flex flex-wrap gap-3"
          >
            <div
              v-for="g in data?.images ?? []"
              :key="g.requirementId"
              class="rounded-md border border-border p-2"
            >
              <div class="mb-1 flex items-center gap-2 text-xs">
                <span class="font-medium">{{ g.requirementKey }}</span>
                <Tag class="!mr-0">{{ g.kind }}</Tag>
                <span class="text-muted-foreground">
                  v{{ g.version }} · 候选 {{ g.candidateCount }}
                </span>
              </div>
              <div class="flex gap-2">
                <Image
                  v-for="p in g.previews"
                  :key="p.candidateId"
                  :src="thumb(p.filePath)"
                  :width="96"
                  :height="96"
                  class="cursor-pointer rounded object-cover"
                  :preview="{ src: thumb(p.filePath) }"
                />
              </div>
              <div class="mt-1 flex items-center justify-between gap-2">
                <a
                  class="text-xs"
                  @click="
                    router.push({
                      name: 'DramaDetail',
                      query: { id: g.dramaId },
                    })
                  "
                >
                  {{ g.dramaName || '查看剧目' }}
                </a>
                <Button
                  type="link"
                  size="small"
                  @click="openReview(g.requirementId)"
                >
                  去决策
                </Button>
              </div>
            </div>
          </div>
          <Empty v-else description="暂无待审候选" />
        </template>

        <!-- 片段异常 -->
        <template v-else-if="t.key === 'videos'">
          <div
            v-if="(data?.videos.length ?? 0) > 0"
            class="flex flex-col gap-2"
          >
            <div
              v-for="v in data?.videos ?? []"
              :key="v.clipId"
              class="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
            >
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 text-xs">
                  <Badge
                    :status="v.status === 'failed' ? 'error' : 'warning'"
                  />
                  <Tag :color="v.status === 'failed' ? 'error' : 'warning'">
                    {{ v.status === 'failed' ? '渲染失败' : '素材变更失效' }}
                  </Tag>
                  <span class="text-muted-foreground">
                    {{ v.dramaName }} · 镜 {{ v.shotId }}
                  </span>
                </div>
                <div v-if="v.error" class="mt-1 truncate text-xs">
                  {{ v.error }}
                </div>
              </div>
              <Button
                type="link"
                size="small"
                @click="
                  router.push({
                    name: 'DramaDetail',
                    query: { id: v.dramaId, tab: 'clip' },
                  })
                "
              >
                去处理
              </Button>
            </div>
          </div>
          <Empty v-else description="无异常片段" />
        </template>

        <!-- 待发布成片 -->
        <template v-else-if="t.key === 'products'">
          <div
            v-if="(data?.products.length ?? 0) > 0"
            class="flex flex-wrap gap-3"
          >
            <div
              v-for="p in data?.products ?? []"
              :key="p.episodeId"
              class="rounded-md border border-border p-2"
            >
              <Image
                :src="thumb(p.coverPath)"
                :width="140"
                :height="80"
                class="rounded object-cover"
                :preview="{ src: thumb(p.coverPath) }"
              />
              <div class="mt-1 text-xs">
                {{ p.dramaName }} · 第 {{ p.episodeNo }} 集
                <span class="text-muted-foreground">
                  {{ p.durationSec ?? 0 }}s
                </span>
              </div>
              <Button type="link" size="small" @click="openProduct(p.dramaId)">
                去发布
              </Button>
            </div>
          </div>
          <Empty v-else description="暂无待发布成片" />
        </template>

        <!-- 待确认剧本 -->
        <template v-else>
          <div
            v-if="(data?.scripts.length ?? 0) > 0"
            class="flex flex-col gap-2"
          >
            <div
              v-for="s in data?.scripts ?? []"
              :key="s.scriptId"
              class="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
            >
              <div class="flex items-center gap-2 text-xs">
                <Tag
                  :color="s.status === 'rewriting' ? 'processing' : 'default'"
                >
                  {{ s.status === 'rewriting' ? '洗稿中' : s.status }}
                </Tag>
                <span>{{ s.dramaName }}</span>
                <span class="text-muted-foreground">v{{ s.version }}</span>
              </div>
              <Button
                type="link"
                size="small"
                @click="openDramaScript(s.dramaId)"
              >
                去确认
              </Button>
            </div>
          </div>
          <Empty v-else description="暂无待确认剧本" />
        </template>
      </Tabs.TabPane>
    </Tabs>
  </Card>
</template>
