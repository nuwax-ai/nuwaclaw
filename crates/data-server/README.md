# data-server

数据中转服务器，基于 RustDesk 协议提供信令 (hbbs) 和中继 (hbbr) 服务。

## 目录

- [概述](#概述)
- [架构](#架构)
- [端口说明](#端口说明)
- [快速开始](#快速开始)
- [配置说明](#配置说明)
- [部署方式](#部署方式)
  - [二进制部署](#二进制部署)
  - [Docker 部署](#docker-部署)
  - [Systemd 服务](#systemd-服务)
- [云服务部署](#云服务部署)
  - [阿里云 ECS](#阿里云-ecs)
  - [腾讯云 CVM](#腾讯云-cvm)
  - [AWS EC2](#aws-ec2)
- [安全配置](#安全配置)
- [监控与日志](#监控与日志)
- [故障排查](#故障排查)

---

## 概述

data-server 是 nuwax-agent 系统的核心基础设施组件，负责：

- **信令服务 (hbbs)**：客户端 ID 分配、在线状态管理、P2P 打洞协调
- **中继服务 (hbbr)**：当 P2P 直连失败时，提供数据中继转发

```
┌─────────────────┐                         ┌─────────────────────┐
│  agent-client   │                         │ agent-server-admin  │
│  (无公网 IP)     │                         │   (管理后台)         │
└────────┬────────┘                         └──────────┬──────────┘
         │                                             │
         │ UDP/TCP                                     │ UDP/TCP
         │                                             │
         └─────────────────┬───────────────────────────┘
                           │
                    ┌──────┴──────┐
                    │ data-server │
                    │             │
                    │ hbbs:21116  │  ← 信令服务（ID注册、打洞）
                    │ hbbr:21117  │  ← 中继服务（数据转发）
                    │             │
                    └─────────────┘
```

---

## 架构

### 组件说明

| 组件 | 端口 | 协议 | 说明 |
|------|------|------|------|
| hbbs | 21116 | UDP + TCP | 信令服务器，处理客户端注册和 P2P 打洞 |
| hbbr | 21117 | TCP | 中继服务器，P2P 失败时转发数据 |

### 通信流程

1. **客户端注册**：agent-client 启动后连接 hbbs:21116，获取唯一 ID
2. **P2P 打洞**：两个客户端通过 hbbs 交换网络信息，尝试直连
3. **中继回退**：如果 P2P 失败（严格 NAT），通过 hbbr:21117 中继

---

## 端口说明

部署时需要开放以下端口：

| 端口 | 协议 | 必须 | 说明 |
|------|------|------|------|
| 21116 | UDP | 是 | hbbs 信令（心跳、ID注册） |
| 21116 | TCP | 是 | hbbs 信令（连接建立） |
| 21117 | TCP | 是 | hbbr 中继数据转发 |
| 21118 | TCP | 否 | hbbs Web 客户端（如需要） |
| 21119 | TCP | 否 | hbbs WebSocket（如需要） |

---

## 快速开始

### 本地运行

```bash
# 1. 构建
cargo build -p data-server --release

# 2. 运行（使用默认配置）
./target/release/data-server

# 或指定配置文件
./target/release/data-server --config config/data-server.toml
```

### 验证服务

```bash
# 检查端口监听
netstat -tlnup | grep -E "21116|21117"

# 或使用 lsof
lsof -i :21116
lsof -i :21117
```

---

## 配置说明

配置文件格式为 TOML，默认路径 `config/data-server.toml`：

```toml
[hbbs]
# 监听地址（0.0.0.0 表示所有网卡）
host = "0.0.0.0"
# 信令端口
port = 21116
# 中继服务器地址（供客户端连接）
# 如果 hbbr 在同一台服务器，可不配置
# relay = "your-server-ip:21117"
# 认证密钥（"-" 自动生成，留空不使用）
key = "-"
# UDP 接收缓冲区（0 使用系统默认）
rmem = 0

[hbbr]
# 监听地址
host = "0.0.0.0"
# 中继端口
port = 21117
# 最大连接数
max_connections = 1000
# 认证密钥（与 hbbs 保持一致）
key = "-"

[logging]
# 日志级别: trace, debug, info, warn, error
level = "info"
# 是否输出到文件
to_file = false
# 日志文件路径
# file_path = "/var/log/data-server/server.log"
```

### 环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `RUST_LOG` | 日志级别 | `info`, `debug`, `data_server=debug` |
| `RELAY-SERVERS` | 中继服务器列表 | `server1:21117,server2:21117` |

---

## 部署方式

### 二进制部署

#### 1. 编译

```bash
# 在开发机器上编译
cargo build -p data-server --release

# 产物位置
ls -la target/release/data-server
```

#### 2. 上传到服务器

```bash
# 上传二进制和配置
scp target/release/data-server user@your-server:/opt/data-server/
scp config/data-server.toml user@your-server:/opt/data-server/config/
```

#### 3. 在服务器上运行

```bash
# SSH 到服务器
ssh user@your-server

# 创建目录
sudo mkdir -p /opt/data-server/{config,data,logs}

# 运行
cd /opt/data-server
./data-server --config config/data-server.toml
```

---

### Docker 部署

#### Dockerfile

在项目根目录创建 `docker/data-server/Dockerfile`：

```dockerfile
FROM rust:1.75-slim as builder

WORKDIR /app
COPY . .

# 安装依赖
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# 构建
RUN cargo build -p data-server --release

# 运行镜像
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/target/release/data-server /app/
COPY --from=builder /app/config/data-server.toml /app/config/

EXPOSE 21116/udp 21116/tcp 21117/tcp

CMD ["./data-server", "--config", "config/data-server.toml"]
```

#### docker-compose.yml

```yaml
version: '3.8'

services:
  data-server:
    build:
      context: ../..
      dockerfile: docker/data-server/Dockerfile
    container_name: data-server
    restart: unless-stopped
    ports:
      - "21116:21116/udp"
      - "21116:21116/tcp"
      - "21117:21117/tcp"
    volumes:
      - ./config:/app/config:ro
      - ./data:/app/data
      - ./logs:/app/logs
    environment:
      - RUST_LOG=info
    healthcheck:
      test: ["CMD", "nc", "-z", "localhost", "21116"]
      interval: 30s
      timeout: 10s
      retries: 3
```

#### 运行 Docker

```bash
# 构建镜像
docker compose build

# 启动服务
docker compose up -d

# 查看日志
docker compose logs -f

# 停止服务
docker compose down
```

---

### Systemd 服务

创建 `/etc/systemd/system/data-server.service`：

```ini
[Unit]
Description=Data Server (RustDesk Protocol)
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=data-server
Group=data-server
WorkingDirectory=/opt/data-server
ExecStart=/opt/data-server/data-server --config /opt/data-server/config/data-server.toml
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# 安全限制
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/data-server/data /opt/data-server/logs

# 资源限制
LimitNOFILE=65535
LimitNPROC=4096

[Install]
WantedBy=multi-user.target
```

#### 安装步骤

```bash
# 1. 创建用户
sudo useradd -r -s /bin/false data-server

# 2. 创建目录
sudo mkdir -p /opt/data-server/{config,data,logs}
sudo chown -R data-server:data-server /opt/data-server

# 3. 复制文件
sudo cp target/release/data-server /opt/data-server/
sudo cp config/data-server.toml /opt/data-server/config/

# 4. 安装服务
sudo cp data-server.service /etc/systemd/system/
sudo systemctl daemon-reload

# 5. 启动服务
sudo systemctl enable data-server
sudo systemctl start data-server

# 6. 查看状态
sudo systemctl status data-server
sudo journalctl -u data-server -f
```

---

## 云服务部署

### 阿里云 ECS

#### 1. 创建 ECS 实例

- **规格**：2核4G 起步（根据连接数调整）
- **系统**：Ubuntu 22.04 / Debian 12 / CentOS Stream 9
- **带宽**：建议 5Mbps+ 按流量计费
- **安全组**：见下方配置

#### 2. 安全组配置

```
入方向规则：
┌──────────┬──────────┬─────────────┬───────────────┐
│ 优先级    │ 协议      │ 端口范围     │ 授权对象       │
├──────────┼──────────┼─────────────┼───────────────┤
│ 1        │ TCP      │ 22          │ 你的IP/0.0.0.0│
│ 1        │ UDP      │ 21116       │ 0.0.0.0/0     │
│ 1        │ TCP      │ 21116-21117 │ 0.0.0.0/0     │
└──────────┴──────────┴─────────────┴───────────────┘
```

#### 3. 部署脚本

```bash
#!/bin/bash
# deploy-aliyun.sh

set -e

SERVER_IP="your-ecs-ip"
SERVER_USER="root"

# 编译
cargo build -p data-server --release

# 上传
scp target/release/data-server ${SERVER_USER}@${SERVER_IP}:/opt/data-server/
scp config/data-server.toml ${SERVER_USER}@${SERVER_IP}:/opt/data-server/config/

# 远程执行
ssh ${SERVER_USER}@${SERVER_IP} << 'EOF'
systemctl restart data-server
systemctl status data-server
EOF

echo "部署完成！"
```

---

### 腾讯云 CVM

#### 1. 创建 CVM 实例

- **规格**：标准型 S5.MEDIUM4（2核4G）
- **系统**：Ubuntu Server 22.04 LTS
- **带宽**：按使用流量计费，上限 100Mbps

#### 2. 安全组配置

在腾讯云控制台 → 安全组 → 添加规则：

```
入站规则：
- TCP:22      来源：你的IP
- UDP:21116   来源：0.0.0.0/0
- TCP:21116   来源：0.0.0.0/0
- TCP:21117   来源：0.0.0.0/0
```

#### 3. 使用轻量应用服务器（更简单）

腾讯云轻量应用服务器自带防火墙，配置更简单：

```bash
# 在轻量应用服务器控制台 → 防火墙 → 添加规则
# 应用类型：自定义
# 协议：TCP+UDP
# 端口：21116-21117
```

---

### AWS EC2

#### 1. 启动 EC2 实例

- **AMI**：Ubuntu Server 22.04 LTS
- **实例类型**：t3.small（2 vCPU, 2 GiB）起步
- **存储**：20 GiB gp3

#### 2. 安全组配置

```bash
# 使用 AWS CLI 创建安全组
aws ec2 create-security-group \
  --group-name data-server-sg \
  --description "Security group for data-server"

# 添加规则
aws ec2 authorize-security-group-ingress \
  --group-name data-server-sg \
  --protocol tcp --port 22 --cidr YOUR_IP/32

aws ec2 authorize-security-group-ingress \
  --group-name data-server-sg \
  --protocol udp --port 21116 --cidr 0.0.0.0/0

aws ec2 authorize-security-group-ingress \
  --group-name data-server-sg \
  --protocol tcp --port 21116-21117 --cidr 0.0.0.0/0
```

#### 3. 使用 User Data 自动部署

```bash
#!/bin/bash
# EC2 User Data 脚本

# 更新系统
apt-get update && apt-get upgrade -y

# 创建目录
mkdir -p /opt/data-server/{config,data,logs}

# 下载预编译二进制（需提前上传到 S3）
aws s3 cp s3://your-bucket/data-server /opt/data-server/
aws s3 cp s3://your-bucket/data-server.toml /opt/data-server/config/
chmod +x /opt/data-server/data-server

# 创建 systemd 服务
cat > /etc/systemd/system/data-server.service << 'EOF'
[Unit]
Description=Data Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/data-server
ExecStart=/opt/data-server/data-server --config config/data-server.toml
Restart=always

[Install]
WantedBy=multi-user.target
EOF

# 启动服务
systemctl daemon-reload
systemctl enable data-server
systemctl start data-server
```

---

## 安全配置

### 1. 防火墙配置

#### UFW (Ubuntu/Debian)

```bash
# 启用 UFW
sudo ufw enable

# 允许 SSH
sudo ufw allow 22/tcp

# 允许 data-server 端口
sudo ufw allow 21116/udp
sudo ufw allow 21116/tcp
sudo ufw allow 21117/tcp

# 查看规则
sudo ufw status verbose
```

#### firewalld (CentOS/RHEL)

```bash
# 添加端口
sudo firewall-cmd --permanent --add-port=21116/udp
sudo firewall-cmd --permanent --add-port=21116/tcp
sudo firewall-cmd --permanent --add-port=21117/tcp

# 重载
sudo firewall-cmd --reload

# 查看
sudo firewall-cmd --list-all
```

### 2. 密钥配置

生产环境建议使用固定密钥：

```toml
[hbbs]
key = "your-secret-key-here"

[hbbr]
key = "your-secret-key-here"
```

生成密钥：

```bash
# 生成随机密钥
openssl rand -base64 32
```

### 3. 限制连接数

```toml
[hbbr]
max_connections = 1000  # 根据服务器配置调整
```

### 4. 系统优化

```bash
# /etc/sysctl.conf
net.core.somaxconn = 65535
net.core.netdev_max_backlog = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 30

# 应用配置
sudo sysctl -p

# 增加文件描述符限制
# /etc/security/limits.conf
* soft nofile 65535
* hard nofile 65535
```

---

## 监控与日志

### 日志查看

```bash
# Systemd 日志
sudo journalctl -u data-server -f

# 按时间查看
sudo journalctl -u data-server --since "1 hour ago"

# Docker 日志
docker logs -f data-server
```

### 健康检查

```bash
# 检查端口
nc -zv your-server-ip 21116
nc -zv your-server-ip 21117

# 检查进程
ps aux | grep data-server

# 检查连接数
ss -s
netstat -an | grep -E "21116|21117" | wc -l
```

### Prometheus 监控（可选）

可以使用 `process-exporter` 监控进程：

```yaml
# process-exporter config
process_names:
  - name: "{{.Comm}}"
    cmdline:
      - data-server
```

---

## 故障排查

### 常见问题

#### 1. 端口无法访问

```bash
# 检查服务是否运行
systemctl status data-server

# 检查端口监听
ss -tlnup | grep 21116

# 检查防火墙
sudo iptables -L -n
sudo ufw status
```

#### 2. 客户端无法注册

```bash
# 检查 hbbs 日志
journalctl -u data-server | grep -i error

# 测试 UDP 连通性
nc -u your-server-ip 21116
```

#### 3. P2P 连接失败

- 确认两端防火墙允许 UDP
- 检查 NAT 类型（严格 NAT 需要中继）
- 验证 hbbr 服务正常

#### 4. 中继连接失败

```bash
# 检查 hbbr 端口
telnet your-server-ip 21117

# 检查连接数是否超限
journalctl -u data-server | grep "max_connections"
```

### 调试模式

```bash
# 启用调试日志
RUST_LOG=debug ./data-server --config config/data-server.toml
```

---

## 性能调优

### 服务器规格建议

| 并发连接数 | CPU | 内存 | 带宽 |
|-----------|-----|------|------|
| < 100 | 1核 | 1GB | 1Mbps |
| 100-500 | 2核 | 2GB | 5Mbps |
| 500-2000 | 4核 | 4GB | 10Mbps |
| 2000+ | 8核+ | 8GB+ | 按需 |

### 多节点部署

对于大规模部署，可以使用多个 data-server 实例：

```
                    ┌─────────────────┐
                    │   负载均衡器     │
                    │ (DNS 轮询/LB)   │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
┌───────┴───────┐   ┌───────┴───────┐   ┌───────┴───────┐
│ data-server-1 │   │ data-server-2 │   │ data-server-3 │
│ 区域: 华东     │   │ 区域: 华南     │   │ 区域: 华北     │
└───────────────┘   └───────────────┘   └───────────────┘
```

---

## 许可证

本项目基于 MIT 许可证开源。
