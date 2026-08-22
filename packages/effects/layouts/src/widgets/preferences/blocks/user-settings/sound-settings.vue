<script setup lang="ts">
import { onUnmounted, ref } from 'vue';

import { Volume2 } from '@vben/icons';
import { $t } from '@vben/locales';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  VbenButton,
} from '@vben-core/shadcn-ui';

defineOptions({
  name: 'UserSettingsSoundSettings',
});

// Props: 从父组件接收设置值
const newMessageEnabled = defineModel<boolean>('newMessageEnabled', {
  default: true,
});
const newMessageSound = defineModel<string>('newMessageSound', {
  default: 'ding.mp3',
});
const systemNotificationEnabled = defineModel<boolean>(
  'systemNotificationEnabled',
  { default: true },
);
const systemNotificationSound = defineModel<string>('systemNotificationSound', {
  default: 'dingdong.mp3',
});

// 可用提示音列表
const soundOptions = [
  { label: '叮（清脆）', value: 'ding.mp3' },
  { label: '叮咚（双音）', value: 'dingdong.mp3' },
  { label: '铃铃铃（铃声）', value: 'dinglingling.mp3' },
  { label: 'Duang（短促）', value: 'duang.mp3' },
];

// 预览音频
let previewAudio: HTMLAudioElement | null = null;
const isPlaying = ref(false);

function previewSound(soundFile: string) {
  if (previewAudio) {
    previewAudio.pause();
    previewAudio.currentTime = 0;
  }

  isPlaying.value = true;
  previewAudio = new Audio(`/sounds/${soundFile}`);

  previewAudio.addEventListener('ended', () => {
    isPlaying.value = false;
  });

  previewAudio.addEventListener('error', () => {
    isPlaying.value = false;
    console.error('Failed to load audio:', soundFile);
  });

  previewAudio.play().catch((error) => {
    isPlaying.value = false;
    console.error('Failed to play sound:', error);
  });
}

// 组件卸载时清理
onUnmounted(() => {
  if (previewAudio) {
    previewAudio.pause();
    previewAudio = null;
  }
});
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- 新消息提醒 -->
    <div class="setting-row">
      <div
        class="setting-label"
        @click="newMessageEnabled = !newMessageEnabled"
      >
        <span class="text-sm">
          {{ $t('preferences.userSettings.sound.newMessage') }}
        </span>
        <Switch v-model="newMessageEnabled" @click.stop />
      </div>

      <!-- 新消息提示音选择 -->
      <div v-if="newMessageEnabled" class="setting-control">
        <Select v-model="newMessageSound" class="flex-1">
          <SelectTrigger class="h-8">
            <SelectValue :placeholder="$t('preferences.userSettings.sound.selectSound')" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="item in soundOptions"
              :key="item.value"
              :value="item.value"
            >
              {{ item.label }}
            </SelectItem>
          </SelectContent>
        </Select>
        <VbenButton
          size="sm"
          variant="outline"
          class="h-8 w-8 shrink-0 p-0"
          :disabled="isPlaying"
          @click="previewSound(newMessageSound)"
        >
          <Volume2 class="h-4 w-4" />
        </VbenButton>
      </div>
    </div>

    <!-- 分隔线 -->
    <div class="border-border border-t" />

    <!-- 系统通知提醒 -->
    <div class="setting-row">
      <div
        class="setting-label"
        @click="systemNotificationEnabled = !systemNotificationEnabled"
      >
        <span class="text-sm">
          {{ $t('preferences.userSettings.sound.systemNotification') }}
        </span>
        <Switch v-model="systemNotificationEnabled" @click.stop />
      </div>

      <!-- 系统通知提示音选择 -->
      <div v-if="systemNotificationEnabled" class="setting-control">
        <Select v-model="systemNotificationSound" class="flex-1">
          <SelectTrigger class="h-8">
            <SelectValue :placeholder="$t('preferences.userSettings.sound.selectSound')" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="item in soundOptions"
              :key="item.value"
              :value="item.value"
            >
              {{ item.label }}
            </SelectItem>
          </SelectContent>
        </Select>
        <VbenButton
          size="sm"
          variant="outline"
          class="h-8 w-8 shrink-0 p-0"
          :disabled="isPlaying"
          @click="previewSound(systemNotificationSound)"
        >
          <Volume2 class="h-4 w-4" />
        </VbenButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.setting-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.setting-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
  cursor: pointer;
}

.setting-label:hover {
  opacity: 0.8;
}

.setting-control {
  display: flex;
  gap: 8px;
  align-items: center;
  padding-left: 8px;
}
</style>
