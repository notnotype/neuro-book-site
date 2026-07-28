import {prisma} from "../server/database/prisma";
import {maintainAgentAssetArchives} from "../server/utils/agent-asset-maintenance";

/** 归档维护默认执行只读 preflight；只有显式 --apply 才修改持久数据。 */
async function main(): Promise<void> {
    const apply = process.argv.includes("--apply");
    if (apply && process.argv.includes("--preflight")) {
        throw new Error("--apply 与 --preflight 不能同时使用");
    }
    const report = await maintainAgentAssetArchives(apply);
    for (const action of report.actions) {
        console.log(`${apply ? "apply" : "preflight"} ${action}`);
    }
    console.log(JSON.stringify({mode: apply ? "apply" : "preflight", ...report}));
}

try {
    await main();
} finally {
    await prisma.$disconnect();
}
