import type { RouteRecordRaw } from 'vue-router';

import { LOGIN_PATH } from '@vben/constants';
import { preferences } from '@vben/preferences';

import { $t } from '#/locales';

const BasicLayout = () => import('#/layouts/basic.vue');
const AuthPageLayout = () => import('#/layouts/auth.vue');
/** 全局404页面 */
const fallbackNotFoundRoute: RouteRecordRaw = {
  component: () => import('#/views/_core/fallback/not-found.vue'),
  meta: {
    hideInBreadcrumb: true,
    hideInMenu: true,
    hideInTab: true,
    title: '404',
  },
  name: 'FallbackNotFound',
  path: '/:path(.*)*',
};

/** 安装向导独立路由 */
const setupRoute: RouteRecordRaw = {
  name: 'Setup',
  path: '/setup',
  component: () => import('#/views/_core/setup/setup.vue'),
  meta: {
    hideInBreadcrumb: true,
    hideInMenu: true,
    hideInTab: true,
    title: '系统安装向导',
  },
};

/** 切片上传并发 BUG 复现页面（dev 调试用） */
const uploadStressRoute: RouteRecordRaw = {
  name: 'UploadStress',
  path: '/test/upload-stress',
  component: () => import('#/views/_core/upload-stress/index.vue'),
  meta: {
    hideInBreadcrumb: true,
    hideInMenu: true,
    hideInTab: true,
    title: '切片上传并发测试',
  },
};

/** TimeProgress 组件集中演示页 */
const timeProgressDemoRoute: RouteRecordRaw = {
  name: 'TimeProgressDemo',
  path: '/test/time-progress',
  component: () => import('#/views/_core/time-progress-demo/index.vue'),
  meta: {
    hideInBreadcrumb: true,
    hideInMenu: true,
    hideInTab: true,
    title: 'TimeProgress 组件演示',
  },
};

/** 基本路由，这些路由是必须存在的 */
const coreRoutes: RouteRecordRaw[] = [
  setupRoute,
  uploadStressRoute,
  timeProgressDemoRoute,
  /**
   * 根路由
   * 使用基础布局，作为所有页面的父级容器，子级就不必配置BasicLayout。
   * 此路由必须存在，且不应修改
   */
  {
    component: BasicLayout,
    meta: {
      hideInBreadcrumb: true,
      title: 'Root',
    },
    name: 'Root',
    path: '/',
    redirect: preferences.app.defaultHomePath,
    children: [],
  },
  {
    component: AuthPageLayout,
    meta: {
      hideInTab: true,
      title: 'Authentication',
    },
    name: 'Authentication',
    path: '/auth',
    redirect: LOGIN_PATH,
    children: [
      {
        name: 'Login',
        path: 'login',
        component: () => import('#/views/_core/authentication/login.vue'),
        meta: {
          title: $t('page.auth.login'),
        },
      },
      {
        name: 'CodeLogin',
        path: 'code-login',
        component: () => import('#/views/_core/authentication/code-login.vue'),
        meta: {
          title: $t('page.auth.codeLogin'),
        },
      },
      {
        name: 'QrCodeLogin',
        path: 'qrcode-login',
        component: () =>
          import('#/views/_core/authentication/qrcode-login.vue'),
        meta: {
          title: $t('page.auth.qrcodeLogin'),
        },
      },
      {
        name: 'ForgetPassword',
        path: 'forget-password',
        component: () =>
          import('#/views/_core/authentication/forget-password.vue'),
        meta: {
          title: $t('page.auth.forgetPassword'),
        },
      },
      {
        name: 'Register',
        path: 'register',
        component: () => import('#/views/_core/authentication/register.vue'),
        meta: {
          title: $t('page.auth.register'),
        },
      },
    ],
  },
  /**
   * 授权页面 — 独立的顶级路由（不使用 AuthPageLayout，避免左侧宣传区干扰）
   * 全屏显示授权状态和续期操作，自带 header bar
   */
  {
    name: 'License',
    path: '/auth/license',
    component: () => import('#/views/_core/authentication/license.vue'),
    meta: {
      hideInTab: true,
      title: '系统授权',
    },
  },
];

export { coreRoutes, fallbackNotFoundRoute };
