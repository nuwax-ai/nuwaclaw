export type UpdateStatus = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';

export interface UpdateProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export interface UpdateInfo {
  hasUpdate: boolean;
  version?: string;
  releaseDate?: string;
  releaseNotes?: string;
  error?: string;
  /** 上一次检查仍在进行中，本次调用被跳过 */
  alreadyChecking?: boolean;
}

export interface UpdateState {
  status: UpdateStatus;
  version?: string;
  progress?: UpdateProgress;
  error?: string;
  /** false 表示当前安装方式不支持自动更新（如 Windows MSI），需要手动下载 */
  canAutoUpdate?: boolean;
  /** true 表示因应用在只读卷运行（如从「下载」直接打开）导致无法就地更新，应引导用户前往下载页 */
  isReadOnlyVolumeError?: boolean;
}
