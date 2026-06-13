/**
 * macOS 系统设置「隐私与安全性」各子面板的统一入口。
 *
 * 多处需要打开系统设置面板(工作区权限引导、权限页 IPC 等),
 * 集中维护 URL，避免散落多处的 `x-apple.systempreferences:...` 字符串随 macOS 版本漂移时漏改。
 */
import { shell } from "electron";
import log from "electron-log";

/** macOS 隐私面板 → 系统设置 URL（模块私有：外部统一走 openMacPrivacySettings，避免绕过平台/错误处理） */
const MAC_PRIVACY_PANE_URLS = {
  accessibility:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  screen_recording:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  file_access:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
} as const;

export type MacPrivacyPane = keyof typeof MAC_PRIVACY_PANE_URLS;

/** 判断给定 key 是否是受支持的隐私面板。 */
export function isMacPrivacyPane(key: string): key is MacPrivacyPane {
  return key in MAC_PRIVACY_PANE_URLS;
}

/**
 * 打开 macOS 系统设置的指定隐私面板。
 * 非 darwin 平台或打开失败时返回 false（不抛错）。
 */
export async function openMacPrivacySettings(
  pane: MacPrivacyPane,
): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  const url = MAC_PRIVACY_PANE_URLS[pane];
  try {
    await shell.openExternal(url);
    return true;
  } catch (e) {
    log.error(`[macPermissions] openExternal failed for "${pane}":`, e);
    return false;
  }
}
