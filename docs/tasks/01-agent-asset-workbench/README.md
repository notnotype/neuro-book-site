# Task 01: Agent Asset Workbench

## User Request / Topic

- 把 NeuroBook 文件树的通用交互抽到 `@notnotype/nb-ui`，供官方站资产详情与发布页复用。
- 让 Skill、Workflow、Profile 使用同一 Agent 资产包外壳，并把公开版本统一为 SemVer。
- 建立可浏览、可编辑、可验证的发布资产工作台；本任务不实现 NeuroBook 客户端安装、更新、冲突处理或回滚。
- 所有站点开发从 `origin/master` 创建本地 `dev`，验证后只推送 `dev`；不合并 `master`，不部署生产环境。

## Goal

- 详情页提供可分享 URL 的 GitHub 式文件树浏览。
- 发布页提供内存态完整包编辑器，覆盖目录导入、文本编辑和树结构操作。
- 根 `package.json` 成为资产类型、安装名、版本与兼容性的唯一真相源。
- 旧整数版本和 `nbook-package.json` 可通过幂等迁移转换为新合同。
- 站点依赖固定到已发布的 `nb-ui` commit，不依赖本地 link。

## Final State

- 站点支持 `skill | workflow | profile`，公开版本为 canonical SemVer 字符串。
- 数据库使用 `version` 保存公开版本、`ordinal` 负责排序和 ZIP 寻址，并分别保证同一资产下两者唯一。
- 详情页以文件树、目录面包屑和文件内容区浏览任意版本；URL 保存 tab、版本与路径状态。
- `/publish` 创建新资产，`/publish/:slug` 克隆作者已有版本并发布更新。
- 发布工作台以内存草稿统一维护元数据和完整文件包，支持文本编辑、目录操作、文件/目录/ZIP 导入及 ZIP 导出。
- 迁移工具默认 dry-run，只有 `--apply` 才修改 ZIP 和数据库；生产迁移尚未执行。

## Decisions / Discussion

### Unified Package Contract

- 唯一清单为根 `package.json`；`neurobook.schemaVersion = 1`，`assetType` 为 `skill | workflow | profile`。
- 固定入口分别为 `SKILL.md`、`workflow.ts`、`<name>.profile.tsx`。
- `name` 必须为 kebab-case，`version` 与可选 `minAppVersion` 必须是 canonical SemVer。
- 新版本的 SemVer precedence 必须严格大于当前版本，只有 build metadata 变化的版本会被拒绝。
- Workflow 禁止依赖、`import`、动态 `import()`、`export from` 和 `require`；站点只解析结构，不执行用户代码。
- Skill 继续允许 `dependencies`、`scripts`、`bin` 和 `bun.lock`，并保留 frozen-lockfile 生命周期合同。
- 路径验证拒绝绝对路径、反斜杠、`.`、`..`、NUL、Windows 保留名、尾随空格或点，以及大小写折叠冲突。
- 统一门禁为最多 500 条目、最多 100 MiB 解压内容、最终 ZIP 不超过 20 MiB。

### Public Version And API Contract

- `WorkshopItemType` 增加 `workflow`，所有公开 DTO 的版本字段改为 SemVer 字符串。
- 文件列表、文件预览和下载使用 URL 编码后的 SemVer `version` 查询参数。
- `/api/v1/meta` 输出 `packageSchemaVersion: 1` 和三种资产类型，不再输出旧 manifest version。
- 新增作者源包接口 `GET /api/v1/me/items/:slug/package?version=`；作者可读取自己的 unlisted/removed 资产，且不会增加公开下载计数。
- 上传锁内重新读取当前最新 ordinal 和版本，避免并发请求在锁外使用过期判断。

### Migration

- 旧版本 `N` 原地映射为 `N.0.0`，ordinal 仍为 `N`，旧 ZIP 文件名无需改动。
- 旧 `nbook-package.json` 与已有 `package.json` 合并；安装依赖、脚本和命令等作者字段继续保留，旧清单从 ZIP 删除。
- ZIP 替换使用同目录临时文件和原子 rename，随后更新大小、SHA-256 与 `packageSchemaVersion`。
- 数据库更新失败时恢复原 ZIP；已迁移版本和重复执行不会再次修改文件。
- `bun run db:migrate:agent-assets` 为 dry-run，`bun run db:migrate:agent-assets -- --apply` 才实际迁移。

### File Tree And Workbench

- `nb-ui` 提供受控 `FileTree` / `FileTreeNode`，负责树语义、展开、选择、激活、键盘、焦点、可选移动、右键事件和节点 slot。
- 组件事件包含 `update:expandedIds`、`select`、`activate`、`move`、`contextmenu`，移动位置为 `before | after | inside | root`。
- 业务数据修改、Project Workspace 元数据和 NeuroBook 专属状态仍留在各自适配层。
- 站点详情页在桌面使用树与内容双栏，移动端使用可折叠树；客户端从最多 500 条的平面清单构树。
- 文本文件在线预览；二进制和超限文本只显示大小等元信息。
- 工作台使用 CodeMirror 编辑文本；二进制内容可保留、移动、改名、删除和重新导出，但不尝试在线编辑。
- `package.json` 是类型、安装名和版本的唯一真相，patch/minor/major/custom 控件结构化更新该文件并保留其它字段。
- 新资产默认 `1.0.0`；更新默认克隆最新版并建议 patch。切换类型需确认，并按新类型重建模板。
- 草稿只存在当前浏览器内存，元数据或文件有未发布修改时离开页面会明确确认。

## Implementation Walkthrough

### 2026-07-28

- 从当时最新 `origin/master` 提交 `17dc3ba` 创建本地 `dev`；未修改或部署生产环境。
- 在 `nb-ui` 实现 FileTree，完成 54 项测试、typecheck 和 build；提交 `0436234` 后以 `291b2d6` 补齐导出样式并推送 `main`。
- 站点将 `@notnotype/nb-ui` 固定为 `291b2d6b49c4e92557eb305a1ffa38370644a5ce`，重建 `bun.lock`，未使用本地 link。
- 新增统一 Agent 资产包解析与验证，完成三种入口、SemVer、Workflow 静态限制、路径安全和 ZIP 限额合同。
- 完成 Prisma 模型、SemVer API、作者源包 API、并发版本发布和运行镜像内迁移工具。
- 用完整包工作台替换单入口编辑器；详情页接入 FileTree 并实现 URL 可恢复的文件浏览。
- 更新站点 README、部署文档、历史 Web UI 任务说明和 `PROJECT-STATUS.md`。
- 在 NeuroBook 脏工作区定点新增统一协议参考，并更新相关 Skill/Workshop task 交叉链接；没有 stage、commit 或覆盖其它用户改动。

## Verification / Test

### nb-ui

- `54` 项测试通过，覆盖展开/收起、选择、激活、键盘导航、四种移动位置、受控状态和 slot。
- typecheck 通过。
- build 通过。

### neuro-book-site

- `bun run typecheck` 通过。
- `bun run test` 通过：`18` 个测试文件、`125` 项测试。
- `bun run build` 通过。
- `node dist/migrate-agent-assets.mjs` 在空 SQLite 数据库真实执行通过，输出 `Dry run found 0 version(s).`。
- 迁移集成测试覆盖真实 SQLite 与 ZIP 的映射、合并、摘要更新、幂等和失败回滚。

### Browser Acceptance

- 使用 `$playwright-cli` 在仓库外隔离数据目录发布 slug `111` 的 Workflow `1.0.0`，再从 `/publish/111` 克隆并发布 `1.0.1`。
- 桌面端验证根目录、子目录、文本预览、分享 URL、刷新、前进后退、SemVer 切换；文件预览前后下载计数保持 `0`。
- 移动端 `390 x 844` 验证文件树折叠、缺失 version 自动规范化、二进制元信息和无水平溢出。
- 最终浏览器审计为 `0` console error、`0` console warning，相关业务请求均为 HTTP `200`。

### Linux Container

- 本机无 Docker CLI，因此在 `arch` 的一次性临时目录构建 `linux/amd64` 镜像；未连接 DMIT 或生产站点。
- Docker legacy builder 完成 frozen install、Nuxt/Prisma build 和运行时工具打包，镜像 ID 为临时验证值 `512d6e7681d0`。
- 镜像检查结果为 `amd64/linux`，配置用户与短命容器实际用户均为 `10001:10001`。
- 确认 `/app/dist/migrate-agent-assets.mjs` 和对应 Prisma migration 存在，运行 `node --check` 通过。
- 验证完成后已删除 `arch` 上的测试镜像和精确临时目录；没有部署、运行或推送该镜像。

## Deviations From Plan

- 计划中的两个发布页面由一个 Nuxt 可选参数页面 `app/pages/publish/[[slug]].vue` 承载，仍同时提供 `/publish` 和 `/publish/:slug`，避免重复宿主逻辑。
- 最初将 Playwright 测试 ZIP 放在仓库内 `.agent` 时，Nuxt watcher 因文件写入触发热重载，表现为发布后页面状态重置。隔离数据移到仓库外 Temp 后流程稳定，确认不是产品导航缺陷。
- `arch` 未安装 buildx，容器验证使用 Docker legacy builder；目标架构、镜像 build、非 root 用户和运行时工具检查仍全部完成。
- 本任务没有实现 NeuroBook 客户端的安装、更新检测、冲突处理或回滚，因此尚不能把统一包协议标记为端到端可用。
- 生产数据库/ZIP 迁移、站点部署和 DMIT 配置均未执行，仍需单独授权和维护窗口。

## Changed Areas

- `shared/agent-asset-package.ts`：统一包协议和共享常量。
- `server/utils/workshop-package.ts`、Workshop API 与 DTO：包验证、SemVer 和三类资产合同。
- `server/utils/agent-asset-migration.ts`、`scripts/migrate-agent-assets.ts`、Prisma migration：旧包迁移。
- `app/components/AgentAssetWorkbench.vue`：完整包发布工作台。
- `app/components/PackageFileBrowser.vue`：详情页文件树和预览。
- `app/pages/publish/[[slug]].vue`：新建与更新发布入口。
- `README.md`、`docs/deployment.md`、`PROJECT-STATUS.md`：使用、迁移与当前状态。

## TODO / Follow-ups

- [ ] 单独审批生产停站、冷快照、数据库 migration 和 Agent 资产包 dry-run/apply。
- [ ] 在 NeuroBook 客户端实现 Workshop 安装、更新检测、冲突处理和回滚。
- [ ] 客户端能力完成后再进行真实站点到 NeuroBook 的端到端验收。
