<script lang="ts" setup>
import type { UploadProps } from './internal/types';

/**
 * 强制切片（大文件场景）
 *
 * 内部即 SmartUpload 加 forceMode='chunk'，保证 props/emits/slots 与
 * SmartUpload / DirectUpload 三组件完全一致，业务页切换组件只需改 tag 名。
 */
import SmartUpload from './SmartUpload.vue';

defineOptions({ name: 'ChunkUpload' });

const props = defineProps<UploadProps>();
const emit = defineEmits<{
  change: [d: any];
  error: [e: Error];
  success: [d: any];
  'update:value': [v: string | string[]];
}>();
</script>

<template>
  <SmartUpload
    v-bind="props"
    force-mode="chunk"
    @update:value="(v: any) => emit('update:value', v)"
    @change="(d: any) => emit('change', d)"
    @success="(d: any) => emit('success', d)"
    @error="(e: any) => emit('error', e)"
  >
    <template v-if="$slots.default" #default="scope">
      <slot v-bind="scope"></slot>
    </template>
    <template v-if="$slots.extra" #extra="scope">
      <slot name="extra" v-bind="scope"></slot>
    </template>
  </SmartUpload>
</template>
