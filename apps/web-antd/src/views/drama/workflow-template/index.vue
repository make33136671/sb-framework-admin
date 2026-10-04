<script lang="ts" setup>
import type {
  WorkflowAnalysis,
  WorkflowImportResult,
  WorkflowTemplateRow,
  WorkflowTestResult,
} from '#/api/core/dramafloow';

/**
 * ComfyUI 工作流模板管理
 *
 * 定位：让用户在短剧系统里**直接编辑工作流对接**，不做可视化节点编辑器
 * （那是 ComfyUI 自己的活儿），只做「基础可编辑 + 保存前体检 + 真跑一次」。
 *
 * 三条设计主线（对应后端 WorkflowAnalyzer / WorkflowTestService）：
 *   ① **格式识别**：粘贴的最常见错误是 UI 格式（ComfyUI 界面 Ctrl+S 导出的默认格式），
 *      它不能提交给 /prompt。保存前必须挡下并给出可操作提示。
 *   ② **占位符体检**：系统不解析节点语义，只替换 8 个占位符。缺 {{positive}} 不会报错，
 *      只会安静地出一张与剧本无关的图 —— 所以必须在保存前把风险摆明。
 *   ③ **真跑一次**：静态体检证明不了「这个工作流能跑通」（缺模型/连线错/无输出节点都能
 *      在 /system_stats 200 的情况下失败）。连通性测试真的提交一次并取回产物。
 */
import { computed, onMounted, reactive, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Alert,
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Empty,
  Form,
  FormItem,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Textarea,
  Tooltip,
  Upload,
} from 'ant-design-vue';

import {
  templateWorkflowAnalyze,
  templateWorkflowDelete,
  templateWorkflowImport,
  templateWorkflowImportList,
  templateWorkflowList,
  templateWorkflowSave,
  templateWorkflowTest,
} from '#/api/core/dramafloow';
import { TimeTag } from '#/components/TimeTag';

// ─────────────────────────── 列表 ───────────────────────────

const rows = ref<WorkflowTemplateRow[]>([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    rows.value = await templateWorkflowList();
  } catch {
    // 拦截器已提示
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());

const columns = [
  { title: 'ID', dataIndex: 'id', width: 60 },
  { title: '名称', dataIndex: 'name', key: 'name' },
  { title: 'Key', dataIndex: 'key', width: 140 },
  { title: '种类', key: 'kind', width: 90 },
  { title: '体检', key: 'health', width: 200 },
  { title: '绑定', key: 'bound', width: 90 },
  { title: '状态', key: 'status', width: 80 },
  { title: '更新时间', key: 'updatedAt', width: 170 },
  { title: '操作', key: 'action', width: 210, fixed: 'right' as const },
];

const PLACEHOLDER_HELP = [
  { name: 'positive', desc: '正向提示词（来自剧本），**必填**', quoted: true },
  { name: 'negative', desc: '负向提示词', quoted: true },
  {
    name: 'ref_image',
    desc: 'i2v 首帧参考图（服务端上传后的文件名）',
    quoted: true,
  },
  {
    name: 'seed',
    desc: '随机种子，**必填**（缺了多候选会完全相同）',
    quoted: false,
  },
  { name: 'variant', desc: '候选序号', quoted: false },
  { name: 'width', desc: '宽度', quoted: false },
  { name: 'height', desc: '高度', quoted: false },
];

// ─────────────────────────── 编辑器 ───────────────────────────

interface EditorState {
  analysis: null | WorkflowAnalysis;
  analyzing: boolean;
  description: string;
  force: boolean;
  id: null | number;
  isActive: boolean;
  key: string;
  name: string;
  open: boolean;
  saving: boolean;
  template: string;
}

const editor = reactive<EditorState>({
  open: false,
  id: null,
  key: '',
  name: '',
  description: '',
  template: '',
  isActive: true,
  force: false,
  analyzing: false,
  analysis: null,
  saving: false,
});

const editorTitle = computed(() =>
  editor.id === null ? '新建工作流模板' : `编辑工作流模板 #${editor.id}`,
);

// 「能不能被系统驱动」的总体判定
const healthLevel = computed(() => {
  const a = editor.analysis;
  if (!a) return 'unknown';
  if (!a.usable || a.errors.length > 0) return 'error';
  if (a.missing.length > 0) return 'warn';
  return 'ok';
});

let analyzeTimer: null | ReturnType<typeof setTimeout> = null;

/** 输入时静默体检（防抖，避免每敲一个字符打一次接口）。 */
function onTemplateInput() {
  if (analyzeTimer) clearTimeout(analyzeTimer);
  analyzeTimer = setTimeout(() => void runAnalyze(), 600);
}

async function runAnalyze() {
  if (!editor.template.trim()) {
    editor.analysis = null;
    return;
  }
  editor.analyzing = true;
  try {
    editor.analysis = await templateWorkflowAnalyze(editor.template);
  } catch {
    // 拦截器已提示；保留上一次结果
  } finally {
    editor.analyzing = false;
  }
}

function openCreate() {
  Object.assign(editor, {
    open: true,
    id: null,
    key: '',
    name: '',
    description: '',
    template: '',
    isActive: true,
    force: false,
    analysis: null,
  });
  testResult.value = null;
}

function openEdit(row: Record<string, any> | WorkflowTemplateRow) {
  Object.assign(editor, {
    open: true,
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description ?? '',
    template: row.template,
    isActive: row.isActive,
    force: false,
    analysis: row.analysis,
  });
  testResult.value = null;
}

async function save() {
  if (!editor.key.trim()) return;
  if (!editor.name.trim()) return;
  editor.saving = true;
  try {
    await templateWorkflowSave({
      id: editor.id ?? undefined,
      key: editor.key,
      name: editor.name,
      description: editor.description,
      template: editor.template,
      isActive: editor.isActive,
      force: editor.force,
    });
    editor.open = false;
    await load();
  } catch {
    // 拦截器已提示（含「存在以下问题，可勾选强制保存」）
  } finally {
    editor.saving = false;
  }
}

async function remove(row: Record<string, any> | WorkflowTemplateRow) {
  try {
    await templateWorkflowDelete(row.id);
    await load();
  } catch {
    // 拦截器已提示（含「被模型绑定，请先解绑」）
  }
}

/** 在光标处插入占位符。 */
const templateRef = ref<null | { resizableTextArea?: any }>(null);

function insertPlaceholder(name: string, quoted: boolean) {
  const token = quoted ? `"{{${name}}}"` : `{{${name}}}`;
  const el: HTMLTextAreaElement | undefined =
    templateRef.value?.resizableTextArea?.textArea;
  if (!el) {
    editor.template += token;
    onTemplateInput();
    return;
  }
  const start = el.selectionStart ?? editor.template.length;
  const end = el.selectionEnd ?? start;
  editor.template =
    editor.template.slice(0, start) + token + editor.template.slice(end);
  onTemplateInput();
  requestAnimationFrame(() => {
    el.focus();
    el.selectionStart = el.selectionEnd = start + token.length;
  });
}

/** 从文件导入（ComfyUI 导出的 API 格式 JSON）。 */
function importFile(file: File) {
  // 用 Blob#text()（现代 API，取代 FileReader 的 onload/readAsText）：
  // 既满足 unicorn/prefer-blob-reading-methods，也避免 onload 赋值写法被 lint 拦下。
  void file.text().then((text) => {
    editor.template = text;
    void runAnalyze();
  });
  // 返回 false 阻止 antd Upload 自动上传（本处只是「选文件即读入编辑器」）
  return false;
}

// ─────────────────────────── 连通性测试 ───────────────────────────

const testPanel = reactive({
  open: false,
  prompt:
    'a cinematic close-up portrait of a young woman in a neon-lit city at night',
  negativePrompt: 'blurry, low quality, watermark',
  width: 512,
  height: 512,
  seed: 42,
  /** 等待上限（秒）：视频模型（LTX 22B 等）首次要加载 20B+ 权重，180s 远远不够。 */
  timeoutSec: 180,
  running: false,
});

const testResult = ref<null | WorkflowTestResult>(null);

/** 当前编辑的工作流推断出的种类（决定测试面板的尺寸/超时默认值）。 */
const editorKind = computed(() => editor.analysis?.kind ?? 't2i');

function openTest() {
  if (editorKind.value === 'i2v') {
    // 视频：给足超时，否则用户会看到「超时」而误以为工作流坏了
    testPanel.width = 512;
    testPanel.height = 320;
    testPanel.timeoutSec = 900;
  } else {
    testPanel.width = 512;
    testPanel.height = 512;
    testPanel.timeoutSec = 180;
  }
  testPanel.open = true;
  testResult.value = null;
}

async function runTest() {
  if (!testPanel.prompt.trim()) return;
  testPanel.running = true;
  testResult.value = null;
  try {
    testResult.value = await templateWorkflowTest({
      template: editor.template,
      prompt: testPanel.prompt,
      negativePrompt: testPanel.negativePrompt,
      kind: editorKind.value ?? 't2i',
      width: testPanel.width,
      height: testPanel.height,
      seed: testPanel.seed,
      timeoutSec: testPanel.timeoutSec,
    });
  } catch {
    // 拦截器已提示
  } finally {
    testPanel.running = false;
  }
}

// ─────────────────────── 从 ComfyUI 网页导入 ───────────────────────
//
// 用户的原话是「我在 ComfyUI 的 web 页面里调试好了工作流，如何让短剧系统调用它」。
// 此前只能手工「导出（API 格式）」再粘贴 —— 这里把那一步做掉。
//
// ⚠️ 两条**故意**的设计（都不自动改用户的东西）：
//   ① 导入只是把转换结果**填进编辑器**，不落库、不覆盖已有模板 → 用户仍走
//      「体检 → 改 key/name → 保存」这条既有路径，不引入第二套保存逻辑；
//   ② 占位符**只给建议、不自动插**：自动判断哪个是正向提示词会猜错
//      （把负面提示词当正向插进去会安静地毁掉出图），所以把判据摆给用户看。

const importPanel = reactive({
  open: false,
  loading: false,
  importing: false,
  files: [] as string[],
  providerName: '',
  baseUrl: '',
  selected: '',
  error: '',
  result: null as null | WorkflowImportResult,
});

/** 打开导入面板并拉取 ComfyUI 上的工作流列表。 */
async function openImport() {
  importPanel.open = true;
  importPanel.loading = true;
  importPanel.error = '';
  importPanel.files = [];
  importPanel.selected = '';
  importPanel.result = null;
  try {
    const res = await templateWorkflowImportList();
    importPanel.files = res.files ?? [];
    importPanel.providerName = res.providerName ?? '';
    importPanel.baseUrl = res.baseUrl ?? '';
  } catch (error) {
    importPanel.error = error instanceof Error ? error.message : '读取失败';
  } finally {
    importPanel.loading = false;
  }
}

/** 选中一个工作流 → 服务端转换 → 展示预览（**还没填进编辑器**）。 */
async function loadImportPreview(fileName: string) {
  importPanel.selected = fileName;
  importPanel.importing = true;
  importPanel.result = null;
  try {
    importPanel.result = await templateWorkflowImport(fileName);
  } catch {
    // 拦截器已提示（如「含嵌套子图，不支持自动展开」）
  } finally {
    importPanel.importing = false;
  }
}

/** 确认导入：把转换结果填进编辑器（不落库）。 */
function applyImport() {
  const r = importPanel.result;
  if (!r) return;
  editor.template = r.apiJson;
  // key 用文件名（去掉 .json）做个能用的默认值，用户可改
  if (!editor.key.trim()) {
    editor.key = r.fileName.replace(/\.json$/i, '').replaceAll(/[^\w.-]/g, '_');
  }
  if (!editor.name.trim()) {
    editor.name = r.fileName.replace(/\.json$/i, '');
  }
  editor.analysis = r.analysis;
  importPanel.open = false;
}
</script>

<template>
  <Page
    title="工作流模板"
    description="ComfyUI 工作流对接：粘贴 API 格式 JSON、保存前体检、真跑一次拿产物"
  >
    <Card>
      <template #extra>
        <Space>
          <Button @click="load">刷新</Button>
          <Button type="primary" @click="openCreate">新建工作流</Button>
        </Space>
      </template>

      <Alert
        class="mb-4"
        type="info"
        show-icon
        message="在 ComfyUI 里搭好工作流后，用「工作流 → 导出（API 格式）」导出 JSON 再粘贴到这里"
        description="系统不解析节点语义，只替换 7 个占位符（{{positive}} {{negative}} {{seed}} {{variant}} {{width}} {{height}} {{ref_image}}）。因此工作流里必须写上这些占位符，否则任务不会报错、只会安静地产出与剧本无关的图。"
      />

      <Table
        :columns="columns"
        :data-source="rows"
        :loading="loading"
        :pagination="false"
        row-key="id"
        size="small"
        :scroll="{ x: 1200 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'name'">
            <div>{{ record.name }}</div>
            <div v-if="record.description" class="text-xs opacity-60">
              {{ record.description }}
            </div>
          </template>

          <template v-else-if="column.key === 'kind'">
            <Tag :color="record.kind === 'i2v' ? 'purple' : 'blue'">
              {{ record.kind === 'i2v' ? '图生视频' : '文生图' }}
            </Tag>
          </template>

          <template v-else-if="column.key === 'health'">
            <Space :size="4" wrap>
              <Tag v-if="!record.analysis.usable" color="error">格式不可用</Tag>
              <Tag v-else-if="record.analysis.errors.length > 0" color="error">
                {{ record.analysis.errors.length }} 项错误
              </Tag>
              <Tag
                v-else-if="record.analysis.missing.length > 0"
                color="warning"
              >
                缺 {{ record.analysis.missing.length }} 个占位符
              </Tag>
              <Tag v-else color="success">可驱动</Tag>
              <Tooltip
                :title="`${record.analysis.nodeCount} 个节点 · 输出节点：${record.analysis.outputs.join('、') || '无'}`"
              >
                <Tag>{{ record.analysis.nodeCount }} 节点</Tag>
              </Tooltip>
            </Space>
          </template>

          <template v-else-if="column.key === 'bound'">
            <Tag v-if="record.boundModelCount > 0" color="processing">
              已绑定
            </Tag>
            <span v-else class="opacity-50">—</span>
          </template>

          <template v-else-if="column.key === 'status'">
            <Tag :color="record.isActive ? 'success' : 'default'">
              {{ record.isActive ? '启用' : '停用' }}
            </Tag>
          </template>

          <template v-else-if="column.key === 'updatedAt'">
            <TimeTag :time="record.updatedAt" />
          </template>

          <template v-else-if="column.key === 'action'">
            <Space :size="4">
              <Button size="small" @click="openEdit(record)">编辑</Button>
              <Popconfirm
                title="确认删除该工作流模板？"
                :description="
                  record.boundModelCount > 0
                    ? '该模板已被模型绑定，删除会被拒绝'
                    : '删除后不可恢复'
                "
                @confirm="remove(record)"
              >
                <Button size="small" danger>删除</Button>
              </Popconfirm>
            </Space>
          </template>
        </template>

        <template #emptyText>
          <Empty description="还没有工作流模板，点右上角「新建工作流」开始" />
        </template>
      </Table>
    </Card>

    <!-- ─────────── 编辑器 ─────────── -->
    <Modal
      v-model:open="editor.open"
      :title="editorTitle"
      width="1000px"
      :confirm-loading="editor.saving"
      @ok="save"
    >
      <Form layout="vertical" class="mt-4">
        <div class="grid grid-cols-3 gap-3">
          <FormItem label="Key（唯一标识）" required>
            <Input
              v-model:value="editor.key"
              placeholder="例如 t2i_sd15"
              :disabled="editor.id !== null"
            />
          </FormItem>
          <FormItem label="名称" required>
            <Input
              v-model:value="editor.name"
              placeholder="例如 SD1.5 文生图"
            />
          </FormItem>
          <FormItem label="启用">
            <Switch v-model:checked="editor.isActive" />
          </FormItem>
        </div>

        <FormItem label="说明（可选）">
          <Input
            v-model:value="editor.description"
            placeholder="这个工作流干什么、依赖哪些模型文件"
          />
        </FormItem>

        <FormItem>
          <template #label>
            <div class="flex items-center gap-2">
              <span>工作流 JSON（API 格式）</span>
              <Spin v-if="editor.analyzing" size="small" />
              <Button size="small" @click="runAnalyze">重新体检</Button>
              <Tooltip
                title="直接读取 ComfyUI 网页里已保存的工作流，自动转成 API 格式"
              >
                <Button size="small" type="primary" ghost @click="openImport">
                  从 ComfyUI 导入
                </Button>
              </Tooltip>
              <Upload
                :show-upload-list="false"
                :before-upload="importFile"
                accept=".json,application/json"
              >
                <Button size="small">从文件导入</Button>
              </Upload>
            </div>
          </template>

          <Textarea
            ref="templateRef"
            v-model:value="editor.template"
            :rows="14"
            class="font-mono"
            placeholder='粘贴 ComfyUI「导出（API 格式）」的 JSON，例如 {"3":{"class_type":"KSampler","inputs":{...}}}'
            @input="onTemplateInput"
          />

          <div class="mt-2 flex flex-wrap gap-1">
            <span class="mr-1 text-xs opacity-60">插入占位符：</span>
            <Tooltip
              v-for="p in PLACEHOLDER_HELP"
              :key="p.name"
              :title="p.desc"
            >
              <Button size="small" @click="insertPlaceholder(p.name, p.quoted)">
                {{ p.name }}
              </Button>
            </Tooltip>
          </div>
        </FormItem>

        <!-- 体检结果 -->
        <template v-if="editor.analysis">
          <Alert
            v-if="editor.analysis.format === 'ui'"
            type="error"
            show-icon
            class="mb-2"
            message="这是 UI 格式，不能直接使用"
            :description="editor.analysis.formatHint"
          />
          <Alert
            v-else-if="editor.analysis.format === 'invalid'"
            type="error"
            show-icon
            class="mb-2"
            message="无法识别的格式"
            :description="editor.analysis.formatHint"
          />
          <Alert
            v-else-if="editor.analysis.errors.length > 0"
            type="error"
            show-icon
            class="mb-2"
            message="存在阻断性问题"
          >
            <template #description>
              <ul class="m-0 pl-4">
                <li v-for="e in editor.analysis.errors" :key="e">{{ e }}</li>
              </ul>
            </template>
          </Alert>
          <Alert
            v-else-if="editor.analysis.missing.length > 0"
            type="warning"
            show-icon
            class="mb-2"
            message="可以保存，但系统可能无法正确驱动这个工作流"
          >
            <template #description>
              <ul class="m-0 pl-4">
                <li v-for="w in editor.analysis.warnings" :key="w">{{ w }}</li>
              </ul>
            </template>
          </Alert>
          <Alert
            v-else
            type="success"
            show-icon
            class="mb-2"
            message="体检通过：占位符齐全，可以被系统驱动"
          />

          <Descriptions :column="2" size="small" bordered class="mb-3">
            <DescriptionsItem label="格式">
              <Tag
                :color="editor.analysis.format === 'api' ? 'success' : 'error'"
              >
                {{
                  editor.analysis.format === 'api'
                    ? 'API 格式'
                    : editor.analysis.format
                }}
              </Tag>
            </DescriptionsItem>
            <DescriptionsItem label="节点数">
              {{ editor.analysis.nodeCount }}
            </DescriptionsItem>
            <DescriptionsItem label="已含占位符">
              <Space :size="2" wrap>
                <Tag
                  v-for="p in editor.analysis.present"
                  :key="p"
                  color="success"
                >
                  {{ p }}
                </Tag>
                <span
                  v-if="editor.analysis.present.length === 0"
                  class="opacity-50"
                >
                  无
                </span>
              </Space>
            </DescriptionsItem>
            <DescriptionsItem label="缺失占位符">
              <Space :size="2" wrap>
                <Tag v-for="p in editor.analysis.missing" :key="p">{{ p }}</Tag>
                <span
                  v-if="editor.analysis.missing.length === 0"
                  class="opacity-50"
                >
                  无
                </span>
              </Space>
            </DescriptionsItem>
            <DescriptionsItem label="输出节点" :span="2">
              <Space :size="2" wrap>
                <Tag
                  v-for="o in editor.analysis.outputs"
                  :key="o"
                  color="processing"
                >
                  {{ o }}
                </Tag>
                <span
                  v-if="editor.analysis.outputs.length === 0"
                  class="opacity-50"
                >
                  未找到（跑完取不回产物）
                </span>
              </Space>
            </DescriptionsItem>
            <DescriptionsItem
              v-if="
                editor.analysis.models &&
                Object.keys(editor.analysis.models).length > 0
              "
              label="依赖模型文件"
              :span="2"
            >
              <Space :size="2" wrap>
                <Tag
                  v-for="(v, k) in editor.analysis.models"
                  :key="k"
                  color="geekblue"
                >
                  {{ k }}: {{ v }}
                </Tag>
              </Space>
            </DescriptionsItem>
          </Descriptions>

          <div v-if="healthLevel === 'error'" class="mb-2">
            <Switch v-model:checked="editor.force" size="small" />
            <span class="ml-2 text-xs">我知道有风险，强制保存</span>
          </div>

          <Button type="dashed" block @click="openTest">
            连通性测试：用关键词真跑一次，拿产物看看
          </Button>
        </template>
      </Form>
    </Modal>

    <!-- ─────────── 连通性测试 ─────────── -->
    <Modal
      v-model:open="testPanel.open"
      title="连通性测试（真的生成一次）"
      width="860px"
      :footer="null"
    >
      <Alert
        class="mb-3"
        type="info"
        show-icon
        message="与「提供商测试连通性」的区别"
        description="提供商测试只探 /system_stats（证明端口通）；这里会真的渲染模板 → 提交 /prompt → 轮询 /history → 取回产物，能发现缺模型、连线错误、无输出节点等只有真跑才暴露的问题。"
      />

      <Form layout="vertical">
        <FormItem label="测试关键词（写入 {{positive}}）" required>
          <Textarea v-model:value="testPanel.prompt" :rows="3" />
        </FormItem>
        <FormItem label="负向提示词（写入 {{negative}}）">
          <Input v-model:value="testPanel.negativePrompt" />
        </FormItem>
        <div class="grid grid-cols-4 gap-3">
          <FormItem label="宽度">
            <InputNumber
              v-model:value="testPanel.width"
              :min="64"
              :step="64"
              class="w-full"
            />
          </FormItem>
          <FormItem label="高度">
            <InputNumber
              v-model:value="testPanel.height"
              :min="64"
              :step="64"
              class="w-full"
            />
          </FormItem>
          <FormItem label="Seed">
            <InputNumber v-model:value="testPanel.seed" class="w-full" />
          </FormItem>
          <FormItem>
            <template #label>
              <Tooltip
                title="视频模型（LTX 22B 等）首次要加载 20B+ 权重，180 秒远远不够；超时不代表工作流有问题"
              >
                <span>等待上限（秒）</span>
              </Tooltip>
            </template>
            <InputNumber
              v-model:value="testPanel.timeoutSec"
              :min="30"
              :max="1800"
              :step="60"
              class="w-full"
            />
          </FormItem>
        </div>
        <Button
          type="primary"
          block
          :loading="testPanel.running"
          :disabled="!testPanel.prompt.trim()"
          @click="runTest"
        >
          开始生成
        </Button>
      </Form>

      <div v-if="testPanel.running" class="mt-4 text-center">
        <Spin tip="正在生成（首次加载模型可能较慢）…" />
      </div>

      <template v-if="testResult && !testPanel.running">
        <Alert
          class="mt-4"
          :type="testResult.success ? 'success' : 'error'"
          show-icon
          :message="testResult.success ? '生成成功' : '生成失败'"
        >
          <template #description>
            <div v-if="testResult.success">
              耗时 {{ (testResult.elapsedMs / 1000).toFixed(1) }}s ·
              {{ testResult.fileName }} ·
              {{ ((testResult.fileBytes ?? 0) / 1024).toFixed(0) }} KB
              <div v-if="testResult.detail" class="text-xs opacity-70">
                {{ testResult.detail }}
              </div>
            </div>
            <div v-else>
              <div>{{ testResult.error }}</div>
              <div v-if="testResult.detail" class="mt-1 font-mono text-xs">
                {{ testResult.detail }}
              </div>
              <div class="mt-1 text-xs opacity-70">
                线路：{{ testResult.providerName }}
              </div>
            </div>
          </template>
        </Alert>

        <div v-if="testResult.dataUrl" class="mt-3 text-center">
          <img
            v-if="(testResult.mimeType ?? '').startsWith('image/')"
            :src="testResult.dataUrl"
            alt="测试产物"
            class="max-h-[420px] rounded border"
          />
          <video
            v-else-if="(testResult.mimeType ?? '').startsWith('video/')"
            :src="testResult.dataUrl"
            controls
            class="max-h-[420px] rounded border"
          ></video>
          <div v-else class="text-xs opacity-60">
            产物类型 {{ testResult.mimeType }} 不支持内联预览
          </div>
          <div class="mt-1 text-xs opacity-60">
            产物已落盘：{{ testResult.fileUrl }}
          </div>
        </div>
      </template>
    </Modal>

    <!-- 从 ComfyUI 网页导入 -->
    <Modal
      v-model:open="importPanel.open"
      :footer="null"
      :width="900"
      title="从 ComfyUI 导入工作流"
    >
      <Alert
        class="mb-3"
        type="info"
        show-icon
        message="读取的是你在 ComfyUI 网页里保存的工作流"
        :description="`来源：${importPanel.providerName || '—'}（${importPanel.baseUrl || '—'}）。系统会自动把 UI 格式转成 API 格式；导入后仍需自己插占位符并点「连通性测试」真跑一次。`"
      />

      <Spin :spinning="importPanel.loading">
        <div v-if="importPanel.error">
          <Alert type="error" show-icon :message="importPanel.error" />
        </div>

        <Empty
          v-else-if="!importPanel.loading && importPanel.files.length === 0"
          description="ComfyUI 里还没有保存过工作流 —— 先在 ComfyUI 网页调好并 Ctrl+S 保存"
        />

        <div v-else class="grid grid-cols-3 gap-3">
          <!-- 左：文件列表 -->
          <div class="col-span-1 max-h-[420px] overflow-auto border-r pr-2">
            <div
              v-for="f in importPanel.files"
              :key="f"
              class="cursor-pointer rounded px-2 py-1 text-xs hover:bg-black/5"
              :class="{
                'bg-blue-50 font-medium': importPanel.selected === f,
              }"
              @click="loadImportPreview(f)"
            >
              {{ f }}
            </div>
          </div>

          <!-- 右：转换预览 -->
          <div class="col-span-2 max-h-[420px] overflow-auto">
            <Spin :spinning="importPanel.importing">
              <Empty
                v-if="!importPanel.result && !importPanel.importing"
                description="选一个工作流看转换结果"
              />
              <div v-if="importPanel.result">
                <Descriptions size="small" :column="2" bordered>
                  <DescriptionsItem label="可执行节点">
                    {{ importPanel.result.nodeCount }}
                  </DescriptionsItem>
                  <DescriptionsItem label="推断种类">
                    {{ importPanel.result.analysis.kind ?? '—' }}
                  </DescriptionsItem>
                  <DescriptionsItem label="输出节点" :span="2">
                    <Space :size="2" wrap>
                      <Tag
                        v-for="o in importPanel.result.analysis.outputs"
                        :key="o"
                        color="processing"
                      >
                        {{ o }}
                      </Tag>
                      <span
                        v-if="importPanel.result.analysis.outputs.length === 0"
                        class="opacity-50"
                      >
                        未找到（跑完取不回产物）
                      </span>
                    </Space>
                  </DescriptionsItem>
                </Descriptions>

                <!-- 转换告警（子图展开、控件对不上…） -->
                <Alert
                  v-for="(w, i) in importPanel.result.convertWarnings"
                  :key="`w${i}`"
                  class="mt-2"
                  type="warning"
                  show-icon
                  :message="w"
                />

                <!-- 占位符建议：只提示，不自动改 -->
                <div
                  v-if="importPanel.result.suggestions.length > 0"
                  class="mt-3"
                >
                  <div class="mb-1 text-xs font-medium">
                    占位符建议（需你手工改，系统不会自动插）
                  </div>
                  <div
                    v-for="(s, i) in importPanel.result.suggestions"
                    :key="`s${i}`"
                    class="mb-1 rounded border p-2 text-xs"
                  >
                    <Space :size="4" wrap>
                      <Tag>节点 {{ s.nodeId }}</Tag>
                      <Tag color="geekblue">{{ s.classType }}</Tag>
                      <Tag color="green">{{ s.field }}</Tag>
                      <Tag
                        :color="s.confidence === 'high' ? 'green' : 'orange'"
                      >
                        {{ s.confidence === 'high' ? '较确定' : '需确认' }}
                      </Tag>
                    </Space>
                    <div class="mt-1">{{ s.reason }}</div>
                    <div class="mt-1 opacity-60">
                      当前值：{{ s.currentValue }}
                    </div>
                  </div>
                </div>

                <Alert
                  v-else
                  class="mt-3"
                  type="warning"
                  show-icon
                  message="没有识别到可插占位符的位置 —— 请手工检查文本编码器与采样器节点"
                />
              </div>
            </Spin>
          </div>
        </div>
      </Spin>

      <div class="mt-4 flex justify-end gap-2">
        <Button @click="importPanel.open = false">取消</Button>
        <Button
          type="primary"
          :disabled="!importPanel.result"
          @click="applyImport"
        >
          填入编辑器
        </Button>
      </div>
    </Modal>
  </Page>
</template>
