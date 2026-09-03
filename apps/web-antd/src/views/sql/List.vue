<script lang="ts" setup>
import { ref } from 'vue';

import { Button, Card, message, Space, Table, Tag } from 'ant-design-vue';

import { executeSql, exportCsv } from './api';

const sql = ref('');
const loading = ref(false);
const result = ref<any>(null);
const errorMsg = ref('');

// 表格列（动态生成）
const columns = ref<any[]>([]);
const dataSource = ref<any[]>([]);

async function handleExecute() {
  if (!sql.value.trim()) {
    message.warning('请输入 SQL 语句');
    return;
  }
  loading.value = true;
  errorMsg.value = '';
  result.value = null;
  columns.value = [];
  dataSource.value = [];

  try {
    const data = await executeSql(sql.value);
    result.value = data;
    if (data.type === 'query' && data.columns) {
      columns.value = data.columns.map((col: string) => ({
        title: col,
        dataIndex: col,
        key: col,
        ellipsis: true,
      }));
      dataSource.value = (data.rows || []).map((row: any, i: number) => ({
        ...row,
        _key: i,
      }));
    }
  } catch (error: any) {
    errorMsg.value = error?.message || '执行失败';
  } finally {
    loading.value = false;
  }
}

function handleExport() {
  if (!sql.value.trim()) {
    message.warning('请输入 SQL 语句');
    return;
  }
  exportCsv(sql.value);
}

function handleClear() {
  sql.value = '';
  result.value = null;
  errorMsg.value = '';
  columns.value = [];
  dataSource.value = [];
}
</script>

<template>
  <Card
    title="SQL 执行"
    style="display: flex; flex-direction: column; height: 100%"
  >
    <div style="margin-bottom: 12px">
      <textarea
        v-model="sql"
        placeholder="输入 SQL 语句，支持 SELECT / INSERT / UPDATE / DELETE / CREATE / ALTER 等"
        style="
          width: 100%;
          min-height: 160px;
          padding: 12px;
          font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
          font-size: 13px;
          line-height: 1.6;
          color: #d4d4d4;
          resize: vertical;
          outline: none;
          background: #1e1e1e;
          border: 1px solid #d9d9d9;
          border-radius: 6px;
        "
        @keydown.ctrl.enter="handleExecute"
        @keydown.meta.enter="handleExecute"
      ></textarea>
      <div style="margin-top: 4px; font-size: 12px; color: #999">
        Ctrl + Enter 执行
      </div>
    </div>

    <Space style="margin-bottom: 16px">
      <Button type="primary" :loading="loading" @click="handleExecute">
        执行
      </Button>
      <Button
        :disabled="!result || result.type !== 'query'"
        @click="handleExport"
      >
        导出 CSV
      </Button>
      <Button @click="handleClear">清空</Button>
    </Space>

    <!-- 错误信息 -->
    <div
      v-if="errorMsg"
      style="
        padding: 12px;
        margin-bottom: 12px;
        font-size: 13px;
        color: #cf1322;
        background: #fff2f0;
        border: 1px solid #ffccc7;
        border-radius: 6px;
      "
    >
      {{ errorMsg }}
    </div>

    <!-- 执行结果 -->
    <div v-if="result">
      <div style="margin-bottom: 8px">
        <Tag v-if="result.type === 'query'" color="processing">
          查询结果: {{ result.rowCount }} 行
        </Tag>
        <Tag v-else color="success">
          执行成功: 影响 {{ result.affectedRows }} 行
        </Tag>
      </div>

      <!-- 查询结果表格 -->
      <Table
        v-if="result.type === 'query' && columns.length > 0"
        :columns="columns"
        :data-source="dataSource"
        :row-key="(r: any) => r._key"
        :scroll="{ x: 'max-content', y: 480 }"
        :pagination="{
          pageSize: 100,
          showSizeChanger: true,
          showTotal: (t: number) => `共 ${t} 条`,
        }"
        size="small"
        bordered
      />
    </div>
  </Card>
</template>
