#!/usr/bin/env bun

import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import {createInterface} from "node:readline/promises";
import {stdin, stdout} from "node:process";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {setTimeout as delay} from "node:timers/promises";
import type {Readable} from "node:stream";

const REPOSITORY = "notnotype/neuro-book-site";
const WORKFLOW = "container.yml";
const EXPECTED_BRANCH = "master";
const IMAGE_REPOSITORY = "ghcr.io/notnotype/neuro-book-site";
const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const REMOTE_SCRIPT = resolve(REPO_ROOT, "scripts/deploy/upgrade-dmit.sh");

interface Options {
    dryRun: boolean;
    yes: boolean;
    sshAlias: string;
    workflowTimeoutMs: number;
}

interface GitHubRun {
    conclusion: string | null;
    databaseId: number;
    headSha: string;
    status: string;
    url: string;
}

interface CommandOptions {
    capture?: boolean;
    input?: string;
}

function usage(): string {
    return [
        "用法：bun run deploy:dmit -- [--dry-run] [--yes] [--ssh dmit] [--timeout-minutes 30]",
        "",
        "  --dry-run             只检查本地仓库并展示计划，不 push、不连接服务器",
        "  --yes                 跳过交互确认",
        "  --ssh <alias>         SSH alias，默认 dmit",
        "  --timeout-minutes <n> 等待 GitHub Actions 的分钟数，默认 30",
    ].join("\n");
}

function parseOptions(args: string[]): Options {
    const options: Options = {
        dryRun: false,
        yes: false,
        sshAlias: "dmit",
        workflowTimeoutMs: 30 * 60_000,
    };

    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === "--dry-run") {
            options.dryRun = true;
            continue;
        }
        if (argument === "--yes") {
            options.yes = true;
            continue;
        }
        if (argument === "--help" || argument === "-h") {
            console.log(usage());
            process.exit(0);
        }
        if (argument === "--ssh") {
            options.sshAlias = args[index + 1] ?? "";
            index += 1;
            continue;
        }
        if (argument === "--timeout-minutes") {
            const minutes = Number(args[index + 1]);
            if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) {
                throw new Error("--timeout-minutes 必须是 1 到 120 的整数。");
            }
            options.workflowTimeoutMs = minutes * 60_000;
            index += 1;
            continue;
        }
        throw new Error(`未知参数：${argument}\n${usage()}`);
    }

    if (!/^[A-Za-z0-9._-]+$/.test(options.sshAlias)) {
        throw new Error("SSH alias 只能包含字母、数字、点、下划线和连字符。");
    }
    return options;
}

async function run(command: string, args: string[], options: CommandOptions = {}): Promise<string> {
    const capture = options.capture === true;
    const processHandle = spawn(command, args, {
        cwd: REPO_ROOT,
        stdio: [options.input === undefined ? "inherit" : "pipe", capture ? "pipe" : "inherit", capture ? "pipe" : "inherit"],
        windowsHide: true,
    });

    if (options.input !== undefined) {
        processHandle.stdin?.end(options.input);
    }

    const collect = async (stream: Readable | null): Promise<string> => {
        if (!stream) return "";
        let output = "";
        stream.setEncoding("utf8");
        for await (const chunk of stream) output += chunk;
        return output;
    };
    const [exit, capturedStdout, capturedStderr] = await Promise.all([
        once(processHandle, "exit") as Promise<[number | null, NodeJS.Signals | null]>,
        capture ? collect(processHandle.stdout) : Promise.resolve(""),
        capture ? collect(processHandle.stderr) : Promise.resolve(""),
    ]);
    const [exitCode, signal] = exit;
    if (exitCode !== 0) {
        const detail = capturedStderr.trim() || capturedStdout.trim();
        const termination = exitCode === null ? `signal ${signal ?? "unknown"}` : `exit ${exitCode}`;
        throw new Error(`${command} ${args.join(" ")} 失败（${termination}）${detail ? `：\n${detail}` : ""}`);
    }
    return capturedStdout.trim();
}

async function localPreflight(options: Options): Promise<string> {
    const actualRoot = resolve(await run("git", ["rev-parse", "--show-toplevel"], {capture: true}));
    if (actualRoot.toLocaleLowerCase() !== REPO_ROOT.toLocaleLowerCase()) {
        throw new Error(`脚本必须从 ${REPO_ROOT} 仓库运行。`);
    }

    const branch = await run("git", ["branch", "--show-current"], {capture: true});
    if (branch !== EXPECTED_BRANCH) {
        throw new Error(`只允许从 ${EXPECTED_BRANCH} 推送部署，当前分支是 ${branch || "detached HEAD"}。`);
    }

    const remote = await run("git", ["remote", "get-url", "origin"], {capture: true});
    if (!/(?:github\.com[:/])notnotype\/neuro-book-site(?:\.git)?$/i.test(remote)) {
        throw new Error(`origin 不是 ${REPOSITORY}：${remote}`);
    }

    const dirty = await run("git", ["status", "--porcelain=v1"], {capture: true});
    if (dirty && !options.dryRun) {
        throw new Error("工作区存在未提交改动。脚本不会自动 commit；请先审查并提交后再部署。");
    }
    if (dirty) {
        console.warn("[dry-run] 工作区有未提交改动；真实部署会在这里停止。");
    }

    await run("gh", ["repo", "view", REPOSITORY, "--json", "nameWithOwner", "--jq", ".nameWithOwner"], {capture: true});
    await run("ssh", ["-G", options.sshAlias], {capture: true});
    return await run("git", ["rev-parse", "HEAD"], {capture: true});
}

async function confirmDeployment(commit: string, options: Options): Promise<void> {
    console.log(`仓库：${REPOSITORY}`);
    console.log(`提交：${commit}`);
    console.log(`目标：SSH ${options.sshAlias} / /srv/neuro-book-site`);
    console.log("流程：push → Actions verify/container → GHCR digest → 冷快照 → 升级 → readiness/失败回滚");

    if (options.dryRun) {
        console.log("[dry-run] 未执行任何远端写入。");
        return;
    }
    if (options.yes) return;

    const prompt = createInterface({input: stdin, output: stdout});
    try {
        const answer = await prompt.question("输入 deploy 确认推送并升级：");
        if (answer.trim() !== "deploy") throw new Error("已取消部署。");
    } finally {
        prompt.close();
    }
}

async function waitForWorkflow(commit: string, timeoutMs: number): Promise<GitHubRun> {
    const discoveryTimeoutMs = Math.min(timeoutMs, 2 * 60_000);
    const deadline = Date.now() + discoveryTimeoutMs;
    while (Date.now() < deadline) {
        const payload = await run("gh", [
            "run", "list",
            "--repo", REPOSITORY,
            "--workflow", WORKFLOW,
            "--event", "push",
            "--branch", EXPECTED_BRANCH,
            "--limit", "20",
            "--json", "databaseId,headSha,status,conclusion,url",
        ], {capture: true});
        const runs = JSON.parse(payload) as GitHubRun[];
        const matched = runs.find((runItem) => runItem.headSha === commit);
        if (matched) return matched;
        await delay(3_000);
    }
    throw new Error(`GitHub Actions 在 ${Math.round(discoveryTimeoutMs / 1_000)} 秒内没有出现提交 ${commit} 的 push run。`);
}

async function waitForWorkflowCompletion(runId: number, timeoutMs: number): Promise<GitHubRun> {
    const deadline = Date.now() + timeoutMs;
    let lastStatus = "";
    while (Date.now() < deadline) {
        const payload = await run("gh", [
            "run", "view", String(runId),
            "--repo", REPOSITORY,
            "--json", "databaseId,headSha,status,conclusion,url",
        ], {capture: true});
        const workflow = JSON.parse(payload) as GitHubRun;
        const statusLabel = workflow.conclusion ? `${workflow.status}/${workflow.conclusion}` : workflow.status;
        if (statusLabel !== lastStatus) {
            console.log(`Actions 状态：${statusLabel}`);
            lastStatus = statusLabel;
        }
        if (workflow.status === "completed") {
            if (workflow.conclusion !== "success") {
                await run("gh", ["run", "view", String(runId), "--repo", REPOSITORY, "--log-failed"]);
                throw new Error(`GitHub Actions 未通过：${workflow.url}`);
            }
            return workflow;
        }
        await delay(10_000);
    }
    throw new Error(`等待 GitHub Actions 超过 ${Math.round(timeoutMs / 60_000)} 分钟，DMIT 尚未改动。`);
}

async function resolveImageDigest(commit: string): Promise<string> {
    const tag = `sha-${commit.slice(0, 7)}`;
    const tokenUrl = "https://ghcr.io/token?scope=repository:notnotype/neuro-book-site:pull&service=ghcr.io";
    const manifestUrl = `https://ghcr.io/v2/notnotype/neuro-book-site/manifests/${tag}`;
    const accept = [
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
        "application/vnd.docker.distribution.manifest.v2+json",
    ].join(", ");

    for (let attempt = 0; attempt < 20; attempt += 1) {
        const tokenResponse = await fetch(tokenUrl);
        if (!tokenResponse.ok) throw new Error(`GHCR 匿名 token 请求失败：HTTP ${tokenResponse.status}`);
        const tokenBody = await tokenResponse.json() as {token?: string};
        if (!tokenBody.token) throw new Error("GHCR 匿名 token 响应缺少 token。");

        const response = await fetch(manifestUrl, {
            method: "HEAD",
            headers: {authorization: `Bearer ${tokenBody.token}`, accept},
        });
        const digest = response.headers.get("docker-content-digest") ?? "";
        if (response.ok && /^sha256:[0-9a-f]{64}$/.test(digest)) {
            return `${IMAGE_REPOSITORY}@${digest}`;
        }
        await delay(3_000);
    }
    throw new Error(`Actions 已成功，但 60 秒内无法从公开 GHCR 解析 ${tag} 的不可变 digest。`);
}

async function deployRemote(image: string, commit: string, options: Options): Promise<void> {
    if (!/^ghcr\.io\/notnotype\/neuro-book-site@sha256:[0-9a-f]{64}$/.test(image)) {
        throw new Error(`拒绝非法镜像引用：${image}`);
    }
    const script = await readFile(REMOTE_SCRIPT, "utf8");
    const remoteCommand = `sudo -n bash -s -- ${image} ${commit}`;
    await run("ssh", [
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=10",
        options.sshAlias,
        remoteCommand,
    ], {input: script});
}

async function main(): Promise<void> {
    const options = parseOptions(process.argv.slice(2));
    const commit = await localPreflight(options);
    await confirmDeployment(commit, options);
    if (options.dryRun) return;

    console.log("\n[1/4] 推送 master");
    await run("git", ["push", "origin", "HEAD:master"]);

    console.log("\n[2/4] 等待 GitHub Actions verify/container");
    const workflow = await waitForWorkflow(commit, options.workflowTimeoutMs);
    console.log(`Actions：${workflow.url}`);
    await waitForWorkflowCompletion(workflow.databaseId, options.workflowTimeoutMs);

    console.log("\n[3/4] 解析公开 GHCR digest");
    const image = await resolveImageDigest(commit);
    console.log(`镜像：${image}`);

    console.log("\n[4/4] DMIT 冷快照与升级");
    await deployRemote(image, commit, options);
    console.log("\n推送与升级完成。");
}

try {
    await main();
} catch (error) {
    console.error(`\n部署失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
}
