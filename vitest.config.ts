import {defineConfig} from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        // 集成测试单用例包含多次真实 HTTP 往返，放宽默认超时
        testTimeout: 15_000,
    },
});
