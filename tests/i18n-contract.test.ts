import {readFileSync, readdirSync, statSync} from "node:fs";
import {join, resolve} from "node:path";
import {describe, expect, it} from "vitest";
import {createPackageDraft} from "../app/utils/workshop-package";
import enUS from "../i18n/locales/en-US";
import zhCN from "../i18n/locales/zh-CN";

const repoRoot = resolve(import.meta.dirname, "..");

/** 把嵌套语言对象展开为稳定键列表。 */
function localeKeys(value: object, prefix = ""): string[] {
    const keys: string[] = [];
    for (const [key, child] of Object.entries(value)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof child === "object" && child !== null && !Array.isArray(child)) {
            keys.push(...localeKeys(child, path));
        } else {
            keys.push(path);
        }
    }
    return keys.sort();
}

/** 递归列出目录内的 Vue/TypeScript 前端源码。 */
function frontendSources(root: string): string[] {
    const files: string[] = [];
    for (const name of readdirSync(root)) {
        const path = join(root, name);
        if (statSync(path).isDirectory()) {
            files.push(...frontendSources(path));
        } else if (path.endsWith(".vue") || path.endsWith(".ts")) {
            files.push(path);
        }
    }
    return files;
}

/** 读取模板中的固定入口文本。 */
function draftText(type: "skill" | "workflow" | "profile", path: string): string {
    const draft = createPackageDraft(type, `demo-${type}`, "1.0.0", "en-US");
    const entry = draft.entries.find((candidate) => candidate.path === path);
    return entry ? new TextDecoder().decode(entry.bytes) : "";
}

describe("site i18n contract", () => {
    it("keeps Simplified Chinese and English locale keys identical", () => {
        expect(localeKeys(enUS)).toEqual(localeKeys(zhCN));
    });

    it("detects a first-visit locale on every no-prefix entry and keeps the site cookie key", () => {
        const config = readFileSync(join(repoRoot, "nuxt.config.ts"), "utf8");
        expect(config).toContain('strategy: "no_prefix"');
        expect(config).toContain('cookieKey: "neuro-book-site-locale"');
        expect(config).toContain('redirectOn: "all"');
    });

    it("creates asset templates in the locale active when the draft is created", () => {
        expect(draftText("skill", "SKILL.md")).toContain("Describe when this Skill should be used.");
        expect(draftText("workflow", "workflow.ts")).toContain('title: "New workflow"');
        expect(draftText("profile", "demo-profile.profile.tsx")).toContain("Write the system prompt here.");
    });

    it("does not let frontend code render raw server messages", () => {
        for (const path of frontendSources(join(repoRoot, "app"))) {
            const source = readFileSync(path, "utf8");
            expect(source, path).not.toContain("resolveApiErrorMessage");
            expect(source, path).not.toMatch(/(?:response\?\.|response\.|error\?\.|error\.)?(?:_data|data)\??\.message/);
        }
    });
});
