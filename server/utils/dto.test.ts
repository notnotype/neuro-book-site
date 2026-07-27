import {describe, expect, it} from "vitest";
import {LoginRequestDtoSchema, RegisterRequestDtoSchema} from "./dto";

describe("auth DTO schemas", () => {
    it("accepts valid login and register payloads", () => {
        expect(LoginRequestDtoSchema.safeParse({username: "demo_user", password: "secret"}).success).toBe(true);
        expect(RegisterRequestDtoSchema.safeParse({username: "demo-user", password: "password123", inviteCode: "nbw-abc123"}).success).toBe(true);
    });

    it("rejects invalid usernames and short register passwords", () => {
        expect(LoginRequestDtoSchema.safeParse({username: "中文", password: "secret"}).success).toBe(false);
        expect(RegisterRequestDtoSchema.safeParse({username: "ab", password: "short", inviteCode: "nbw-abc123"}).success).toBe(false);
    });

    it("rejects register payload without invite code", () => {
        expect(RegisterRequestDtoSchema.safeParse({username: "demo-user", password: "password123"}).success).toBe(false);
    });
});
