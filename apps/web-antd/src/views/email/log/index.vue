<script lang="ts" setup>
import type { VxeGridProps } from '#/adapter/vxe-table';

import { ref } from 'vue';

import { Page } from '@vben/common-ui';
import { formatDateTime } from '@vben/utils';

import {
  Button,
  Descriptions,
  DescriptionsItem,
  Modal,
  Tag,
} from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';

import { getEmailLog, getEmailLogs } from '../api';

const showDetailModal = ref(false);
const detailLoading = ref(false);
const currentLog = ref<any>(null);

interface RowType {
  id: number;
  toEmail: string;
  subject: string;
  status: number;
  sentAt: string;
  createdAt: string;
}

const formOptions = {
  schema: [
    {
      label: '收件人邮箱',
      fieldName: 'toEmail',
      component: 'Input',
      componentProps: { placeholder: '请输入收件人邮箱' },
    },
    {
      label: '状态',
      fieldName: 'status',
      component: 'Select',
      componentProps: {
        placeholder: '请选择状态',
        options: [
          { label: '待发送', value: 0 },
          { label: '已发送', value: 1 },
          { label: '发送失败', value: 2 },
        ],
        allowClear: true,
      },
    },
  ],
  wrapperClass: 'grid-cols-3',
  showCollapseButton: false,
  submitOnChange: false,
  submitOnEnter: true,
};

const gridOptions: VxeGridProps<RowType> = {
  columns: [
    { fixed: 'left', field: 'id', title: 'ID', width: 80 },
    { field: 'toEmail', title: '收件人邮箱', minWidth: 200 },
    { field: 'subject', title: '邮件主题', minWidth: 250 },
    {
      field: 'status',
      title: '状态',
      width: 100,
      slots: { default: 'status' },
    },
    {
      field: 'sentAt',
      title: '发送时间',
      formatter: 'formatDateTime',
      width: 170,
    },
    {
      field: 'createdAt',
      title: '创建时间',
      formatter: 'formatDateTime',
      width: 170,
    },
    {
      field: 'action',
      fixed: 'right',
      slots: { default: 'action' },
      title: '操作',
      width: 120,
    },
  ],
  height: 'auto',
  keepSource: true,
  pagerConfig: {},
  proxyConfig: {
    ajax: {
      query: async ({ page }, formValues) => {
        const params: any = {
          page: page.currentPage,
          pageSize: page.pageSize,
          ...formValues,
        };

        const result: any = await getEmailLogs(
          params.page,
          params.pageSize,
          params.status,
        );
        return {
          items: result.list || [],
          total: result.total || 0,
        };
      },
    },
  },
  showOverflow: false,
  rowConfig: { isHover: true },
  toolbarConfig: { refresh: true },
};

const [Grid] = useVbenVxeGrid({ formOptions, gridOptions });

const getStatusColor = (status: number) => {
  switch (status) {
    case 0: {
      return 'default';
    }
    case 1: {
      return 'success';
    }
    case 2: {
      return 'error';
    }
    default: {
      return 'default';
    }
  }
};

const getStatusText = (status: number) => {
  switch (status) {
    case 0: {
      return '待发送';
    }
    case 1: {
      return '已发送';
    }
    case 2: {
      return '发送失败';
    }
    default: {
      return '未知';
    }
  }
};

const handleViewDetail = async (row: RowType) => {
  detailLoading.value = true;
  showDetailModal.value = true;
  try {
    const result = await getEmailLog(row.id);
    currentLog.value = result;
  } catch {
    currentLog.value = row;
  } finally {
    detailLoading.value = false;
  }
};

const handleCloseDetail = () => {
  showDetailModal.value = false;
  currentLog.value = null;
};
</script>

<template>
  <Page auto-content-height>
    <Grid>
      <template #status="{ row }">
        <Tag :color="getStatusColor(row.status)">
          {{ getStatusText(row.status) }}
        </Tag>
      </template>
      <template #action="{ row }">
        <Button size="small" @click="handleViewDetail(row)">查看详情</Button>
      </template>
    </Grid>

    <!-- 详情弹窗 -->
    <Modal
      v-model:open="showDetailModal"
      title="邮件日志详情"
      width="800px"
      :footer="null"
      @cancel="handleCloseDetail"
    >
      <div v-if="detailLoading" style="padding: 40px; text-align: center">
        加载中...
      </div>
      <template v-else-if="currentLog">
        <Descriptions bordered :column="2" size="small">
          <DescriptionsItem label="ID">{{ currentLog.id }}</DescriptionsItem>
          <DescriptionsItem label="模板ID">
{{
            currentLog.templateId || '-'
          }}
</DescriptionsItem>
          <DescriptionsItem label="收件人" :span="2">
{{
            currentLog.toEmail
          }}
</DescriptionsItem>
          <DescriptionsItem label="邮件主题" :span="2">
{{
            currentLog.subject
          }}
</DescriptionsItem>
          <DescriptionsItem label="状态">
            <Tag :color="getStatusColor(currentLog.status)">
              {{ getStatusText(currentLog.status) }}
            </Tag>
          </DescriptionsItem>
          <DescriptionsItem label="发送时间">
{{
            currentLog.sentAt ? formatDateTime(currentLog.sentAt) : '-'
          }}
</DescriptionsItem>
          <DescriptionsItem label="创建时间">
{{
            formatDateTime(currentLog.createdAt)
          }}
</DescriptionsItem>
          <DescriptionsItem v-if="currentLog.errorMessage" label="错误信息">
            <span style="color: var(--ant-color-error)">{{
              currentLog.errorMessage
            }}</span>
          </DescriptionsItem>
        </Descriptions>
        <div class="email-body">
          <iframe
            v-if="currentLog.body"
            :srcdoc="currentLog.body"
            style="
              width: 100%;
              height: 400px;
              border: 1px solid var(--ant-color-border);
              border-radius: 4px;
            "
          ></iframe>
          <div v-else class="empty-body">无内容</div>
        </div>
      </template>
    </Modal>
  </Page>
</template>

<style scoped>
.email-body {
  margin-top: 16px;
}

.empty-body {
  padding: 40px;
  color: var(--ant-color-text-quaternary);
  text-align: center;
  background: var(--ant-color-fill-quaternary);
  border-radius: 4px;
}
</style>
