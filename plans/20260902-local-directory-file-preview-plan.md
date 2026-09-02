# 计划：NuwaClaw 多本地目录文件管理与预览

- 对应规格：`specs/local-directory-file-preview.md`
- 状态：已批准实施（用户，2026-09-02）

1. 主进程实现授权仓库、根边界解析、文件 CRUD/搜索/trash 和安全预览协议，并补单测。
2. 扩展 webview 双边桥类型与 preload，实现 scope、grant 和相对路径协议。
3. nuwax 增加文件数据源模型、目录菜单/面包屑、逐级加载和本地文件操作；浏览器保持项目源。
4. 项目目录 API 接入 `relativePath + recursive=false`；加固并重建 bundled file-server。
5. 跑专项与全量测试、生产构建、dist 和真实 Electron 验收；记录未能完成的平台边界。
