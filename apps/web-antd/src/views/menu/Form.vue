<script lang="ts" setup>
import type { Recordable } from '@vben/types';

import type { VbenFormSchema } from '#/adapter/form';

import { computed, h, ref } from 'vue';

import { useVbenDrawer } from '@vben/common-ui';
import { IconifyIcon } from '@vben/icons';
import { getPopupContainer } from '@vben/utils';

import { breakpointsTailwind, useBreakpoints } from '@vueuse/core';

import { useVbenForm } from '#/adapter/form';
import { $t } from '#/locales';

import { getMenuList, postEdit, SystemMenuApi } from './api';

const emit = defineEmits<{
  success: [];
}>();
const formData = ref<SystemMenuApi.SystemMenu>();
const titleSuffix = ref<string>();
const schema: VbenFormSchema[] = [
  // 隐藏的 id 字段，用于编辑时标识菜单
  {
    component: 'Input',
    fieldName: 'id',
    hide: true,
    label: '',
  },
  {
    component: 'Input',
    fieldName: 'name',
    label: $t('system.menu.menuName'),
    rules: 'required',
  },
  {
    component: 'ApiTreeSelect',
    componentProps: {
      api: getMenuList,
      class: 'w-full',
      filterTreeNode(input: string, node: Recordable<any>) {
        if (!input || input.length === 0) {
          return true;
        }
        const title: string = node.meta?.title ?? '';
        if (!title) return false;
        return title.includes(input) || $t(title).includes(input);
      },
      getPopupContainer,
      labelField: 'meta.title',
      showSearch: true,
      treeDefaultExpandAll: true,
      valueField: 'id',
      childrenField: 'children',
    },
    fieldName: 'parentId',
    label: $t('system.menu.parent'),
    renderComponentContent() {
      return {
        title({ label, meta }: { label: string; meta: Recordable<any> }) {
          const coms = [];
          if (!label) return '';
          if (meta?.icon) {
            coms.push(h(IconifyIcon, { class: 'size-4', icon: meta.icon }));
          }
          coms.push(h('span', { class: '' }, $t(label || '')));
          return h('div', { class: 'flex items-center gap-1' }, coms);
        },
      };
    },
  },
  {
    component: 'Input',
    fieldName: 'title',
    label: $t('system.menu.menuTitle'),
    rules: 'required',
  },
  {
    component: 'Input',
    fieldName: 'path',
    label: $t('system.menu.path'),
    rules: 'required',
  },
  {
    component: 'IconPicker',
    // componentProps: {
    //   prefix: 'carbon',
    // },

    fieldName: 'icon',
    label: $t('system.menu.icon'),
  },
  {
    component: 'Input',
    fieldName: 'component',
    label: $t('system.menu.component'),
    // rules: 'required',
  },
  {
    component: 'Input',
    fieldName: 'redirect',
    label: $t('system.menu.redirect'),
  },
  {
    component: 'Input',
    fieldName: 'orderNo',
    label: $t('system.menu.orderNo'),
    defaultValue: 0,
  },
  {
    component: 'RadioGroup',
    componentProps: {
      buttonStyle: 'solid',
      options: [
        { label: $t('common.xianshi'), value: false },
        { label: $t('common.yincang'), value: true },
      ],
      optionType: 'button',
    },
    defaultValue: false,
    fieldName: 'hideInMenu',
    label: $t('system.menu.hideInMenu'),
  },
  {
    component: 'RadioGroup',
    componentProps: {
      buttonStyle: 'solid',
      options: [
        { label: $t('common.enabled'), value: false },
        { label: $t('common.disabled'), value: true },
      ],
      optionType: 'button',
    },
    defaultValue: false,
    fieldName: 'ignoreKeepAlive',
    label: $t('system.menu.ignoreKeepAlive'),
  },
];

const breakpoints = useBreakpoints(breakpointsTailwind);
const isHorizontal = computed(() => breakpoints.greaterOrEqual('md').value);

const [Form, formApi] = useVbenForm({
  commonConfig: {
    colon: true,
    formItemClass: 'col-span-2 md:col-span-1',
  },
  schema,
  showDefaultActions: false,
  wrapperClass: 'grid-cols-2 gap-x-4',
});
const [Drawer, drawerApi] = useVbenDrawer({
  onConfirm: onSubmit,
  onOpenChange(isOpen) {
    if (isOpen) {
      const data = drawerApi.getData<SystemMenuApi.SystemMenu>();
      if (data?.type === 'link') {
        data.linkSrc = data.meta?.link;
      } else if (data?.type === 'embedded') {
        data.linkSrc = data.meta?.iframeSrc;
      }
      if (data) {
        formData.value = data;

        // 将嵌套的 meta 对象展平到顶层，便于表单绑定
        const flattenedData = {
          ...data,
          title: data.meta?.title || data.title,
          icon: data.meta?.icon,
          orderNo: data.meta?.orderNo || data.orderNo,
          hideInMenu: data.meta?.hideInMenu || false,
          ignoreKeepAlive: data.meta?.ignoreKeepAlive || false,
        };

        formApi.setValues(flattenedData);
        titleSuffix.value = data.meta?.title ? $t(data.meta.title) : '';
      } else {
        formApi.resetForm();
        titleSuffix.value = '';
      }
    }
  },
});

async function onSubmit() {
  const { valid } = await formApi.validate();
  if (valid) {
    drawerApi.lock();
    try {
      const formValues = await formApi.getValues();
      console.log('onSubmitValue', formValues);

      // 转换为 FormData 格式
      const formData = new FormData();
      Object.keys(formValues).forEach((key) => {
        const value = formValues[key];
        // 布尔值转换为字符串
        if (typeof value === 'boolean') {
          formData.append(key, value ? 'true' : 'false');
        } else if (value !== null && value !== undefined) {
          formData.append(key, value);
        }
      });

      console.log('formData id:', formData.get('id')); // 调试日志
      await postEdit(formData);
      drawerApi.close();
      emit('success');
    } finally {
      drawerApi.unlock();
    }
  }
}
const getDrawerTitle = computed(() =>
  formData.value?.id
    ? $t('ui.actionTitle.edit', [$t('system.menu.name')])
    : $t('ui.actionTitle.create', [$t('system.menu.name')]),
);
</script>
<template>
  <Drawer class="w-full max-w-[800px]" :title="getDrawerTitle">
    <Form class="mx-4" :layout="isHorizontal ? 'horizontal' : 'vertical'" />
  </Drawer>
</template>
