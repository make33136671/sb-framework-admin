import type { Directive, DirectiveBinding } from 'vue';

import { useUserStore } from '@vben/stores';

import { AdminType } from '#/types/admin';
import { PermissionUtil } from '#/utils/permission';

/**
 * 权限指令
 * 用法: v-permission="'admin:add'"
 * 当用户无权限时,元素会被移除
 */
export const permissionDirective: Directive = {
  mounted(el: HTMLElement, binding: DirectiveBinding<string>) {
    const { value } = binding;
    if (!value) return;

    const userStore = useUserStore();
    const userType =
      (userStore.userInfo?.adminType as AdminType) ?? AdminType.CustomerService;

    const hasPermission = PermissionUtil.hasActionPermission(userType, value);

    if (!hasPermission) {
      // 移除元素
      el.parentNode?.removeChild(el);
    }
  },
};

/**
 * 注册权限指令到 Vue 应用
 */
export function setupPermissionDirective(app: any) {
  app.directive('permission', permissionDirective);
}
