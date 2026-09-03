<script setup lang="ts">
import { onMounted, ref } from 'vue';

import { Profile } from '@vben/common-ui';
import { useUserStore } from '@vben/stores';

import { useAuthStore } from '#/store';

import ProfileAuthenticatorSetting from './authenticator-setting.vue';
import ProfileAvatarSetting from './avatar-setting.vue';
import ProfilePasswordSetting from './password-setting.vue';
import ProfileSetting from './profile-setting.vue';

const userStore = useUserStore();
const authStore = useAuthStore();

const tabsValue = ref<string>('profile');

// 进入页面时刷新用户信息
onMounted(async () => {
  await authStore.fetchUserInfo();
});

const tabs = ref([
  {
    label: '修改资料',
    value: 'profile',
  },
  {
    label: '修改头像',
    value: 'avatar',
  },
  {
    label: '修改密码',
    value: 'password',
  },
  {
    label: '谷歌验证器',
    value: 'authenticator',
  },
]);
</script>
<template>
  <Profile
    v-model:model-value="tabsValue"
    title="个人中心"
    :user-info="userStore.userInfo"
    :tabs="tabs"
  >
    <template #content>
      <ProfileSetting v-if="tabsValue === 'profile'" />
      <ProfileAvatarSetting v-if="tabsValue === 'avatar'" />
      <ProfilePasswordSetting v-if="tabsValue === 'password'" />
      <ProfileAuthenticatorSetting v-if="tabsValue === 'authenticator'" />
    </template>
  </Profile>
</template>
