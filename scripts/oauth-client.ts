import {hashUserPassword} from "../server/utils/password";
import {prisma} from "../server/database/prisma";
import {OAUTH_CLIENT_ID, OAUTH_REDIRECT_URI, OAUTH_SCOPE} from "../server/utils/oauth";

/** 从 stdin 读取 client secret；secret 不进入 argv、环境变量、日志或输出。 */
async function readClientSecret(): Promise<string> {
    if (process.stdin.isTTY) {
        throw new Error("OAuth client secret 必须通过 stdin 传入");
    }
    let input = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) {
        input += chunk;
    }
    const secret = input.replace(/\r?\n$/, "");
    if (secret.includes("\n") || secret.includes("\r")) {
        throw new Error("stdin 只能包含一行 OAuth client secret");
    }
    if (secret.length < 32) {
        throw new Error("OAuth client secret 至少需要 32 个字符");
    }
    return secret;
}

function parseCommand(): void {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== "--ensure" || args[1] !== OAUTH_CLIENT_ID) {
        throw new Error(`用法：bun scripts/oauth-client.ts --ensure ${OAUTH_CLIENT_ID}`);
    }
}

/** 幂等创建/更新固定第一方 client；数据库只保存 scrypt 摘要。 */
async function main(): Promise<void> {
    parseCommand();
    const secret = await readClientSecret();
    await prisma.oAuthClient.upsert({
        where: {clientId: OAUTH_CLIENT_ID},
        create: {
            clientId: OAUTH_CLIENT_ID,
            secretHash: await hashUserPassword(secret),
            redirectUri: OAUTH_REDIRECT_URI,
            scopesJson: JSON.stringify([OAUTH_SCOPE]),
            status: "active",
        },
        update: {
            secretHash: await hashUserPassword(secret),
            redirectUri: OAUTH_REDIRECT_URI,
            scopesJson: JSON.stringify([OAUTH_SCOPE]),
            status: "active",
        },
    });
    console.log(`OAuth client ready: ${OAUTH_CLIENT_ID}`);
}

await main();
