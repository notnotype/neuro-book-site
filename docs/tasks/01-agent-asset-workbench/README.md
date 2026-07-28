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
- 首次发布使用可恢复的两步流程：先创建作者可见的无版本草稿，再上传首版；首版成功前不会进入任何公开面。
- 归档先 fsync 并原子落位，版本、元数据、风险字段和目标状态随后在一个数据库事务提交；数据库记录不再先于 ZIP 出现。
- 浏览器与服务端共享协议规则，分别使用 `fflate` 与 `yauzl` 的有界 ZIP 适配器；服务端上传、迁移、列表和预览不再使用整包无界解压。
- 迁移工具默认执行只读 preflight，只有 `--apply` 才修改 ZIP 和数据库；部署脚本与容器 entrypoint 已接入 guard，但生产迁移尚未执行。

## Decisions / Discussion

### Unified Package Contract

- 唯一清单为根 `package.json`；`neurobook.schemaVersion = 1`，`assetType` 为 `skill | workflow | profile`。
- 固定入口分别为 `SKILL.md`、`workflow.ts`、`<name>.profile.tsx`。
- `package.json.name` 是唯一安装身份，不新增 `assetKey`。Skill / Workflow 使用 kebab-case；Profile 允许 `leader.default` 形式的点分 key，每段允许连字符。
- 新版本的 SemVer precedence 必须严格大于当前版本，只有 build metadata 变化的版本会被拒绝。
- Workflow 必须直接 default export 静态对象，`key` 等于包名并直接声明 `run`；AST 拒绝语法错误、静态/动态 import、import-equals、export-from 和直接 `require()`。站点不执行用户代码。
- Skill 的 `SKILL.md` 必须提供合法 YAML frontmatter，非空 `name` / `description` 且 name 与包名一致。
- 只有 Skill 可声明 Bun 安装字段、`scripts` 和 `bin`；这些字段存在实际内容时必须携带非空 `bun.lock`。
- Profile 在站点只检查合法 TSX 与 default export。未来客户端编译后还必须确认 `profileManifest.key === package.json.name`。
- 三类入口默认限制 1 MiB；浏览器仅在 Workflow / Profile 编辑时懒加载 TypeScript，普通详情浏览不加载编译器。
- 路径验证拒绝绝对路径、反斜杠、`.`、`..`、NUL、Windows 保留名、尾随空格或点，以及大小写折叠冲突。
- 统一门禁为最多 500 条目、最多 100 MiB 解压内容、最终 ZIP 不超过 20 MiB。
- 站点 AST 检查只是发布质量门禁，不是安全沙箱；NeuroBook 第三方 Workflow 自动安装继续关闭。

### Public Version And API Contract

- `WorkshopItemType` 增加 `workflow`，所有公开 DTO 的版本字段改为 SemVer 字符串。
- 文件列表、文件预览和下载使用 URL 编码后的 SemVer `version` 查询参数。
- `/api/v1/meta` 输出 `packageSchemaVersion: 1` 和三种资产类型，不再输出旧 manifest version。
- 新增作者源包接口 `GET /api/v1/me/items/:slug/package?version=`；作者可读取自己的 unlisted/removed 资产，且不会增加公开下载计数。
- 上传锁内重新读取当前最新 ordinal 和版本，避免并发请求在锁外使用过期判断。
- 显式指定不存在的 SemVer 返回 404；只有未提供 `version` 时选择最新版，合法 `+build` query 保真。
- DTO 增加服务端计算的 `containsExecutableCode`；Workflow / Profile 恒为 true，Skill 按脚本、命令和 Bun 安装输入判断。

### Migration

- 旧版本 `N` 原地映射为 `N.0.0`，ordinal 仍为 `N`，旧 ZIP 文件名无需改动。
- 旧 `nbook-package.json` 与已有 `package.json` 合并；安装依赖、脚本和命令等作者字段继续保留，旧清单从 ZIP 删除。
- ZIP 迁移使用确定性的 `.agent-asset-<versionId>.tmp` / `.backup`；恢复方向由 schema、数据库摘要和正式文件共同证明，歧义状态直接停止。
- schema 0 先恢复与旧数据库摘要一致的 backup，再重跑迁移；schema 1 必须由正式文件匹配数据库摘要，之后才可清理 sidecar。
- 迁移前后都通过有界 ZIP 校验，并更新大小、SHA-256、`packageSchemaVersion` 与代码风险字段；已迁移版本和重复执行不会再次改写。
- `bun run db:migrate:agent-assets` 为只读 preflight，`bun run db:migrate:agent-assets -- --apply` 才实际迁移。

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
- 新建条目成功后先用客户端路由切到 `/publish/:slug`，保留当前内存包再上传首版；上传失败停在同一草稿页，刷新后按条目身份重建可重试模板。
- 安装名编辑会同步固定入口身份：Skill frontmatter name、Workflow 静态 key、Profile 入口文件名和可识别的 `profileManifest.key`，并用 revision 防止连续输入的异步校验覆盖新值。
- 目录、文件和 ZIP 导入先完整验证到临时结果，成功后才替换内存草稿；二进制字节保持原样。

### Publication Consistency And Runtime Gate

- `POST /api/v1/items` 只创建 `unlisted` 无版本草稿；公开列表、公开详情、作者公开页、作者状态修改和 admin 上架都拒绝空条目。
- 作者可通过 `DELETE /api/v1/me/items/:slug/draft` 删除自己的无版本草稿并释放 slug；已有版本、非作者和 admin 代删均不走该入口。
- 版本上传的 multipart 固定包含 `file`、`changelog` 与可选 JSON `metadata`。首版在事务内写入安装名并自动发布，后续版本在同一事务更新元数据与目标状态。
- 临时归档验证完成后执行文件 fsync，再用同盘 hard link + unlink 原子落位且拒绝覆盖目标，之后才创建版本数据库记录；数据库失败删除最终文件。启动与下次上传只清理可证明的数据库外孤儿文件，数据库有记录但正式文件缺失时 fail closed。
- DMIT 升级脚本在停站前以只读 data volume 运行目标镜像 preflight；冷快照后由新镜像 entrypoint 依次执行 Prisma migration、Agent 资产 apply guard，再启动 Nitro。
- readiness 只检查 schema、正式文件存在/大小和 sidecar，不反复读取全部 ZIP 计算 SHA；完整摘要与有界解包放在 preflight/startup。

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

### 2026-07-29 Systematic Closure

- 将包 schema、按类型命名、canonical SemVer、固定入口、Bun 安装输入、锁文件、风险字段、源码与路径限制集中到 `shared/agent-asset-package.ts`；新增 `yaml`、`yauzl`，并把 TypeScript 固定为服务端生产依赖 `5.9.3`。
- 用 TypeScript AST 替换 Workflow 正则；补齐 Skill frontmatter、Profile default export、三类真实模板和浏览器安装身份同步。SemVer canonical 检查改为解析后重建，合法 `1.1.0+build.1` 不再被误拒绝。
- 服务端新增 `yauzl` lazy-entry 适配器，按真实输出累计解压量并拒绝 symlink/特殊文件；上传、迁移、文件列表与 200 KiB 预览统一走该适配器。浏览器导入保持 `fflate`，失败只丢弃候选结果，不污染现有草稿。
- 新增独立 Prisma migration `20260729090000_agent_asset_publish_integrity`，保持既有 migration checksum 不变；无版本草稿默认 unlisted，版本记录新增持久风险字段。
- 新增首版草稿删除、首版成功前公开面/状态门禁、multipart metadata 原子提交、归档先落盘后数据库事务，以及启动/上传的可证明孤儿清理。
- 迁移 sidecar 改为确定性命名，补 schema 0/1 恢复矩阵、只读 preflight、entrypoint apply guard 与 readiness 轻量检查；DMIT 升级脚本在停站前用目标镜像和只读数据卷运行 preflight。
- 真实 Nitro 首次暴露 Windows 对只读句柄执行 `fsync` 返回 `EPERM`；临时归档句柄改为 `r+`，Linux 的 fsync 语义不变，并新增真实文件原子落位测试。
- 真实浏览器暴露安装名只更新 `package.json`、未同步类型入口身份的问题；新增按类型同步和 revision 竞态保护，并让同步后的三类包重新经过共享解析器验证。
- 最终提交审查补齐中央目录伪造边界：服务端完整扫描后的单条目大小改用实际输出，空 `bun.lock` 不能再伪造声明大小绕过；浏览器拒绝带实际内容的目录条目。版本归档落位从“检查后 rename”改为原子拒绝覆盖，消除 helper 自身的 TOCTOU 窗口。
- NeuroBook 主仓协议补充安装身份 ADR。计划编号 `0009` 已被同一脏工作区的 Product Runtime ADR 占用，且已有 `0010`，因此使用下一个空号 `0011`；没有重编号或覆盖无关 ADR。

## Verification / Test

### nb-ui

- `54` 项测试通过，覆盖展开/收起、选择、激活、键盘导航、四种移动位置、受控状态和 slot。
- typecheck 通过。
- build 通过。

### neuro-book-site

- `bun run typecheck` 通过。
- `bun x vitest run --exclude ".agent/**"` 通过：`21` 个测试文件、`144` 项测试。
- `bun run build` 通过。
- 真实 HTTP 集成覆盖 API v1 `25/25`，全组 Passport / Backup / Account / Admin 共 `61/61`；测试进程主动 drain Nitro stdout/stderr，避免 Pino pipe 背压制造尾部假超时。
- 迁移集成测试覆盖真实 SQLite 与 ZIP 的映射、合并、摘要更新、确定性 sidecar、幂等、preflight 零写入和失败恢复。
- 最终 build 确认 Nitro 从生产依赖加载 TypeScript `5.9.3`；浏览器端 TypeScript 保持动态 chunk，不进入普通文件浏览入口。

### Browser Acceptance

- 使用 `$playwright-cli 0.1.17` 和仓库外隔离数据目录，真实发布 Skill `111`、Workflow `112` 与点分安装身份 Profile `leader.default`；三类同步后的入口均被服务端接受。
- Skill 详情验证文件树、`?tab=files&version=1.0.0&path=SKILL.md` 分享 URL、刷新和前进/后退恢复；显式 `version=9.9.9` 只显示“指定版本不存在”，不残留旧文件投影。
- Workflow 模板确认直接 default export `{key, run}`，安装名修改会同步静态 key；Profile 确认入口重命名为 `leader.default.profile.tsx` 并同步 `profileManifest.key`。
- 用 Playwright route 仅拦截首次 `/versions` 上传并返回 503：条目先无刷新进入 `/publish/failure-retry`，保留可重试草稿；刷新后从无版本条目重建模板，解除拦截即可成功发布。
- 移动端 `390 x 844` 验证详情文件树折叠和完整发布工作台；`innerWidth`、document/body `scrollWidth` 均为 `390`，无水平溢出。
- 最终页面审计为 `0` console error、`0` console warning。测试过程中不存在版本的 404 和主动模拟的 503 分别产生预期网络错误，离开对应页面后无残留异常。

### Linux Container

- 本机无 Docker CLI，因此在 `arch` 的一次性临时目录构建 `linux/amd64` 镜像；未连接 DMIT 或生产站点。
- production install 包含 TypeScript `5.9.3`；镜像与实际容器用户均为 `10001:10001`，根文件系统只读、`/tmp` 可写、内存限制 `768 MiB`。
- schema 0 只读数据卷 preflight 正确报告迁移动作，数据库与 ZIP 在 preflight 前后 SHA-256 完全一致。
- 空数据卷 entrypoint 应用 9 个 Prisma migration、执行 Agent 资产 apply guard，readiness 全部 `ok`；强制重建后数据仍在且无待应用 migration。
- 容器矩阵完成后才补浏览器端安装身份同步；该修复不改变服务端、entrypoint 或容器约束，最终生产 build 已在修复后重跑，但没有把早于前端修复的容器证据描述为最终镜像逐字节复验。
- 验证完成后已删除 `arch` 上的测试镜像、容器和精确临时目录；没有部署、运行或推送该镜像。

## Deviations From Plan

- 计划中的两个发布页面由一个 Nuxt 可选参数页面 `app/pages/publish/[[slug]].vue` 承载，仍同时提供 `/publish` 和 `/publish/:slug`，避免重复宿主逻辑。
- 最初将 Playwright 测试 ZIP 放在仓库内 `.agent` 时，Nuxt watcher 因文件写入触发热重载，表现为发布后页面状态重置。隔离数据移到仓库外 Temp 后流程稳定，确认不是产品导航缺陷。
- `arch` 未安装 buildx，容器验证使用 Docker legacy builder；目标架构、镜像 build、非 root 用户和运行时工具检查仍全部完成。
- 安装身份 ADR 原计划使用编号 `0009`，但 NeuroBook 主仓脏工作区已存在另一份 `0009` 且 `0010` 也已占用；实际使用 `0011`，避免重编号或覆盖无关工作。
- 容器矩阵早于最后的浏览器端安装身份同步修复；修复后重跑了全量测试、typecheck 和生产 build，没有重复不受该前端改动影响的远端运行约束矩阵。
- 本任务没有实现 NeuroBook 客户端的安装、更新检测、冲突处理或回滚，因此尚不能把统一包协议标记为端到端可用。
- 生产数据库/ZIP 迁移、站点部署和 DMIT 配置均未执行。代码已把只读 preflight、冷快照后的 entrypoint apply 和失败整数据回滚接入普通升级路径，但实际升级仍需单独授权。

## Changed Areas

- `shared/agent-asset-package.ts`：统一包协议和共享常量。
- `server/utils/agent-asset-archive.ts`、`workshop-package.ts`、Workshop API 与 DTO：有界 ZIP、包验证、SemVer 和三类资产合同。
- `server/utils/workshop-version-publisher.ts`、Workshop files/API：归档先持久化、数据库事务与草稿发布门禁。
- `server/utils/agent-asset-migration.ts`、`agent-asset-maintenance.ts`、`scripts/migrate-agent-assets.ts`、Prisma migration：旧包迁移、恢复和运行 guard。
- `app/components/AgentAssetWorkbench.vue`：完整包发布工作台。
- `app/components/PackageFileBrowser.vue`：详情页文件树和预览。
- `app/pages/publish/[[slug]].vue`：新建与更新发布入口。
- `docker/entrypoint.sh`、`scripts/deploy/upgrade-dmit.sh`、readiness：部署 preflight、apply 和轻量健康门禁。
- `docs/deployment.md`、`PROJECT-STATUS.md`：迁移运行手册与当前状态。

## TODO / Follow-ups

- [ ] 单独审批并执行包含只读 preflight、冷快照、数据库 migration、归档 apply 和失败回滚的 DMIT 升级。
- [ ] 在 NeuroBook 客户端实现 Workshop 安装、更新检测、冲突处理和回滚。
- [ ] 在允许第三方 Workflow 自动安装前完成执行隔离威胁模型与 ADR，不能复用站点 AST 检查作为安全证明。
- [ ] 客户端能力完成后再进行真实站点到 NeuroBook 的端到端验收。
