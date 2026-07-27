import {hashUserPassword} from "../server/utils/password";
import {prisma} from "../server/database/prisma";

type AdminCommand = "create" | "reset";

const adminUsername = process.env.ADMIN_USERNAME?.trim() || "admin";

/** 解析管理员密码管理命令，避免无参数时意外修改账号。 */
function parseCommand(value: string | undefined): AdminCommand {
    if (value === "create" || value === "reset") {
        return value;
    }
    throw new Error("用法：bun run db:admin -- <create|reset>");
}

/** 从标准输入读取密码，确保密码不进入 argv、环境变量或日志。 */
async function readPassword(): Promise<string> {
    if (process.stdin.isTTY) {
        throw new Error("管理员密码必须通过 stdin 传入");
    }

    let input = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) {
        input += chunk;
    }

    const password = input.replace(/\r?\n$/, "");
    if (password.includes("\n") || password.includes("\r")) {
        throw new Error("stdin 只能包含一行管理员密码");
    }
    if (password.length < 16) {
        throw new Error("管理员密码至少需要 16 个字符");
    }
    return password;
}

/** 新建管理员；同名账号存在时拒绝，避免覆盖普通账号或已有管理员。 */
async function createAdmin(password: string): Promise<void> {
    const existing = await prisma.user.findUnique({
        where: {username: adminUsername},
        select: {role: true},
    });
    if (existing) {
        throw new Error(`账号已存在，未修改：${adminUsername}`);
    }

    await prisma.user.create({
        data: {
            username: adminUsername,
            displayName: adminUsername,
            role: "admin",
            passwordHash: await hashUserPassword(password),
        },
    });
    console.log(`已创建管理员：${adminUsername}`);
}

/** 重置现有管理员密码，并递增会话版本使全部旧会话失效。 */
async function resetAdmin(password: string): Promise<void> {
    const existing = await prisma.user.findUnique({
        where: {username: adminUsername},
        select: {id: true, role: true},
    });
    if (!existing) {
        throw new Error(`管理员不存在，未修改：${adminUsername}`);
    }
    if (existing.role !== "admin") {
        throw new Error(`目标账号不是管理员，未修改：${adminUsername}`);
    }

    await prisma.user.update({
        where: {id: existing.id},
        data: {
            passwordHash: await hashUserPassword(password),
            sessionVersion: {increment: 1},
        },
    });
    console.log(`已重置管理员密码并注销旧会话：${adminUsername}`);
}

/** 执行显式的 create/reset 管理命令。 */
async function main(): Promise<void> {
    const command = parseCommand(process.argv[2]);
    const password = await readPassword();
    if (command === "create") {
        await createAdmin(password);
        return;
    }
    await resetAdmin(password);
}

await main();
