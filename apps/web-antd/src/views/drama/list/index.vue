<script lang="ts" setup>
/**
 * 剧目列表（契约 §5.1 Drama）
 *
 * 新建剧目 → 进详情走「存原始稿 → 洗稿 → 分镜 → 素材 → 片段 → 成片」全链路。
 */
import type { VbenFormProps } from '#/adapter/form';
import type { VxeGridProps } from '#/adapter/vxe-table';

import { ref } from 'vue';
import { useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';

import { Button, Input, Modal, Space, Tag } from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import type { DramaItem } from '#/api/core/dramafloow';
import {
  dramaAdd,
  dramaArchive,
  dramaList,
  dramaRestore,
  dramaSetStatus,
} from '#/api/core/dramafloow';
import { TimeTag } from '#/components/TimeTag';

const router = useRouter();
const archivedView = ref(false);

/** 状态 → 中文 + 颜色 */
const STATUS_MAP: Record<string, { color: string; text: string }> = {
  draft: { text: '草稿', color: 'default' },
  producing: { text: '生产中', color: 'processing' },
  review: { text: '待审', color: 'warning' },
  done: { text: '已完成', color: 'success' },
  archived: { text: '已归档', color: 'default' },
};

function statusText(s: string): string {
  return STATUS_MAP[s]?.text ?? s;
}
function statusColor(s: string): string {
  return STATUS_MAP[s]?.color ?? 'default';
}

const formOptions: VbenFormProps = {
  schema: [
    {
      component: 'Input',
      componentProps: { placeholder: '名称 / 编号' },
      fieldName: 'keyword',
      label: '关键词',
    },
    {
      component: 'Select',
      componentProps: {
        options: [
          { label: '草稿', value: 'draft' },
          { label: '生产中', value: 'producing' },
          { label: '待审', value: 'review' },
          { label: '已完成', value: 'done' },
        ],
      },
      fieldName: 'status',
      label: '状态',
    },
  ],
  showCollapseButton: false,
  submitOnChange: false,
  submitOnEnter: true,
  wrapperClass: 'grid-cols-2',
};

const gridOptions: VxeGridProps<DramaItem> = {
  columns: [
    { field: 'id', title: 'Id', visible: false, width: 60 },
    { field: 'code', title: '编号', width: 150 },
    { field: 'name', title: '剧目名称', minWidth: 180 },
    { field: 'genre', title: '题材', width: 110 },
    {
      field: 'episodeTargetCount',
      title: '目标集数',
      width: 90,
    },
    {
      field: 'status',
      slots: { default: 'status' },
      title: '状态',
      width: 100,
    },
    {
      field: 'synopsis',
      title: '简介',
      minWidth: 200,
      showOverflow: 'tooltip',
    },
    {
      field: 'createdAt',
      slots: { default: 'createdAt' },
      title: '创建时间',
      width: 170,
    },
    {
      field: 'action',
      fixed: 'right',
      slots: { default: 'action' },
      title: '操作',
      width: 220,
    },
  ],
  pagerConfig: { enabled: true },
  proxyConfig: {
    ajax: {
      query: async ({ page }, formValues) => {
        const res = await dramaList({
          keyword: formValues.keyword,
          status: formValues.status,
          archived: archivedView.value,
          page: page.currentPage,
          pageSize: page.pageSize,
        });
        return { items: res.items, total: res.total };
      },
    },
  },
  toolbarConfig: { custom: true, refresh: true, zoom: true },
};

const [Grid, gridApi] = useVbenVxeGrid({ formOptions, gridOptions });

/** 新建/编辑弹窗 */
const editOpen = ref(false);
const editing = ref<null | Partial<DramaItem>>(null);

// 建剧同时上传剧本（D1）
const createScriptFile = ref<File | null>(null);
const createScriptText = ref('');
const createScriptInputRef = ref<HTMLInputElement>();

function onCreateScriptPicked(e: Event) {
  const input = e.target as HTMLInputElement;
  createScriptFile.value = input.files?.[0] ?? null;
}

function openCreate() {
  editing.value = { episodeTargetCount: 10 };
  editOpen.value = true;
}

function openEdit(row: DramaItem) {
  editing.value = { ...row };
  editOpen.value = true;
}

async function submitEdit() {
  const d = editing.value;
  if (!d?.name) return;
  if (d.id) {
    const { dramaUpdate } = await import('#/api/core/dramafloow');
    await dramaUpdate({
      id: d.id,
      name: d.name,
      genre: d.genre,
      synopsis: d.synopsis,
      episodeTargetCount: d.episodeTargetCount ?? 10,
    });
  } else {
    await dramaAdd({
      code: d.code,
      name: d.name,
      genre: d.genre,
      synopsis: d.synopsis,
      episodeTargetCount: d.episodeTargetCount ?? 10,
      // 建剧同时上传剧本（D1）：文件优先，其次粘贴文本
      scriptFile: createScriptFile.value ?? undefined,
      scriptText: createScriptText.value.trim() || undefined,
    });
  }
  editOpen.value = false;
  // 清掉剧本附件状态，避免下次新建时误带上次的文件
  createScriptFile.value = null;
  createScriptText.value = '';
  gridApi.query();
}

async function archive(row: DramaItem) {
  Modal.confirm({
    title: '归档剧目',
    content: `确认归档「${row.name}」？归档后可恢复（软删除）。`,
    onOk: async () => {
      await dramaArchive(row.id);
      gridApi.query();
    },
  });
}

async function restore(row: DramaItem) {
  await dramaRestore(row.id);
  gridApi.query();
}

async function setStatus(row: DramaItem, status: string) {
  await dramaSetStatus(row.id, status);
  gridApi.query();
}

function toggleArchived() {
  archivedView.value = !archivedView.value;
  gridApi.query();
}

/** 跳详情：路由名由后端菜单 Component 路径推导，用 query 传 id（沿用 member/List.vue 约定） */
function openDetail(row: DramaItem) {
  router.push({ name: 'DramaDetail', query: { id: row.id } });
}
</script>

<template>
  <Page class="df-page" title="剧目管理">
    <Grid>
      <template #toolbar-actions>
        <Button type="primary" @click="openCreate">新建剧目</Button>
        <Button class="ml-2" @click="toggleArchived">
          {{ archivedView ? '查看在用' : '查看归档' }}
        </Button>
      </template>

      <template #status="{ row }">
        <Tag :color="statusColor(row.status)" class="!mr-0">
          {{ statusText(row.status) }}
        </Tag>
      </template>

      <template #createdAt="{ row }">
        <TimeTag :time="row.createdAt" />
      </template>

      <template #action="{ row }">
        <Space>
          <Button size="small" type="link" @click="openDetail(row)"
            >详情</Button
          >
          <template v-if="!archivedView">
            <Button size="small" type="link" @click="openEdit(row)"
              >编辑</Button
            >
            <Button
              v-if="row.status !== 'producing'"
              size="small"
              type="link"
              @click="setStatus(row, 'producing')"
            >
              开产
            </Button>
            <Button size="small" type="link" danger @click="archive(row)">
              归档
            </Button>
          </template>
          <Button v-else size="small" type="link" @click="restore(row)">
            恢复
          </Button>
        </Space>
      </template>
    </Grid>

    <Modal
      v-model:open="editOpen"
      :title="editing?.id ? '编辑剧目' : '新建剧目'"
      @ok="submitEdit"
    >
      <div class="flex flex-col gap-3">
        <div>
          <div class="mb-1 text-sm">剧目名称 *</div>
          <Input v-model:value="editing!.name" placeholder="必填" />
        </div>
        <div v-if="!editing?.id">
          <div class="mb-1 text-sm">编号（留空自动生成）</div>
          <Input v-model:value="editing!.code" placeholder="如 D20260101" />
        </div>
        <div>
          <div class="mb-1 text-sm">题材</div>
          <Input v-model:value="editing!.genre" placeholder="如 都市/悬疑" />
        </div>
        <div>
          <div class="mb-1 text-sm">目标集数</div>
          <Input
            v-model:value="editing!.episodeTargetCount as any"
            type="number"
            placeholder="默认 10"
          />
        </div>
        <div>
          <div class="mb-1 text-sm">简介</div>
          <Input.TextArea v-model:value="editing!.synopsis" :rows="3" />
        </div>

        <!-- 建剧同时上传剧本（D1）：用户流程「创建剧目的同时上传剧本」。
             不填也行 —— 之后可在剧目详情的剧本 Tab 里补传。 -->
        <div v-if="!editing?.id">
          <div class="mb-1 text-sm">剧本（可选，也可之后在剧目详情里上传）</div>
          <div class="mb-2 flex flex-wrap items-center gap-2">
            <input
              ref="createScriptInputRef"
              accept=".docx"
              class="hidden"
              type="file"
              @change="onCreateScriptPicked"
            />
            <Button size="small" @click="createScriptInputRef?.click()">
              选择 .docx 剧本
            </Button>
            <span v-if="createScriptFile" class="text-xs text-muted-foreground">
              {{ createScriptFile.name }}
            </span>
            <Button
              v-if="createScriptFile"
              size="small"
              type="link"
              @click="createScriptFile = null"
            >
              移除
            </Button>
          </div>
          <Input.TextArea
            v-model:value="createScriptText"
            :rows="4"
            placeholder="或直接粘贴剧本正文（两者都填时以 .docx 文件为准）"
          />
        </div>
      </div>
    </Modal>
  </Page>
</template>
