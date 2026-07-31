import {afterEach, describe, expect, it, vi} from "vitest";
import type {AuthSessionDto} from "../../shared/dto/auth.dto";
import {useAuthState} from "./useAuthState";

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("useAuthState", () => {
    it("applies an auth mutation response without issuing another request", () => {
        const states = new Map<string, {value: unknown}>();
        const fetchMock = vi.fn();
        vi.stubGlobal("useState", (key: string, factory: () => unknown) => {
            const state = states.get(key) ?? {value: factory()};
            states.set(key, state);
            return state;
        });
        vi.stubGlobal("$fetch", fetchMock);

        const auth = useAuthState();
        const session: AuthSessionDto = {
            authEnabled: true,
            user: {
                id: "42",
                username: "demo_user",
                displayName: "示例用户",
                avatarUrl: "",
                role: "user",
                sessionVersion: 1,
            },
        };
        auth.applySession(session);

        expect(auth.session.value).toEqual(session);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
