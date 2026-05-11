<script setup lang="ts">
import { computed } from 'vue';

import { Card, Descriptions, DescriptionsItem, Tag } from 'ant-design-vue';

import { usePermission } from '#/composables/usePermission';
import {
  getAdminTypeColor,
  getAdminTypeLabel,
} from '#/types/admin';

const { userType, dataScope, isSuperAdmin, isAdmin, isZhanzhang, isKefu } =
  usePermission();

const permissionDescription = computed(() => {
  const descriptions: Record<number, string> = {
    0: '您拥有系统的最高权限，可以管理所有数据和执行系统级操作。',
    1: '您可以管理站长和客服，但无法删除客户或执行系统级操作。',
    2: '您可以管理自己的网站和客服团队，并充当客服接待客户。',
    3: '您可以接待客户、查看客户信息和处理会话。',
  };
  return descriptions[userType.value] || '';
});

const dataScopeLabel = computed(() => {
  const labels: Record<string, string> = {
    all: '所有数据',
    subordinate: '所属范围的数据',
    self: '仅自己的数据',
  };
  return labels[dataScope.value] || '';
});

const permissionFeatures = computed(() => {
  const features: Record<number, string[]> = {
    0: [
      '管理所有管理员',
      '管理所有角色',
      '管理所有平台',
      '管理所有客户',
      '删除客户数据',
      '查看所有统计',
      '系统级配置',
    ],
    1: [
      '管理站长和客服',
      '管理平台',
      '查看所有客户',
      '编辑客户信息',
      '查看所有统计',
      '业务配置',
    ],
    2: [
      '管理自己的客服',
      '管理自己的网站',
      '查看所属客户',
      '编辑客户信息',
      '处理会话',
      '查看统计',
    ],
    3: ['查看客户信息', '处理会话', '编辑客户备注', '查看个人统计'],
  };
  return features[userType.value] || [];
});
</script>

<template>
  <Card title="权限信息">
    <Descriptions :column="1" bordered>
      <DescriptionsItem label="角色类型">
        <Tag :color="getAdminTypeColor(userType)">
          {{ getAdminTypeLabel(userType) }}
        </Tag>
      </DescriptionsItem>

      <DescriptionsItem label="数据范围">
        <span class="font-medium">{{ dataScopeLabel }}</span>
      </DescriptionsItem>

      <DescriptionsItem label="权限说明">
        <p class="text-gray-600">{{ permissionDescription }}</p>
      </DescriptionsItem>

      <DescriptionsItem label="主要功能">
        <div class="space-y-1">
          <div
            v-for="(feature, index) in permissionFeatures"
            :key="index"
            class="flex items-center"
          >
            <span class="mr-2 text-green-500">✓</span>
            <span>{{ feature }}</span>
          </div>
        </div>
      </DescriptionsItem>

      <DescriptionsItem label="权限级别">
        <div class="flex items-center space-x-2">
          <div
            class="h-2 flex-1 rounded-full bg-gray-200"
            style="max-width: 200px"
          >
            <div
              class="h-full rounded-full transition-all"
              :class="{
                'bg-red-500': isSuperAdmin,
                'bg-orange-500': isAdmin,
                'bg-blue-500': isZhanzhang,
                'bg-green-500': isKefu,
              }"
              :style="{
                width: isSuperAdmin
                  ? '100%'
                  : isAdmin
                    ? '75%'
                    : isZhanzhang
                      ? '50%'
                      : '25%',
              }"
            ></div>
          </div>
          <span class="text-sm text-gray-500">
            {{
              isSuperAdmin
                ? '最高'
                : isAdmin
                  ? '高'
                  : isZhanzhang
                    ? '中'
                    : '基础'
            }}
          </span>
        </div>
      </DescriptionsItem>
    </Descriptions>
  </Card>
</template>
