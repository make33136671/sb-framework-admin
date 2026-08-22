<script lang="ts" setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { Card, Button, Typography, message } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';

import { getDetail, postAdd, postEdit, getCategoryList } from './api';

const router = useRouter();
const route = useRoute();

const id = ref<number>(0);
const currentDisplayType = ref<number>(0);

/** DisplayType 中属于「上传组件」的类型，触发 uploadMode 字段显示 */
const UPLOAD_DISPLAY_TYPES = [6, 17, 18];

/** uploadMode 选项：传给 SmartUpload 的 forceMode prop */
const uploadModeOptions = [
  { label: '智能选择 (按文件大小自动切换)', value: 'auto' },
  { label: '普通上传 (一次性 POST，适合小文件)', value: 'direct' },
  { label: '切片上传 (分片+哈希秒传，适合大文件)', value: 'chunk' },
];

const displayTypeOptions = [
  { label: 'Input - 文本输入框', value: 0 },
  { label: 'InputTextArea - 多行文本', value: 1 },
  { label: 'RadioGroup - 单选按钮组', value: 2 },
  { label: 'Select - 下拉选择', value: 3 },
  { label: 'CheckboxGroup - 多选框组', value: 4 },
  { label: 'Switch - 开关', value: 5 },
  { label: 'ImageUpload - 单图上传', value: 6 },
  { label: 'InputNumber - 数字输入框', value: 7 },
  { label: 'InputPassword - 密码输入框', value: 8 },
  { label: 'DatePicker - 日期选择器', value: 9 },
  { label: 'TimePicker - 时间选择器', value: 10 },
  { label: 'RangePicker - 日期范围', value: 11 },
  { label: 'Rate - 评分', value: 12 },
  { label: 'AutoComplete - 自动完成', value: 13 },
  { label: 'Mentions - 提及输入', value: 14 },
  { label: 'TreeSelect - 树形选择', value: 15 },
  { label: 'IconPicker - 图标选择器', value: 16 },
  { label: 'MultiImageUpload - 多图上传', value: 17 },
  { label: 'FileUpload - 文件上传', value: 18 },
];

// 每种 DisplayType 对应的示例配置
const configExamples: Record<number, { tip: string; json: string }> = {
  0: {
    tip: 'placeholder (可选)',
    json: '{"placeholder":"请输入内容"}',
  },
  1: {
    tip: 'placeholder (可选)',
    json: '{"placeholder":"请输入内容"}',
  },
  2: {
    tip: '选项列表 [{label, value}]',
    json: JSON.stringify(
      [
        { label: '选项A', value: 'a' },
        { label: '选项B', value: 'b' },
      ],
      null,
      2,
    ),
  },
  3: {
    tip: '选项列表 [{label, value}]',
    json: JSON.stringify(
      [
        { label: '选项A', value: 'a' },
        { label: '选项B', value: 'b' },
      ],
      null,
      2,
    ),
  },
  4: {
    tip: '选项列表 [{label, value}]',
    json: JSON.stringify(
      [
        { label: '选项A', value: 'a' },
        { label: '选项B', value: 'b' },
      ],
      null,
      2,
    ),
  },
  5: { tip: '无需配置', json: '' },
  6: {
    tip: 'mode (auto/direct/chunk)',
    json: JSON.stringify({ mode: 'auto' }, null, 2),
  },
  7: {
    tip: 'min/max/step (可选)',
    json: JSON.stringify({ min: 0, max: 100, step: 1 }, null, 2),
  },
  8: {
    tip: 'placeholder (可选)',
    json: '{"placeholder":"请输入密码"}',
  },
  9: {
    tip: 'format (可选)',
    json: '{"format":"YYYY-MM-DD"}',
  },
  10: {
    tip: 'format (可选)',
    json: '{"format":"HH:mm:ss"}',
  },
  11: {
    tip: 'format (可选)',
    json: '{"format":"YYYY-MM-DD"}',
  },
  12: {
    tip: 'count/allowHalf (可选)',
    json: JSON.stringify({ count: 5, allowHalf: true }, null, 2),
  },
  13: {
    tip: '候选项 [{value}]',
    json: JSON.stringify(
      [{ value: 'Google' }, { value: 'Bing' }, { value: 'Baidu' }],
      null,
      2,
    ),
  },
  14: {
    tip: '提及选项 [{value, label}]',
    json: JSON.stringify(
      [
        { value: 'admin', label: '管理员' },
        { value: 'user', label: '用户' },
      ],
      null,
      2,
    ),
  },
  15: {
    tip: '树形数据 [{title, value, children}]',
    json: JSON.stringify(
      [
        {
          title: '父节点',
          value: 'parent',
          children: [
            { title: '子节点A', value: 'childA' },
            { title: '子节点B', value: 'childB' },
          ],
        },
      ],
      null,
      2,
    ),
  },
  16: { tip: '无需配置', json: '' },
  17: {
    tip: 'maxCount + mode',
    json: JSON.stringify({ maxCount: 5, mode: 'auto' }, null, 2),
  },
  18: {
    tip: 'maxCount/accept + mode',
    json: JSON.stringify(
      { maxCount: 3, accept: '.pdf,.doc,.docx', mode: 'auto' },
      null,
      2,
    ),
  },
};

const currentExample = computed(() => {
  return configExamples[currentDisplayType.value] || { tip: '', json: '' };
});

function copyExample() {
  const example = currentExample.value;
  if (!example.json) {
    message.info('该类型无需数据配置');
    return;
  }
  navigator.clipboard.writeText(example.json).then(() => {
    message.success('已复制到剪贴板');
  });
}

function applyExample() {
  const example = currentExample.value;
  if (!example.json) {
    message.info('该类型无需数据配置');
    return;
  }
  baseFormApi.setValues({ dataContentConfig: example.json });
  message.success('已填入示例配置');
}

const categoryOptions = ref<{ label: string; value: number }[]>([]);

onMounted(async () => {
  // 加载分类列表
  try {
    const catResult = await getCategoryList({ pageSize: 999 });
    const items =
      (catResult as any)?.items || [];
    categoryOptions.value = items.map((c: any) => ({
      label: c.name,
      value: c.id,
    }));
    baseFormApi.updateSchema([
      {
        fieldName: 'categoryId',
        componentProps: { options: categoryOptions.value },
      },
    ]);
  } catch {
    // ignore
  }

  // 加载编辑数据
  id.value = route.query.id as any;
  if (id.value > 0) {
    getDetail(id.value).then((result: any) => {
      const data = result?.data || result;
      baseFormApi.setValues(data);
      if (data.displayType !== undefined) {
        currentDisplayType.value = data.displayType;
      }
      // 上传类型：从 dataContentConfig JSON 中解析 mode 回填到 uploadMode 字段
      if (UPLOAD_DISPLAY_TYPES.includes(Number(data.displayType))) {
        try {
          const cfg = data.dataContentConfig
            ? JSON.parse(data.dataContentConfig)
            : {};
          baseFormApi.setValues({ uploadMode: cfg.mode || 'auto' });
        } catch {
          baseFormApi.setValues({ uploadMode: 'auto' });
        }
      }
    });
  }
});

const [BaseForm, baseFormApi] = useVbenForm({
  commonConfig: {
    colon: true,
    componentProps: {
      class: 'w-full',
    },
  },
  handleSubmit: onSubmit,
  layout: 'horizontal',
  schema: [
    {
      fieldName: 'categoryId',
      component: 'Select',
      label: '分类',
      rules: 'required',
      componentProps: {
        placeholder: '请选择分类',
        options: [],
      },
    },
    {
      fieldName: 'key',
      component: 'Input',
      label: 'Key',
      rules: 'required',
      componentProps: { placeholder: '请输入Key' },
    },
    {
      fieldName: 'name',
      component: 'Input',
      label: '名称',
      rules: 'required',
      componentProps: { placeholder: '请输入名称' },
    },
    {
      fieldName: 'displayType',
      component: 'Select',
      label: '显示类型',
      defaultValue: 0,
      rules: 'required',
      componentProps: {
        placeholder: '请选择显示类型',
        options: displayTypeOptions,
        showSearch: true,
        optionFilterProp: 'label',
        onChange: (val: number) => {
          currentDisplayType.value = val;
        },
      },
    },
    {
      fieldName: 'uploadMode',
      component: 'Select',
      label: '上传方式',
      defaultValue: 'auto',
      componentProps: {
        placeholder: '请选择上传方式',
        options: uploadModeOptions,
      },
      dependencies: {
        triggerFields: ['displayType'],
        show: (values: Record<string, any>) =>
          UPLOAD_DISPLAY_TYPES.includes(Number(values.displayType)),
      },
    },
    {
      fieldName: 'dataContent',
      component: 'Input',
      label: '数据内容',
      componentProps: { placeholder: '请输入数据内容' },
    },
    {
      fieldName: 'dataContentConfig',
      component: 'Textarea',
      label: '数据配置(JSON)',
      componentProps: {
        placeholder: '请输入数据配置',
        rows: 3,
      },
    },
    {
      fieldName: 'sort',
      component: 'InputNumber',
      label: '排序',
      defaultValue: 0,
      componentProps: { placeholder: '请输入排序' },
    },
    {
      fieldName: 'cantDelete',
      component: 'Switch',
      label: '禁止删除',
      defaultValue: false,
    },
  ],
  wrapperClass: 'grid-cols-1 md:grid-cols-2',
});

async function onSubmit(values: Record<string, any>) {
  // 上传类型：把 uploadMode 合并到 dataContentConfig JSON 的 mode 字段
  if (UPLOAD_DISPLAY_TYPES.includes(Number(values.displayType))) {
    let cfg: Record<string, any> = {};
    try {
      cfg = values.dataContentConfig
        ? JSON.parse(values.dataContentConfig)
        : {};
      if (typeof cfg !== 'object' || Array.isArray(cfg)) cfg = {};
    } catch {
      cfg = {};
    }
    cfg.mode = values.uploadMode || 'auto';
    values.dataContentConfig = JSON.stringify(cfg);
  }
  // 表单内部字段，不发给后端
  delete values.uploadMode;

  if (id.value > 0) {
    values.id = id.value;
    // toast 由 axios 拦截器统一弹
    await postEdit(values);
  } else {
    const result: any = await postAdd(values);
    if (result?.id) id.value = result.id;
  }
}
</script>

<template>
  <Card title="系统设置" style="margin: 10px">
    <BaseForm />

    <!-- 示例配置 -->
    <Card
      size="small"
      title="数据配置示例"
      style="margin-top: 16px; background: var(--ant-color-fill-quaternary)"
    >
      <template #extra>
        <span style="margin-right: 8px; font-size: 12px; color: var(--ant-color-text-secondary)">
          {{ currentExample.tip }}
        </span>
        <Button
          size="small"
          :disabled="!currentExample.json"
          @click="copyExample"
          style="margin-right: 6px"
        >
          复制
        </Button>
        <Button
          type="primary"
          size="small"
          :disabled="!currentExample.json"
          @click="applyExample"
        >
          填入
        </Button>
      </template>
      <Typography.Text
        v-if="currentExample.json"
        code
      >
        <pre style="margin: 0; font-size: 12px; white-space: pre-wrap">{{ currentExample.json }}</pre>
      </Typography.Text>
      <Typography.Text v-else type="secondary">
        该显示类型无需数据配置
      </Typography.Text>
    </Card>
  </Card>
</template>
