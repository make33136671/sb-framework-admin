<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { Card, Tree, Spin } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import dayjs from 'dayjs';

import {
  getAllMenuTree,
  getRoleDetail,
  getRoleMenuIds,
  postRoleAdd,
  postRoleEdit,
  setRoleMenus,
} from './api';

const router = useRouter();
const route = useRoute();

const id = ref<number>(0);
const menuTreeData = ref<any[]>([]);
const checkedMenuKeys = ref<number[]>([]);
const loadingMenus = ref(false);

// 将菜单数据转换为 Tree 组件需要的格式
function convertMenuToTreeData(menus: any[]): any[] {
  return menus.map((menu) => ({
    title: menu.meta?.title || menu.Meta?.Title || menu.title || '未命名',
    key: menu.id || menu.Id,
    children:
      menu.children || menu.Children
        ? convertMenuToTreeData(menu.children || menu.Children)
        : [],
  }));
}

onMounted(async () => {
  id.value = route.query.id;

  // 加载所有菜单
  loadingMenus.value = true;
  try {
    const menuResult = await getAllMenuTree();
    console.log('菜单数据:', menuResult);
    const menuData = menuResult.items;
    if (menuResult.code === 0 && menuData) {
      menuTreeData.value = convertMenuToTreeData(menuData);
      console.log('转换后的树数据:', menuTreeData.value);
    }
  } catch (error) {
    console.error('加载菜单失败:', error);
  } finally {
    loadingMenus.value = false;
  }

  // 如果是编辑模式，加载角色详情和菜单权限
  if (id.value > 0) {
    getRoleDetail(id.value).then((result) => {
      baseFormApi.setValues(result);
    });

    // 加载角色的菜单权限
    try {
      const menuIdsResult = await getRoleMenuIds(id.value);
      console.log('角色菜单权限原始数据:', menuIdsResult);

      // 如果返回的是数组，直接使用；如果是对象，从 data 字段中取
      let menuIds = [];
      if (Array.isArray(menuIdsResult)) {
        menuIds = menuIdsResult;
      } else if (menuIdsResult.code === 0) {
        menuIds = menuIdsResult.items || [];
      }

      checkedMenuKeys.value = menuIds;
      console.log('选中的菜单ID:', checkedMenuKeys.value);
    } catch (error) {
      console.error('加载角色菜单权限失败:', error);
    }
  }
});

const [BaseForm, baseFormApi] = useVbenForm({
  commonConfig: {
    colon: true,
    componentProps: {
      class: 'w-full',
    },
  },
  fieldMappingTime: [['rangePicker', ['startTime', 'endTime'], 'YYYY-MM-DD']],
  handleSubmit: onSubmit,

  layout: 'horizontal',
  schema: [
    {
      fieldName: 'name',
      component: 'Input',
      label: '角色名称',
      rules: 'required',
      componentProps: { placeholder: '请输入角色名称' },
    },
    {
      fieldName: 'roleKey',
      component: 'Input',
      label: '角色Key',
      rules: 'required',
      componentProps: { placeholder: '请输入角色Key' },
    },
  ],
  wrapperClass: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
});

async function onSubmit(values: Record<string, any>) {
  try {
    let roleId = id.value;

    // 保存角色基本信息
    if (id.value > 0) {
      values.id = id.value;
      const result = await postRoleEdit(values);
      if (result.code !== 0) {
        return;
      }
    } else {
      const result = await postRoleAdd(values);
      if (result.code === 0) {
        roleId = result.data.id;
        id.value = roleId;
      } else {
        return;
      }
    }

    // 保存菜单权限 (toast 由 axios 拦截器统一弹)
    if (roleId > 0) {
      await setRoleMenus(roleId, checkedMenuKeys.value);
    }
  } catch (error) {
    console.error('保存失败:', error);
  }
}
</script>

<template>
  <div
    style="
      display: flex;
      flex-direction: column;
      height: calc(100vh - 110px);
      margin: 10px;
    "
  >
    <Card title="管理员角色" style="flex-shrink: 0">
      <BaseForm />
    </Card>

    <Card title="菜单权限配置" style=" flex: 1; min-height: 0;margin-top: 20px">
      <template #extra>
        <span style="font-size: 12px; color: #999">
          已选择 {{ checkedMenuKeys.length }} 个菜单
        </span>
      </template>
      <div style="height: 100%; overflow: auto">
        <Spin :spinning="loadingMenus">
          <Tree
            v-model:checkedKeys="checkedMenuKeys"
            checkable
            :tree-data="menuTreeData"
            :selectable="false"
          />
        </Spin>
      </div>
    </Card>
  </div>
</template>
