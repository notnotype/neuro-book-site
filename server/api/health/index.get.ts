import {apiError} from "../../utils/api-error";

/** 旧健康路径硬切移除，避免未命中 API 时被 SPA fallback 返回 200。 */
export default defineEventHandler(() => {
    throw apiError(404, "not_found", "Not Found");
});
