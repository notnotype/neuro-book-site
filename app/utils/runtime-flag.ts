/**
 * 解析 Nuxt public runtime config 中的布尔开关。
 * 构建默认值是 boolean，环境变量在运行时覆盖后可能被解析为 string 或 number。
 */
export function isRuntimeFlagEnabled(value: boolean | string | number): boolean {
    return value === true
        || value === 1
        || (typeof value === "string" && ["1", "true"].includes(value.trim().toLowerCase()));
}
