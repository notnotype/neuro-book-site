// Agent 资产包的跨端基础合同。服务端负责严格解析，浏览器工作台消费同一组类型与入口规则。

export const AGENT_ASSET_PACKAGE_SCHEMA_VERSION = 1 as const;

export const AGENT_ASSET_TYPES = ["skill", "workflow", "profile"] as const;

export type AgentAssetType = (typeof AGENT_ASSET_TYPES)[number];

export type AgentAssetPackageJson = {
    name: string;
    version: string;
    type: "module";
    neurobook: {
        schemaVersion: typeof AGENT_ASSET_PACKAGE_SCHEMA_VERSION;
        assetType: AgentAssetType;
        minAppVersion?: string;
    };
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    bin?: string | Record<string, string>;
    scripts?: Record<string, string>;
};

/** 返回资产包固定入口的相对路径。 */
export function assetEntryPath(assetType: AgentAssetType, name: string): string {
    if (assetType === "skill") {
        return "SKILL.md";
    }
    if (assetType === "workflow") {
        return "workflow.ts";
    }
    return `${name}.profile.tsx`;
}

/** Workflow 包不能声明任何 Node/Bun 依赖。 */
export function hasRuntimeDependencies(packageJson: AgentAssetPackageJson): boolean {
    return [
        packageJson.dependencies,
        packageJson.devDependencies,
        packageJson.peerDependencies,
        packageJson.optionalDependencies,
    ].some((dependencies) => dependencies !== undefined && Object.keys(dependencies).length > 0);
}

/** Skill 脚本/依赖、Workflow 和 Profile 都需要在发布前提示用户它们包含可执行代码。 */
export function packageRunsCode(packageJson: AgentAssetPackageJson): boolean {
    if (packageJson.neurobook.assetType !== "skill") {
        return true;
    }
    return hasRuntimeDependencies(packageJson)
        || (packageJson.scripts !== undefined && Object.keys(packageJson.scripts).length > 0)
        || packageJson.bin !== undefined;
}
