import {prisma} from "../../../../../database/prisma";
import {requireAdmin, requireIdParam} from "../../../../../utils/workshop";
import {AdminUserRoleRequestSchema} from "../../../../../utils/admin-dto";
import {validateBody} from "../../../../../utils/dto";
import {apiError} from "../../../../../utils/api-error";

/**
 * admin 授予 / 收回管理员角色。
 * 禁止操作自己：防止最后一个管理员把自己降级导致后台失守。
 * 变更同时 sessionVersion+1 踢线强制重登：session 里的 role 是快照，不踢线会出现
 * 降级后前端仍显示 admin 入口（请求全 403）的撕裂状态。
 */
export default defineEventHandler(async (event): Promise<{ok: true}> => {
    const admin = await requireAdmin(event);
    const id = requireIdParam(event);
    const body = await validateBody(event, AdminUserRoleRequestSchema);

    if (id === admin.id) {
        throw apiError(400, "self_role_change_forbidden", "Cannot change your own role");
    }
    const target = await prisma.user.findUnique({where: {id}, select: {id: true, sessionVersion: true}});
    if (!target) {
        throw apiError(404, "user_not_found", "User not found");
    }

    await prisma.user.update({
        where: {id},
        data: {role: body.role, sessionVersion: target.sessionVersion + 1},
    });
    return {ok: true};
});
