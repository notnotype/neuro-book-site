import {createError} from "h3";
import type {ApiErrorDataDto} from "../../shared/dto/error.dto";

/**
 * 创建带稳定错误码的 H3 错误。
 * message 只用于服务端诊断；Web 前端必须按 data.error 本地化，不能直接展示。
 */
export function apiError(statusCode: number, error: string, message: string, details: Omit<ApiErrorDataDto, "error"> = {}) {
    return createError({
        statusCode,
        message,
        data: {error, ...details} satisfies ApiErrorDataDto,
    });
}
