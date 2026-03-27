# macOS 沙箱配置

> **平台**: darwin
> **实现**: sandbox-exec (Seatbelt)

---

## 1. 系统要求

- macOS 10.5+
- 应用必须正确签名

---

## 2. Seatbelt 配置模板

### 基础模板

```scheme
(version 1)
(allow default)

; 允许系统库读取
(allow file-read* (subpath "/usr") (subpath "/System"))

; 工作区访问
(allow file-read* (subpath "${WORKSPACE}"))
(allow file-write* (subpath "${WORKSPACE}"))

; 禁止敏感目录
(deny file-read* (subpath "~/.ssh"))
(deny file-read* (subpath "~/.aws"))
(deny file-read* (subpath "~/.gnupg"))
```

### 网络访问模板

```scheme
; 允许网络访问（白名单模式）
(allow network-outbound
  (remote tcp "github.com" 443)
  (remote tcp "*.github.com" 443)
  (remote tcp "registry.npmjs.org" 443)
  (remote tcp "pypi.org" 443)
)

; 或禁止所有网络
(deny network*)
```

### 资源限制模板

```scheme
; 限制进程数
(limit process-count 100)

; 限制文件描述符
(limit file-write-bytes 104857600)  ; 100MB
```

---

## 3. Node.js 开发模板

```scheme
(version 1)
(allow default)

; 系统访问
(allow file-read* (subpath "/usr") (subpath "/System") (subpath "/Library"))

; Node.js 核心模块
(allow file-read* (subpath "/usr/local/lib/node_modules"))

; 工作区
(allow file-read* (subpath "${WORKSPACE}"))
(allow file-write* (subpath "${WORKSPACE}"))

; 网络访问
(allow network-outbound
  (remote tcp "registry.npmjs.org" 443)
  (remote tcp "github.com" 443)
)

; 临时文件
(allow file-write* (subpath "/tmp"))
```

---

## 4. Python 开发模板

```scheme
(version 1)
(allow default)

; 系统库
(allow file-read* (subpath "/usr") (subpath "/System"))

; Python 环境
(allow file-read* (subpath "/usr/local/lib/python*"))
(allow file-read* (subpath "~/.pyenv"))

; 工作区
(allow file-read* (subpath "${WORKSPACE}"))
(allow file-write* (subpath "${WORKSPACE}"))

; 网络
(allow network-outbound
  (remote tcp "pypi.org" 443)
  (remote tcp "files.pythonhosted.org" 443)
)

; 虚拟环境
(allow file-write* (subpath "${WORKSPACE}/venv"))
(allow file-write* (subpath "${WORKSPACE}/.venv"))
```

---

## 5. 完整开发环境模板

```scheme
(version 1)
(allow default)

;; === 系统访问 ===
(allow file-read* (subpath "/usr"))
(allow file-read* (subpath "/bin"))
(allow file-read* (subpath "/System"))
(allow file-read* (subpath "/Library"))

;; === 开发工具 ===
; Git
(allow process-exec* (path "/usr/bin/git"))

; Node.js
(allow file-read* (subpath "/usr/local/lib/node_modules"))
(allow process-exec* (path "/usr/local/bin/node"))
(allow process-exec* (path "/usr/local/bin/npm"))

; Python
(allow file-read* (subpath "/usr/local/lib/python*"))
(allow process-exec* (path "/usr/local/bin/python3"))

;; === 工作区 ===
(allow file-read* (subpath "${WORKSPACE}"))
(allow file-write* (subpath "${WORKSPACE}"))

;; === 网络 ===
(allow network-outbound
  ; Git
  (remote tcp "github.com" 443)
  (remote tcp "*.github.com" 443)
  
  ; Node.js
  (remote tcp "registry.npmjs.org" 443)
  (remote tcp "*.npmjs.org" 443)
  
  ; Python
  (remote tcp "pypi.org" 443)
  (remote tcp "files.pythonhosted.org" 443)
  
  ; DNS
  (remote udp "8.8.8.8" 53)
)

;; === 临时文件 ===
(allow file-read* (subpath "/tmp"))
(allow file-write* (subpath "/tmp"))

;; === 禁止访问 ===
(deny file-read* (subpath "~/.ssh"))
(deny file-read* (subpath "~/.aws"))
(deny file-read* (subpath "~/.gnupg"))
(deny file-read* (subpath "~/.kube"))

;; === 资源限制 ===
(limit process-count 200)
(limit file-write-bytes 1073741824)  ; 1GB
```

---

## 6. 安全注意事项

### ✅ 允许的操作

- 读取系统库
- 在工作区内读写
- 访问白名单域名
- 执行开发工具

### ❌ 禁止的操作

- 访问敏感目录（~/.ssh, ~/.aws）
- 访问系统配置
- 修改系统文件
- 网络监听

---

## 7. 测试命令

```bash
# 基本测试
sandbox-exec -f profile.sb bash -c "echo test"

# 文件系统测试
sandbox-exec -f profile.sb bash -c "ls -la ${WORKSPACE}"

# 网络测试
sandbox-exec -f profile.sb bash -c "curl https://github.com"

# 敏感目录测试（应该失败）
sandbox-exec -f profile.sb bash -c "cat ~/.ssh/id_rsa"
```

---

**配置状态**: 完成
**更新时间**: 2026-03-27
