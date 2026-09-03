<script lang="ts" setup>
import type { VxeGridProps } from '#/adapter/vxe-table';

import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';

import {
  Button,
  Form,
  FormItem,
  Space,
  Spin,
  TabPane,
  Tabs,
  Tag,
} from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';

import {
  getCategoryList,
  getCategoryWithSettingList,
  getList,
  postCategoryDel,
  postCategoryEdit,
  postDel,
  postSaveList,
} from './api';
import SettingRender from './SettingRender.vue';

const router = useRouter();

// ===== Setting tabs data =====
interface SettingItem {
  id: number;
  key: string;
  categoryId: number;
  name: string;
  displayType: number;
  cantDelete: boolean;
  dataContent: null | string;
  dataContentConfig: string;
  sort: number;
}

interface CategoryItem {
  id: number;
  name: string;
  icon: string;
  sort: number;
  systemSettingList: SettingItem[];
}

const activeTab = ref<string>('');
const categories = ref<CategoryItem[]>([]);
const loading = ref(false);
const saving = ref(false);

// Reactive form data: categoryId -> { settingId -> value }
const formData = reactive<Record<number, Record<number, any>>>({});

async function loadData() {
  loading.value = true;
  try {
    const result = await getCategoryWithSettingList();
    // requestClient (responseReturn: 'data') 返回外层 ResultData.data，即 ResultPage 对象
    const list = (result as any)?.items || [];
    categories.value = list;

    // Initialize form data
    for (const cat of list) {
      const catForm = (formData[cat.id] = formData[cat.id] || {});
      for (const item of cat.systemSettingList || []) {
        catForm[item.id] = item.dataContent ?? '';
      }
    }

    // Set default active tab
    if (list.length > 0 && !activeTab.value) {
      activeTab.value = `cat-${list[0].id}`;
    }
  } finally {
    loading.value = false;
  }
}

async function handleSave(category: CategoryItem) {
  saving.value = true;
  try {
    const settings = (category.systemSettingList || []).map((item) => ({
      id: item.id,
      dataContent: formData[category.id]?.[item.id] ?? '',
    }));
    await postSaveList(settings);
    // toast 由 axios 拦截器统一弹后端 message
  } finally {
    saving.value = false;
  }
}

function getSettingValue(catId: number, itemId: number) {
  return formData[catId]?.[itemId] ?? '';
}

function setSettingValue(catId: number, itemId: number, val: any) {
  if (!formData[catId]) {
    formData[catId] = {};
  }
  formData[catId][itemId] = val;
}

onMounted(() => {
  loadData();
});

// ===== Data management CRUD tab =====
const DisplayTypeMap: Record<number, string> = {
  0: 'Input',
  1: 'TextArea',
  2: 'RadioGroup',
  3: 'Select',
  4: 'CheckboxGroup',
  5: 'Switch',
  6: 'ImageUpload',
  7: 'InputNumber',
  8: 'InputPassword',
  9: 'DatePicker',
  10: 'TimePicker',
  11: 'RangePicker',
  12: 'Rate',
  13: 'AutoComplete',
  14: 'Mentions',
  15: 'TreeSelect',
  16: 'IconPicker',
  17: 'MultiImageUpload',
  18: 'FileUpload',
};

interface RowType {
  cantDelete: boolean;
  displayType: number;
  id: number;
}

const formOptions = {
  schema: [
    {
      label: '名称',
      fieldName: 'name',
      component: 'Input',
      componentProps: { placeholder: '请输入名称' },
    },
    {
      label: 'Key',
      fieldName: 'key',
      component: 'Input',
      componentProps: { placeholder: '请输入Key' },
    },
  ],
  wrapperClass: 'grid-cols-2',
  showCollapseButton: false,
  submitOnChange: false,
  submitOnEnter: true,
};

const gridOptions: VxeGridProps<RowType> = {
  columns: [
    { fixed: 'left', field: 'id', title: 'Id', width: 60 },
    { field: 'category.name', title: '分类', width: 120 },
    { field: 'key', title: 'Key', width: 180 },
    { field: 'name', title: '名称', width: 150 },
    {
      field: 'displayType',
      title: '显示类型',
      width: 140,
      slots: { default: 'displayType' },
    },
    { field: 'dataContent', title: '数据内容', minWidth: 200 },
    { field: 'sort', title: '排序', width: 80, sortable: true },
    {
      field: 'cantDelete',
      title: '禁删',
      width: 70,
      slots: { default: 'cantDelete' },
    },
    {
      field: 'action',
      fixed: 'right',
      slots: { default: 'action' },
      title: '操作',
      width: 170,
    },
  ],
  height: 'auto',
  keepSource: true,
  pagerConfig: {},
  proxyConfig: {
    ajax: {
      query: async ({ page }, formValues) => {
        return await getList({
          page: page.currentPage,
          pageSize: page.pageSize,
          ...formValues,
        });
      },
    },
  },
  showOverflow: false,
  rowConfig: {
    isHover: true,
  },
  toolbarConfig: {
    refresh: true,
    custom: true,
  },
};

const [Grid, gridApi] = useVbenVxeGrid({
  formOptions,
  gridOptions,
});

const delSetting = (id: number) => {
  postDel(id).then((result: any) => {
    if (result.code === 0) {
      gridApi.query();
    }
  });
};

// ===== Category management =====
const catGridOptions: VxeGridProps<RowType> = {
  columns: [
    { field: 'id', title: 'Id', width: 60 },
    {
      field: 'name',
      title: '分类名称',
      minWidth: 150,
      editRender: { name: 'input' },
    },
    { field: 'icon', title: '图标', width: 120, editRender: { name: 'input' } },
    {
      field: 'sort',
      title: '排序',
      width: 100,
      sortable: true,
      editRender: { name: 'input' },
    },
    {
      field: 'action',
      fixed: 'right',
      slots: { default: 'catAction' },
      title: '操作',
      width: 170,
    },
  ],
  height: 'auto',
  keepSource: true,
  pagerConfig: {},
  proxyConfig: {
    ajax: {
      query: async ({ page }) => {
        return await getCategoryList({
          page: page.currentPage,
          pageSize: page.pageSize,
        });
      },
    },
  },
  editConfig: {
    trigger: 'click',
    mode: 'row',
    showStatus: true,
  },
  rowConfig: { isHover: true },
  toolbarConfig: { refresh: true },
};

const [CatGrid, catGridApi] = useVbenVxeGrid({
  gridOptions: catGridOptions,
});

async function saveCatRow(row: any) {
  // toast 由 axios 拦截器统一弹
  await postCategoryEdit(row);
  catGridApi.query();
  loadData(); // 刷新左侧分类标签
}

async function delCategory(id: number) {
  await postCategoryDel(id);
  catGridApi.query();
  loadData();
}

async function addCategory() {
  await postCategoryEdit({ name: '新分类', icon: '', sort: 0 });
  catGridApi.query();
  loadData();
}
</script>

<template>
  <Page auto-content-height>
    <Spin :spinning="loading">
      <Tabs
        v-model:active-key="activeTab"
        tab-position="left"
        class="setting-tabs"
      >
        <!-- Category tabs -->
        <TabPane
          v-for="cat in categories"
          :key="`cat-${cat.id}`"
          :tab="cat.name"
        >
          <div class="setting-form-container">
            <Form layout="vertical">
              <FormItem
                v-for="item in cat.systemSettingList"
                :key="item.id"
                :label="item.name"
              >
                <SettingRender
                  :setting="item"
                  :model-value="getSettingValue(cat.id, item.id)"
                  @update:model-value="
                    (val: any) => setSettingValue(cat.id, item.id, val)
                  "
                />
              </FormItem>
            </Form>
            <div class="setting-form-actions">
              <Button type="primary" :loading="saving" @click="handleSave(cat)">
                保存
              </Button>
            </div>
          </div>
        </TabPane>

        <!-- Data management tab -->
        <TabPane key="data-management" tab="数据管理">
          <div style="height: calc(100vh - 260px)">
            <Grid>
              <template #toolbar-tools>
                <Button
                  type="primary"
                  @click="router.push({ name: 'SystemSettingEdit' })"
                >
                  新增设置
                </Button>
              </template>
              <template #displayType="{ row }">
                <Tag color="blue">
                  {{ DisplayTypeMap[row.displayType] || row.displayType }}
                </Tag>
              </template>
              <template #cantDelete="{ row }">
                <Tag :color="row.cantDelete ? 'red' : 'green'">
                  {{ row.cantDelete ? '是' : '否' }}
                </Tag>
              </template>
              <template #action="{ row }">
                <Space>
                  <Button
                    type="primary"
                    size="small"
                    @click="
                      router.push({
                        name: 'SystemSettingEdit',
                        query: { id: row.id },
                      })
                    "
                  >
                    编辑
                  </Button>
                  <Button
                    danger
                    size="small"
                    :disabled="row.cantDelete"
                    @click="delSetting(row.id)"
                  >
                    删除
                  </Button>
                </Space>
              </template>
            </Grid>
          </div>
        </TabPane>

        <!-- Category management tab -->
        <TabPane key="cat-management" tab="分类管理">
          <div style="height: calc(100vh - 260px)">
            <CatGrid>
              <template #toolbar-tools>
                <Button type="primary" @click="addCategory">新增分类</Button>
              </template>
              <template #catAction="{ row }">
                <Space>
                  <Button type="primary" size="small" @click="saveCatRow(row)">
                    保存
                  </Button>
                  <Button danger size="small" @click="delCategory(row.id)">
                    删除
                  </Button>
                </Space>
              </template>
            </CatGrid>
          </div>
        </TabPane>
      </Tabs>
    </Spin>
  </Page>
</template>

<style scoped>
.setting-tabs {
  min-height: calc(100vh - 160px);
}

.setting-tabs :deep(.ant-tabs-content) {
  padding: 0 24px;
}

.setting-form-container {
  max-width: 800px;
  padding: 16px 0;
}

.setting-form-actions {
  padding-top: 16px;
  border-top: 1px solid #f0f0f0;
}
</style>
