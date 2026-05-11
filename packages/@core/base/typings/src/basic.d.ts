interface BasicOption {
  label: string;
  value: string;
}

type SelectOption = BasicOption;

type TabOption = BasicOption;

interface BasicUserInfo {
  /**
   * Avatar
   */
  avatar: string;
  /**
   * Real name
   */
  realName: string;
  /**
   * User roles
   */
  roles?: string[];
  /**
   * User id
   */
  userId: string;
  /**
   * Username
   */
  username: string;
}

type ClassType = Array<object | string> | object | string;

export type { BasicOption, BasicUserInfo, ClassType, SelectOption, TabOption };
