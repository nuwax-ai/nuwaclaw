# TODO - codex-cli 国内模型厂商 Response 协议支持

**状态**: 进行中
**创建日期**: 2026-05-16
**更新日期**: 2026-05-16

## 背景

codex-cli 只支持 **response 协议**，国内模型厂商提供 **OpenAI chat 协议**。

通过 `gateway chat2response` 将 OpenAI chat 协议转换为 response 协议。


## 模型验证 (基于 models.dev & 官方文档)

| 厂商 | 最新一代 | 上一代 | 备注 |
|------|---------|--------|------|
| **DeepSeek** | `deepseek-v4-pro` / `deepseek-v4-flash` | `deepseek-chat` (V3) / `deepseek-reasoner` (R1) | v4 = 2025-06, V3 = 2024-12 |
| **Kimi** | `kimi-k2.6` | `kimi-k2` | kimi-latest 已废弃，K2 = 2025-07 |
| **Zhipu** | `glm-5.1` | `glm-4.6` | GLM-5.1 = 2026-04，GLM-4.6 = 2025-09 |
| **MiniMax** | `MiniMax-M2.7` | `MiniMax-M2.5` | M2.7 = 2026-03, M2.5 = 2026-02 |
| **Qwen** | `qwen3-235b-a22b-instruct-2507` | `qwen3-235b-a22b` (2504) | 2507 = 最新, 2504 = 上一代 |
| **MiMo** | `MiMo-V2.5` | `MiMo-V2-Flash` | V2.5 = 2026-04, V2-Flash = 2025-12 |

## 验证状态

| 厂商 | 状态 | 备注 |
|------|------|------|
| **DeepSeek** | ✅ 通过 | v4-flash/v4-pro 工作正常 |
| **MiniMax** | ✅ 通过 | M2.7 工作正常 |
| **MiMo** | ✅ 通过 | mimo-v2.5-pro 工作正常 |
| **GLM (Zhipu)** | ❌ 余额不足 | API Key 余额为 0，需充值 |
| **Kimi** | 🔲 未测试 | - |
| **Qwen** | 🔲 未测试 | - |

## 测试结果 (2026-05-16)

```
通过: 3/4
✅ DeepSeek (deepseek-v4-flash)
✅ MiniMax (MiniMax-M2.7)
✅ MiMo (mimo-v2.5-pro)
❌ GLM (Zhipu) - 余额不足
```

### 测试脚本

**位置:** `crates/gateway-server/test-providers.mjs`

**用法:**
```bash
cd crates/gateway-server

# 测试所有厂商
node test-providers.mjs

# 测试指定厂商
node test-providers.mjs mimo
```

### chat2response fork

https://github.com/dongdada29/chat2response
- 已添加 MiMo provider
- 已更新 DeepSeek/MiniMax 模型配置
- 添加 detectProviderFromModel 到 chat/completions endpoint

## 相关文件

- `crates/gateway-server/.env`
- `crates/gateway-server/test-providers.mjs`
- `crates/gateway-server/node_modules/chat2response/`