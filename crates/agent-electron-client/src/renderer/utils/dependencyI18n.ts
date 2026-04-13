import { I18N_KEYS } from "@shared/constants";
import { t } from "../services/core/i18n";

interface DependencyNameInput {
  name: string;
  displayName?: string;
}

/**
 * 统一解析依赖名称的展示文案（多语言兜底）。
 *
 * 设计目的：
 * - 后端在个别异常场景可能返回未翻译 key，甚至错误拼接的 key；
 * - 若前端直接展示该值，会把内部 key 暴露给用户，影响可读性；
 * - 因此前端按稳定包名优先映射本地 i18n，再回退后端字段。
 */
export function resolveDepDisplayName(dep: DependencyNameInput): string {
  const keyByPackageName: Record<string, string> = {
    uv: I18N_KEYS.Pages.Dependencies.DEP_UV,
    pnpm: I18N_KEYS.Pages.Dependencies.DEP_PNPM,
    "@anthropic-ai/sdk": I18N_KEYS.Pages.Dependencies.DEP_ANTHROPIC_SDK,
    "claude-code-acp-ts": I18N_KEYS.Pages.Dependencies.DEP_CLAUDE_CODE_ACP,
    "nuwax-file-server": I18N_KEYS.Pages.Dependencies.DEP_FILE_SERVER,
    "nuwax-mcp-stdio-proxy": I18N_KEYS.Pages.Dependencies.DEP_MCP_PROXY,
    nuwaxcode: I18N_KEYS.Pages.Dependencies.DEP_NUWAXCODE,
  };

  const mappedKey = keyByPackageName[dep.name];
  if (mappedKey) return t(mappedKey);

  const fallbackDisplayName = dep.displayName?.trim();
  if (!fallbackDisplayName) return dep.name;

  if (fallbackDisplayName.includes("Claw.Pages.Dependencies.dep.")) {
    const translated = t(fallbackDisplayName);
    return translated !== fallbackDisplayName ? translated : dep.name;
  }

  return fallbackDisplayName;
}
