import {randomUUID} from "node:crypto";
import type {H3Event} from "h3";
import {getResponseStatus, setResponseHeader} from "h3";
import {defineNitroPlugin} from "nitropack/runtime";
import {clientIp} from "../utils/site-config";
import {safeLogError, sanitizeRequestPath, siteLogger, siteLoggerRuntime} from "../utils/site-logger";

type RequestLogContext = {
    requestId: string;
    method: string;
    path: string;
    startedAt: bigint;
    /** beforeResponse 解析出的健康状态；普通请求为空。 */
    healthState?: string;
};

const requests = new WeakMap<H3Event, RequestLogContext>();

/**
 * 安装官方站请求生命周期日志。请求与响应对象不会直接交给日志器，避免 header/body 泄漏。
 */
export default defineNitroPlugin((nitroApp) => {
    nitroApp.hooks.hook("request", (event) => {
        const context: RequestLogContext = {
            requestId: randomUUID(),
            method: event.method,
            path: sanitizeRequestPath(event.path),
            startedAt: process.hrtime.bigint(),
        };
        requests.set(event, context);
        setResponseHeader(event, "x-request-id", context.requestId);
        event.node.res.once("finish", () => logRequestCompletion(event, context));
    });

    nitroApp.hooks.hook("error", (error, errorContext) => {
        const event = errorContext.event;
        const request = event ? requests.get(event) : undefined;
        const statusCode = errorStatusCode(error);
        const fields = {
            event: "http.request.error",
            ...(request ? {
                requestId: request.requestId,
                method: request.method,
                path: request.path,
            } : {}),
            ...(statusCode ? {statusCode} : {}),
            error: safeLogError(error),
        };
        if (statusCode !== null && statusCode < 500) {
            siteLogger.warn(fields, "request failed");
        } else {
            siteLogger.error(fields, "request failed");
        }
    });

    nitroApp.hooks.hook("beforeResponse", (event, response) => {
        const request = requests.get(event);
        if (request) {
            request.healthState = responseHealthState(request.path, response?.body);
        }
    });

    nitroApp.hooks.hook("close", async () => {
        await siteLoggerRuntime.close();
    });

    siteLogger.info({
        event: "site.logging.ready",
        configuredLevel: siteLogger.level,
        persistent: Boolean(process.env.NB_LOG_FILE?.trim()),
    }, "structured logging ready");
});

/** response finish 对成功与异常响应都会触发，是每请求唯一完成日志出口。 */
function logRequestCompletion(event: H3Event, request: RequestLogContext): void {
    const statusCode = getResponseStatus(event);
    if (isSuccessfulHealth(request.path, statusCode, request.healthState)) {
        return;
    }
    const fields = {
        event: "http.request.completed",
        requestId: request.requestId,
        method: request.method,
        path: request.path,
        statusCode,
        durationMs: Number(process.hrtime.bigint() - request.startedAt) / 1_000_000,
        clientIp: clientIp(event),
        ...(request.healthState ? {healthState: request.healthState} : {}),
    };
    if (statusCode >= 500) {
        siteLogger.error(fields, "request completed");
    } else if (statusCode === 429 || request.healthState === "degraded" || request.healthState === "not_ready") {
        siteLogger.warn(fields, "request completed");
    } else {
        siteLogger.info(fields, "request completed");
    }
}

function responseHealthState(path: string, body: unknown): string | undefined {
    if (!isHealthPath(path) || typeof body !== "object" || body === null || !("status" in body)) {
        return undefined;
    }
    return typeof body.status === "string" ? body.status : undefined;
}

function isSuccessfulHealth(path: string, statusCode: number, healthState: string | undefined): boolean {
    if (statusCode >= 400) {
        return false;
    }
    return (path === "/api/health/live" && healthState === "live")
        || (path === "/api/health/ready" && healthState === "ready");
}

function isHealthPath(path: string): boolean {
    return path === "/api/health/live" || path === "/api/health/ready";
}

function errorStatusCode(error: unknown): number | null {
    if (typeof error !== "object" || error === null) {
        return null;
    }
    const candidate = error as {statusCode?: unknown; status?: unknown}; // H3 与底层库的错误字段并不统一。
    const statusCode = candidate.statusCode ?? candidate.status;
    return typeof statusCode === "number" && Number.isInteger(statusCode) ? statusCode : null;
}
