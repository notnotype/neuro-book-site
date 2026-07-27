/**
 * 受保护页面的标准路由中间件。未登录跳登录页并携带回跳地址（登录成功后回到原页）。
 */
export default defineNuxtRouteMiddleware(async (to) => {
    const {session, refresh} = useAuthState();
    if (session.value.user) {
        return;
    }

    const loginPath = `/login?redirect=${encodeURIComponent(to.fullPath)}`;
    try {
        await refresh();
    } catch {
        return navigateTo(loginPath);
    }

    if (!session.value.user) {
        return navigateTo(loginPath);
    }
});
