<script lang="ts" setup>
/**
 * TaskDrawer —— 任务详情的**外框**（两种形态共用同一份内容）
 *
 * ## 为什么要有这个组件（而不是让调用方各自选）
 *
 * 同一份任务详情要能以两种方式出现：
 *   · `drawer`（默认）—— 右侧滑出，列表页点「详情」的既有用法；
 *   · `modal` —— 居中弹窗，即用户要的**「任务执行窗口」**：
 *     「提交任务后 直接把任务执行窗口 也 直接用弹窗的方式在当前页面弹出来」。
 *
 * 提交完生成后用户注意力就在当前页面，右侧抽屉在宽屏下离视线很远；
 * 居中的执行窗口"啪"地出现，才符合"我刚提交，现在盯它跑"的心理预期。
 *
 * 内容本体在 `TaskDetailView.vue`（唯一实现，含 WS 订阅与轮询）——
 * 本组件只决定**套哪个壳**，不含任何数据逻辑。
 * 这样就不会出现"抽屉改了、弹窗没改"的漂移（那种漂移不报错，只是两个入口不一致）。
 */
import { Drawer, Modal } from 'ant-design-vue';

import TaskDetailView from './TaskDetailView.vue';

withDefaults(
  defineProps<{
    /**
     * 呈现形态：
     *   · `drawer` —— 右侧抽屉（默认；列表页点「详情」）；
     *   · `modal` —— 居中弹窗（「任务执行窗口」）。
     */
    presentation?: 'drawer' | 'modal';
    /** 要查看的任务 id；null 表示关闭 */
    taskId: null | number;
    /** 弹窗形态的标题（抽屉形态固定用「子任务详情」） */
    title?: string;
  }>(),
  { presentation: 'drawer', title: '任务执行窗口' },
);

const emit = defineEmits<{
  (e: 'close'): void;
  /** 任务状态变化后，通知父组件刷新列表 */
  (e: 'changed'): void;
}>();
</script>

<template>
  <!--
    弹窗形态的关键参数：
      · `:footer="null"` —— 操作按钮在内容顶部（与抽屉一致）；弹窗自己的
        确定/取消对"看任务跑"没有语义，留着只会让人误以为要点"确定"才算保存；
      · `:width="980"` —— 比抽屉(860)宽：详情里有版本快照表 + 作业表 + 日志，
        窄了会挤成多行，破坏"一眼看清"；
      · 不设 `destroy-on-close` —— 保留滚动位置与已展开的参数面板，
        来回看任务时不必重新展开；数据本身由 taskId 变化驱动重载。
  -->
  <Modal
    v-if="presentation === 'modal'"
    :footer="null"
    :open="taskId !== null"
    :title="title"
    :width="980"
    @cancel="emit('close')"
  >
    <div class="df-task-modal-body">
      <TaskDetailView
        :task-id="taskId"
        @changed="emit('changed')"
        @close="emit('close')"
      />
    </div>
  </Modal>

  <Drawer
    v-else
    :open="taskId !== null"
    :width="860"
    title="子任务详情"
    @close="emit('close')"
  >
    <TaskDetailView
      :task-id="taskId"
      @changed="emit('changed')"
      @close="emit('close')"
    />
  </Drawer>
</template>
