import { ref } from 'vue';

import { acceptHMRUpdate, defineStore } from 'pinia';

/**
 * 声音设置接口
 */
export interface SoundSettings {
  newMessageEnabled: boolean;
  newMessageSound: string;
  newMessageVolume: number;
  systemNotificationEnabled: boolean;
  systemNotificationSound: string;
  systemNotificationVolume: number;
}

/**
 * 可用提示音选项
 */
export interface SoundOption {
  label: string;
  value: string;
}

/**
 * 默认声音设置
 */
const defaultSettings: SoundSettings = {
  newMessageEnabled: true,
  newMessageSound: 'ding.mp3',
  newMessageVolume: 80,
  systemNotificationEnabled: true,
  systemNotificationSound: 'dingdong.mp3',
  systemNotificationVolume: 80,
};

/**
 * 默认可用提示音列表
 */
const defaultSoundOptions: SoundOption[] = [
  { label: '叮（清脆）', value: 'ding.mp3' },
  { label: '叮咚（双音）', value: 'dingdong.mp3' },
  { label: '铃铃铃（铃声）', value: 'dinglingling.mp3' },
  { label: 'Duang（短促）', value: 'duang.mp3' },
];

// API 回调函数类型
type FetchSettingsCallback = () => Promise<null | SoundSettings>;
type SaveSettingsCallback = (settings: SoundSettings) => Promise<boolean>;
type FetchSoundsCallback = () => Promise<null | SoundOption[]>;

// localStorage 降级存储 key
const STORAGE_KEY = 'sound-settings';

/**
 * 从 localStorage 读取设置
 */
function loadFromStorage(): null | SoundSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw) as SoundSettings;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * 保存设置到 localStorage
 */
function saveToStorage(s: SoundSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

// 全局 API 回调存储（在模块级别，确保单例）
let _fetchSettingsCallback: FetchSettingsCallback | null = null;
let _saveSettingsCallback: null | SaveSettingsCallback = null;
let _fetchSoundsCallback: FetchSoundsCallback | null = null;

/**
 * 注册 API 回调函数（由 apps 调用）
 */
export function registerSoundSettingsApiCallbacks(callbacks: {
  fetchSettings?: FetchSettingsCallback;
  fetchSounds?: FetchSoundsCallback;
  saveSettings?: SaveSettingsCallback;
}) {
  if (callbacks.fetchSettings) {
    _fetchSettingsCallback = callbacks.fetchSettings;
  }
  if (callbacks.saveSettings) {
    _saveSettingsCallback = callbacks.saveSettings;
  }
  if (callbacks.fetchSounds) {
    _fetchSoundsCallback = callbacks.fetchSounds;
  }
}

/**
 * 声音设置 Store
 * 用于管理用户的提示音偏好设置
 */
export const useSoundSettingsStore = defineStore('sound-settings', () => {
  // 状态
  const settings = ref<SoundSettings>({ ...defaultSettings });
  const availableSounds = ref<SoundOption[]>([...defaultSoundOptions]);
  const isLoading = ref(false);
  const isInitialized = ref(false);
  const isSaving = ref(false);

  // 预览音频实例
  let previewAudio: HTMLAudioElement | null = null;

  // 防抖定时器
  let saveTimeoutId: null | ReturnType<typeof setTimeout> = null;

  /**
   * 初始化设置（优先从后端加载，失败则降级到 localStorage）
   */
  async function initialize() {
    if (isInitialized.value) return;

    isLoading.value = true;
    let apiSuccess = false;

    try {
      // 优先尝试 API
      if (_fetchSettingsCallback) {
        const settingsData = await _fetchSettingsCallback();
        if (settingsData) {
          settings.value = { ...settings.value, ...settingsData };
          apiSuccess = true;
        }
      }

      if (_fetchSoundsCallback) {
        const soundsData = await _fetchSoundsCallback();
        if (soundsData) {
          availableSounds.value = soundsData;
        }
      }
    } catch {
      // API 失败（404 等），静默处理
    }

    // API 未成功时，从 localStorage 降级读取
    if (!apiSuccess) {
      const stored = loadFromStorage();
      if (stored) {
        settings.value = { ...settings.value, ...stored };
      }
    }

    isInitialized.value = true;
    isLoading.value = false;
  }

  /**
   * 保存设置（优先 API，失败则降级到 localStorage）
   */
  async function save(): Promise<boolean> {
    isSaving.value = true;

    // 始终同步到 localStorage（即时生效）
    saveToStorage(settings.value);

    if (!_saveSettingsCallback) {
      isSaving.value = false;
      return true;
    }

    try {
      return await _saveSettingsCallback(settings.value);
    } catch {
      console.warn('[SoundSettings] API 保存失败，已降级到 localStorage');
      return true; // localStorage 已保存，视为成功
    } finally {
      isSaving.value = false;
    }
  }

  /**
   * 防抖保存
   */
  function debouncedSave() {
    if (saveTimeoutId) {
      clearTimeout(saveTimeoutId);
    }
    saveTimeoutId = setTimeout(() => {
      save();
      saveTimeoutId = null;
    }, 500);
  }

  /**
   * 更新设置（实时保存到 localStorage，防抖保存到 API）
   */
  function updateSettings(newSettings: Partial<SoundSettings>) {
    settings.value = { ...settings.value, ...newSettings };
    // 立即同步到 localStorage，不等防抖
    saveToStorage(settings.value);
    if (isInitialized.value) {
      debouncedSave();
    }
  }

  /**
   * 试听提示音
   */
  function previewSound(soundFile: string) {
    if (previewAudio) {
      previewAudio.pause();
      previewAudio = null;
    }

    previewAudio = new Audio(`/sounds/${soundFile}`);
    previewAudio.volume = settings.value.newMessageVolume / 100;
    previewAudio.play().catch((error) => {
      console.error('[SoundSettings] 播放失败:', error);
    });
  }

  /**
   * 停止预览
   */
  function stopPreview() {
    if (previewAudio) {
      previewAudio.pause();
      previewAudio = null;
    }
  }

  /**
   * 播放新消息提示音
   */
  function playNewMessageSound() {
    if (!settings.value.newMessageEnabled) return;

    const audio = new Audio(`/sounds/${settings.value.newMessageSound}`);
    audio.volume = settings.value.newMessageVolume / 100;
    audio.play().catch(() => {});
  }

  /**
   * 播放系统通知提示音
   */
  function playSystemNotificationSound() {
    if (!settings.value.systemNotificationEnabled) return;

    const audio = new Audio(
      `/sounds/${settings.value.systemNotificationSound}`,
    );
    audio.volume = settings.value.systemNotificationVolume / 100;
    audio.play().catch(() => {});
  }

  /**
   * 重置 store
   */
  function $reset() {
    settings.value = { ...defaultSettings };
    availableSounds.value = [...defaultSoundOptions];
    isInitialized.value = false;
    isLoading.value = false;
    isSaving.value = false;
    stopPreview();
    if (saveTimeoutId) {
      clearTimeout(saveTimeoutId);
      saveTimeoutId = null;
    }
  }

  return {
    // 状态
    settings,
    availableSounds,
    isLoading,
    isInitialized,
    isSaving,
    // 方法
    initialize,
    save,
    updateSettings,
    previewSound,
    stopPreview,
    playNewMessageSound,
    playSystemNotificationSound,
    $reset,
  };
});

// 解决热更新问题
const hot = import.meta.hot;
if (hot) {
  hot.accept(acceptHMRUpdate(useSoundSettingsStore, hot));
}
