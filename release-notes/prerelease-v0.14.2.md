NuwaClaw 0.14.2 (Prerelease)

修复 0.14.1 macOS 启动即崩溃的关键版本。

- 修复 macOS 启动崩溃（Unable to find helper app / 启动即闪退）：包内 CFBundleName 与 Helper 应用命名不一致
- 内置 nuwax-file-server 仍为最新 1.4.7（workspaceType 空间类型定位、git 操作 bug 修复）
- 其余与 0.14.1 相同：应用退出前等待托管进程结束、guest preload 补全宿主身份、productName 统一 ASCII 化
