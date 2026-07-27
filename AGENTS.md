# AGENTS.md

- 默认使用中文与用户交流。
- 安装依赖使用 `bun`。
- 不要擅自移动项目根目录。
- 重大任务需要更新 `docs/tasks/<NN-task>/README.md`，行为或架构状态变化时同步 `PROJECT-STATUS.md`。
- 前端基础组件优先使用 `@notnotype/nb-ui`，不要在业务组件中重复实现 Dialog、通知、Dropdown、SegmentedControl 或可拖拽面板。
- API 错误文案优先使用 `resolveApiErrorMessage(error, fallback)`。
- 修改代码后只运行与本次变更相关的最小验证；大型浏览器验证需要用户明确要求。
