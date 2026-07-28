# NeuroBook Site

NeuroBook 官方站，提供账号关联、创意工坊和客户端加密云备份。当前按 owner-only 私有内测运行：不开放注册和 GitHub 登录，管理员先创建自己的账号，再用 NeuroBook 完成设备码关联。

技术栈为 Nuxt 4 SPA、Nitro API、Prisma 7/libSQL SQLite 和本地持久文件。生产环境只运行一个应用实例；数据库、工坊压缩包和云备份必须位于同一台主机的持久目录。

## Agent 资产包

Workshop 统一发布 Skill、Workflow 和 Profile。三类资产都以根 `package.json` 为协议真相源，公开版本使用 SemVer：

```json
{
    "name": "example-asset",
    "version": "1.2.3",
    "type": "module",
    "neurobook": {
        "schemaVersion": 1,
        "assetType": "skill",
        "minAppVersion": "0.8.0"
    }
}
```

固定入口为 Skill `SKILL.md`、Workflow `workflow.ts`、Profile `<name>.profile.tsx`。Workflow 不允许声明依赖或使用 `import` / `require`；站点只做静态结构检查，不执行包内代码。详情页可以按版本和路径浏览包文件，发布页在浏览器内编辑完整包。

## 本地开发

依赖已固定到公开 Git commit，不需要 sibling `nb-ui` 或 Bun link。

```powershell
bun install --frozen-lockfile
Copy-Item .env.example .env
$adminInput = Read-Host -MaskInput "设置本地管理员密码（至少 16 位）"
$adminInput | bun run db:setup
Remove-Variable adminInput
bun run dev
```

`db:setup` 只从 stdin 读取管理员密码，不接受密码环境变量，也没有默认密码。账号已存在时该命令保持幂等。

## 验证

```powershell
bun install --frozen-lockfile
bun run typecheck
bun run build
bun run test
```

测试包含真实 build 产物启动、生产配置 fail-closed、私有模式、设备码、Workshop 上传边界、加密备份格式、容量与限频。

旧整数版本与 `nbook-package.json` 的迁移命令默认只报告，不写数据：

```powershell
bun run db:migrate:agent-assets
bun run db:migrate:agent-assets -- --apply
```

必须先应用 `20260728090000_agent_asset_package` 数据库 migration，再执行包迁移。生产环境需要停站、冷快照和单独维护授权，具体顺序见部署文档；不要在当前线上容器直接试跑。

## 生产部署

生产镜像由 GitHub Actions 构建 `linux/amd64` 并推送公开 GHCR。服务器只匿名拉取固定 digest，不在本机编译，也不保存 GitHub Token。

部署步骤、初始化、健康检查、升级与冷快照见 [docs/deployment.md](docs/deployment.md)。部署合同要点：

- Compose 只发布 `127.0.0.1:3100`，由宿主 Nginx 提供 HTTPS。
- 容器以 UID/GID `10001` 非 root 运行，根文件系统只读，`/tmp` 使用 tmpfs。
- `GET /api/health/live` 只检查进程；`GET /api/health/ready` 检查数据库、migration、持久目录和容量状态。
- 容量耗尽时 readiness 返回 `degraded` 和 HTTP 200，新增上传返回 HTTP 507；管理员仍可登录和删除文件。
- 云备份只接受 `.nbbackup` 客户端密文。官方站不知道恢复码，也无法替用户找回密钥。

本仓库公开可读，但当前没有 `LICENSE`，不授予源码使用许可。
