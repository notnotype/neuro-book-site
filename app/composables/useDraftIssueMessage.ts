import type {DraftIssue} from "../utils/workshop-package";

/** 将资产草稿错误码本地化；未知协议码不会泄露内部 message。 */
export function useDraftIssueMessage() {
    const {t, te} = useI18n();

    /** 合并一个操作产生的全部结构化问题。 */
    function describeIssues(issues: readonly DraftIssue[]): string {
        return issues.map((issue) => {
            const key = `workbench.errors.${issue.code}`;
            return te(key)
                ? t(key, {path: issue.path ?? "", count: issue.count ?? "", version: issue.version ?? ""})
                : t("workbench.errors.invalid_asset", {path: issue.path ?? ""});
        }).join(t("workbench.errorSeparator"));
    }

    return {describeIssues};
}
