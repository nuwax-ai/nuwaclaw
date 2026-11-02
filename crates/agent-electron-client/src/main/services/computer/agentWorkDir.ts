/**
 * agent_work_dir 三轨校验与归一化（/computer/chat 及 IPC computer:chat 共用）。
 *
 * 三轨制（2026-09 normalProject 需求，在双轨制上扩展）：
 * - 标识符轨道：!path.isAbsolute(v) —— 维持原校验 [a-zA-Z0-9_-]{1,64}，
 *   目录由 {workspace}/computer-project-workspace/{userId}/{id} 拼接（存量调用零影响）。
 * - 绝对路径轨道：path.isAbsolute(v) —— nuwax web 目录选择弹窗（file-server fs/roots
 *   + fs/children）回传的本机目录。须存在（fail fast 不误建）、是目录、可写；
 *   realpathSync 归一化（消解 symlink / macOS 大小写形态）后作为唯一形态回写
 *   body.agent_work_dir——下游引擎复用、会话注册表、派发串行化、SSE 清理等
 *   把它当 key 的位置拿到的都是同一字符串，key 函数免改。
 * - normalProject 轨道：service_type=computer-normal-project 的常规项目会话。
 *   云端容器布局为 /home/user/normalProject/{project_id}（rcoder chat 物化与
 *   agent-runner 终端推导同根），本机镜像为
 *   {workspace}/computer-project-workspace/{userId}/normalProject/{pid}。
 *   判定（主判据）：service_type 归一后为 normalProject 且 agent_work_dir 为
 *   单段名（Java SandboxAgentClient 下发 devTargetId 形态）。
 *   容错：agent_work_dir 形如 /home/user/normalProject/{pid}（rcoder 物化形态）
 *   时即使 service_type 缺失也按此轨道，pid 提取后作为归一值回写（下游 key 统一）。
 *   service_type=normalProject 但 agent_work_dir 为其他绝对路径：web 目录弹窗
 *   自选的本机目录（Java agentWorkspacePath 覆盖场景）——走绝对路径轨道。
 *
 * 安全边界（产品拍板 2026-09-14）：默认全放，仅存在性+可写校验；边界=lanproxy
 * 登录隧道（请求来自登录用户的后端转发）。后续如需收紧为目录白名单，收口在本
 * 模块单点。
 *
 * 历史兼容：旧正则保证存量成功请求不可能含 / 或盘符，轨道判别无旧数据误判。
 */
import * as fs from "fs";
import * as path from "path";

/** 绝对路径轨道长度上限（常见 PATH_MAX；标识符轨道维持 64） */
const MAX_ABS_PATH_LENGTH = 4096;

/** 标识符轨道原正则（与改造前 router.ts validateAgentWorkDir 一致） */
const IDENTIFIER_PATTERN = /^[a-zA-Z0-9_-]+$/;

/** 标识符轨道长度上限（与原正则配套；normalProject pid 同口径） */
const MAX_IDENTIFIER_LENGTH = 64;

/** normalProject 业务的 service_type wire 词（kebab-case 规范 + camelCase/PascalCase 兼容词，对齐 rcoder FromStr） */
const NORMAL_PROJECT_SERVICE_TYPE_WORDS = new Set([
  "computer-normal-project",
  "normalProject",
  "ComputerNormalProject",
]);

/** rcoder 物化形态前缀（云端容器内常规项目工作区根） */
export const NORMAL_PROJECT_CONTAINER_PREFIX = "/home/user/normalProject/";

export type AgentWorkDirErrorCode =
  | "AGENT_WORK_DIR_INVALID"
  | "AGENT_WORK_DIR_NOT_FOUND"
  | "AGENT_WORK_DIR_NOT_A_DIRECTORY"
  | "AGENT_WORK_DIR_NOT_WRITABLE";

export type AgentWorkDirResolution =
  | { ok: true; kind: "id" | "abs" | "normal-project"; value: string }
  | { ok: false; code: AgentWorkDirErrorCode; message: string };

export function isAbsoluteAgentWorkDir(value: string): boolean {
  return path.isAbsolute(value);
}

/** service_type 是否为常规项目（normalProject）业务 */
export function isNormalProjectServiceType(serviceType?: string): boolean {
  if (!serviceType) return false;
  return NORMAL_PROJECT_SERVICE_TYPE_WORDS.has(serviceType.trim());
}

/**
 * 识别 rcoder 物化形态的 normalProject 容器路径（/home/user/normalProject/{pid}），
 * 返回 pid（须过标识符校验）；其余形态（含更深嵌套/非法段）返回 null。
 */
export function extractNormalProjectContainerPid(raw: string): string | null {
  if (!raw.startsWith(NORMAL_PROJECT_CONTAINER_PREFIX)) return null;
  const pid = raw.slice(NORMAL_PROJECT_CONTAINER_PREFIX.length);
  if (!pid || pid.length > MAX_IDENTIFIER_LENGTH) return null;
  return IDENTIFIER_PATTERN.test(pid) ? pid : null;
}

/**
 * 三轨校验入口。成功返回归一化后的唯一形态 value（标识符原样；绝对路径为
 * realpath；normalProject 容器物化形态提取为 pid 单段名），失败返回分类错误码
 * 与可读 message（经 HTTP 400 / IPC 错误体透出，前端 toast 直接展示）。
 *
 * options.serviceType：请求体 service_type 字段。normalProject 业务时单段名
 * 标识符升级为 normal-project 轨道（value 不变）；缺省时行为与双轨制完全一致。
 */
export function validateAgentWorkDirInput(
  raw: string,
  options?: { serviceType?: string },
): AgentWorkDirResolution {
  if (!raw) {
    return {
      ok: false,
      code: "AGENT_WORK_DIR_INVALID",
      message: "agent_work_dir must be 1-64 characters",
    };
  }

  if (path.isAbsolute(raw)) {
    // normalProject 容器物化形态（rcoder：/home/user/normalProject/{pid}）：
    // 无论 service_type 是否携带都按此轨道——双轨制下它会因目录不存在被误拒。
    // pid 提取后作为归一值回写，与单段名形态的下游 key 统一。
    const containerPid = extractNormalProjectContainerPid(raw);
    if (containerPid) {
      return { ok: true, kind: "normal-project", value: containerPid };
    }
    // service_type=normalProject + 其他绝对路径：Java agentWorkspacePath 覆盖的
    // 本机自选目录场景——维持绝对路径轨道（存在性/可写校验照旧），不做映射。
    if (raw.length > MAX_ABS_PATH_LENGTH) {
      return {
        ok: false,
        code: "AGENT_WORK_DIR_INVALID",
        message: `agent_work_dir path exceeds ${MAX_ABS_PATH_LENGTH} characters`,
      };
    }
    let resolved: string;
    try {
      // 存在性 fail-fast + 消解 symlink / macOS 大小写形态（唯一形态的关键）
      resolved = fs.realpathSync(raw);
    } catch {
      return {
        ok: false,
        code: "AGENT_WORK_DIR_NOT_FOUND",
        message: `agent_work_dir directory does not exist: ${raw}`,
      };
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolved);
    } catch {
      return {
        ok: false,
        code: "AGENT_WORK_DIR_NOT_FOUND",
        message: `agent_work_dir directory does not exist: ${raw}`,
      };
    }
    if (!stat.isDirectory()) {
      return {
        ok: false,
        code: "AGENT_WORK_DIR_NOT_A_DIRECTORY",
        message: `agent_work_dir is not a directory: ${raw}`,
      };
    }
    try {
      fs.accessSync(resolved, fs.constants.W_OK);
    } catch {
      return {
        ok: false,
        code: "AGENT_WORK_DIR_NOT_WRITABLE",
        message: `agent_work_dir directory is not writable: ${raw}`,
      };
    }
    return { ok: true, kind: "abs", value: resolved };
  }

  // 标识符轨道：原正则（天然拒绝 / \ .. 与盘符）
  if (raw.length > 64) {
    return {
      ok: false,
      code: "AGENT_WORK_DIR_INVALID",
      message: "agent_work_dir must be 1-64 characters",
    };
  }
  if (!IDENTIFIER_PATTERN.test(raw)) {
    return {
      ok: false,
      code: "AGENT_WORK_DIR_INVALID",
      message: "agent_work_dir may only contain [a-zA-Z0-9_-]",
    };
  }
  // normalProject 业务：单段名即常规项目 id（devTargetId），升级轨道供调用方
  // 分流建目录/推导目录；value 与标识符轨道一致，存量 key 行为不变。
  if (isNormalProjectServiceType(options?.serviceType)) {
    return { ok: true, kind: "normal-project", value: raw };
  }
  return { ok: true, kind: "id", value: raw };
}
