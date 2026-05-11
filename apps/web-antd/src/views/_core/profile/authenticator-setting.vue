<script setup lang="ts">
import { computed, ref, h } from 'vue';
import { Card, Button, Input, message, Space, Modal, Spin } from 'ant-design-vue';
import { IconifyIcon } from '@vben/icons';

import {
  getAdminInfoApi,
  getGoogleCodeInfoApi,
  getGoogleCodeQRApi,
  bindGoogleCodeApi,
  unbindGoogleCodeApi,
} from '#/api/core/admin';
import { useUserStore } from '@vben/stores';

const userStore = useUserStore();

// 状态管理
const isBound = computed(
  () => userStore.userInfo?.authenticatorBindTime !== null,
);
const qrCodeUrl = ref<string>('');
const manualEntryKey = ref<string>('');
const currentPassword = ref('');
const totpCode = ref('');
const bindTotpCode = ref('');
const loading = ref(false);
const showQRModal = ref(false);

// 获取二维码
async function handleGetQR() {
  try {
    loading.value = true;
    const res = await getGoogleCodeQRApi();
    if (res) {
      qrCodeUrl.value = res.qrBase64 || '';
      manualEntryKey.value = res.manualEntryKey || '';
      showQRModal.value = true;
    }
  } catch (error) {
    message.error('获取二维码失败');
  } finally {
    loading.value = false;
  }
}

// 绑定谷歌验证器
async function handleBind() {
  if (!bindTotpCode.value.trim()) {
    message.error('请输入验证码');
    return;
  }

  if (!currentPassword.value.trim()) {
    message.error('请输入当前密码');
    return;
  }

  try {
    loading.value = true;
    const res = await bindGoogleCodeApi(bindTotpCode.value, currentPassword.value);
    if (res?.code === 0) {
      message.success('绑定成功');
      showQRModal.value = false;
      bindTotpCode.value = '';
      currentPassword.value = '';
      qrCodeUrl.value = '';
      manualEntryKey.value = '';
      // 刷新用户信息以更新页面状态
      const userInfo = await getAdminInfoApi();
      if (userInfo) {
        userStore.setUserInfo(userInfo);
      }
    }
  } catch (error) {
    message.error('绑定失败');
  } finally {
    loading.value = false;
  }
}

// 解绑谷歌验证器
async function handleUnbind() {
  if (!currentPassword.value.trim()) {
    message.error('请输入当前密码');
    return;
  }

  if (!totpCode.value.trim()) {
    message.error('请输入验证码');
    return;
  }

  Modal.confirm({
    title: '确认解绑',
    icon: () => h(IconifyIcon, { icon: 'carbon:warning-alt' }),
    content: '解绑后将无法使用谷歌验证器进行两步验证，确定要继续吗？',
    okText: '确定',
    cancelText: '取消',
    async onOk() {
      try {
        loading.value = true;
        const res = await unbindGoogleCodeApi(totpCode.value, currentPassword.value);
        if (res?.code === 0) {
          message.success('解绑成功');
          totpCode.value = '';
          currentPassword.value = '';
          // 刷新用户信息以更新页面状态
          const userInfo = await getAdminInfoApi();
          if (userInfo) {
            userStore.setUserInfo(userInfo);
          }
        }
      } catch (error) {
        message.error('解绑失败');
      } finally {
        loading.value = false;
      }
    },
  });
}
</script>

<template>
  <div class="flex justify-center w-full">
    <Card
      v-if="!isBound"
      title="绑定谷歌验证器"
      class="w-full max-w-md"
    >
      <Spin :spinning="loading">
        <div class="flex flex-col gap-6">
          <div class="text-sm text-gray-600">
            <p class="mb-2">谷歌验证器可以为您的账号增加一层安全保护。</p>
            <p class="mb-2">绑定步骤：</p>
            <ol class="list-decimal list-inside space-y-1">
              <li>点击"获取二维码"按钮</li>
              <li>用谷歌验证器应用扫描二维码</li>
              <li>输入验证码进行确认</li>
            </ol>
          </div>

          <Button type="primary" block @click="handleGetQR" :loading="loading">
            获取二维码
          </Button>

          <Modal
            v-model:open="showQRModal"
            title="绑定谷歌验证器"
            :footer="null"
            @cancel="showQRModal = false"
          >
            <div class="flex flex-col items-center gap-4">
              <div class="text-sm text-gray-600">
                用谷歌验证器应用扫描下方二维码
              </div>
              <img
                v-if="qrCodeUrl"
                :src="qrCodeUrl"
                alt="谷歌验证器二维码"
                class="w-48 h-48 border border-gray-200 rounded"
              />

              <!-- 手动输入密钥 -->
              <div v-if="manualEntryKey" class="w-full border-t pt-4">
                <div class="text-sm text-gray-600 mb-2">
                  或手动输入以下密钥到谷歌验证器应用中：
                </div>
                <div class="flex gap-2 items-center">
                  <code class="flex-1 p-2 bg-gray-200 rounded text-sm break-all text-gray-900 font-mono">
                    {{ manualEntryKey }}
                  </code>
                  <Button
                    type="text"
                    size="small"
                    @click="() => {
                      navigator.clipboard.writeText(manualEntryKey);
                      message.success('已复制到剪贴板');
                    }"
                  >
                    复制
                  </Button>
                </div>
              </div>

              <div class="w-full">
                <label class="block text-sm font-medium mb-2">
                  当前密码
                </label>
                <Input
                  v-model:value="currentPassword"
                  type="password"
                  placeholder="请输入当前密码"
                  @keyup.enter="handleBind"
                />
              </div>

              <div class="w-full">
                <label class="block text-sm font-medium mb-2">
                  验证码
                </label>
                <Input
                  v-model:value="bindTotpCode"
                  placeholder="请输入6位数字验证码"
                  maxlength="6"
                  type="number"
                  @keyup.enter="handleBind"
                />
              </div>
              <Button
                type="primary"
                block
                @click="handleBind"
                :loading="loading"
              >
                确认绑定
              </Button>
            </div>
          </Modal>
        </div>
      </Spin>
    </Card>

    <Card
      v-else
      title="解绑谷歌验证器"
      class="w-full max-w-md"
    >
      <Spin :spinning="loading">
        <div class="flex flex-col gap-4">
          <div class="p-3 bg-green-50 border border-green-200 rounded text-sm text-green-700">
            ✓ 您已绑定谷歌验证器
          </div>

          <div class="text-sm text-gray-600">
            <p>
              绑定时间：
              {{
                userStore.userInfo?.authenticatorBindTime
                  ? new Date(
                      userStore.userInfo.authenticatorBindTime,
                    ).toLocaleString('zh-CN')
                  : '-'
              }}
            </p>
          </div>

          <div>
            <label class="block text-sm font-medium mb-2">
              当前密码
            </label>
            <Input
              v-model:value="currentPassword"
              type="password"
              placeholder="请输入当前密码"
              @keyup.enter="handleUnbind"
            />
          </div>

          <div>
            <label class="block text-sm font-medium mb-2">
              验证码
            </label>
            <Input
              v-model:value="totpCode"
              placeholder="请输入6位数字验证码"
              maxlength="6"
              type="number"
              @keyup.enter="handleUnbind"
            />
          </div>

          <Button
            type="primary"
            danger
            block
            @click="handleUnbind"
            :loading="loading"
          >
            解绑谷歌验证器
          </Button>
        </div>
      </Spin>
    </Card>
  </div>
</template>
