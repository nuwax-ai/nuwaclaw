/**
 * ttyd 终端路由 query 参数契约（/computer/ttyd/{userId}/{projectId}/{*path}）。
 *
 * 与服务端 rcoder/Pingora 契约对齐（crates/rcoder-proxy/src/service/handlers/
 * ttyd_params.rs + shared_types normalize_absolute_dir 的 TS 孪生）：
 * - service_type：业务场景枚举，省略=默认 computer-agent-runner；非法值/非
 *   computer 族（如 web-agent-runner）→ 400。本机网关仅 query 通道（浏览器
 *   原生 WebSocket 无法设自定义 header），不实现 header/query 合并矩阵。
 * - cwd：显式终端初始目录，多平台绝对路径归一（POSIX/盘符/UNC、反斜杠折叠、
 *   拒点段/控制字符/超长），优先于按业务推导的默认目录。合法 ≠ 可用——目录
 *   存在性回落归网关（对齐 agent_runner resolve_explicit_cwd 的 warn+回落）。
 *
 * 解码语义：form 形态（+ 与 %20 均为空格），URLSearchParams 解析天然满足且
 * 重复键 last-wins——与服务端 parse_terminal_query 一致（重复不 400）。
 * 已知分歧：Node URLSearchParams 把非法 percent 序列解为 U+FFFD 而非报错，
 * 该形态目录必然不存在 → 走回落，无安全影响（服务端为 400）。
 *
 * 本模块为纯函数（无 fs/无 gateway 依赖），可独立测试。
 */

/** computer 族业务场景枚举（与服务端 ServiceType kebab-case wire 词对齐） */
export type TtydServiceType =
  | "computer-agent-runner"
  | "computer-normal-project";

export const DEFAULT_TTYD_SERVICE_TYPE: TtydServiceType =
  "computer-agent-runner";

/** cwd 长度上限（按 Unicode 字符数计，对齐服务端 normalize_absolute_dir） */
export const MAX_TTYD_CWD_LENGTH = 512;

export type TtydRouteParamErrorCode =
  | "TTYD_SERVICE_TYPE_INVALID"
  | "TTYD_CWD_INVALID"
  /** cwd query 与存量 arg=--cwd 通道值冲突（gateway 侧检测产生） */
  | "TTYD_CWD_CONFLICT";

export type TtydRouteParamsResolution =
  | { ok: true; serviceType: TtydServiceType; cwd: string | null }
  | { ok: false; code: TtydRouteParamErrorCode; message: string };

type ValueValidation<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

/**
 * service_type 归一词表（对齐 rcoder ServiceType::from_str 的 computer 族子集）：
 * kebab-case 规范词 + camelCase/PascalCase 兼容词。
 */
const SERVICE_TYPE_WORDS: Record<string, TtydServiceType> = {
  "computer-agent-runner": "computer-agent-runner",
  ComputerAgentRunner: "computer-agent-runner",
  "computer-normal-project": "computer-normal-project",
  normalProject: "computer-normal-project",
  ComputerNormalProject: "computer-normal-project",
};

/** 校验单个 service_type 值（空串视为非法——出现即必须可解析） */
export function validateTtydServiceTypeValue(
  raw: string,
): ValueValidation<TtydServiceType> {
  const normalized = SERVICE_TYPE_WORDS[raw.trim()];
  if (!normalized) {
    return {
      ok: false,
      message: `invalid service_type query parameter: ${raw}`,
    };
  }
  return { ok: true, value: normalized };
}

const CONTROL_CHARS_PATTERN = /[\u0000-\u001F\u007F]/;

/** 盘符形态：X:/（首字符 ASCII 字母 + : + /），对齐服务端 is_drive_form */
function isDriveForm(dir: string): boolean {
  return (
    dir.length >= 3 &&
    /[A-Za-z]/.test(dir[0]) &&
    dir[1] === ":" &&
    dir[2] === "/"
  );
}

/**
 * 剥离 Windows verbatim 前缀（在分隔符归一之前，否则 `\\?\` 被折叠成 `//?/`
 * 产出非法形态）：`\\?\C:\x` → `C:\x`；`\\?\UNC\server\share` → `\\server\share`。
 */
function stripVerbatim(dir: string): string {
  if (dir.startsWith("\\\\?\\UNC\\")) {
    // 还原双前导反斜杠（模板字符串中 \\\\ = 两个字符）
    return "\\\\" + dir.slice("\\\\?\\UNC\\".length);
  }
  if (dir.startsWith("\\\\?\\")) {
    return dir.slice("\\\\?\\".length);
  }
  return dir;
}

/**
 * 分隔符归一：`\` → `/`，折叠段间重复分隔符；UNC 前导 `//` 保留；
 * 盘符首字母大写（大小写不敏感形态统一）。镜像服务端 canonicalize_dir。
 */
function canonicalizeDir(dir: string): string {
  const unc = dir.startsWith("//") || dir.startsWith("\\\\");
  let collapsed = "";
  let inSeparator = false;
  for (const ch of dir) {
    const normalized = ch === "\\" ? "/" : ch;
    if (normalized === "/") {
      if (!inSeparator) collapsed += "/";
      inSeparator = true;
    } else {
      collapsed += normalized;
      inSeparator = false;
    }
  }
  let result = unc ? `/${collapsed}` : collapsed;
  // 盘符首字母大写（^[a-z]:/ → ^[A-Z]:/）
  if (result.length >= 3 && isDriveForm(result)) {
    result = result[0].toUpperCase() + result.slice(1);
  }
  return result;
}

/**
 * cwd 多平台绝对路径归一（镜像服务端 normalize_absolute_dir 的词汇表）：
 * trim → 限长 512（字符数）→ 拒控制字符 → 剥 verbatim → 分隔符归一 →
 * 须以 `/` 或盘符 `X:/` 开头 → 归一后无 `.`/`..` 段。
 * 成功返回归一化路径（调用方以返回值为准），失败返回英文 message（→ 400）。
 * 不做存在性检查——目录缺失由网关 warn 后回落业务默认目录（对齐服务端语义）。
 */
export function normalizeTtydAbsoluteDir(raw: string): ValueValidation<string> {
  const dir = raw.trim();
  if ([...dir].length > MAX_TTYD_CWD_LENGTH) {
    return { ok: false, message: "cwd length exceeds 512" };
  }
  if (CONTROL_CHARS_PATTERN.test(dir)) {
    return { ok: false, message: "cwd contains illegal characters" };
  }
  const canonical = canonicalizeDir(stripVerbatim(dir));
  if (!(canonical.startsWith("/") || isDriveForm(canonical))) {
    return {
      ok: false,
      message:
        "cwd must be an absolute path (POSIX /a/b, Windows C:/a/b or UNC //server/share/a/b)",
    };
  }
  if (canonical.split("/").some((seg) => seg === "." || seg === "..")) {
    return { ok: false, message: "cwd must not contain dot segments" };
  }
  return { ok: true, value: canonical };
}

/**
 * 提取并校验 /computer/ttyd 路由的 query 契约参数。
 * service_type 省略 → 默认；cwd 省略 → null。重复键 last-wins——注意
 * URLSearchParams.get() 取首个值（WHATWG 语义），与服务端 parse_terminal_query
 * 的逐对覆盖（last-wins）不一致，故此处用 getAll 取末位对齐。任一参数非法 →
 * 统一错误码 + message（网关据此回 400）。
 */
export function parseTtydRouteParams(
  params: URLSearchParams,
): TtydRouteParamsResolution {
  const serviceTypeValues = params.getAll("service_type");
  let serviceType: TtydServiceType = DEFAULT_TTYD_SERVICE_TYPE;
  if (serviceTypeValues.length > 0) {
    const resolved = validateTtydServiceTypeValue(
      serviceTypeValues[serviceTypeValues.length - 1],
    );
    if (!resolved.ok) {
      return {
        ok: false,
        code: "TTYD_SERVICE_TYPE_INVALID",
        message: resolved.message,
      };
    }
    serviceType = resolved.value;
  }

  const cwdValues = params.getAll("cwd");
  let cwd: string | null = null;
  if (cwdValues.length > 0) {
    const resolved = normalizeTtydAbsoluteDir(cwdValues[cwdValues.length - 1]);
    if (!resolved.ok) {
      return { ok: false, code: "TTYD_CWD_INVALID", message: resolved.message };
    }
    cwd = resolved.value;
  }

  return { ok: true, serviceType, cwd };
}
