<script lang="ts" setup>
import type { VxeGridProps } from '#/adapter/vxe-table';

import { onMounted, ref } from 'vue';

import {
  Alert,
  Button,
  Card,
  Descriptions,
  Input,
  message,
  Modal,
  Space,
  Tag,
  Tooltip,
} from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';

import { api } from '#/api/request';
import { TimeTag } from '#/components/TimeTag';
import {
  checkBackup,
  downloadFile,
  getList,
  getSettingByKey,
  postBackup,
  postDel,
  postRestart,
  postRestore,
  postUploadToCloud,
} from './api';

// ============ 数据库信息 ============
const dbInfo = ref<{
  available: boolean;
  charSet?: string;
  collation?: string;
  database: string;
  dbType?: string;
  dialect?: string;
  lastBackupTime?: null | string;
  mysqlClientAvailable?: boolean;
  server: string;
  serverVersion?: string;
  tableCount?: number;
  totalRows?: number;
  totalSize?: number;
  version: string;
} | null>(null);

const infoLoading = ref(false);

// 全局开关：是否启用了云端备份上传（系统设置 backup_upload_enabled）
const cloudUploadEnabled = ref(false);
async function loadCloudUploadFlag() {
  try {
    const s = await getSettingByKey('backup_upload_enabled');
    cloudUploadEnabled.value =
      s?.dataContent?.toLowerCase() === 'true' || s?.dataContent === '1';
  } catch {
    cloudUploadEnabled.value = false;
  }
}

async function uploadToCloud(id: number) {
  // 成功/失败 toast 由 axios 拦截器自动弹后端 message，业务不重复 message.success/error
  await postUploadToCloud(id);
  gridApi.reload();
}

async function loadDbInfo() {
  infoLoading.value = true;
  try {
    dbInfo.value = await checkBackup();
  } catch {
    dbInfo.value = null;
  } finally {
    infoLoading.value = false;
  }
}

// ============ 备份操作 ============
const backing = ref(false);

async function handleBackup() {
  backing.value = true;
  try {
    // toast (成功/失败) 由 axios 拦截器统一弹
    await postBackup();
    gridApi.reload();
  } finally {
    backing.value = false;
  }
}

// ============ 下载 ============
function handleDownload(row: any) {
  downloadFile(row.filePath, row.fileName);
}

// ============ 恢复 ============
const restoreVisible = ref(false);
const restoreRow = ref<any>(null);
const restoreConfirmInput = ref('');
const restoring = ref(false);

function handleRestoreClick(row: any) {
  restoreRow.value = row;
  restoreConfirmInput.value = '';
  restoreVisible.value = true;
}

async function handleRestoreConfirm() {
  if (!restoreRow.value || !dbInfo.value) return;
  if (restoreConfirmInput.value !== dbInfo.value.database) {
    message.error('请输入正确的数据库名以确认');
    return;
  }
  restoring.value = true;
  try {
    const res = await postRestore(
      restoreRow.value.id,
      restoreRow.value.filePath,
    );
    restoreVisible.value = false;
    Modal.confirm({
      title: '恢复成功',
      content: `从备份 ${restoreRow.value.fileName} 恢复完成（耗时 ${(res as any)?.duration || 0}ms）。
新数据已写入，但 API 进程仍持有旧数据库会话，强烈建议立即重启 API 让 ORM 重新读取 schema。`,
      okText: '立即重启 API',
      cancelText: '稍后再说',
      okButtonProps: { danger: true },
      async onOk() {
        try {
          await postRestart();
          message.success('已发送重启指令，刷新页面查看新数据');
        } catch {
          message.error('重启失败，请手动重启 API');
        }
      },
    });
    gridApi.reload();
    // postRestore 失败 toast 由 axios 拦截器自动弹
  } finally {
    restoring.value = false;
  }
}

// ============ 删除 ============
function handleDel(row: any) {
  const tip =
    row.source === 'db_only'
      ? '该记录磁盘文件已不存在，仅删除 DB 记录'
      : row.source === 'disk_only'
        ? '该文件无 DB 记录，仅删除磁盘文件'
        : `确定要删除备份 ${row.fileName} 吗？文件 + 记录将同时被删除`;
  Modal.confirm({
    title: '确认删除',
    content: tip,
    okText: '确定',
    cancelText: '取消',
    async onOk() {
      await postDel(row.id, row.filePath);
      gridApi.reload();
    },
  });
}

// ============ 数据库类型颜色映射 ============
function dbTypeColor(t?: string): string {
  if (!t) return 'default';
  const m: Record<string, string> = {
    MySql: 'orange',
    PostgreSql: 'geekblue',
    SqlServer: 'purple',
    Sqlite: 'cyan',
    Oracle: 'red',
    Dameng: 'magenta',
    ClickHouse: 'gold',
  };
  return m[t] || 'default';
}

// ============ source 状态映射 ============
const SOURCE_META: Record<
  string,
  { color: string; label: string; tooltip: string }
> = {
  both: {
    color: 'success',
    label: 'DB+磁盘',
    tooltip: '数据库记录与磁盘文件同时存在（正常）',
  },
  db_only: {
    color: 'error',
    label: '仅记录',
    tooltip: '数据库有记录但磁盘文件丢失，无法下载/恢复',
  },
  disk_only: {
    color: 'warning',
    label: '仅文件',
    tooltip: '磁盘有备份但数据库无记录（如恢复后留下的安全备份）',
  },
};

// ============ 格式化 ============
function fmtSize(bytes: number) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(2)} ${units[i]}`;
}

function fmtDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// 程序时区：从 /Verification/Status 拉取后端 appsettings.TimeZone，所有时间按它格式化
const appTimeZone = ref<string>('UTC');
async function loadAppTimeZone() {
  try {
    const data = await api.get<any>('/Verification/Status', { params: {} });
    if (data?.appTimeZone) appTimeZone.value = data.appTimeZone;
  } catch {
    /* 拿不到保持 UTC */
  }
}

function fmtTime(v: string) {
  if (!v) return '-';
  // 后端 UTC 时间无 Z 时补 Z 让浏览器按 UTC 解析
  const hasTz = /[Zz]|[+-]\d\d:?\d\d$/.test(v);
  const d = new Date(hasTz ? v : `${v}Z`);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('zh-CN', { hour12: false, timeZone: appTimeZone.value || 'UTC' });
}

// ============ 表格 ============
interface RowType {}

const gridOptions: VxeGridProps<RowType> = {
  columns: [
    { field: 'source', title: '状态', width: 150, slots: { default: 'source' } },
    { field: 'fileName', title: '文件名 / MD5', minWidth: 320, slots: { default: 'fileName' } },
    { field: 'fileSize', title: '文件大小', width: 120, slots: { default: 'fileSize' } },
    { field: 'duration', title: '耗时', width: 100, slots: { default: 'duration' } },
    { field: 'createdBy', title: '操作人', width: 120 },
    { field: 'createdTime', title: '备份时间', width: 180, slots: { default: 'createdTime' } },
    { title: '操作', width: 290, fixed: 'right', slots: { default: 'action' } },
  ],
  height: 'auto',
  keepSource: true,
  pagerConfig: {},
  proxyConfig: {
    ajax: {
      query: async ({ page }) => {
        return await getList({
          page: page.currentPage,
          pageSize: page.pageSize,
        });
      },
    },
  },
  showOverflow: true,
  rowConfig: { isHover: true, height: 80 },
  toolbarConfig: { enabled: false },
};

const [Grid, gridApi] = useVbenVxeGrid({ gridOptions });

onMounted(() => {
  loadDbInfo();
  loadCloudUploadFlag();
  loadAppTimeZone();
});
</script>

<template>
  <div class="db-tab">
    <Grid>
      <!-- 表格上方：数据库信息卡片 -->
      <template #top>
        <Card title="数据库备份" :loading="infoLoading" style="margin-bottom: -2px">
          <Descriptions
            v-if="dbInfo"
            :column="{ xs: 1, sm: 2, md: 2, lg: 3, xl: 3, xxl: 3 }"
            :label-style="{ width: '120px' }"
            bordered
            size="small"
          >
            <Descriptions.Item label="数据库类型">
              <Tag :color="dbTypeColor(dbInfo.dbType)">
                {{ dbInfo.dbType || '-' }}
              </Tag>
              <span
                v-if="dbInfo.dialect && dbInfo.dialect !== dbInfo.dbType"
                style="
                  margin-left: 6px;
                  font-size: 12px;
                  color: var(--ant-color-text-tertiary);
                "
              >
                ({{ dbInfo.dialect }})
              </span>
            </Descriptions.Item>
            <Descriptions.Item label="数据库服务器">
              {{ dbInfo.server }}
            </Descriptions.Item>
            <Descriptions.Item label="数据库名称">
              <Tag color="blue">{{ dbInfo.database }}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="服务器版本">
              {{ dbInfo.serverVersion || '-' }}
            </Descriptions.Item>
            <Descriptions.Item label="字符集">
              <Tag v-if="dbInfo.charSet">{{ dbInfo.charSet }}</Tag>
              <span v-else>-</span>
            </Descriptions.Item>
            <Descriptions.Item label="排序规则">
              {{ dbInfo.collation || '-' }}
            </Descriptions.Item>
            <Descriptions.Item label="表数量">
              {{ dbInfo.tableCount ?? 0 }}
            </Descriptions.Item>
            <Descriptions.Item label="总大小">
              {{ fmtSize(dbInfo.totalSize ?? 0) }}
            </Descriptions.Item>
            <Descriptions.Item label="总行数(估算)">
              {{ (dbInfo.totalRows ?? 0).toLocaleString() }}
            </Descriptions.Item>
            <Descriptions.Item label="最近备份">
              <span v-if="dbInfo.lastBackupTime">
                {{ dbInfo.lastBackupTime }}
              </span>
              <span v-else style="color: var(--ant-color-text-tertiary)">
                还没有备份
              </span>
            </Descriptions.Item>
            <Descriptions.Item label="备份工具">
              <Tag v-if="dbInfo.available" color="success">
                mysqldump 可用
              </Tag>
              <Tag v-else color="error">mysqldump 不可用</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="恢复工具">
              <Tag v-if="dbInfo.mysqlClientAvailable" color="success">
                mysql 可用
              </Tag>
              <Tag v-else color="error">mysql 不可用</Tag>
            </Descriptions.Item>
          </Descriptions>

          <div
            v-else
            style="text-align: center; padding: 16px; color: #999"
          >
            无法获取数据库信息
          </div>

          <div style="margin-top: 16px">
            <Button
              type="primary"
              :loading="backing"
              :disabled="!dbInfo?.available"
              @click="handleBackup"
            >
              备份数据库
            </Button>
          </div>
        </Card>
      </template>

      <template #source="{ row }">
        <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-start">
          <Tag
            :color="SOURCE_META[row.source]?.color || 'default'"
            :title="SOURCE_META[row.source]?.tooltip || row.source"
            style="margin: 0"
          >
            {{ SOURCE_META[row.source]?.label || row.source }}
          </Tag>
          <Tooltip
            v-if="row.remoteUploadStatus === 'success'"
            :title="`云端: ${fmtTime(row.remoteUploadTime)} → ${row.remoteUploadUrl || ''}`"
          >
            <Tag color="green" style="margin: 0">云端 ✓</Tag>
          </Tooltip>
          <Tooltip
            v-else-if="row.remoteUploadStatus === 'failed'"
            :title="row.remoteUploadError || '上传失败'"
          >
            <Tag color="red" style="margin: 0">云端 ✗</Tag>
          </Tooltip>
          <Tag v-else style="margin: 0">{{ cloudUploadEnabled ? '云端 ○' : '云端未启用' }}</Tag>
        </div>
      </template>

      <template #fileName="{ row }">
        <div>{{ row.fileName }}</div>
        <div
          v-if="row.md5"
          style="
            font-family: monospace;
            font-size: 11px;
            color: var(--ant-color-text-tertiary);
            margin-top: 2px;
          "
        >
          MD5: {{ row.md5 }}
        </div>
      </template>

      <template #fileSize="{ row }">
        {{ fmtSize(row.fileSize) }}
      </template>

      <template #duration="{ row }">
        {{ fmtDuration(row.duration) }}
      </template>

      <template #createdTime="{ row }">
        <TimeTag
          :time="fmtTime(row.createdTime)"
          :timezone="appTimeZone"
          color="blue"
        />
      </template>

      <template #action="{ row }">
        <Space>
          <Button
            type="primary"
            size="small"
            :disabled="row.source === 'db_only'"
            :title="
              row.source === 'db_only' ? '磁盘文件不存在，无法下载' : ''
            "
            @click="handleDownload(row)"
          >
            下载
          </Button>
          <Button
            type="primary"
            size="small"
            danger
            :disabled="row.source === 'db_only'"
            :title="
              row.source === 'db_only' ? '磁盘文件不存在，无法恢复' : ''
            "
            @click="handleRestoreClick(row)"
          >
            恢复
          </Button>
          <Button
            v-if="row.remoteUploadStatus !== 'success'"
            size="small"
            type="primary"
            ghost
            :disabled="
              row.source === 'db_only' || !cloudUploadEnabled
            "
            :title="
              !cloudUploadEnabled
                ? '系统设置未启用云端备份'
                : row.source === 'db_only'
                ? '磁盘文件不存在'
                : row.remoteUploadStatus === 'failed'
                ? '上次上传失败，点击重试'
                : '点击上传到云端'
            "
            @click="uploadToCloud(row.id)"
          >
            {{ row.remoteUploadStatus === 'failed' ? '重试上传' : '上传云端' }}
          </Button>
          <Button
            size="small"
            danger
            @click="handleDel(row)"
          >
            删除
          </Button>
        </Space>
      </template>
    </Grid>

    <!-- 恢复数据库确认弹窗（双重防呆：警告 + 输入数据库名） -->
    <Modal
      v-model:open="restoreVisible"
      title="恢复数据库确认"
      :closable="!restoring"
      :mask-closable="false"
      :footer="null"
      width="540px"
      destroy-on-close
    >
      <div v-if="restoreRow && dbInfo">
        <Alert
          type="error"
          show-icon
          message="高危操作：将覆盖当前数据库所有数据"
          description="此操作不可逆。后端会先自动备份当前数据库（在备份记录里能找到），但仍请慎重确认。"
          style="margin-bottom: 16px"
        />

        <Descriptions
          :column="1"
          size="small"
          bordered
          :label-style="{ width: '100px' }"
          style="margin-bottom: 16px"
        >
          <Descriptions.Item label="目标数据库">
            <Tag color="red">{{ dbInfo.database }}</Tag>
            <span style="color: var(--ant-color-text-tertiary); font-size: 12px">
              ({{ dbInfo.server }})
            </span>
          </Descriptions.Item>
          <Descriptions.Item label="使用备份">
            {{ restoreRow.fileName }}
          </Descriptions.Item>
          <Descriptions.Item label="备份大小">
            {{ fmtSize(restoreRow.fileSize) }}
          </Descriptions.Item>
          <Descriptions.Item label="备份时间">
            {{ fmtTime(restoreRow.createdTime) }}
          </Descriptions.Item>
        </Descriptions>

        <div style="margin-bottom: 8px">
          请输入数据库名
          <code class="db-name-code">{{ dbInfo.database }}</code>
          以确认操作：
        </div>
        <Input
          v-model:value="restoreConfirmInput"
          :placeholder="dbInfo.database"
          :disabled="restoring"
          @press-enter="handleRestoreConfirm"
        />

        <div
          style="
            display: flex;
            gap: 8px;
            justify-content: flex-end;
            margin-top: 16px;
          "
        >
          <Button :disabled="restoring" @click="restoreVisible = false">
            取消
          </Button>
          <Button
            type="primary"
            danger
            :loading="restoring"
            :disabled="restoreConfirmInput !== dbInfo.database"
            @click="handleRestoreConfirm"
          >
            确认恢复
          </Button>
        </div>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
/* 嵌入 ops-tools Tab 时撑满父高度，让 vxe-grid 的 height:auto 有依据 */
.db-tab {
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.db-name-code {
  display: inline-block;
  padding: 1px 6px;
  margin: 0 4px;
  font-family:
    ui-monospace, 'SF Mono', 'Cascadia Mono', 'Roboto Mono', Menlo, Consolas,
    monospace;
  font-size: 12px;
  color: var(--ant-color-error);
  background: var(--ant-color-error-bg);
  border-radius: 4px;
}
</style>
