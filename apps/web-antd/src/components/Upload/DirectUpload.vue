<script lang="ts" setup>
/**
 * 强制直传（小文件场景）
 *
 * 内部即 SmartUpload 加 forceMode='direct'，保证 props/emits/slots 与
 * SmartUpload / ChunkUpload 三组件完全一致，业务页切换组件只需改 tag 名。
 */
import SmartUpload from './SmartUpload.vue';
import type { UploadProps } from './internal/types';

defineOptions({ name: 'DirectUpload' });

const props = defineProps<UploadProps>();
const emit = defineEmits<{
  'update:value': [v: string | string[]];
  change: [d: any];
  success: [d: any];
  error: [e: Error];
}>();
</script>

<template>
  <SmartUpload
    v-bind="props"
    force-mode="direct"
    @update:value="(v: any) => emit('update:value', v)"
    @change="(d: any) => emit('change', d)"
    @success="(d: any) => emit('success', d)"
    @error="(e: any) => emit('error', e)"
  >
    <template v-if="$slots.default" #default="scope">
      <slot v-bind="scope" />
    </template>
    <template v-if="$slots.extra" #extra="scope">
      <slot name="extra" v-bind="scope" />
    </template>
  </SmartUpload>
</template>
