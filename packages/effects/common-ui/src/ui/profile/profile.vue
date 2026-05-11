<script setup lang="ts">
import type { Props } from './types';

import { preferences } from '@vben-core/preferences';
import {
  Card,
  Separator,
  Tabs,
  TabsList,
  TabsTrigger,
  VbenAvatar,
} from '@vben-core/shadcn-ui';

import { Page } from '../../components';

defineOptions({
  name: 'ProfileUI',
});

withDefaults(defineProps<Props>(), {
  title: '关于项目',
  tabs: () => [],
});

const tabsValue = defineModel<string>('modelValue');
</script>
<template>
  <Page auto-content-height>
    <div class="flex h-full w-full flex-col md:flex-row">
      <Card class="w-full flex-none md:w-1/3 lg:w-1/4 xl:w-1/5 md:min-w-[180px]">
        <div class="mt-4 flex h-40 flex-col items-center justify-center gap-4">
          <VbenAvatar
            :src="userInfo?.avatar ?? preferences.app.defaultAvatar"
            class="size-20"
          />
          <span class="text-lg font-semibold">
            {{ userInfo?.realName ?? '' }}
          </span>
          <span class="text-foreground/80 text-sm">
            {{ userInfo?.username ?? '' }}
          </span>
        </div>
        <Separator class="my-4" />
        <Tabs v-model="tabsValue" orientation="vertical" class="m-4">
          <TabsList class="bg-card grid w-full grid-cols-1">
            <TabsTrigger
              v-for="tab in tabs"
              :key="tab.value"
              :value="tab.value"
              class="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground h-12 justify-start whitespace-nowrap"
            >
              {{ tab.label }}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </Card>
      <Card class="mt-4 w-full flex-auto p-8 md:ml-4 md:mt-0">
        <slot name="content"></slot>
      </Card>
    </div>
  </Page>
</template>
