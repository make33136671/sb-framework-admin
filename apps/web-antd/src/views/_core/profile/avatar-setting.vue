<script setup lang="ts">
import type { UploadDetail } from '#/components/Upload';

import { computed, ref } from 'vue';

import { useUserStore } from '@vben/stores';

import { Button, Card, message } from 'ant-design-vue';

import { changeAvatarApi } from '#/api/core/admin';
import { DirectUpload } from '#/components/Upload';

const userStore = useUserStore();

/** 当前用户头像（数据库中存的，可能是绝对 URL） */
const currentAvatar = computed(() => userStore.userInfo?.avatar || '');

/** v-model 绑定 DirectUpload：新上传头像的相对路径 */
const newAvatarPath = ref<string>('');

/** 新上传后的预览 URL（绝对 URL，由 @success 事件回写） */
const newAvatarUrl = ref('');

/** 显示的头像：优先新上传，否则当前 */
const displayAvatar = computed(() => newAvatarUrl.value || currentAvatar.value);

const saving = ref(false);

/**
 * 上传成功回调：保留绝对 URL 用于预览与提交后端
 */
function onUploaded(detail: UploadDetail | UploadDetail[]) {
  const d = Array.isArray(detail) ? detail[0] : detail;
  if (!d) return;
  newAvatarUrl.value = d.absfileName;
  message.success('图片上传成功');
}

async function handleSave() {
  if (!newAvatarUrl.value) {
    message.error('请先上传头像');
    return;
  }
  saving.value = true;
  try {
    const res = await changeAvatarApi(newAvatarUrl.value);
    if (res?.code === 0 && userStore.userInfo) {
      userStore.setUserInfo({
        ...userStore.userInfo,
        avatar: newAvatarUrl.value,
      });
    }
  } catch {
    // sbRequestClient 自动处理错误消息
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="flex justify-center w-full">
    <Card title="修改头像" class="w-full max-w-md">
      <div class="flex flex-col items-center gap-6">
        <div class="relative">
          <div
            class="h-32 w-32 overflow-hidden rounded-full border-4 border-gray-200"
          >
            <img
              v-if="displayAvatar"
              :src="displayAvatar"
              alt="头像"
              class="h-full w-full object-cover"
            />
            <div
              v-else
              class="flex h-full w-full items-center justify-center bg-gray-100 text-gray-400"
            >
              暂无头像
            </div>
          </div>
        </div>

        <DirectUpload
          type="image"
          v-model:value="newAvatarPath"
          @success="onUploaded"
        />

        <div class="text-sm text-gray-500">支持 JPG、PNG 格式</div>

        <Button
          type="primary"
          :loading="saving"
          :disabled="
            !newAvatarUrl || newAvatarUrl === userStore.userInfo?.avatar
          "
          @click="handleSave"
        >
          保存头像
        </Button>
      </div>
    </Card>
  </div>
</template>
