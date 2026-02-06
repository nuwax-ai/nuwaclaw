# DEPRECATED - agent-gpui-client

**⚠️ 此模块已废弃，不再维护。**

## 状态

- **废弃日期**: 2026-02-06
- **替代方案**: 请使用 [agent-tauri-client](../agent-tauri-client)
- **维护状态**: 不再更新，可能无法编译

## 原因

项目已确定使用 Tauri 2.0 + React 作为主要 UI 框架，gpui-client 不再是发展方向。

## 替代方案

所有新功能开发请使用 `agent-tauri-client`：

```bash
# 开发运行
unset CI && make tauri-dev

# 打包发布
unset CI && make tauri-bundle
```

## 目录结构参考

gpui-client 中的某些代码（如 tray 模块）已被移植到 `nuwax-platform` crate，可在跨平台抽象中使用。

## 清理计划

未来版本可能会从代码库中移除此目录。如有需要保留的代码，请迁移到其他位置。
