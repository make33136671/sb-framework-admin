<script lang="ts" setup>
import type { VxeGridProps } from '#/adapter/vxe-table';

import { ref } from 'vue';

import { Page } from '@vben/common-ui';

import { Button, Input, Modal, Space, Switch, Tag } from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';

import { getEmailTemplates, saveEmailTemplate } from '../api';

const showModal = ref(false);
const modalTitle = ref('新增模板');
const formLoading = ref(false);
const editingId = ref<number>(0);

interface RowType {
  id: number;
  code: string;
  name: string;
  subject: string;
  body?: string;
  isActive: boolean;
}

const formOptions = {
  schema: [
    {
      label: '模板名称',
      fieldName: 'name',
      component: 'Input',
      componentProps: { placeholder: '请输入模板名称' },
    },
  ],
  wrapperClass: 'grid-cols-2',
  showCollapseButton: false,
  submitOnChange: false,
  submitOnEnter: true,
};

const gridOptions: VxeGridProps<RowType> = {
  columns: [
    { fixed: 'left', field: 'id', title: 'ID', width: 80 },
    { field: 'code', title: '模板代码', minWidth: 160 },
    { field: 'name', title: '模板名称', minWidth: 160 },
    { field: 'subject', title: '邮件主题', minWidth: 200 },
    {
      field: 'isActive',
      title: '状态',
      width: 100,
      slots: { default: 'isActive' },
    },
    {
      field: 'updatedAt',
      title: '更新时间',
      formatter: 'formatDateTime',
      width: 170,
    },
    {
      field: 'action',
      fixed: 'right',
      slots: { default: 'action' },
      title: '操作',
      width: 150,
    },
  ],
  height: 'auto',
  keepSource: true,
  pagerConfig: {},
  proxyConfig: {
    ajax: {
      query: async ({ page }) => {
        const result: any = await getEmailTemplates(
          page.currentPage,
          page.pageSize,
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
  toolbarConfig: { refresh: true, custom: true },
};

const [Grid, gridApi] = useVbenVxeGrid({ formOptions, gridOptions });

const formData = ref({
  code: '',
  name: '',
  subject: '',
  body: '',
  isActive: true,
});

const handleAdd = () => {
  editingId.value = 0;
  modalTitle.value = '新增模板';
  formData.value = {
    code: '',
    name: '',
    subject: '',
    body: '',
    isActive: true,
  };
  showModal.value = true;
};

const handleEdit = (row: RowType) => {
  editingId.value = row.id;
  modalTitle.value = '编辑模板';
  formData.value = {
    code: row.code,
    name: row.name,
    subject: row.subject,
    body: row.body || '',
    isActive: row.isActive,
  };
  showModal.value = true;
};

const handleSave = async () => {
  if (!formData.value.code || !formData.value.name || !formData.value.subject) {
    Modal.warning({
      title: '提示',
      content: '请填写完整信息',
    });
    return;
  }

  formLoading.value = true;
  try {
    const data = {
      id: editingId.value,
      ...formData.value,
    };
    const result: any = await saveEmailTemplate(data);
    if (result.code === 0 || result.type === 'success') {
      Modal.success({
        title: '成功',
        content: editingId.value ? '更新成功' : '新增成功',
      });
      showModal.value = false;
      gridApi.query();
    } else {
      Modal.error({
        title: '失败',
        content: result.message || '操作失败',
      });
    }
  } catch {
    Modal.error({
      title: '错误',
      content: '操作失败，请检查网络连接',
    });
  } finally {
    formLoading.value = false;
  }
};

const handleCancel = () => {
  showModal.value = false;
};
</script>

<template>
  <Page auto-content-height>
    <Grid>
      <template #toolbar-tools>
        <Button type="primary" @click="handleAdd">新增模板</Button>
      </template>
      <template #isActive="{ row }">
        <Tag v-if="row.isActive" color="green">启用</Tag>
        <Tag v-else color="red">禁用</Tag>
      </template>
      <template #action="{ row }">
        <Space>
          <Button type="primary" @click="handleEdit(row)">编辑</Button>
        </Space>
      </template>
    </Grid>

    <!-- 编辑弹窗 -->
    <Modal
      v-model:open="showModal"
      :title="modalTitle"
      width="900px"
      :confirm-loading="formLoading"
      @ok="handleSave"
      @cancel="handleCancel"
    >
      <div style="padding: 20px 0">
        <div class="form-item">
          <label class="form-label"
            >模板代码 <span class="required">*</span></label
          >
          <Input
            v-model:value="formData.code"
            placeholder="如: RegisterVerify"
            :disabled="editingId > 0"
            allow-clear
          />
          <div class="form-hint">唯一标识，创建后不可修改</div>
        </div>

        <div class="form-item">
          <label class="form-label"
            >模板名称 <span class="required">*</span></label
          >
          <Input
            v-model:value="formData.name"
            placeholder="如: 注册验证码"
            allow-clear
          />
        </div>

        <div class="form-item">
          <label class="form-label"
            >邮件主题 <span class="required">*</span></label
          >
          <Input
            v-model:value="formData.subject"
            placeholder="如: 您的注册验证码"
            allow-clear
          />
          <div class="form-hint">
            可使用 &#123;&#123;code&#125;&#125; 作为验证码变量
          </div>
        </div>

        <div class="form-item">
          <label class="form-label">邮件内容</label>
          <Input.TextArea
            v-model:value="formData.body"
            :rows="8"
            placeholder="请输入HTML邮件内容"
          />
          <div class="form-hint">
            支持 HTML，可用变量: &#123;&#123;code&#125;&#125; - 验证码,
            &#123;&#123;email&#125;&#125; - 邮箱,
            &#123;&#123;expiryMinutes&#125;&#125; - 有效期
          </div>
        </div>

        <div class="form-item">
          <label class="form-label">是否启用</label>
          <Switch v-model:checked="formData.isActive" />
        </div>
      </div>
    </Modal>
  </Page>
</template>

<style scoped>
.form-item {
  margin-bottom: 20px;
}

.form-label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
  color: #333;
}

.required {
  margin-left: 4px;
  color: #ff4d4f;
}

.form-hint {
  margin-top: 4px;
  font-size: 12px;
  color: #999;
}
</style>
