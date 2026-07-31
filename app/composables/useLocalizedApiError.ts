import {VALIDATION_ISSUE_CODES, type ApiErrorDataDto, type ValidationIssueDto} from "../../shared/dto/error.dto";

type ApiResponseBody = {
    data?: ApiErrorDataDto;
};

type FetchErrorLike = {
    data?: ApiResponseBody;
    status?: number;
    statusCode?: number;
    response?: {
        _data?: ApiResponseBody;
        headers?: Headers;
        status?: number;
    };
};

export type LocalizedFormError = {
    fields: {[field: string]: string};
    message: string;
};

/** 可跨语言切换重新渲染的安全错误快照；不持有请求 body 或服务端 message。 */
export type ApiErrorSnapshot = {
    kind: "api_error_snapshot";
    errorCode: string;
    field: string;
    issues: ValidationIssueDto[];
    status: number;
    requestId: string;
};

/** 判断调用方传入的值是否已经是本模块生成的安全快照。 */
function isSnapshot(error: unknown): error is ApiErrorSnapshot {
    return typeof error === "object" && error !== null
        && "kind" in error && error.kind === "api_error_snapshot";
}

/** 从同源 API 响应复制有限 issue 字段；外部响应形状未知，因此在边界处逐项检查。 */
function copyIssues(issues: unknown): ValidationIssueDto[] {
    if (!Array.isArray(issues)) return [];
    return issues.flatMap((issue) => {
        if (typeof issue !== "object" || issue === null) return [];
        const candidate = issue as {path?: unknown; code?: unknown; minimum?: unknown; maximum?: unknown};
        if (typeof candidate.path !== "string"
            || typeof candidate.code !== "string"
            || !VALIDATION_ISSUE_CODES.includes(candidate.code as ValidationIssueDto["code"])) {
            return [];
        }
        return [{
            path: candidate.path,
            code: candidate.code as ValidationIssueDto["code"],
            ...(typeof candidate.minimum === "number" ? {minimum: candidate.minimum} : {}),
            ...(typeof candidate.maximum === "number" ? {maximum: candidate.maximum} : {}),
        }];
    });
}

/** 从外部请求异常中只复制稳定错误数据，不消费 message。 */
function inspect(error: unknown): ApiErrorSnapshot {
    if (isSnapshot(error)) return error;
    const candidate = error as FetchErrorLike;
    const body = candidate.response?._data ?? candidate.data;
    const data = body?.data;
    return {
        kind: "api_error_snapshot",
        errorCode: typeof data?.error === "string" ? data.error : "",
        field: typeof data?.field === "string" ? data.field : "",
        issues: copyIssues(data?.issues),
        status: candidate.response?.status ?? candidate.statusCode ?? candidate.status ?? 0,
        requestId: candidate.response?.headers?.get("x-request-id") ?? "",
    };
}

/** 站点统一的本地化 API 错误出口。 */
export function useLocalizedApiError() {
    const {t, te} = useI18n();

    /** 翻译单个结构化字段问题，优先使用字段专属文案。 */
    function issueMessage(issue: ValidationIssueDto): string {
        const fieldKey = `validation.fields.${issue.path}.${issue.code}`;
        const key = te(fieldKey) ? fieldKey : `validation.${issue.code}`;
        return t(key, {minimum: issue.minimum ?? "", maximum: issue.maximum ?? ""});
    }

    /** 把请求异常解析为不会泄露服务端 message 的本地化文案。 */
    function resolve(error: unknown, fallbackKey: string): string {
        const inspected = inspect(error);
        if (inspected.errorCode) {
            const key = `errors.api.${inspected.errorCode}`;
            if (te(key)) {
                return t(key);
            }
        }
        if (inspected.status >= 500) {
            const message = t("common.serviceUnavailable");
            return inspected.requestId ? `${message} ${t("common.requestId", {id: inspected.requestId})}` : message;
        }
        return t(fallbackKey);
    }

    /** 将参数问题和可归属业务错误映射到字段，其余错误留在表单级。 */
    function form(error: unknown, fallbackKey: string): LocalizedFormError {
        const inspected = inspect(error);
        const fields: {[field: string]: string} = {};
        for (const issue of inspected.issues) {
            if (issue.path && !fields[issue.path]) {
                fields[issue.path] = issueMessage(issue);
            }
        }
        if (inspected.field && inspected.errorCode) {
            const key = `errors.api.${inspected.errorCode}`;
            fields[inspected.field] = te(key) ? t(key) : t(fallbackKey);
        }
        return {
            fields,
            message: Object.keys(fields).length > 0 ? "" : resolve(error, fallbackKey),
        };
    }

    /** 保存可在语言切换后重新翻译的有限错误信息。 */
    function snapshot(error: unknown): ApiErrorSnapshot {
        return inspect(error);
    }

    /** 按稳定错误码分类，不让页面读取 $fetch 的内部响应形状。 */
    function hasCode(error: unknown, code: string): boolean {
        return inspect(error).errorCode === code;
    }

    return {resolve, form, issueMessage, snapshot, hasCode};
}
