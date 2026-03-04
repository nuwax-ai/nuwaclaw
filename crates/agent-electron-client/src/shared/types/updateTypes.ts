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
}

export interface UpdateState {
  status: UpdateStatus;
  version?: string;
  progress?: UpdateProgress;
  error?: string;
  /** false 表示当前安装方式不支持自动更新（如 Windows MSI），需要手动下载 */
  canAutoUpdate?: boolean;
}
