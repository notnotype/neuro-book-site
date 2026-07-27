// 进程内固定窗口限流。站点按单进程 Nitro 部署，无跨实例共享需求；重启清零可接受
// （限的是 15 分钟设备码申请这类滥用面，不是安全边界）。

type RateBucket = {
    windowStart: number;
    count: number;
};

const buckets = new Map<string, RateBucket>();

/**
 * 消费一次限流额度；返回 false 表示当前窗口已超限。
 * 每次调用顺手清理过期桶，避免 Map 无界增长。
 */
export function consumeRateLimit(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    for (const [existingKey, bucket] of buckets) {
        if (now - bucket.windowStart >= windowMs) {
            buckets.delete(existingKey);
        }
    }
    const bucket = buckets.get(key);
    if (!bucket || now - bucket.windowStart >= windowMs) {
        buckets.set(key, {windowStart: now, count: 1});
        return true;
    }
    if (bucket.count >= limit) {
        return false;
    }
    bucket.count += 1;
    return true;
}

/**
 * 读取 env 覆写的限流额度（测试用），无效或未设时用默认值。
 */
export function envRateLimit(name: string, fallback: number): number {
    const parsed = Number.parseInt(process.env[name] ?? "", 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
