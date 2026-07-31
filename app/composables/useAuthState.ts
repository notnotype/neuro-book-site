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

    /** 应用登录或注册接口返回的权威 session，避免成功后再发一次可能失败的读取请求。 */
    function applySession(nextSession: AuthSessionDto): void {
        session.value = nextSession;
    }

    async function logout(): Promise<void> {
        await $fetch("/api/auth/logout", {method: "POST"});
        session.value = {authEnabled: true, user: null};
    }

    return {
        session,
        pending,
        applySession,
        refresh,
        logout,
    };
}
