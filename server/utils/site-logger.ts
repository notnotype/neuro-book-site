import {closeSync, fchmodSync, mkdirSync, openSync} from "node:fs";
import {dirname, isAbsolute} from "node:path";
import pino, {type DestinationStream, type Logger} from "pino";
import {SITE_LOG_LEVELS, type SiteLogLevel} from "./site-config";

const REDACTED = "[REDACTED]";
const MAX_LOG_TEXT_LENGTH = 12_000;
const SENSITIVE_LABEL = "api[-_ ]?key|apikey|authorization|cookie|set-cookie|password|token|secret|credential|access[-_ ]?token|refresh[-_ ]?token|device[-_ ]?code|user[-_ ]?code|registration[-_ ]?code|invite[-_ ]?code|recovery[-_ ]?code|backup[-_ ]?key|backup[-_ ]?keyring";
const SENSITIVE_VALUE_LABEL = "api[-_ ]?key|apikey|password|token|secret|credential|access[-_ ]?token|refresh[-_ ]?token|device[-_ ]?code|user[-_ ]?code|registration[-_ ]?code|invite[-_ ]?code|recovery[-_ ]?code|backup[-_ ]?key|backup[-_ ]?keyring";

export type SafeLogError = {
    name: string;
    message: string;
    stack?: string;
    /** Node/Undici 错误码；无法识别时省略。 */
    code?: string;
};

export type SiteLoggerRuntime = {
    logger: Logger;
    /** 刷新异步 destination，主要用于进程关闭和测试。 */
    flush: () => Promise<void>;
    /** 刷新并关闭持久文件 destination；Nitro close 时调用。 */
    close: () => Promise<void>;
};

type SiteLoggerOptions = {
    env?: NodeJS.ProcessEnv;
    stdout?: DestinationStream;
    stderr?: Pick<NodeJS.WriteStream, "write">;
    /** 测试可注入等价 destination，生产始终使用 Pino SonicBoom。 */
    fileDestination?: (filePath: string) => ReturnType<typeof pino.destination>;
};

/**
 * 创建官方站结构化日志器。生产配置了 NB_LOG_FILE 时，同一 JSONL 同时写 stdout 与文件。
 */
export function createSiteLogger(options: SiteLoggerOptions = {}): SiteLoggerRuntime {
    const env = options.env ?? process.env;
    const stdout = options.stdout ?? process.stdout;
    const stderr = options.stderr ?? process.stderr;
    const streams: DestinationStream[] = [stdout];
    const destinations: Array<ReturnType<typeof pino.destination>> = [];
    const filePath = env.NB_LOG_FILE?.trim() ?? "";

    if (filePath && isAbsolute(filePath)) {
        prepareLogFile(filePath);
        const destination = options.fileDestination?.(filePath)
            ?? pino.destination({dest: filePath, sync: false});
        let failed = false;
        let lastWarningAt = 0;
        destination.on("error", (error: Error) => {
            failed = true;
            const now = Date.now();
            if (now - lastWarningAt >= 60_000) {
                lastWarningAt = now;
                stderr.write(`[site-logger] persistent log disabled: ${redactSensitiveText(error.message)}\n`);
            }
        });
        streams.push({
            write(message: string): void {
                if (!failed) {
                    destination.write(message);
                }
            },
        });
        destinations.push(destination);
    }

    const logger = pino({
        level: resolveLogLevel(env.NB_LOG_LEVEL),
        base: {service: "neuro-book-site"},
        timestamp: pino.stdTimeFunctions.isoTime,
        formatters: {
            level(label) {
                return {level: label};
            },
        },
        redact: {
            paths: sensitiveLogPaths(),
            censor: REDACTED,
        },
    }, pino.multistream(streams));

    const flush = async (): Promise<void> => {
        await new Promise<void>((resolveFlush) => logger.flush(() => resolveFlush()));
        for (const destination of destinations) {
            destination.flush();
        }
    };
    return {
        logger,
        flush,
        async close(): Promise<void> {
            await flush();
            await Promise.all(destinations.map(async (destination) => {
                await new Promise<void>((resolveClose) => {
                    let settled = false;
                    const finish = (): void => {
                        if (settled) {
                            return;
                        }
                        settled = true;
                        clearTimeout(timeout);
                        resolveClose();
                    };
                    const timeout = setTimeout(() => {
                        destination.destroy();
                        finish();
                    }, 2_000);
                    destination.once("close", finish);
                    destination.end();
                });
            }));
        },
    };
}

/** 将 URL path 收敛为不含 query、设备码或超长输入的日志路径。 */
export function sanitizeRequestPath(input: string): string {
    let pathname = input;
    try {
        pathname = new URL(input, "http://localhost").pathname;
    } catch {
        pathname = input.split("?", 1)[0] ?? "/";
    }
    pathname = pathname.replace(
        /^(\/api\/v1\/passport\/device\/)(?!code(?:\/|$))[^/]+/iu,
        `$1${REDACTED}`,
    );
    return redactSensitiveText(pathname).slice(0, 512) || "/";
}

/** 清理自由文本中的凭据，供 error message/stack 与日志故障兜底共用。 */
export function redactSensitiveText(input: string): string {
    return input
        .replace(new RegExp(`(["'](?:${SENSITIVE_LABEL})["']\\s*:\\s*["'])[^"']*(["'])`, "giu"), `$1${REDACTED}$2`)
        .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=:-]+/giu, `$1 ${REDACTED}`)
        .replace(/(\bauthorization\s*[:=]\s*)(?!(?:Bearer|Basic)\b)[^\s,;}]+/giu, `$1${REDACTED}`)
        .replace(new RegExp(`\\b(cookie|set-cookie)\\s*[:=]\\s*[^\\r\\n]+`, "giu"), `$1=${REDACTED}`)
        .replace(new RegExp(`(\\b(?:${SENSITIVE_VALUE_LABEL})\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|[^\\s,;}]+)`, "giu"), `$1${REDACTED}`)
        .replace(/\bNBK1-[A-Za-z0-9_-]{43}-[0-9a-f]{8}\b/gu, REDACTED)
        .replace(/\b(?:nbp_(?:dc|at|rt)_|sk-)[A-Za-z0-9_-]{8,}\b/giu, REDACTED)
        .slice(0, MAX_LOG_TEXT_LENGTH);
}

/** 把未知异常压缩为允许进入日志的固定字段。 */
export function safeLogError(error: unknown): SafeLogError {
    if (!(error instanceof Error)) {
        return {name: "UnknownError", message: redactSensitiveText(String(error))};
    }
    const code = nodeErrorCode(error);
    return {
        name: error.name,
        message: redactSensitiveText(error.message),
        ...(error.stack ? {stack: redactSensitiveText(error.stack)} : {}),
        ...(code ? {code} : {}),
    };
}

/** 解析日志级别；生产门禁负责拒绝非法配置，日志器本身安全回退 info。 */
export function resolveLogLevel(value: string | undefined): SiteLogLevel {
    const normalized = value?.trim().toLowerCase() ?? "";
    return SITE_LOG_LEVELS.includes(normalized as SiteLogLevel) ? normalized as SiteLogLevel : "info";
}

/** 为文件 destination 建立 owner-only 文件，并在交给 Pino 前验证可写。 */
function prepareLogFile(filePath: string): void {
    mkdirSync(dirname(filePath), {recursive: true, mode: 0o700});
    const file = openSync(filePath, "a", 0o600);
    try {
        fchmodSync(file, 0o600);
    } finally {
        closeSync(file);
    }
}

/** Pino fast-redact 是第二层保护；业务代码仍只能传固定安全字段。 */
function sensitiveLogPaths(): string[] {
    const keys = [
        "authorization", "cookie", "password", "token", "secret", "credential",
        "accessToken", "refreshToken", "deviceCode", "userCode", "registrationCode",
        "inviteCode", "recoveryCode", "backupKey", "backupKeyring",
    ];
    return keys.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]);
}

function nodeErrorCode(error: Error): string | undefined {
    if (!("code" in error) || typeof error.code !== "string") {
        return undefined;
    }
    return redactSensitiveText(error.code).slice(0, 100);
}

export const siteLoggerRuntime = createSiteLogger();
export const siteLogger = siteLoggerRuntime.logger;
