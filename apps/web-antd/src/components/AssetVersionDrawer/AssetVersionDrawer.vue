<script lang="ts" setup>
import type { AssetRequirementItem } from '#/api/core/dramafloow';

/**
 * 素材版本抽屉（AssetVersionDrawer）
 *
 * 对应需求：「洗稿时能生成 角色/道具/场景；不满意可重新生成；**不覆盖**，
 * 保留历史版本（生成 10 版仍可选前期版本）」。
 *
 * 展示某个 key（如 character_林深）的全部历史版本，每版可：
 *   - 查看：版本号/来源/描述/候选数/创建时间，当前生效版有标记
 *   - 回选：把任一历史版本设为「当前生效」（current-pointer，写审计）
 *   - 删除：软删该版本
 * 顶部提供「重新提取」：再生成一版（append-only，旧版保留）。
 */
import { ref, watch } from 'vue';

import {
  Button,
  Descriptions,
  Drawer,
  Empty,
  message,
  Popconfirm,
  Table,
  Tag,
} from 'ant-design-vue';

import {
  assetExtractStart,
  assetSetCurrentVersion,
  assetVersionDelete,
  assetVersionList,
} from '#/api/core/dramafloow';
import { AiProviderSelect } from '#/components/AiProviderSelect';
import { TimeTag } from '#/components/TimeTag';
import { enumText } from '#/composables/useEnumText';

const props = defineProps<{
  /** 要查看的素材 key；null 表示关闭 */
  assetKey: null | string;
  dramaId: null | number;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'changed'): void;
}>();

const open = ref(false);
const loading = ref(false);
const rows = ref<AssetRequirementItem[]>([]);
const acting = ref(false);
/**
 * 「重新提取」用哪个模型（null = 自动，按文本能力的默认线路）。
 *
 * 用户诉求：「AI任务里只有自动排队，不能手动指定任务模型跑，这部分我希望可以手动接管」。
 * 这里与素材页的「素材提取」用**同一个组件、同一套能力校验**（asset_extract → 文本能力），
 * 不再让"重新提取"这条路径成为唯一不能选模型的入口。
 */
const extractProviderId = ref<null | number>(null);

async function load() {
  if (props.dramaId === null || !props.assetKey) return;
  loading.value = true;
  try {
    rows.value = await assetVersionList(props.dramaId, props.assetKey);
  } catch {
    // 拦截器已提示
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.assetKey,
  (k) => {
    open.value = !!k;
    if (k) void load();
  },
  { immediate: true },
);

/** 来源标签（storyboard 推导 / LLM 提取 / 人工新增） */
function sourceText(src?: string): string {
  if (src === 'extract') return 'LLM 提取';
  if (src === 'manual') return '人工新增';
  if (src === 'storyboard') return '分镜推导';
  return src || '-';
}

function sourceColor(src?: string): string {
  if (src === 'extract') return 'processing';
  if (src === 'manual') return 'default';
  return 'default';
}

/** 重新提取：新增一版（不覆盖） */
async function reExtract() {
  if (props.dramaId === null) return;
  acting.value = true;
  try {
    const res = await assetExtractStart(props.dramaId, extractProviderId.value);
    // 与素材页同一口径：说清"只出清单、不出图"，避免用户在素材页苦等图片
    message.success(
      `已入队素材清单提取（任务 #${res.taskId}）：完成后会新增一版，**不会自动出图**`,
    );
    emit('changed');
  } finally {
    acting.value = false;
  }
}

async function setCurrent(row: AssetRequirementItem) {
  acting.value = true;
  try {
    await assetSetCurrentVersion(row.id);
    await load();
    emit('changed');
  } finally {
    acting.value = false;
  }
}

async function removeVersion(row: AssetRequirementItem) {
  acting.value = true;
  try {
    await assetVersionDelete(row.id);
    await load();
    emit('changed');
  } finally {
    acting.value = false;
  }
}

const columns = [
  { title: '版本', key: 'version', width: 100 },
  { title: '来源', key: 'source', width: 100 },
  { title: '状态', key: 'status', width: 100 },
  { title: '候选', key: 'cand', width: 110 },
  {
    title: '描述',
    dataIndex: 'description',
    key: 'description',
    ellipsis: true,
  },
  { title: '创建时间', key: 'createdAt', width: 170 },
  { title: '操作', key: 'action', width: 150 },
];
</script>

<template>
  <Drawer :open="open" :width="900" title="素材历史版本" @close="emit('close')">
    <div class="mb-3 flex flex-wrap items-center gap-3">
      <span class="text-sm font-medium">{{ assetKey }}</span>
      <Tag class="!mr-0">共 {{ rows.length }} 版</Tag>
      <div class="flex-1"></div>
      <!-- 手动指定「重新提取」用哪个模型（默认自动）：与素材页的提取入口能力一致 -->
      <AiProviderSelect
        v-model:value="extractProviderId"
        task-type="asset_extract"
      />
      <Button size="small" type="primary" :loading="acting" @click="reExtract">
        重新提取（新增一版）
      </Button>
      <Button size="small" :loading="loading" @click="load">刷新</Button>
    </div>

    <p class="mb-3 text-xs text-muted-foreground">
      每次提取/重新生成都会新增一版，旧版不会被覆盖；可随时回选任一历史版本为当前生效版本。
    </p>

    <Table
      v-if="rows.length > 0"
      :columns="columns"
      :data-source="rows"
      :pagination="false"
      row-key="id"
      size="small"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'version'">
          <span>v{{ record.version }}</span>
          <Tag v-if="record.isCurrent" color="success" class="ml-1 !mr-0">
            当前
          </Tag>
        </template>

        <template v-else-if="column.key === 'source'">
          <Tag :color="sourceColor(record.source)" class="!mr-0">
            {{ sourceText(record.source) }}
          </Tag>
        </template>

        <template v-else-if="column.key === 'status'">
          <Tag class="!mr-0">{{ enumText.candidateStatus(record.status) }}</Tag>
        </template>

        <template v-else-if="column.key === 'cand'">
          {{ record.approvedCount }}/{{ record.candidateCount }}
        </template>

        <template v-else-if="column.key === 'createdAt'">
          <TimeTag :time="record.createdAt" />
        </template>

        <template v-else-if="column.key === 'action'">
          <Button
            v-if="!record.isCurrent"
            type="link"
            size="small"
            :loading="acting"
            @click="setCurrent(record as AssetRequirementItem)"
          >
            设为当前
          </Button>
          <Popconfirm
            title="确认删除该版本？"
            description="软删除，可恢复。"
            @confirm="removeVersion(record as AssetRequirementItem)"
          >
            <Button type="link" size="small" danger :loading="acting">
              删除
            </Button>
          </Popconfirm>
        </template>
      </template>
    </Table>

    <Empty v-else description="暂无版本" />

    <!-- 选中版本的描述详情（便于对比不同版本的描述差异） -->
    <div v-if="rows.length > 0" class="mt-4">
      <div class="mb-2 text-sm font-medium">当前生效版本描述</div>
      <Descriptions bordered size="small" :column="1">
        <Descriptions.Item label="版本">
          v{{ rows.find((r) => r.isCurrent)?.version ?? '-' }}
        </Descriptions.Item>
        <Descriptions.Item label="描述">
          {{ rows.find((r) => r.isCurrent)?.description || '-' }}
        </Descriptions.Item>
      </Descriptions>
    </div>
  </Drawer>
</template>
