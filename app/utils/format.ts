// 展示层格式化助手：相对时间 / 日期 / 文件大小。跨 ItemCard、详情版本区、侧栏、admin 复用。
// 均为纯展示用途，浏览器环境下 Date 可用。

/**
 * 相对时间：ISO 时间串 → "刚刚 / x 分钟前 / x 小时前 / x 天前"；超过 30 天回退到 YYYY-MM-DD。
 */
export function relativeTime(iso: string): string {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) {
        return "";
    }
    const diffSec = Math.round((Date.now() - then) / 1000);
    if (diffSec < 60) {
        return "刚刚";
    }
    const diffMin = Math.round(diffSec / 60);
    if (diffMin < 60) {
        return `${diffMin} 分钟前`;
    }
    const diffHour = Math.round(diffMin / 60);
    if (diffHour < 24) {
        return `${diffHour} 小时前`;
    }
    const diffDay = Math.round(diffHour / 24);
    if (diffDay < 30) {
        return `${diffDay} 天前`;
    }
    return formatDate(iso);
}

/**
 * ISO 时间串 → 本地日期 YYYY-MM-DD。
 */
export function formatDate(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
        return "";
    }
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

/**
 * 字节数 → 人类可读（B / KB / MB）。
 */
export function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
