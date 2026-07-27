import type {AuthSessionDto} from "../../shared/dto/auth.dto";

/**
 * 维护当前用户 session 的轻量客户端状态。
 */
export function useAuthState() {
    const session = useState<AuthSessionDto>("auth-session", () => ({authEnabled: true, user: null}));
    const pending = useState<boolean>("auth-session-pending", () => false);

    async function refresh(): Promise<AuthSessionDto> {
        pending.value = true;
        try {
            session.value = await $fetch<AuthSessionDto>("/api/auth/me");
            return session.value;
        } finally {
            pending.value = false;
        }
    }

    async function logout(): Promise<void> {
        await $fetch("/api/auth/logout", {method: "POST"});
        session.value = {authEnabled: true, user: null};
    }

    return {
        session,
        pending,
        refresh,
        logout,
    };
}
