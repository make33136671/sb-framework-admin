import { createApp, watchEffect } from 'vue';

import { registerAccessDirective } from '@vben/access';
import { registerLoadingDirective } from '@vben/common-ui/es/loading';
import { preferences, updatePreferences } from '@vben/preferences';
import { initStores } from '@vben/stores';
import '@vben/styles';
import '@vben/styles/antd';

import { useTitle } from '@vueuse/core';

import { $t, setupI18n } from '#/locales';

import { initComponentAdapter } from './adapter/component';
import { initSetupVbenForm } from './adapter/form';
import App from './app.vue';
import { router } from './router';

// DramaFlow 业务页面统一样式（卡片内边距与间距，仅作用于 .df-page）
import '#/styles/dramafloow.css';

async function bootstrap(namespace: string) {
  // 初始化组件适配器
  await initComponentAdapter();

  // 初始化表单组件
  await initSetupVbenForm();

  // // 设置弹窗的默认配置
  // setDefaultModalProps({
  //   fullscreenButton: false,
  // });
  // // 设置抽屉的默认配置
  // setDefaultDrawerProps({
  //   zIndex: 1020,
  // });

  // 加载品牌配置（app-info.json，由安装向导生成到 wwwroot/storage/）
  // 把后端写入的 nameCn / logo 同步到 preferences，避免任何硬编码
  try {
    const res = await fetch('/storage/app-info.json');
    if (res.ok) {
      const appInfo = await res.json();
      (window as any).__APP_INFO__ = appInfo;
      const overrides: Record<string, any> = {};
      if (appInfo.nameCn) {
        overrides.app = { name: appInfo.nameCn };
        overrides.copyright = { companyName: appInfo.nameCn };
      }
      if (appInfo.logo) {
        overrides.logo = { source: appInfo.logo };
      }
      if (Object.keys(overrides).length > 0) {
        updatePreferences(overrides);
      }
    }
  } catch {
    // app-info.json 不存在（未安装或开发环境）时静默忽略
  }

  const app = createApp(App);

  // 注册v-loading指令
  registerLoadingDirective(app, {
    loading: 'loading', // 在这里可以自定义指令名称，也可以明确提供false表示不注册这个指令
    spinning: 'spinning',
  });

  // 国际化 i18n 配置
  await setupI18n(app);

  // 配置 pinia-tore
  await initStores(app, { namespace });

  // 安装权限指令
  registerAccessDirective(app);

  // 初始化 tippy
  const { initTippy } = await import('@vben/common-ui/es/tippy');
  initTippy(app);

  // 配置路由及路由守卫
  app.use(router);

  // 配置Motion插件
  const { MotionPlugin } = await import('@vben/plugins/motion');
  app.use(MotionPlugin);

  // 动态更新标题
  watchEffect(() => {
    if (preferences.app.dynamicTitle) {
      const routeTitle = router.currentRoute.value.meta?.title;
      const pageTitle =
        (routeTitle ? `${$t(routeTitle)} - ` : '') + preferences.app.name;
      useTitle(pageTitle);
    }
  });

  app.mount('#app');
}

export { bootstrap };
