import type {ApiErrorDataDto, ValidationIssueDto} from "../../shared/dto/error.dto";

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

/** 从外部请求异常中只读取受信任的稳定错误数据，不消费 message。 */
function inspect(error: unknown): {data?: ApiErrorDataDto; status: number; requestId: string} {
    const candidate = error as FetchErrorLike;
    const body = candidate.response?._data ?? candidate.data;
    return {
        data: body?.data,
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
        if (inspected.data?.error) {
            const key = `errors.api.${inspected.data.error}`;
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
        for (const issue of inspected.data?.issues ?? []) {
            if (issue.path && !fields[issue.path]) {
                fields[issue.path] = issueMessage(issue);
            }
        }
        if (inspected.data?.field && inspected.data.error) {
            const key = `errors.api.${inspected.data.error}`;
            fields[inspected.data.field] = te(key) ? t(key) : t(fallbackKey);
        }
        return {
            fields,
            message: Object.keys(fields).length > 0 ? "" : resolve(error, fallbackKey),
        };
    }

    return {resolve, form, issueMessage};
}
