/**
 * NuwaClawBridge：nuwaclaw 注入到 webview guest（nuwax）window 上的双边桥。
 * 浏览器端不存在；nuwax 消费前需判断 `window.NuwaClawBridge` 是否存在。
 * 桥前端见 preload/webviewPerfBridge.ts，后端见 main/ipc/nuwaxBridgeHandlers.ts。
 */
export interface NuwaClawBridgePerf {
  enabled(): boolean;
  mark(stage: string, payload?: Record<string, unknown>): void;
  markOnce(key: string, stage: string, payload?: Record<string, unknown>): void;
}

export interface NuwaClawBridgeAuth {
  /** 读取本 origin 持久化的 nuwax ACCESS_TOKEN（重启免登）。 */
  getToken(): Promise<string | null>;
  /** nuwax 登录成功后持久化 token。 */
  persistToken(token: string): Promise<boolean>;
  /** nuwax 登出联动：清除本 origin 的持久化 token。 */
  clear(): Promise<boolean>;
}

export interface NuwaClawBridgeNative {
  /** 右键另存图片：系统保存对话框 + 下载。 */
  saveImage(
    url: string,
    filename?: string,
  ): Promise<{ success: boolean; path?: string; error?: string }>;
}

export interface NuwaClawBridge {
  perf?: NuwaClawBridgePerf;
  auth?: NuwaClawBridgeAuth;
  native?: NuwaClawBridgeNative;
}

declare global {
  interface Window {
    NuwaClawBridge?: NuwaClawBridge;
  }
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          partition?: string;
          allowpopups?: string;
          preload?: string;
          httpreferrer?: string;
          useragent?: string;
        },
        HTMLElement
      >;
    }
  }
}
