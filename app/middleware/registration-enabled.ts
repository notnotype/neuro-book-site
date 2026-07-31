import {isRuntimeFlagEnabled} from "../utils/runtime-flag";

/** 密码注册关闭时在页面挂载前返回登录页，避免注册表单短暂闪现。 */
export default defineNuxtRouteMiddleware(() => {
    if (!isRuntimeFlagEnabled(useRuntimeConfig().public.registrationEnabled)) {
        return navigateTo("/login", {replace: true});
    }
});
