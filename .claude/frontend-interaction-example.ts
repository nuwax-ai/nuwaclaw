// 前端界面交互示例（TypeScript）
import { invoke } from '@tauri-apps/api/core';

// 1. 启动 Lanproxy 按钮点击
async function handleStartLanproxy() {
  try {
    const result = await invoke<boolean>('lanproxy_start');
    if (result) {
      console.log('[UI] Lanproxy 启动成功');
      updateStatus('running');
    }
  } catch (error) {
    console.error('[UI] Lanproxy 启动失败:', error);
    showErrorToast(error);
  }
}

// 2. 停止 Lanproxy 按钮点击
async function handleStopLanproxy() {
  try {
    const result = await invoke<boolean>('lanproxy_stop');
    if (result) {
      console.log('[UI] Lanproxy 已停止');
      updateStatus('stopped');
    }
  } catch (error) {
    console.error('[UI] Lanproxy 停止失败:', error);
    showErrorToast(error);
  }
}

// 3. 重启 Lanproxy 按钮点击
async function handleRestartLanproxy() {
  try {
    updateStatus('restarting');
    const result = await invoke<boolean>('lanproxy_restart');
    if (result) {
      console.log('[UI] Lanproxy 重启成功');
      updateStatus('running');
    }
  } catch (error) {
    console.error('[UI] Lanproxy 重启失败:', error);
    showErrorToast(error);
    updateStatus('error');
  }
}

// 4. 轮询查询状态
async function pollServicesStatus() {
  try {
    const status = await invoke<ServicesStatus>('services_status_all');

    // 更新 Lanproxy 状态
    if (status.lanproxy.status === 'Running') {
      updateStatus('running');
      updatePid(status.lanproxy.pid);
    } else {
      updateStatus('stopped');
      updatePid(null);
    }
  } catch (error) {
    console.error('[UI] 状态查询失败:', error);
  }
}

// 每 3 秒轮询一次
setInterval(pollServicesStatus, 3000);

// 5. UI 组件示例（React）
function LanproxyControlPanel() {
  const [status, setStatus] = useState<'running' | 'stopped' | 'restarting'>('stopped');
  const [pid, setPid] = useState<number | null>(null);

  return (
    <div className="lanproxy-panel">
      <div className="status-indicator">
        状态: {status === 'running' ? '🟢 运行中' : '🔴 已停止'}
        {pid && <span className="pid-display">PID: {pid}</span>}
      </div>

      <div className="control-buttons">
        <button
          onClick={handleStartLanproxy}
          disabled={status === 'running'}
        >
          启动
        </button>

        <button
          onClick={handleStopLanproxy}
          disabled={status === 'stopped'}
        >
          停止
        </button>

        <button
          onClick={handleRestartLanproxy}
          disabled={status === 'stopped'}
        >
          重启
        </button>
      </div>
    </div>
  );
}

// 类型定义
interface ServicesStatus {
  file_server: ServiceStatus;
  lanproxy: {
    status: 'Running' | 'Stopped';
    pid: number | null;
  };
  mcp_proxy: ServiceStatus;
}

interface ServiceStatus {
  status: string;
  port?: number;
  pid?: number;
}
