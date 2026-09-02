<script setup lang="ts">
import { computed, ref } from 'vue';

import { ChevronDown, ChevronRight, Volume2 } from '@vben/icons';
import { $t } from '@vben/locales';
import { useSoundSettingsStore } from '@vben/stores';

import SoundSettings from './sound-settings.vue';

defineOptions({
  name: 'PreferenceUserSettings',
});

// 获取声音设置 Store
const soundSettingsStore = useSoundSettingsStore();

// 使用 computed 双向绑定 Store 的设置
const newMessageEnabled = computed({
  get: () => soundSettingsStore.settings.newMessageEnabled,
  set: (val) => soundSettingsStore.updateSettings({ newMessageEnabled: val }),
});

const newMessageSound = computed({
  get: () => soundSettingsStore.settings.newMessageSound,
  set: (val) => soundSettingsStore.updateSettings({ newMessageSound: val }),
});

const systemNotificationEnabled = computed({
  get: () => soundSettingsStore.settings.systemNotificationEnabled,
  set: (val) =>
    soundSettingsStore.updateSettings({ systemNotificationEnabled: val }),
});

const systemNotificationSound = computed({
  get: () => soundSettingsStore.settings.systemNotificationSound,
  set: (val) =>
    soundSettingsStore.updateSettings({ systemNotificationSound: val }),
});

// 展开状态
const expandedSections = ref<Record<string, boolean>>({
  sound: true,
  theme: false,
});

function toggleSection(section: string) {
  expandedSections.value[section] = !expandedSections.value[section];
}
</script>

<template>
  <div class="user-settings">
    <!-- 头部说明 -->
    <div class="mb-4 rounded-lg bg-accent/50 px-3 py-2">
      <p class="text-muted-foreground text-xs">
        {{ $t('preferences.userSettings.subtitle') }}
      </p>
    </div>

    <!-- 声音设置 -->
    <div class="settings-section">
      <div class="section-header" @click="toggleSection('sound')">
        <div class="flex items-center gap-2">
          <Volume2 class="h-4 w-4 text-primary" />
          <span class="font-medium">
            {{ $t('preferences.userSettings.sound.title') }}
          </span>
        </div>
        <component
          :is="expandedSections.sound ? ChevronDown : ChevronRight"
          class="h-4 w-4 text-muted-foreground transition-transform"
        />
      </div>
      <div v-show="expandedSections.sound" class="section-content">
        <SoundSettings
          v-model:new-message-enabled="newMessageEnabled"
          v-model:new-message-sound="newMessageSound"
          v-model:system-notification-enabled="systemNotificationEnabled"
          v-model:system-notification-sound="systemNotificationSound"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.user-settings {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.settings-section {
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  cursor: pointer;
  background: hsl(var(--accent) / 30%);
  transition: background-color 0.2s;
}

.section-header:hover {
  background: hsl(var(--accent) / 50%);
}

.section-content {
  padding: 12px 16px;
  border-top: 1px solid hsl(var(--border));
}
</style>
