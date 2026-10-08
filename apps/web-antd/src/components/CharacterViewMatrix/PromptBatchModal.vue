<script lang="ts" setup>
import type {
  CharacterMatrix,
  CharacterMatrixRow,
} from '#/api/core/dramafloow';

/**
 * PromptBatchModal —— 「一键补充提示词」（用户 2026-10-07 要求）
 *
 * > 「一键生7图边上 加入一个 一键补充提示词」
 *
 * ## 它与「一键生成 7 图」的本质区别
 *
 * | | 一键生成 7 图 | 一键补充提示词 |
 * |---|---|---|
 * | 下发任务 | `PromptGen`(LLM) + `T2I` | 仅 `ImagePromptGen`(PE-T2I) |
 * | 占 GPU | 是（要出图） | 不占（纯文本，但需 PE 权重驻留） |
 * | 产物 | 图 | 提示词（落回需求，供出图复用） |
 *
 * ## 为什么走任务队列而不是在弹窗里同步调
 *
 * 用户明确要求「希望在 AI 执行任务列表里 显示这些 AI 任务」。
 * 同步调用（`Asset/GeneratePrompts`）是**单视图弹窗**的场景：用户盯着一个视图等、能取消；
 * 而批量补充时同步调用在任务列表里**完全不可见** —— 用户不知道跑到哪、失败没有，
 * 且页面一关就全断。走队列后每条都是正规任务：可排队/取消/重试/看日志。
 *
 * ## 一次调用下发全部
 *
 * 与 `taskBatchSubmitViews` 同样的教训（见其 api 注释）：**必须一次请求下发全部**，
 * 不能在浏览器里循环调用 —— 那样关页面/切标签会让**后面的视图根本没被创建**，
 * 且不报错。故这里是"一次提交 → 后端建 N 条任务"，提交回来就已全部入库。
 */
import { computed, ref, watch } from 'vue';

import { Alert, Button, Empty, Modal, Space, Table, Tag } from 'ant-design-vue';

import { taskBatchSubmitPromptGen } from '#/api/core/dramafloow';

const props = defineProps<{
  /** 剧目 id（仅用于展示；提交靠 requirementIds） */
  dramaId: number;
  /** 矩阵里的一行（一个角色）；null = 关闭 */
  row: CharacterMatrixRow | null;
  /** 列定义（含各视图的 spec） */
  viewColumns: CharacterMatrix['viewColumns'];
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  /** 下发完成后通知父组件刷新 */
  (e: 'finished'): void;
  /** 查看某条任务的执行窗口 */
  (e: 'viewTask', taskId: number): void;
}>();

const open = computed(() => props.row !== null);

/** 待补充提示词的视图（有 requirementId 的才算） */
const targets = computed(() => {
  if (!props.row) return [];
  // 用类型收窄而不是非空断言：过滤条件与取值条件写成同一个判据，
  // 改一处忘另一处时 TS 会直接报错（非空断言会**静默放过**这种不一致）。
  return props.row.views
    .filter((v): v is typeof v & { requirementId: number } =>
      Boolean(v.requirementId),
    )
    .map((v) => ({
      requirementId: v.requirementId,
      label: v.label,
      suffix: v.suffix,
    }));
});

/** 无视图需求时给出明确引导，而不是提交一个空请求 */
const noTargets = computed(
  () => props.row !== null && targets.value.length === 0,
);

type RowState = {
  label: string;
  message?: string;
  requirementId: number;
  status: 'failed' | 'pending' | 'submitted';
  taskId?: number;
};

const items = ref<RowState[]>([]);
const submitting = ref(false);
const done = ref(false);
const failures = ref<{ label: string; reason: string }[]>([]);

// 打开弹窗时初始化行状态
watch(
  () => props.row,
  (row) => {
    if (!row) return;
    done.value = false;
    failures.value = [];
    items.value = targets.value.map((t) => ({
      requirementId: t.requirementId,
      label: t.label,
      status: 'pending' as const,
    }));
  },
  { immediate: true },
);

async function submit() {
  if (targets.value.length === 0) return;
  submitting.value = true;
  try {
    const res = await taskBatchSubmitPromptGen({
      requirementIds: targets.value.map((t) => t.requirementId),
    });

    const byReq = new Map(res.created.map((c) => [c.requirementId, c]));
    const skipByReq = new Map(res.skipped.map((s) => [s.requirementId, s.why]));

    items.value.forEach((it) => {
      const hit = byReq.get(it.requirementId);
      if (hit) {
        it.status = 'submitted';
        it.taskId = hit.taskId;
        it.message = '已入队';
      } else {
        it.status = 'failed';
        it.message = skipByReq.get(it.requirementId) ?? '未下发';
        failures.value.push({ label: it.label, reason: it.message });
      }
    });
  } catch {
    // 拦截器已提示
  } finally {
    submitting.value = false;
    done.value = true;
    emit('finished');
  }
}
</script>

<template>
  <Modal
    :footer="null"
    :open="open"
    :width="680"
    title="一键补充提示词"
    @cancel="emit('close')"
  >
    <template v-if="row">
      <Empty
        v-if="noTargets"
        description="该角色还没有任何视图需求，请先「补齐角色视图」"
      />

      <template v-else>
        <Alert class="mb-3" show-icon type="info">
          <template #message>
            为「{{ row.name }}」的 {{ targets.length }} 个视图各生成一份提示词
          </template>
          <template #description>
            <span class="text-xs">
              走 PE-T2I 真机生成正向 + 规则推导反向，**只补提示词、不出图**。
              每条都是正式任务，可在「AI 任务列表」查看进度、取消或重试。
              首个视图约 1 分钟（需加载模型），之后每个数秒。
            </span>
          </template>
        </Alert>

        <Table
          :columns="[
            { title: '视图', dataIndex: 'label', width: 200 },
            { title: '状态', dataIndex: 'status', width: 120 },
            { title: '说明', dataIndex: 'message' },
            { title: '', dataIndex: 'action', width: 80 },
          ]"
          :data-source="items"
          :pagination="false"
          :row-key="(r: RowState) => r.requirementId"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.dataIndex === 'status'">
              <Tag v-if="record.status === 'pending'" color="default"
                >待下发</Tag
              >
              <Tag v-else-if="record.status === 'submitted'" color="blue"
                >已入队</Tag
              >
              <Tag v-else color="red">失败</Tag>
            </template>
            <template v-else-if="column.dataIndex === 'action'">
              <Button
                v-if="record.taskId"
                size="small"
                type="link"
                @click="emit('viewTask', record.taskId!)"
              >
                查看
              </Button>
            </template>
          </template>
        </Table>

        <div v-if="failures.length > 0" class="mt-3">
          <Alert show-icon type="warning">
            <template #message>{{ failures.length }} 个视图未下发</template>
            <template #description>
              <ul class="m-0 pl-4 text-xs">
                <li v-for="(f, i) in failures" :key="i">
                  {{ f.label }}：{{ f.reason }}
                </li>
              </ul>
            </template>
          </Alert>
        </div>

        <div class="mt-4 flex justify-end">
          <Space>
            <Button @click="emit('close')">关闭</Button>
            <Button
              :disabled="done && failures.length === 0"
              :loading="submitting"
              type="primary"
              @click="submit"
            >
              {{ done ? '再次补充' : '开始补充' }}
            </Button>
          </Space>
        </div>
      </template>
    </template>
  </Modal>
</template>
