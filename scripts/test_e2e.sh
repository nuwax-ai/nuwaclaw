#!/bin/bash
# 端到端通信验证脚本
#
# 验证 data-server、agent-server-admin、agent-client 三者之间的通信链路。
#
# 测试流程:
#   1. 启动 data-server (hbbs + hbbr)
#   2. 启动 agent-server-admin
#   3. 通过 API 验证服务状态
#   4. 模拟客户端注册和消息通信
#   5. 测试任务管理 API
#   6. 测试认证（可选，需设置环境变量启用）
#
# 用法:
#   ./scripts/test_e2e.sh                          # 无认证模式
#   ADMIN_API_KEY=xxx ./scripts/test_e2e.sh        # 启用认证测试

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 配置
ADMIN_HOST="127.0.0.1"
ADMIN_PORT="8080"
ADMIN_URL="http://${ADMIN_HOST}:${ADMIN_PORT}"
HBBS_PORT="21116"
HBBR_PORT="21117"

# 认证配置（可通过环境变量设置）
TEST_ADMIN_API_KEY="${ADMIN_API_KEY:-}"
TEST_CLIENT_TOKEN="${CLIENT_API_TOKEN:-}"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; FAILURES=$((FAILURES + 1)); }
info() { echo -e "${YELLOW}[INFO]${NC} $1"; }

FAILURES=0
PIDS=()

# 清理函数
cleanup() {
    info "Cleaning up..."
    for pid in "${PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
        fi
    done
    wait 2>/dev/null || true
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

# 生成认证 header
get_admin_auth_header() {
    if [ -n "$TEST_ADMIN_API_KEY" ]; then
        echo "-H X-API-Key:${TEST_ADMIN_API_KEY}"
    fi
}

get_client_auth_header() {
    if [ -n "$TEST_CLIENT_TOKEN" ]; then
        echo "-H X-Client-Token:${TEST_CLIENT_TOKEN}"
    fi
}

echo "========================================"
echo "  端到端通信验证测试"
echo "========================================"
echo ""

# ============================================================================
# 1. 构建所有服务
# ============================================================================
info "Building services..."
cd "$PROJECT_ROOT"

# 确保 SQLite DB 存在（sqlx 编译时需要）
if [ ! -f "db_v2.sqlite3" ]; then
    sqlite3 db_v2.sqlite3 "create table if not exists peer (guid blob primary key not null, id varchar(100) not null, uuid blob not null, pk blob not null, created_at datetime not null default(current_timestamp), user blob, status tinyint, note varchar(300), info text not null) without rowid; create unique index if not exists index_peer_id on peer (id); create index if not exists index_peer_user on peer (user); create index if not exists index_peer_created_at on peer (created_at); create index if not exists index_peer_status on peer (status);"
fi

export DATABASE_URL="sqlite://db_v2.sqlite3"
export VCPKG_ROOT="${VCPKG_ROOT:-$HOME/vcpkg}"

cargo build -p data-server -p agent-server-admin 2>&1 | tail -5
echo ""

# ============================================================================
# 2. 启动 data-server
# ============================================================================
info "Starting data-server (hbbs:${HBBS_PORT}, hbbr:${HBBR_PORT})..."
RUST_LOG=info cargo run -p data-server -- --config config/data-server.toml > /tmp/data-server.log 2>&1 &
PIDS+=($!)
info "data-server PID: ${PIDS[-1]}"

if wait_for_port $HBBS_PORT 30; then
    pass "data-server hbbs listening on port $HBBS_PORT"
else
    fail "data-server hbbs failed to start on port $HBBS_PORT"
    echo "Last log lines:"
    tail -20 /tmp/data-server.log
    exit 1
fi

# ============================================================================
# 3. 启动 agent-server-admin
# ============================================================================
info "Starting agent-server-admin (${ADMIN_URL})..."

# 将认证配置传递给服务器
AUTH_ENV=""
if [ -n "$TEST_ADMIN_API_KEY" ]; then
    AUTH_ENV="ADMIN_API_KEY=$TEST_ADMIN_API_KEY"
    info "Authentication enabled: ADMIN_API_KEY"
fi
if [ -n "$TEST_CLIENT_TOKEN" ]; then
    AUTH_ENV="$AUTH_ENV CLIENT_API_TOKEN=$TEST_CLIENT_TOKEN"
    info "Authentication enabled: CLIENT_API_TOKEN"
fi

env $AUTH_ENV RUST_LOG=info cargo run -p agent-server-admin > /tmp/admin-server.log 2>&1 &
PIDS+=($!)
info "admin-server PID: ${PIDS[-1]}"

if wait_for_port $ADMIN_PORT 15; then
    pass "agent-server-admin listening on port $ADMIN_PORT"
else
    fail "agent-server-admin failed to start on port $ADMIN_PORT"
    echo "Last log lines:"
    tail -20 /tmp/admin-server.log
    exit 1
fi

sleep 2  # 等待桥接层初始化

# ============================================================================
# 4. 测试 - 健康检查（无需认证）
# ============================================================================
echo ""
info "=== Test: Health Check ==="
HEALTH=$(curl -s "${ADMIN_URL}/health")
if echo "$HEALTH" | grep -q '"status":"ok"'; then
    pass "Health check returned OK"
else
    fail "Health check failed: $HEALTH"
fi

# ============================================================================
# 5. 测试 - 认证（仅当配置了认证时）
# ============================================================================
if [ -n "$TEST_ADMIN_API_KEY" ]; then
    echo ""
    info "=== Test: Authentication ==="

    # 无 token 访问应被拒绝
    NO_AUTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "${ADMIN_URL}/api/clients")
    if [ "$NO_AUTH_RESPONSE" = "401" ]; then
        pass "Unauthenticated request rejected (401)"
    else
        fail "Unauthenticated request should return 401, got: $NO_AUTH_RESPONSE"
    fi

    # 错误 token 应被拒绝
    WRONG_AUTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -H "X-API-Key: wrong_key" "${ADMIN_URL}/api/clients")
    if [ "$WRONG_AUTH_RESPONSE" = "401" ]; then
        pass "Wrong API key rejected (401)"
    else
        fail "Wrong API key should return 401, got: $WRONG_AUTH_RESPONSE"
    fi

    # 正确 token 应通过
    CORRECT_AUTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -H "X-API-Key: ${TEST_ADMIN_API_KEY}" "${ADMIN_URL}/api/clients")
    if [ "$CORRECT_AUTH_RESPONSE" = "200" ]; then
        pass "Correct API key accepted (200)"
    else
        fail "Correct API key should return 200, got: $CORRECT_AUTH_RESPONSE"
    fi
fi

# ============================================================================
# 6. 测试 - 桥接层状态
# ============================================================================
info "=== Test: Bridge Status ==="
STATUS=$(curl -s $(get_admin_auth_header) "${ADMIN_URL}/api/status")
info "Bridge status: $STATUS"

if echo "$STATUS" | grep -q '"bridge_running"'; then
    pass "Bridge status endpoint responds"
else
    fail "Bridge status endpoint failed"
fi

if echo "$STATUS" | grep -q '"hbbs_addr"'; then
    pass "Bridge reports hbbs address"
else
    fail "Bridge missing hbbs address"
fi

# ============================================================================
# 7. 测试 - 客户端注册
# ============================================================================
info "=== Test: Client Registration ==="
REG_RESPONSE=$(curl -s -X POST $(get_client_auth_header) "${ADMIN_URL}/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "client_id": "test-client-001",
        "name": "Test Client",
        "os": "darwin",
        "os_version": "24.0.0",
        "arch": "aarch64",
        "client_version": "0.1.0"
    }')

if echo "$REG_RESPONSE" | grep -q '"success":true'; then
    pass "Client registration successful"
else
    fail "Client registration failed: $REG_RESPONSE"
fi

# ============================================================================
# 8. 测试 - 客户端列表
# ============================================================================
info "=== Test: Client List ==="
CLIENTS=$(curl -s $(get_admin_auth_header) "${ADMIN_URL}/api/clients")

if echo "$CLIENTS" | grep -q '"test-client-001"'; then
    pass "Registered client appears in client list"
else
    fail "Client not found in list: $CLIENTS"
fi

TOTAL=$(echo "$CLIENTS" | python3 -c "import sys,json; print(json.load(sys.stdin)['total'])" 2>/dev/null || echo "?")
info "Total clients: $TOTAL"

# ============================================================================
# 9. 测试 - 获取单个客户端
# ============================================================================
info "=== Test: Get Client ==="
CLIENT=$(curl -s $(get_admin_auth_header) "${ADMIN_URL}/api/clients/test-client-001")

if echo "$CLIENT" | grep -q '"online":true'; then
    pass "Client is online"
else
    fail "Client not online: $CLIENT"
fi

# ============================================================================
# 10. 测试 - 客户端心跳
# ============================================================================
info "=== Test: Heartbeat ==="
HB_RESPONSE=$(curl -s -X POST $(get_client_auth_header) "${ADMIN_URL}/api/heartbeat" \
    -H "Content-Type: application/json" \
    -d '{"client_id": "test-client-001", "latency_ms": 25}')

if echo "$HB_RESPONSE" | grep -q '"success":true'; then
    pass "Heartbeat accepted"
else
    fail "Heartbeat failed: $HB_RESPONSE"
fi

# ============================================================================
# 11. 测试 - 发送消息到客户端
# ============================================================================
info "=== Test: Send Message ==="
MSG_RESPONSE=$(curl -s -X POST $(get_admin_auth_header) "${ADMIN_URL}/api/clients/test-client-001/message" \
    -H "Content-Type: application/json" \
    -d '{
        "message_type": "AgentTaskRequest",
        "payload": {
            "task_type": "echo",
            "params": {"message": "hello from e2e test"}
        }
    }')

if echo "$MSG_RESPONSE" | grep -q '"success":true'; then
    pass "Message sent successfully"
    MSG_ID=$(echo "$MSG_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['message_id'])" 2>/dev/null || echo "unknown")
    info "Message ID: $MSG_ID"
else
    fail "Message send failed: $MSG_RESPONSE"
fi

# ============================================================================
# 12. 测试 - 客户端轮询消息
# ============================================================================
info "=== Test: Poll Messages ==="
POLL_RESPONSE=$(curl -s -X POST $(get_client_auth_header) "${ADMIN_URL}/api/poll" \
    -H "Content-Type: application/json" \
    -d '{"client_id": "test-client-001"}')

if echo "$POLL_RESPONSE" | grep -q '"AgentTaskRequest"'; then
    pass "Client received AgentTaskRequest message"
else
    fail "Client did not receive message: $POLL_RESPONSE"
fi

if echo "$POLL_RESPONSE" | grep -q '"hello from e2e test"'; then
    pass "Message payload matches"
else
    fail "Message payload mismatch: $POLL_RESPONSE"
fi

# ============================================================================
# 13. 测试 - 客户端上报消息
# ============================================================================
info "=== Test: Report Message ==="
REPORT_RESPONSE=$(curl -s -X POST $(get_client_auth_header) "${ADMIN_URL}/api/report" \
    -H "Content-Type: application/json" \
    -d '{
        "client_id": "test-client-001",
        "message_type": "AgentTaskResponse",
        "payload": {"status": "completed", "result": "echo: hello from e2e test"},
        "in_reply_to": "'"$MSG_ID"'"
    }')

if echo "$REPORT_RESPONSE" | grep -q '"success":true'; then
    pass "Report accepted"
else
    fail "Report failed: $REPORT_RESPONSE"
fi

# ============================================================================
# 14. 测试 - 在线客户端列表
# ============================================================================
info "=== Test: Online Clients ==="
ONLINE=$(curl -s $(get_admin_auth_header) "${ADMIN_URL}/api/clients/online")

if echo "$ONLINE" | grep -q '"test-client-001"'; then
    pass "Client in online list"
else
    fail "Client not in online list: $ONLINE"
fi

# ============================================================================
# 15. 测试 - 第二次轮询（消息已消费完）
# ============================================================================
info "=== Test: Empty Poll ==="
POLL2=$(curl -s -X POST $(get_client_auth_header) "${ADMIN_URL}/api/poll" \
    -H "Content-Type: application/json" \
    -d '{"client_id": "test-client-001"}')

MSG_COUNT=$(echo "$POLL2" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['messages']))" 2>/dev/null || echo "?")
if [ "$MSG_COUNT" = "0" ]; then
    pass "Second poll returns empty (messages consumed)"
else
    fail "Second poll should be empty, got $MSG_COUNT messages"
fi

# ============================================================================
# 16. 测试 - 任务管理 API：创建任务
# ============================================================================
echo ""
info "=== Test: Task Management - Create Task ==="
TASK_RESPONSE=$(curl -s -X POST $(get_admin_auth_header) "${ADMIN_URL}/api/tasks/chat" \
    -H "Content-Type: application/json" \
    -d '{
        "client_id": "test-client-001",
        "project_id": "test-project-001",
        "prompt": "Hello, this is a test task",
        "service_type": "RCoder"
    }')

if echo "$TASK_RESPONSE" | grep -q '"success":true'; then
    pass "Task created successfully"
    TASK_ID=$(echo "$TASK_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['task_id'])" 2>/dev/null || echo "unknown")
    info "Task ID: $TASK_ID"
else
    fail "Task creation failed: $TASK_RESPONSE"
    TASK_ID=""
fi

# ============================================================================
# 17. 测试 - 任务列表
# ============================================================================
info "=== Test: Task Management - List Tasks ==="
TASKS=$(curl -s $(get_admin_auth_header) "${ADMIN_URL}/api/tasks")

if echo "$TASKS" | grep -q '"total"'; then
    pass "Task list endpoint responds"
    TASK_TOTAL=$(echo "$TASKS" | python3 -c "import sys,json; print(json.load(sys.stdin)['total'])" 2>/dev/null || echo "?")
    info "Total tasks: $TASK_TOTAL"
else
    fail "Task list endpoint failed: $TASKS"
fi

# ============================================================================
# 18. 测试 - 按客户端过滤任务
# ============================================================================
info "=== Test: Task Management - List Tasks by Client ==="
TASKS_BY_CLIENT=$(curl -s $(get_admin_auth_header) "${ADMIN_URL}/api/tasks?client_id=test-client-001")

if echo "$TASKS_BY_CLIENT" | grep -q '"test-client-001"'; then
    pass "Tasks filtered by client_id"
else
    fail "Task filter by client_id failed: $TASKS_BY_CLIENT"
fi

# ============================================================================
# 19. 测试 - 获取任务详情
# ============================================================================
if [ -n "$TASK_ID" ] && [ "$TASK_ID" != "unknown" ]; then
    info "=== Test: Task Management - Get Task ==="
    TASK_DETAIL=$(curl -s $(get_admin_auth_header) "${ADMIN_URL}/api/tasks/${TASK_ID}")

    if echo "$TASK_DETAIL" | grep -q '"task_id"'; then
        pass "Task detail retrieved"
        TASK_STATUS=$(echo "$TASK_DETAIL" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null || echo "?")
        info "Task status: $TASK_STATUS"
    else
        fail "Task detail retrieval failed: $TASK_DETAIL"
    fi

    # ============================================================================
    # 20. 测试 - 获取任务状态
    # ============================================================================
    info "=== Test: Task Management - Get Task Status ==="
    TASK_STATUS_RESPONSE=$(curl -s $(get_admin_auth_header) "${ADMIN_URL}/api/tasks/${TASK_ID}/status")

    if echo "$TASK_STATUS_RESPONSE" | grep -q '"status"'; then
        pass "Task status endpoint responds"
    else
        fail "Task status endpoint failed: $TASK_STATUS_RESPONSE"
    fi
fi

# ============================================================================
# 21. 测试 - Agent 状态
# ============================================================================
info "=== Test: Agent Status ==="
AGENT_STATUS=$(curl -s $(get_admin_auth_header) "${ADMIN_URL}/api/clients/test-client-001/agent/status")

if echo "$AGENT_STATUS" | grep -q '"status"'; then
    pass "Agent status endpoint responds"
    STATUS_VALUE=$(echo "$AGENT_STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null || echo "?")
    info "Agent status: $STATUS_VALUE"
else
    fail "Agent status endpoint failed: $AGENT_STATUS"
fi

# ============================================================================
# 22. 测试 - 客户端轮询任务消息
# ============================================================================
info "=== Test: Poll Task Messages ==="
POLL_TASK=$(curl -s -X POST $(get_client_auth_header) "${ADMIN_URL}/api/poll" \
    -H "Content-Type: application/json" \
    -d '{"client_id": "test-client-001"}')

if echo "$POLL_TASK" | grep -q '"AgentTaskRequest"'; then
    pass "Client received task as AgentTaskRequest message"
else
    # 可能已经在之前的测试中被消费
    info "No new task messages (may have been consumed)"
fi

# ============================================================================
# 23. 测试 - 取消任务
# ============================================================================
if [ -n "$TASK_ID" ] && [ "$TASK_ID" != "unknown" ]; then
    info "=== Test: Task Management - Cancel Task ==="
    CANCEL_RESPONSE=$(curl -s -X POST $(get_admin_auth_header) "${ADMIN_URL}/api/tasks/${TASK_ID}/cancel" \
        -H "Content-Type: application/json" \
        -d '{"reason": "E2E test cancellation"}')

    if echo "$CANCEL_RESPONSE" | grep -q '"success":true'; then
        pass "Task cancelled successfully"
    else
        # 任务可能已完成，取消会失败
        if echo "$CANCEL_RESPONSE" | grep -q '"Task already completed"'; then
            pass "Task already completed (cannot cancel)"
        else
            fail "Task cancellation failed: $CANCEL_RESPONSE"
        fi
    fi
fi

# ============================================================================
# 24. 测试 - P2P 连接（需要 client 带 P2P 密码注册）
# ============================================================================
info "=== Test: P2P Connection ==="

# 注册带 P2P 密码的客户端
P2P_REG_RESPONSE=$(curl -s -X POST $(get_client_auth_header) "${ADMIN_URL}/api/register" \
    -H "Content-Type: application/json" \
    -d '{
        "client_id": "p2p-client-001",
        "name": "P2P Test Client",
        "os": "darwin",
        "os_version": "24.0.0",
        "arch": "aarch64",
        "client_version": "0.1.0",
        "p2p_password": "test_p2p_password_123"
    }')

if echo "$P2P_REG_RESPONSE" | grep -q '"success":true'; then
    pass "P2P client registration successful"
else
    fail "P2P client registration failed: $P2P_REG_RESPONSE"
fi

# 尝试建立 P2P 连接（预期失败，因为没有真正的 agent-client 运行）
# 这个测试主要验证 API 接口工作正常
P2P_CONNECT_RESPONSE=$(curl -s -X POST $(get_admin_auth_header) "${ADMIN_URL}/api/clients/p2p-client-001/connect" \
    -H "Content-Type: application/json" \
    -d '{}')

if echo "$P2P_CONNECT_RESPONSE" | grep -q '"success":true'; then
    pass "P2P connection initiated successfully"
else
    # 连接可能失败（因为没有真正的 peer），但 API 应该正常响应
    if echo "$P2P_CONNECT_RESPONSE" | grep -q '"message"'; then
        pass "P2P connection API responds (connection may fail without real peer)"
        info "P2P response: $P2P_CONNECT_RESPONSE"
    else
        fail "P2P connection API failed: $P2P_CONNECT_RESPONSE"
    fi
fi

# ============================================================================
# 25. 测试 - 桥接状态检查 P2P 连接数
# ============================================================================
info "=== Test: Bridge P2P Status ==="
P2P_STATUS=$(curl -s $(get_admin_auth_header) "${ADMIN_URL}/api/status")

if echo "$P2P_STATUS" | grep -q '"p2p_connections"'; then
    pass "Bridge status includes P2P connection count"
    P2P_COUNT=$(echo "$P2P_STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('p2p_connections', 'N/A'))" 2>/dev/null || echo "?")
    info "P2P connections: $P2P_COUNT"
else
    fail "Bridge status missing P2P connection info"
fi

# ============================================================================
# 26. 测试 - P2P 消息发送（模拟模式，队列回退）
# ============================================================================
info "=== Test: P2P Message Send ==="
P2P_MSG_RESPONSE=$(curl -s -X POST $(get_admin_auth_header) "${ADMIN_URL}/api/clients/p2p-client-001/message" \
    -H "Content-Type: application/json" \
    -d '{
        "message_type": "AgentTaskRequest",
        "payload": {
            "task_type": "echo",
            "params": {"message": "P2P test message"}
        }
    }')

if echo "$P2P_MSG_RESPONSE" | grep -q '"success":true'; then
    pass "P2P message sent successfully"
    # 检查是否通过 P2P 发送或回退到队列
    if echo "$P2P_MSG_RESPONSE" | grep -q '"sent_via_p2p":true'; then
        info "Message sent via P2P"
    else
        info "Message queued (P2P not connected)"
    fi
else
    fail "P2P message send failed: $P2P_MSG_RESPONSE"
fi

# ============================================================================
# 27. 测试 - 停止 Agent
# ============================================================================
info "=== Test: Stop Agent ==="
STOP_RESPONSE=$(curl -s -X POST $(get_admin_auth_header) "${ADMIN_URL}/api/clients/test-client-001/agent/stop" \
    -H "Content-Type: application/json" \
    -d '{"reason": "E2E test stop"}')

if echo "$STOP_RESPONSE" | grep -q '"success":true'; then
    pass "Stop agent command sent successfully"
    CANCELLED=$(echo "$STOP_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('cancelled_tasks', 0))" 2>/dev/null || echo "?")
    info "Cancelled tasks: $CANCELLED"
else
    fail "Stop agent failed: $STOP_RESPONSE"
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
info "Logs: /tmp/data-server.log, /tmp/admin-server.log"

exit $FAILURES
