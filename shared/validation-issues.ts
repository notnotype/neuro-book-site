import type {z} from "zod";
import type {ValidationIssueCode, ValidationIssueDto} from "./dto/error.dto";

/** 将 Zod issue 归一成稳定、可翻译且不泄露输入值的结构。 */
export function normalizeValidationIssues(issues: z.core.$ZodIssue[]): ValidationIssueDto[] {
    return issues.map((issue) => {
        let code: ValidationIssueCode = "invalid_value";
        if (issue.code === "invalid_type") {
            code = "required";
        } else if (issue.code === "too_small") {
            code = issue.origin === "string"
                ? (issue.minimum === 1 ? "required" : "too_short")
                : "below_minimum";
        } else if (issue.code === "too_big") {
            code = issue.origin === "string" ? "too_long" : "above_maximum";
        } else if (issue.code === "invalid_format") {
            code = "invalid_format";
        } else if (issue.code === "custom" && issue.message === "password_mismatch") {
            code = "password_mismatch";
        }

        const minimum = "minimum" in issue && typeof issue.minimum === "number" ? issue.minimum : undefined;
        const maximum = "maximum" in issue && typeof issue.maximum === "number" ? issue.maximum : undefined;
        return {
            path: issue.path.map(String).join("."),
            code,
            ...(minimum !== undefined ? {minimum} : {}),
            ...(maximum !== undefined ? {maximum} : {}),
        };
    });
}
