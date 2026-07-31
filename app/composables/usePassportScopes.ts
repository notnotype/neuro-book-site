export type ScopeDescription = {
    label: string;
    detail: string;
};

const SCOPE_KEYS = {
    "workshop:publish": "workshopPublish",
    "backup:read": "backupRead",
    "backup:write": "backupWrite",
} as const;

/** 把 Passport scope 转换为当前语言的人类可读说明；未知 scope 原文兜底。 */
export function usePassportScopes() {
    const {t} = useI18n();

    function describeScope(scope: string): ScopeDescription {
        const key = SCOPE_KEYS[scope as keyof typeof SCOPE_KEYS];
        if (!key) {
            return {label: scope, detail: ""};
        }
        return {
            label: t(`passport.scopes.${key}.label`),
            detail: t(`passport.scopes.${key}.detail`),
        };
    }

    return {describeScope};
}
