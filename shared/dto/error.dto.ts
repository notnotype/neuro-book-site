/** 前端可稳定翻译的参数错误类型；不包含用户提交值或 Zod 原始 message。 */
export const VALIDATION_ISSUE_CODES = [
    "required",
    "too_short",
    "too_long",
    "below_minimum",
    "above_maximum",
    "invalid_format",
    "invalid_value",
    "password_mismatch",
] as const;

export type ValidationIssueCode = typeof VALIDATION_ISSUE_CODES[number];

/** 单个字段校验问题；path 使用点分路径，根级问题使用空串。 */
export type ValidationIssueDto = {
    path: string;
    code: ValidationIssueCode;
    minimum?: number;
    maximum?: number;
};

/** 所有站点 API 错误的稳定机器可读数据。 */
export type ApiErrorDataDto = {
    error: string;
    field?: string;
    issues?: ValidationIssueDto[];
};
