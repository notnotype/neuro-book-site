/** 只证明 Nitro 进程可响应，不访问任何外部依赖。 */
export default defineEventHandler(() => {
    return {
        status: "live" as const,
        time: new Date().toISOString(),
    };
});
