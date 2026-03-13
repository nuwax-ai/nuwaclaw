# 在 nuwaclaw 仓库启用「仅同步到 OSS」

`sync-oss.sh` 会触发 **nuwax-ai/nuwaclaw** 的 workflow **sync-electron-to-oss.yml**（仅同步、不构建）。

## 一次性操作（在 nuwaclaw 仓库）

把**本仓库**里的这个文件：

```
nuwax-agent/.github/workflows/sync-electron-to-oss.yml
```

**复制到 nuwaclaw 仓库**的相同路径：

```
nuwaclaw/.github/workflows/sync-electron-to-oss.yml
```

然后提交并推送到 nuwaclaw 的默认分支（如 main）。

## 完成后

在本地执行：

```bash
./scripts/sync-oss.sh electron-v0.9.0
```

即可将 GitHub Release 的已有资产同步到 OSS，无需改 nuwaclaw 原有的 `release-electron.yml`。

## 所需 Secrets（nuwaclaw 仓库）

- `GH_PAT` 或使用 repo 默认 token（下载 Release 资产）
- `OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`（上传到阿里云 OSS）
