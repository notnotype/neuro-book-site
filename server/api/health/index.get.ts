/** 旧健康路径硬切移除，避免未命中 API 时被 SPA fallback 返回 200。 */
export default defineEventHandler(() => {
    throw createError({statusCode: 404, message: "Not Found"});
});
