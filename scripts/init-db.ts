import {hashUserPassword} from "../server/utils/password";
import {prisma} from "../server/database/prisma";

const adminUsername = process.env.ADMIN_USERNAME?.trim() || "admin";

/**
 * 从标准输入读取一次管理员密码。密码不进入 argv、环境变量或日志。
 */
async function readAdminPassword(): Promise<string> {
    if (process.stdin.isTTY) {
        throw new Error("管理员密码必须通过 stdin 传入，例如：printf '%s\\n' \"$PASSWORD\" | bun run db:init");
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

/** 创建默认管理员账号；已存在时保持幂等且不读取 stdin。 */
async function main(): Promise<void> {
    const existing = await prisma.user.findUnique({
        where: {username: adminUsername},
        select: {id: true},
    });
    if (existing) {
        console.log(`Admin user already exists: ${adminUsername}`);
        return;
    }

    const adminPassword = await readAdminPassword();
    await prisma.user.create({
        data: {
            username: adminUsername,
            displayName: adminUsername,
            role: "admin",
            passwordHash: await hashUserPassword(adminPassword),
        },
    });
    console.log(`Created admin user: ${adminUsername}`);
}

await main();
