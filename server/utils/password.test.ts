import {describe, expect, it} from "vitest";
import {hashUserPassword, verifyUserPassword} from "./password";

describe("password utilities", () => {
    it("verifies matching scrypt password hashes", async () => {
        const hash = await hashUserPassword("correct-password");

        expect(await verifyUserPassword("correct-password", hash)).toBe(true);
        expect(await verifyUserPassword("wrong-password", hash)).toBe(false);
    });
});
