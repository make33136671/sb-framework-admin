<script lang="ts" setup>
import { onBeforeUnmount, ref, watch } from 'vue';

import { Button, Modal, Progress, Space, Spin } from 'ant-design-vue';

import { api } from '#/api/request';

interface Props {
  /** v-model:open 控制弹窗显隐 */
  open?: boolean;
  /** 基线 startTime — 提供时仅当返回的 startTime 与之不同视为重启完成;不提供时只要能 GET 到 /App/Info 即视为完成 */
  baselineStartTime?: string;
  /** 最大等待毫秒数 (默认 60s) */
  maxWaitMs?: number;
  /** 轮询间隔毫秒 (默认 2s) */
  intervalMs?: number;
  /** 不弹 modal,只在后台轮询并 emit success/timeout */
  silent?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  open: false,
  maxWaitMs: 60_000,
  intervalMs: 2000,
  silent: false,
});

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void;
  (e: 'success', info: any): void;
  (e: 'timeout'): void;
}>();

type Status = 'error' | 'polling' | 'success';
const status = ref<Status>('polling');

let pollingTimer: null | ReturnType<typeof setInterval> = null;
let timeoutTimer: null | ReturnType<typeof setTimeout> = null;

function clearTimers() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
  if (timeoutTimer) {
    clearTimeout(timeoutTimer);
    timeoutTimer = null;
  }
}

function start() {
  clearTimers();
  status.value = 'polling';

  pollingTimer = setInterval(async () => {
    try {
      const info: any = await api.get('/App/Info', { silent: true });
      if (!info) return;
      // 有 baseline 就比对 startTime;没 baseline 就只要返回 info 就算成功
      if (
        props.baselineStartTime &&
        info.startTime === props.baselineStartTime
      ) {
        return;
      }
      clearTimers();
      status.value = 'success';
      emit('success', info);
      if (!props.silent) {
        // modal 显示 success 1.5s 后自动关
        setTimeout(() => {
          emit('update:open', false);
        }, 1500);
      } else {
        emit('update:open', false);
      }
    } catch {
      // 服务还在重启中,继续轮询
    }
  }, props.intervalMs);

  timeoutTimer = setTimeout(() => {
    clearTimers();
    status.value = 'error';
    emit('timeout');
    if (props.silent) {
      emit('update:open', false);
    }
  }, props.maxWaitMs);
}

watch(
  () => props.open,
  (val) => {
    if (val) start();
    else clearTimers();
  },
  { immediate: true },
);

onBeforeUnmount(clearTimers);

function retry() {
  start();
}

function close() {
  emit('update:open', false);
}
</script>

<template>
  <Modal
    v-if="!silent"
    :open="open"
    :closable="status !== 'polling'"
    :mask-closable="false"
    :footer="null"
    title="程序重启"
    width="420px"
    @update:open="(v: boolean) => emit('update:open', v)"
  >
    <div style="padding: 24px 0; text-align: center">
      <div v-if="status === 'polling'">
        <div class="restart-pulse">
          <div class="restart-pulse-ring" />
          <div class="restart-pulse-icon">
            <Spin size="large" />
          </div>
        </div>
        <div
          style="
            margin-top: 20px;
            font-size: 15px;
            color: var(--ant-color-text-secondary);
          "
        >
          程序正在重启<span class="restart-dots" />
        </div>
        <div
          style="
            margin-top: 8px;
            font-size: 13px;
            color: var(--ant-color-text-tertiary);
          "
        >
          服务恢复后将自动关闭
        </div>
      </div>

      <div v-else-if="status === 'success'">
        <Progress type="circle" :percent="100" status="success" />
        <div style="margin-top: 16px; color: var(--ant-color-success)">
          重启成功
        </div>
      </div>

      <div v-else>
        <Progress type="circle" :percent="100" status="exception" />
        <div style="margin-top: 16px; color: var(--ant-color-error)">
          重启超时,请登录服务器查看日志
        </div>
        <Space style="margin-top: 16px">
          <Button @click="close">关闭</Button>
          <Button type="primary" @click="retry">重试</Button>
        </Space>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.restart-pulse {
  position: relative;
  width: 80px;
  height: 80px;
  margin: 0 auto;
}

.restart-pulse-ring {
  position: absolute;
  inset: 0;
  border: 3px solid var(--ant-color-primary);
  border-radius: 50%;
  opacity: 0.4;
  animation: restart-pulse 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

.restart-pulse-icon {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

@keyframes restart-pulse {
  0% {
    opacity: 0.6;
    transform: scale(0.85);
  }

  100% {
    opacity: 0;
    transform: scale(1.2);
  }
}

.restart-dots::after {
  display: inline-block;
  width: 12px;
  content: '';
  animation: restart-dots 1.4s steps(4, end) infinite;
}

@keyframes restart-dots {
  0% {
    content: '';
  }

  25% {
    content: '.';
  }

  50% {
    content: '..';
  }

  75% {
    content: '...';
  }
}
</style>
