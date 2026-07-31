/** 当前语言对应的日期、相对时间、数字与文件大小格式化。 */
export function useLocaleFormat() {
    const {locale} = useI18n();

    /** ISO 时间转换为短日期。 */
    function formatDate(iso: string): string {
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) {
            return "";
        }
        return new Intl.DateTimeFormat(locale.value, {year: "numeric", month: "2-digit", day: "2-digit"}).format(date);
    }

    /** ISO 时间转换为短日期时间。 */
    function formatDateTime(iso: string): string {
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) {
            return "";
        }
        return new Intl.DateTimeFormat(locale.value, {dateStyle: "short", timeStyle: "short"}).format(date);
    }

    /** ISO 时间转换为自然相对时间；超过 30 天回退到短日期。 */
    function relativeTime(iso: string): string {
        const then = new Date(iso).getTime();
        if (Number.isNaN(then)) {
            return "";
        }
        const diffSeconds = Math.round((then - Date.now()) / 1000);
        const formatter = new Intl.RelativeTimeFormat(locale.value, {numeric: "auto"});
        if (Math.abs(diffSeconds) < 60) {
            return formatter.format(diffSeconds, "second");
        }
        const minutes = Math.round(diffSeconds / 60);
        if (Math.abs(minutes) < 60) {
            return formatter.format(minutes, "minute");
        }
        const hours = Math.round(minutes / 60);
        if (Math.abs(hours) < 24) {
            return formatter.format(hours, "hour");
        }
        const days = Math.round(hours / 24);
        return Math.abs(days) < 30 ? formatter.format(days, "day") : formatDate(iso);
    }

    /** 字节数转换为当前语言的人类可读值。 */
    function formatBytes(bytes: number): string {
        if (bytes < 1024) {
            return `${new Intl.NumberFormat(locale.value).format(bytes)} B`;
        }
        const value = bytes < 1024 * 1024 ? bytes / 1024 : bytes < 1024 * 1024 * 1024 ? bytes / 1024 / 1024 : bytes / 1024 / 1024 / 1024;
        const unit = bytes < 1024 * 1024 ? "KB" : bytes < 1024 * 1024 * 1024 ? "MB" : "GB";
        return `${new Intl.NumberFormat(locale.value, {maximumFractionDigits: 1}).format(value)} ${unit}`;
    }

    /** 普通数量按当前语言添加分组分隔。 */
    function formatNumber(value: number): string {
        return new Intl.NumberFormat(locale.value).format(value);
    }

    return {formatDate, formatDateTime, relativeTime, formatBytes, formatNumber};
}
