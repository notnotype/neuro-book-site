// 测试用最小 profile 样本：仅作为 Workshop 打包 fixture，不参与任何编译。
// 刻意不 import NeuroBook 内部模块，结构上模拟 <key>.profile.tsx + <key>.home/ 的分发形态。

export const profileManifest = {
    key: "mini-writer",
    name: "Mini Writer",
    version: 1,
    description: "Workshop 集成测试用的最小 profile 样本。",
};

export default function MiniWriterProfile(): string {
    return "你是一个最小测试 profile。";
}
