import {describe, expect, it} from "vitest";
import {resolveGitHubSignIn, suggestUsername} from "../server/utils/github-oauth";

// GitHub 回调三分支决策矩阵（spec §5.2）与用户名建议归一的纯函数单测。

describe("resolveGitHubSignIn", () => {
    it("已绑定且账号可用 → 登录（未登录 / 已登录他人都切到绑定账号）", () => {
        expect(resolveGitHubSignIn({identityUserId: 7, identityUserStatus: "active", currentUserId: null}))
            .toEqual({kind: "login", userId: 7});
        expect(resolveGitHubSignIn({identityUserId: 7, identityUserStatus: "active", currentUserId: 42}))
            .toEqual({kind: "login", userId: 7});
    });

    it("已绑定但账号被封禁 → 拒绝，且不回落到绑定/注册分支", () => {
        expect(resolveGitHubSignIn({identityUserId: 7, identityUserStatus: "disabled", currentUserId: null}))
            .toEqual({kind: "disabled"});
        expect(resolveGitHubSignIn({identityUserId: 7, identityUserStatus: "disabled", currentUserId: 42}))
            .toEqual({kind: "disabled"});
    });

    it("未绑定 + 已登录 → 绑定当前账号", () => {
        expect(resolveGitHubSignIn({identityUserId: null, identityUserStatus: null, currentUserId: 42}))
            .toEqual({kind: "bind", userId: 42});
    });

    it("未绑定 + 未登录 → 进补全注册", () => {
        expect(resolveGitHubSignIn({identityUserId: null, identityUserStatus: null, currentUserId: null}))
            .toEqual({kind: "signup"});
    });
});

describe("suggestUsername", () => {
    it("合法 login 原样保留", () => {
        expect(suggestUsername("notnotype")).toBe("notnotype");
        expect(suggestUsername("a-b_c9")).toBe("a-b_c9");
    });

    it("非法字符转连字符，超长截断到 32", () => {
        expect(suggestUsername("we!rd.name")).toBe("we-rd-name");
        expect(suggestUsername("x".repeat(50))).toHaveLength(32);
    });

    it("过短 login 补后缀达到最小长度", () => {
        expect(suggestUsername("ab")).toBe("ab-user");
    });
});
