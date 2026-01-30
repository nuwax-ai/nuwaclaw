# RustDesk Server 本地部署

用于 nuwax-agent 本地开发测试的 RustDesk 服务器（hbbs + hbbr）。

## 快速开始

### 1. 启动服务

```bash
# 进入目录
cd docker/rustdesk-server

# 启动服务（后台运行）
docker compose up -d

# 查看日志
docker compose logs -f

# 查看状态
docker compose ps
```

### 2. 获取公钥

首次启动后，服务会在 `data/` 目录生成密钥文件：

```bash
# 查看公钥（客户端需要配置此公钥）
cat data/id_ed25519.pub
```

### 3. 配置客户端

在 nuwax-agent 中配置服务器地址：

```toml
# ~/.config/nuwax-agent/config.toml
[server]
hbbs = "127.0.0.1:21116"
hbbr = "127.0.0.1:21117"
# key = "<公钥内容>"  # 可选，如果服务器启用了加密
```

或者在客户端 UI 设置界面中配置。

## 端口说明

| 端口 | 协议 | 服务 | 说明 |
|------|------|------|------|
| 21115 | TCP | hbbs | NAT 类型测试 |
| 21116 | TCP/UDP | hbbs | ID 注册和心跳 |
| 21117 | TCP | hbbr | 中继服务 |
| 21118 | TCP | hbbs | Web 客户端支持 |
| 21119 | TCP | hbbr | Web 客户端支持 |

## 常用命令

```bash
# 启动
docker compose up -d

# 停止
docker compose down

# 重启
docker compose restart

# 查看日志
docker compose logs -f hbbs
docker compose logs -f hbbr

# 查看实时状态
docker compose ps

# 更新镜像
docker compose pull
docker compose up -d

# 完全清理（包括数据）
docker compose down -v
rm -rf data/*
```

## 目录结构

```
rustdesk-server/
├── docker-compose.yml    # Docker Compose 配置
├── README.md             # 本文档
├── .env                  # 环境变量配置（可选）
└── data/                 # 数据目录（自动生成）
    ├── db_v2.sqlite3     # 数据库
    ├── id_ed25519        # 私钥
    ├── id_ed25519.pub    # 公钥
    └── *.log             # 日志文件
```

## 高级配置

### 强制使用中继（禁用 P2P）

编辑 `docker-compose.yml`，在 hbbs 的 environment 中添加：

```yaml
environment:
  - ALWAYS_USE_RELAY=Y
```

### 启用加密

```yaml
environment:
  - ENCRYPTED_ONLY=1
```

### 使用 Host 网络模式（仅 Linux）

Host 模式性能更好，但仅在 Linux 上可用：

```yaml
services:
  hbbs:
    network_mode: "host"
    # 移除 ports 配置
  hbbr:
    network_mode: "host"
    # 移除 ports 配置
```

### 自定义端口

如果需要修改默认端口，编辑 `docker-compose.yml` 的 ports 映射：

```yaml
ports:
  - "12345:21116"  # 映射到主机的 12345 端口
```

## 故障排查

### 连接失败

1. 检查服务是否运行：
   ```bash
   docker compose ps
   ```

2. 检查端口是否监听：
   ```bash
   netstat -tlnp | grep 2111
   # 或
   lsof -i :21116
   ```

3. 检查防火墙：
   ```bash
   # macOS
   sudo pfctl -s rules

   # Linux
   sudo iptables -L -n
   ```

### 查看详细日志

```bash
# hbbs 日志
docker compose logs hbbs --tail 100

# hbbr 日志
docker compose logs hbbr --tail 100
```

### 重置服务

```bash
# 停止并删除容器
docker compose down

# 清理数据（会删除密钥！）
rm -rf data/*

# 重新启动
docker compose up -d
```

## 与 nuwax-agent 集成测试

### 完整测试流程

```bash
# 终端 1: 启动 RustDesk 服务器
cd docker/rustdesk-server
docker compose up

# 终端 2: 启动 agent-client
cd ../..
make run

# 终端 3: 启动 agent-server-admin（可选）
make start-admin

# 终端 4: 运行 E2E 测试
make test-e2e
```

### 使用 Makefile

项目根目录的 Makefile 提供了便捷命令：

```bash
# 从项目根目录
make start-server  # 启动 data-server
```

## 参考链接

- [RustDesk 官方文档](https://rustdesk.com/docs/zh-cn/self-host/rustdesk-server-oss/docker/)
- [RustDesk Server GitHub](https://github.com/rustdesk/rustdesk-server)
- [Docker Compose 文档](https://docs.docker.com/compose/)
