import {isRuntimeFlagEnabled} from "../utils/runtime-flag";

/** GitHub OAuth 关闭时在页面挂载前返回登录页；不依赖密码注册开关。 */
export default defineNuxtRouteMiddleware(() => {
    if (!isRuntimeFlagEnabled(useRuntimeConfig().public.githubOAuthEnabled)) {
        return navigateTo("/login", {replace: true});
    }
});
