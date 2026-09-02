<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Button,
  Card,
  InputNumber,
  List,
  ListItem,
  ListItemMeta,
  Select,
  Space,
  Tag,
} from 'ant-design-vue';

import { downloadFile, getFiles, readFile } from './api';

interface LogFile {
  name: string;
  size: number;
  lastModified: string;
}

interface LogArchive {
  folder: string;
  lastModified: string;
  files: LogFile[];
}

interface FilesResult {
  current: LogFile[];
  archives: LogArchive[];
}

const currentFiles = ref<LogFile[]>([]);
const archives = ref<LogArchive[]>([]);
const filesLoading = ref(false);

// '' 表示当前日志，否则是归档文件夹名
const selectedArchive = ref<string>('');
const selectedFile = ref('');

const content = ref('');
const contentLoading = ref(false);
const totalLines = ref(0);
const returnedLines = ref(0);
const tailCount = ref(500);

const files = computed<LogFile[]>(() => {
  if (!selectedArchive.value) return currentFiles.value;
  return (
    archives.value.find((a) => a.folder === selectedArchive.value)?.files ?? []
  );
});

const archiveOptions = computed(() => [
  { label: `当前日志 (${currentFiles.value.length})`, value: '' },
  ...archives.value.map((a) => ({
    label: `${formatArchiveLabel(a.folder)} (${a.files.length})`,
    value: a.folder,
  })),
]);

function formatArchiveLabel(folder: string): string {
  // 20260408_141139 -> 2026-04-08 14:11:39
  const m = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/.exec(folder);
  if (!m) return folder;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
}

async function loadFiles() {
  filesLoading.value = true;
  try {
    const data: FilesResult = await getFiles();
    currentFiles.value = data?.current ?? [];
    archives.value = data?.archives ?? [];
  } catch {
    currentFiles.value = [];
    archives.value = [];
  } finally {
    filesLoading.value = false;
  }
}

function handleArchiveChange() {
  selectedFile.value = '';
  content.value = '';
  totalLines.value = 0;
  returnedLines.value = 0;
}

async function handleSelect(fileName: string) {
  selectedFile.value = fileName;
  contentLoading.value = true;
  content.value = '';
  try {
    const data = await readFile(
      fileName,
      tailCount.value,
      selectedArchive.value || undefined,
    );
    content.value = data.content;
    totalLines.value = data.totalLines;
    returnedLines.value = data.returnedLines;
  } catch {
    content.value = '读取失败';
  } finally {
    contentLoading.value = false;
  }
}

async function handleLoadAll() {
  if (!selectedFile.value) return;
  contentLoading.value = true;
  try {
    const data = await readFile(
      selectedFile.value,
      0,
      selectedArchive.value || undefined,
    );
    content.value = data.content;
    totalLines.value = data.totalLines;
    returnedLines.value = data.returnedLines;
  } catch {
    content.value = '读取失败';
  } finally {
    contentLoading.value = false;
  }
}

function handleDownload(fileName: string) {
  downloadFile(fileName, selectedArchive.value || undefined);
}

function fmtSize(bytes: number) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(2)} ${units[i]!}`;
}

function fmtTime(v: string) {
  if (!v) return '-';
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getLevelTag(name: string) {
  if (name.startsWith('error')) return { color: 'error', label: 'Error' };
  if (name.startsWith('warning')) return { color: 'warning', label: 'Warning' };
  if (name.startsWith('info')) return { color: 'processing', label: 'Info' };
  if (name.startsWith('debug')) return { color: 'default', label: 'Debug' };
  return { color: 'default', label: 'Log' };
}

onMounted(() => {
  loadFiles();
});
</script>

<template>
  <Page auto-content-height>
    <div style="display: flex; gap: 16px; height: 100%">
      <!-- 左侧文件列表 -->
      <Card
        title="日志文件"
        style="flex-shrink: 0; width: 360px; overflow-y: auto"
        :loading="filesLoading"
      >
        <template #extra>
          <Button size="small" @click="loadFiles">刷新</Button>
        </template>
        <Select
          v-model:value="selectedArchive"
          :options="archiveOptions"
          style="width: 100%; margin-bottom: 12px"
          size="small"
          @change="handleArchiveChange"
        />
        <List size="small" :data-source="files">
          <template #renderItem="{ item }">
            <ListItem
              style="padding: 8px 12px; cursor: pointer"
              :style="{
                background:
                  selectedFile === item.name ? 'hsl(var(--accent))' : '',
              }"
              @click="handleSelect(item.name)"
            >
              <ListItemMeta>
                <template #title>
                  <div style="display: flex; gap: 6px; align-items: center">
                    <Tag
                      :color="getLevelTag(item.name).color"
                      style="margin: 0"
                    >
                      {{ getLevelTag(item.name).label }}
                    </Tag>
                    <span style="font-size: 13px">{{ item.name }}</span>
                  </div>
                </template>
                <template #description>
                  <Space style="font-size: 12px">
                    <span>{{ fmtSize(item.size) }}</span>
                    <span>{{ fmtTime(item.lastModified) }}</span>
                    <a
                      style="color: hsl(var(--primary))"
                      @click.stop="handleDownload(item.name)"
                    >
                      下载
                    </a>
                  </Space>
                </template>
              </ListItemMeta>
            </ListItem>
          </template>
        </List>
      </Card>

      <!-- 右侧内容区 -->
      <Card
        style="display: flex; flex: 1; flex-direction: column; overflow: hidden"
        :loading="contentLoading"
      >
        <template #title>
          <span v-if="selectedFile">{{ selectedFile }}</span>
          <span v-else style="color: hsl(var(--muted-foreground))"
            >请选择日志文件</span
          >
        </template>
        <template v-if="selectedFile" #extra>
          <Space>
            <span style="font-size: 12px; color: hsl(var(--muted-foreground))">
              显示 {{ returnedLines }} / {{ totalLines }} 行
            </span>
            <span style="font-size: 12px; color: hsl(var(--muted-foreground))"
              >尾部行数:</span
            >
            <InputNumber
              v-model:value="tailCount"
              :min="100"
              :max="10000"
              :step="500"
              size="small"
              style="width: 100px"
            />
            <Button size="small" @click="handleSelect(selectedFile)"
              >刷新</Button
            >
            <Button size="small" @click="handleLoadAll">加载全部</Button>
            <Button size="small" @click="handleDownload(selectedFile)"
              >下载</Button
            >
          </Space>
        </template>

        <pre
          v-if="content"
          style="
            flex: 1;
            max-height: calc(100vh - 220px);
            padding: 16px;
            margin: 0;
            overflow: auto;
            font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
            font-size: 12px;
            line-height: 1.6;
            color: #d4d4d4;
            word-break: break-all;
            white-space: pre-wrap;
            background: #1e1e1e;
            border-radius: 6px;
          "
          >{{ content }}</pre
        >
        <div
          v-else-if="!selectedFile"
          style="
            padding: 80px 0;
            color: hsl(var(--muted-foreground));
            text-align: center;
          "
        >
          点击左侧日志文件查看内容
        </div>
      </Card>
    </div>
  </Page>
</template>
