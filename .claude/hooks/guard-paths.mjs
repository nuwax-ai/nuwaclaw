#!/usr/bin/env node
// PreToolUse 守护（AI Native SDLC Playbook「Hooks as build-time guardrails」· nuwaclaw 适配版）
// 本仓无 swarm 式"共享单点"受保护文件，护栏收敛为纯秘钥拦截；误报优先防（日常开发高频，过度门禁会被绕过）。
// 协议：stdin 收事件 JSON；exit 0 = 放行，exit 2 = 阻断（stderr 原因显示给 Claude）。
import { relative, isAbsolute, resolve, sep } from 'node:path';

let raw = '';
process.stdin.on('data', d => (raw += d));
process.stdin.on('end', () => {
  let ev;
  try { ev = JSON.parse(raw); } catch { process.exit(0); }

  const tool = ev.tool_name ?? '';
  const ti = ev.tool_input ?? {};
  const cwd = ev.cwd || process.cwd();
  const reason = msg => { console.error(msg); process.exit(2); };

  // 文件路径类候选：全量秘钥模式。openssl 构建树里的测试证书不算凭证。
  const PATH_SECRET = [
    /(^|[\\/])\.env(\.[^\\/]+)?$/i,
    /\.pem$/i, /\.key$/i, /\.(pfx|p12)$/i,
    /(^|\/)(id_rsa|id_ed25519|id_ecdsa)$/i,
    /credential/i, /secret[s]?\.(json|ya?ml|txt)$/i,
  ];
  // Bash 命令串候选：只拦两类——① 独立出现的 .env 令牌（process.env / 凭证字样检索不受影响）；
  // ② 打印/复制证书文件的明确动作。`dotenv -e .env.development x` 属已知会拦的用法，改走 package.json 脚本包装。
  const BASH_SECRET = [
    /(^|[\s'"=;|&(])\.env(\.[A-Za-z0-9_-]+)?(?=$|[\s'"|;&)])/,
    /(?:^|[;&|]\s*)(?:cat|head|tail|less|more|cp|mv|tee)\s+[^;&|]*\.pem\b/i,
  ];
  // 构建产物/三方源码噪音路径：其中的 pem/key 一律放行
  const BUILD_NOISE = /(^|\/)(node_modules|\.ttyd-build|buildtrees|vcpkg_installed|target|dist)\//;
  // 注意：release/、out/ 不在豁免表——发布目录最可能落真实签名证书

  const normRel = p => {
    if (!p) return '';
    const abs = isAbsolute(p) ? p : resolve(cwd, p);
    return relative(cwd, abs).split(sep).join('/');
  };

  const hit = c => {
    if (/\.(example|sample|template)$/i.test(c)) return false;
    if (tool === 'Bash') return BASH_SECRET.some(re => re.test(c));
    return !BUILD_NOISE.test(c) && PATH_SECRET.some(re => re.test(c));
  };

  for (const c of [tool === 'Bash' ? String(ti.command ?? '') : normRel(ti.file_path)].filter(Boolean)) {
    if (hit(c)) {
      reason(
        `[guard-paths] 拒绝该 ${tool} 动作（命中秘钥护栏）：凭证不得进入会话与 diff。` +
        `本仓已知真实秘钥位：nuwax/.env（子模块）、crates/agent-electron-client/.env.production 与 .env.development。` +
        `确有正当需求请人工评审后调整 .claude/hooks/guard-paths.mjs。`
      );
    }
  }
  process.exit(0);
});
