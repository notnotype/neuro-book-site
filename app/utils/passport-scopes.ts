// Passport scope → 用户可读文案（/link 批准页与授权管理面板共用）。

export type ScopeDescription = {
    label: string;
    detail: string;
};

/** scope 的自然语言解释；未知 scope 展示原文 */
export const PASSPORT_SCOPE_DESCRIPTIONS: Record<string, ScopeDescription> = {
    "workshop:publish": {label: "发布工坊资产", detail: "以你的名义在创意工坊创建条目、上传新版本、编辑自己的条目"},
    "backup:read": {label: "读取云备份", detail: "列出并下载你账号下的实例备份"},
    "backup:write": {label: "写入云备份", detail: "上传新的实例备份、删除已有备份"},
};

/**
 * 取 scope 展示信息；未登记的 scope 原文兜底。
 */
export function describeScope(scope: string): ScopeDescription {
    return PASSPORT_SCOPE_DESCRIPTIONS[scope] ?? {label: scope, detail: ""};
}
