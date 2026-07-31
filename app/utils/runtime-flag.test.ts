import {describe, expect, it} from "vitest";
import {isRuntimeFlagEnabled} from "./runtime-flag";

describe("isRuntimeFlagEnabled", () => {
    it("兼容 Nuxt 构建默认值与运行时环境变量字符串", () => {
        expect(isRuntimeFlagEnabled(true)).toBe(true);
        expect(isRuntimeFlagEnabled(1)).toBe(true);
        expect(isRuntimeFlagEnabled("1")).toBe(true);
        expect(isRuntimeFlagEnabled(" TRUE ")).toBe(true);
        expect(isRuntimeFlagEnabled(false)).toBe(false);
        expect(isRuntimeFlagEnabled(0)).toBe(false);
        expect(isRuntimeFlagEnabled("0")).toBe(false);
        expect(isRuntimeFlagEnabled("false")).toBe(false);
        expect(isRuntimeFlagEnabled("enabled")).toBe(false);
    });
});
