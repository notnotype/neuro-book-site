import type {PageDto} from "../../../../shared/dto/workshop.dto";
import type {AdminUserDto} from "../../../../shared/dto/admin.dto";
import {prisma} from "../../../database/prisma";
import {buildPage, requireAdmin} from "../../../utils/workshop";
import {AdminUsersQuerySchema} from "../../../utils/admin-dto";
import {validateQuery} from "../../../utils/workshop-dto";

/**
 * admin 用户列表：用户名/昵称模糊搜索 + 分页，按注册时间倒序。
 */
export default defineEventHandler(async (event): Promise<PageDto<AdminUserDto>> => {
    await requireAdmin(event);
    const query = validateQuery(event, AdminUsersQuerySchema);

    const where = query.search
        ? {OR: [{username: {contains: query.search}}, {displayName: {contains: query.search}}]}
        : {};
    const [total, users] = await Promise.all([
        prisma.user.count({where}),
        prisma.user.findMany({
            where,
            orderBy: {createdAt: "desc"},
            skip: query.offset,
            take: query.limit,
            include: {
                _count: {select: {items: true}},
                passportIdentities: {where: {provider: "github"}, select: {id: true}},
            },
        }),
    ]);

    const items = users.map((user): AdminUserDto => ({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        role: user.role,
        status: user.status,
        itemCount: user._count.items,
        hasGithub: user.passportIdentities.length > 0,
        hasPassword: user.passwordHash !== null,
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
    }));
    return buildPage(items, total, query.offset, query.limit);
});
