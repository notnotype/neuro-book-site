import {describe, expect, it} from "vitest";
import {normalizeValidationIssues} from "../../shared/validation-issues";
import {DisplayNameSchema, LoginRequestDtoSchema, RegisterFormSchema, RegisterRequestDtoSchema, UsernameSchema} from "../../shared/auth-schema";

describe("auth DTO schemas", () => {
    it("accepts valid login and register payloads", () => {
        expect(LoginRequestDtoSchema.safeParse({username: "demo_user", password: "secret"}).success).toBe(true);
        expect(RegisterRequestDtoSchema.safeParse({username: "demo-user", displayName: "示例用户", password: "password123", registrationCode: "nbr-abc123", inviteCode: "nbi-optional"}).success).toBe(true);
        expect(RegisterRequestDtoSchema.safeParse({username: "demo-user", displayName: "Demo User", password: "password123", registrationCode: "nbr-abc123"}).success).toBe(true);
    });

    it("rejects invalid usernames and short register passwords", () => {
        expect(LoginRequestDtoSchema.safeParse({username: "中文", password: "secret"}).success).toBe(false);
        expect(RegisterRequestDtoSchema.safeParse({username: "ab", displayName: "测试", password: "short", registrationCode: "nbr-abc123"}).success).toBe(false);
    });

    it("keeps account names ASCII while accepting trimmed Unicode display names", () => {
        expect(UsernameSchema.parse("abc")).toBe("abc");
        expect(UsernameSchema.parse("a".repeat(32))).toHaveLength(32);
        expect(UsernameSchema.safeParse("账号名").success).toBe(false);
        expect(UsernameSchema.safeParse("a".repeat(33)).success).toBe(false);

        expect(DisplayNameSchema.parse("  中文名称  ")).toBe("中文名称");
        expect(DisplayNameSchema.parse("名")).toBe("名");
        expect(DisplayNameSchema.parse("名".repeat(50))).toHaveLength(50);
        expect(DisplayNameSchema.safeParse("   ").success).toBe(false);
        expect(DisplayNameSchema.safeParse("名".repeat(51)).success).toBe(false);
    });

    it("validates confirmation locally and normalizes issues without submitted values", () => {
        const input = {
            username: "中文账号",
            displayName: "公开名称",
            password: "sensitive-password",
            confirmPassword: "different-password",
            registrationCode: "nbr-secret-code",
        };
        const result = RegisterFormSchema.safeParse(input);
        expect(result.success).toBe(false);
        if (result.success) return;

        const issues = normalizeValidationIssues(result.error.issues);
        expect(issues).toEqual(expect.arrayContaining([
            {path: "username", code: "invalid_format"},
            {path: "confirmPassword", code: "password_mismatch"},
        ]));
        const serialized = JSON.stringify(issues);
        expect(serialized).not.toContain(input.username);
        expect(serialized).not.toContain(input.password);
        expect(serialized).not.toContain(input.confirmPassword);
        expect(serialized).not.toContain(input.registrationCode);
    });

    it("rejects register payload without registration code", () => {
        expect(RegisterRequestDtoSchema.safeParse({username: "demo-user", displayName: "Demo User", password: "password123"}).success).toBe(false);
    });
});
