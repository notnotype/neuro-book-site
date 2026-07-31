import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";

type RouteMiddleware = () => unknown;

let registrationEnabled: RouteMiddleware;
let githubOAuthEnabled: RouteMiddleware;
let publicConfig = {registrationEnabled: false, githubOAuthEnabled: false};
const navigateMock = vi.fn((path: string, options?: {replace?: boolean}) => ({path, options}));

beforeAll(async () => {
    vi.stubGlobal("defineNuxtRouteMiddleware", (middleware: RouteMiddleware) => middleware);
    vi.stubGlobal("useRuntimeConfig", () => ({public: publicConfig}));
    vi.stubGlobal("navigateTo", navigateMock);
    registrationEnabled = (await import("./registration-enabled")).default as RouteMiddleware;
    githubOAuthEnabled = (await import("./github-oauth-enabled")).default as RouteMiddleware;
});

afterAll(() => {
    vi.unstubAllGlobals();
});

describe("registration route feature gates", () => {
    it.each([
        {registration: false, github: false, registrationRedirect: true, githubRedirect: true},
        {registration: true, github: false, registrationRedirect: false, githubRedirect: true},
        {registration: false, github: true, registrationRedirect: true, githubRedirect: false},
        {registration: true, github: true, registrationRedirect: false, githubRedirect: false},
    ])("keeps password registration and GitHub OAuth independent: %o", (testCase) => {
        publicConfig = {registrationEnabled: testCase.registration, githubOAuthEnabled: testCase.github};
        navigateMock.mockClear();

        const registrationResult = registrationEnabled();
        const githubResult = githubOAuthEnabled();

        expect(Boolean(registrationResult)).toBe(testCase.registrationRedirect);
        expect(Boolean(githubResult)).toBe(testCase.githubRedirect);
        for (const call of navigateMock.mock.calls) {
            expect(call).toEqual(["/login", {replace: true}]);
        }
    });
});
