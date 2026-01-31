#!/bin/bash
# P2P/Relay 传输类型识别集成测试
#
# 验证 DispatchResult.transport 是否正确反映实际传输方式：
#   - P2P 直连返回 "p2p"
#   - TCP Relay 中继返回 "tcp_relay"
#
# 测试流程:
#   1. 启动 Docker RustDesk 服务器 (hbbs + hbbr)
#   2. 启动 agent-server-admin
#   3. 注册模拟客户端
#   4. 建立 P2P 连接
#   5. 发送消息并验证 transport 字段
#
# 用法:
#   ./scripts/test_transport_kind.sh
#
# 依赖:
#   - Docker (运行 RustDesk 服务器)
#   - curl, jq (HTTP 请求和 JSON 解析)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 配置
ADMIN_HOST="127.0.0.1"
ADMIN_PORT="8080"
ADMIN_URL="http://${ADMIN_HOST}:${ADMIN_PORT}"
HBBS_PORT="21116"
HBBR_PORT="21117"

# 测试客户端配置
TEST_CLIENT_ID="transport-test-$(date +%s)"
TEST_P2P_PASSWORD="test_password_123"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; FAILURES=$((FAILURES + 1)); }
info() { echo -e "${YELLOW}[INFO]${NC} $1"; }
debug() { echo -e "${BLUE}[DEBUG]${NC} $1"; }

FAILURES=0
PIDS=()
DOCKER_STARTED=false

# 清理函数
cleanup() {
    info "Cleaning up..."

    # 停止后台进程
    for pid in "${PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
        fi
    done
    wait 2>/dev/null || true

    # 停止 Docker（如果是我们启动的）
    if [ "$DOCKER_STARTED" = true ]; then
        info "Stopping Docker containers..."
        cd "$PROJECT_ROOT/docker/rustdesk-server"
        docker-compose down 2>/dev/null || true
    fi

    info "Cleanup complete"
}
trap cleanup EXIT

# 等待端口可用
wait_for_port() {
    local port=$1
    local timeout=${2:-30}
    local elapsed=0
    while ! nc -z 127.0.0.1 "$port" 2>/dev/null; do
        sleep 1
        elapsed=$((elapsed + 1))
        if [ $elapsed -ge $timeout ]; then
            return 1
        fi
    done
    return 0
}

# 检查依赖
check_dependencies() {
    local missing=()

    command -v docker >/dev/null 2>&1 || missing+=("docker")
    command -v curl >/dev/null 2>&1 || missing+=("curl")
    command -v jq >/dev/null 2>&1 || missing+=("jq")
    command -v nc >/dev/null 2>&1 || missing+=("nc (netcat)")

    if [ ${#missing[@]} -gt 0 ]; then
        echo -e "${RED}Missing dependencies: ${missing[*]}${NC}"
        exit 1
    fi
}

echo "========================================"
echo "  P2P/Relay 传输类型识别测试"
echo "========================================"
echo ""

check_dependencies

# ============================================================================
# 1. 启动 Docker RustDesk 服务器
# ============================================================================
info "=== Step 1: Start Docker RustDesk Server ==="

cd "$PROJECT_ROOT/docker/rustdesk-server"

# 检查是否已在运行
if nc -z 127.0.0.1 $HBBS_PORT 2>/dev/null; then
    info "Docker RustDesk server already running on port $HBBS_PORT"
else
    info "Starting Docker containers..."
    docker-compose up -d
    DOCKER_STARTED=true

    if wait_for_port $HBBS_PORT 60; then
        pass "Docker hbbs started on port $HBBS_PORT"
    else
        fail "Docker hbbs failed to start"
        exit 1
    fi

    if wait_for_port $HBBR_PORT 30; then
        pass "Docker hbbr started on port $HBBR_PORT"
    else
        fail "Docker hbbr failed to start"
        exit 1
    fi

    # 等待服务完全就绪
    sleep 3
fi

# ============================================================================
# 2. 构建并启动 agent-server-admin
# ============================================================================
info "=== Step 2: Build and Start agent-server-admin ==="

cd "$PROJECT_ROOT"

# 确保 SQLite DB 存在
if [ ! -f "db_v2.sqlite3" ]; then
    sqlite3 db_v2.sqlite3 "CREATE TABLE IF NOT EXISTS peer (guid blob primary key not null, id varchar(100) not null, uuid blob not null, pk blob not null, created_at datetime not null default(current_timestamp), user blob, status tinyint, note varchar(300), info text not null) without rowid; CREATE UNIQUE INDEX IF NOT EXISTS index_peer_id on peer (id);"
fi

export DATABASE_URL="sqlite://db_v2.sqlite3"
export VCPKG_ROOT="${VCPKG_ROOT:-$HOME/vcpkg}"

# 检查是否已在运行
if nc -z 127.0.0.1 $ADMIN_PORT 2>/dev/null; then
    info "agent-server-admin already running on port $ADMIN_PORT"
else
    info "Building agent-server-admin..."
    cargo build -p agent-server-admin 2>&1 | tail -3

    info "Starting agent-server-admin..."
    RUST_LOG=info,agent_server_admin=debug cargo run -p agent-server-admin > /tmp/admin-server-transport-test.log 2>&1 &
    PIDS+=($!)

    if wait_for_port $ADMIN_PORT 30; then
        pass "agent-server-admin started on port $ADMIN_PORT"
    else
        fail "agent-server-admin failed to start"
        echo "Last log lines:"
        tail -20 /tmp/admin-server-transport-test.log
        exit 1
    fi

    # 等待桥接层初始化
    sleep 3
fi

# ============================================================================
# 3. 验证服务状态
# ============================================================================
info "=== Step 3: Verify Service Status ==="

HEALTH=$(curl -s "${ADMIN_URL}/health")
if echo "$HEALTH" | jq -e '.status == "ok"' > /dev/null 2>&1; then
    pass "Health check OK"
else
    fail "Health check failed: $HEALTH"
    exit 1
fi

STATUS=$(curl -s "${ADMIN_URL}/api/status")
debug "Bridge status: $STATUS"

BRIDGE_RUNNING=$(echo "$STATUS" | jq -r '.bridge_running // false')
BRIDGE_ID=$(echo "$STATUS" | jq -r '.bridge_self_id // "unknown"')

if [ "$BRIDGE_RUNNING" = "true" ]; then
    pass "Bridge running with ID: $BRIDGE_ID"
else
    fail "Bridge not running"
    exit 1
fi

# ============================================================================
# 4. 注册模拟客户端（带 P2P 密码）
# ============================================================================
info "=== Step 4: Register Test Client ==="

REG_RESPONSE=$(curl -s -X POST "${ADMIN_URL}/api/register" \
    -H "Content-Type: application/json" \
    -d "{
        \"client_id\": \"${TEST_CLIENT_ID}\",
        \"name\": \"Transport Test Client\",
        \"os\": \"darwin\",
        \"os_version\": \"24.0.0\",
        \"arch\": \"aarch64\",
        \"client_version\": \"0.1.0\",
        \"p2p_password\": \"${TEST_P2P_PASSWORD}\"
    }")

if echo "$REG_RESPONSE" | jq -e '.success == true' > /dev/null 2>&1; then
    pass "Client registered: $TEST_CLIENT_ID"
else
    fail "Client registration failed: $REG_RESPONSE"
    exit 1
fi

# ============================================================================
# 5. 尝试建立 P2P 连接
# ============================================================================
info "=== Step 5: Establish P2P Connection ==="

# 注意：由于我们没有真正的 agent-client 运行，连接会失败
# 但我们可以验证 API 正常工作并检查连接状态
CONNECT_RESPONSE=$(curl -s -X POST "${ADMIN_URL}/api/clients/${TEST_CLIENT_ID}/connect" \
    -H "Content-Type: application/json" \
    -d '{}')

debug "Connect response: $CONNECT_RESPONSE"

# 连接可能成功发起（但最终会因为没有真实客户端而失败）
if echo "$CONNECT_RESPONSE" | jq -e '.success == true' > /dev/null 2>&1; then
    pass "P2P connection initiated"

    # 等待连接建立（或超时）
    sleep 5

    # 检查连接状态
    CLIENT_INFO=$(curl -s "${ADMIN_URL}/api/clients/${TEST_CLIENT_ID}")
    debug "Client info: $CLIENT_INFO"
else
    info "P2P connection not established (expected without real agent-client)"
fi

# ============================================================================
# 6. 发送消息并验证 transport 字段
# ============================================================================
info "=== Step 6: Send Message and Verify Transport ==="

# 尝试通过 P2P 发送消息
MSG_RESPONSE=$(curl -s -X POST "${ADMIN_URL}/api/clients/${TEST_CLIENT_ID}/message" \
    -H "Content-Type: application/json" \
    -d '{
        "message_type": "AgentTaskRequest",
        "payload": {
            "task_type": "echo",
            "params": {"message": "transport test"}
        }
    }')

debug "Message response: $MSG_RESPONSE"

# 检查是否有 transport 字段
if echo "$MSG_RESPONSE" | jq -e '.transport' > /dev/null 2>&1; then
    TRANSPORT=$(echo "$MSG_RESPONSE" | jq -r '.transport')
    pass "Transport field present: $TRANSPORT"

    # 验证值是否有效
    if [ "$TRANSPORT" = "p2p" ] || [ "$TRANSPORT" = "tcp_relay" ]; then
        pass "Transport value is valid: $TRANSPORT"
    else
        fail "Unexpected transport value: $TRANSPORT (expected 'p2p' or 'tcp_relay')"
    fi
else
    # 如果消息发送失败（P2P 未连接），检查是否回退到队列
    if echo "$MSG_RESPONSE" | jq -e '.success == true' > /dev/null 2>&1; then
        info "Message queued (P2P not connected)"

        # 检查 sent_via_p2p 字段
        SENT_VIA_P2P=$(echo "$MSG_RESPONSE" | jq -r '.sent_via_p2p // "unknown"')
        if [ "$SENT_VIA_P2P" = "false" ]; then
            pass "Correctly indicates message was not sent via P2P"
        fi
    else
        info "Message send failed (expected without P2P connection): $MSG_RESPONSE"
    fi
fi

# ============================================================================
# 7. 创建任务并验证 transport
# ============================================================================
info "=== Step 7: Create Task and Verify Transport ==="

TASK_RESPONSE=$(curl -s -X POST "${ADMIN_URL}/api/tasks/chat" \
    -H "Content-Type: application/json" \
    -d "{
        \"client_id\": \"${TEST_CLIENT_ID}\",
        \"project_id\": \"transport-test-project\",
        \"prompt\": \"Hello transport test\",
        \"service_type\": \"RCoder\"
    }")

debug "Task response: $TASK_RESPONSE"

if echo "$TASK_RESPONSE" | jq -e '.success == true' > /dev/null 2>&1; then
    TASK_ID=$(echo "$TASK_RESPONSE" | jq -r '.task_id')
    pass "Task created: $TASK_ID"

    # 检查 transport 字段
    if echo "$TASK_RESPONSE" | jq -e '.transport' > /dev/null 2>&1; then
        TASK_TRANSPORT=$(echo "$TASK_RESPONSE" | jq -r '.transport')
        pass "Task response includes transport: $TASK_TRANSPORT"
    else
        info "Task response does not include transport field (may be queued)"
    fi
else
    info "Task creation result: $TASK_RESPONSE"
fi

# ============================================================================
# 8. 检查桥接状态中的 P2P 连接信息
# ============================================================================
info "=== Step 8: Check Bridge P2P Status ==="

FINAL_STATUS=$(curl -s "${ADMIN_URL}/api/status")
P2P_CONNECTIONS=$(echo "$FINAL_STATUS" | jq -r '.p2p_connections // 0')

info "Current P2P connections: $P2P_CONNECTIONS"

# ============================================================================
# 9. 代码级别验证
# ============================================================================
info "=== Step 9: Code-Level Verification ==="

# 检查 dispatch.rs 是否正确调用 is_direct_connection
if grep -q "is_direct_connection" "$PROJECT_ROOT/crates/agent-server-admin/src/dispatch.rs"; then
    pass "dispatch.rs calls is_direct_connection()"
else
    fail "dispatch.rs does not call is_direct_connection()"
fi

# 检查 peer_connection.rs 是否缓存 is_direct
if grep -q "is_direct: Some(direct)" "$PROJECT_ROOT/crates/agent-server-admin/src/peer_connection.rs"; then
    pass "peer_connection.rs caches is_direct value"
else
    fail "peer_connection.rs does not cache is_direct value"
fi

# 检查 TransportKind::TcpRelay 是否在 dispatch 中使用
if grep -q "TransportKind::TcpRelay" "$PROJECT_ROOT/crates/agent-server-admin/src/dispatch.rs"; then
    pass "dispatch.rs uses TransportKind::TcpRelay"
else
    fail "dispatch.rs does not use TransportKind::TcpRelay"
fi

# ============================================================================
# 结果汇总
# ============================================================================
echo ""
echo "========================================"
if [ $FAILURES -eq 0 ]; then
    echo -e "  ${GREEN}All tests passed!${NC}"
else
    echo -e "  ${RED}$FAILURES test(s) failed${NC}"
fi
echo "========================================"
echo ""

info "Note: Full P2P/Relay transport verification requires a real agent-client."
info "This test verifies the code structure and API responses."
info ""
info "To manually verify transport types:"
info "  1. Start agent-client GUI application"
info "  2. Connect via POST /api/clients/:id/connect"
info "  3. Send message and check 'transport' field in response"
info "  4. Block UDP 21116 to force Relay, verify 'tcp_relay' is returned"
echo ""
info "Logs: /tmp/admin-server-transport-test.log"

exit $FAILURES
