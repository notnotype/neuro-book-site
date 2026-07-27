import {EventEmitter} from "node:events";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Writable} from "node:stream";
import type pino from "pino";
import {afterEach, describe, expect, it, vi} from "vitest";
import {
    createSiteLogger,
    redactSensitiveText,
    resolveLogLevel,
    safeLogError,
    sanitizeRequestPath,
} from "./site-logger";

afterEach(() => {
    vi.restoreAllMocks();
});

describe("site logger", () => {
    it("输出固定结构并由 Pino 二次清理敏感键", async () => {
        const lines: string[] = [];
        const output = new Writable({
            write(chunk, _encoding, callback) {
                lines.push(chunk.toString());
                callback();
            },
        });
        const runtime = createSiteLogger({
            env: {NB_LOG_LEVEL: "debug"} as NodeJS.ProcessEnv,
            stdout: output,
        });

        runtime.logger.info({
            event: "test.event",
            requestId: "request-1",
            password: "visible-password",
            nested: {refreshToken: "visible-token"},
        }, "test message");
        await runtime.flush();

        const entry = JSON.parse(lines.join("")) as Record<string, unknown>;
        expect(entry).toMatchObject({
            level: "info",
            service: "neuro-book-site",
            event: "test.event",
            requestId: "request-1",
            password: "[REDACTED]",
            nested: {refreshToken: "[REDACTED]"},
            msg: "test message",
        });
        expect(entry).not.toHaveProperty("pid");
        expect(entry).not.toHaveProperty("hostname");
    });

    it("删除 query 并隐藏动态设备码路径段", () => {
        expect(sanitizeRequestPath("/register?registrationCode=REG-SECRET&inviteCode=INV-SECRET")).toBe("/register");
        expect(sanitizeRequestPath("/api/v1/passport/device/ABCD-EFGH/approve?token=secret"))
            .toBe("/api/v1/passport/device/[REDACTED]/approve");
        expect(sanitizeRequestPath("/api/v1/passport/device/code")).toBe("/api/v1/passport/device/code");
    });

    it("清理自由文本和错误字段", () => {
        const recoveryCode = `NBK1-${"A".repeat(43)}-00000000`;
        const error = Object.assign(new Error(`fetch failed Bearer abc123 recoveryCode=${recoveryCode}`), {code: "ENOTFOUND"});
        const safe = safeLogError(error);

        expect(safe).toMatchObject({name: "Error", code: "ENOTFOUND"});
        expect(safe.message).not.toContain("abc123");
        expect(safe.message).not.toContain(recoveryCode);
        expect(redactSensitiveText("registrationCode=REG-SECRET inviteCode=INV-SECRET"))
            .toBe("registrationCode=[REDACTED] inviteCode=[REDACTED]");
    });

    it("日志级别只接受公开枚举，非法值安全回退 info", () => {
        expect(resolveLogLevel("DEBUG")).toBe("debug");
        expect(resolveLogLevel("silent")).toBe("info");
        expect(resolveLogLevel(undefined)).toBe("info");
    });

    it("持久文件流故障后继续写 stdout，并限制 stderr 告警频率", async () => {
        const directory = mkdtempSync(join(tmpdir(), "neuro-book-site-log-"));
        const stdoutLines: string[] = [];
        const persistedLines: string[] = [];
        const warnings: string[] = [];
        const stdout = new Writable({
            write(chunk, _encoding, callback) {
                stdoutLines.push(chunk.toString());
                callback();
            },
        });
        const destinationEvents = new EventEmitter();
        const destination = Object.assign(destinationEvents, {
            write(message: string): boolean {
                persistedLines.push(message);
                return true;
            },
            flush(): void {},
            destroy(): void {
                destinationEvents.emit("close");
            },
            end(): void {
                destinationEvents.emit("close");
            },
        }) as ReturnType<typeof pino.destination>;
        const runtime = createSiteLogger({
            env: {NB_LOG_LEVEL: "info", NB_LOG_FILE: join(directory, "site.jsonl")} as NodeJS.ProcessEnv,
            stdout,
            stderr: {write(message: string | Uint8Array) {
                warnings.push(message.toString());
                return true;
            }} as Pick<NodeJS.WriteStream, "write">,
            fileDestination: () => destination,
        });

        runtime.logger.info({event: "before.failure"}, "before");
        destination.emit("error", new Error("token=must-not-leak"));
        destination.emit("error", new Error("second failure"));
        runtime.logger.info({event: "after.failure"}, "after");
        await runtime.close();

        expect(stdoutLines.join("")).toContain("before.failure");
        expect(stdoutLines.join("")).toContain("after.failure");
        expect(persistedLines.join("")).toContain("before.failure");
        expect(persistedLines.join("")).not.toContain("after.failure");
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).not.toContain("must-not-leak");
        rmSync(directory, {recursive: true, force: true});
    });
});
