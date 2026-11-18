/**
 * 全局常量。
 * 角色名称直接存进 D1，修改时需同步迁移脚本。
 */
export const ROLE = Object.freeze({
  KNIGHT: '骑士',
  NOBLE: '贵族',
  EMPEROR: '皇帝'
});

/** 管理员可以设置的目标角色（不能通过后台创建皇帝）。 */
export const ASSIGNABLE_ROLES = Object.freeze([ROLE.KNIGHT, ROLE.NOBLE]);

export const LIMITS = Object.freeze({
  /** 骑士最多创建的笔记本数量。 */
  KNIGHT_NOTEBOOKS: 8,
  /** 空账号（没有笔记）在多少天后过期。 */
  EMPTY_ACCOUNT_DAYS: 10,
  /** 登录会话有效期。 */
  SESSION_DAYS: 7,
  /** 分享链接有效期。 */
  SHARE_DAYS: 30
});

export const DAY_MS = 24 * 60 * 60 * 1000;
export const DAY_SECONDS = 24 * 60 * 60;
