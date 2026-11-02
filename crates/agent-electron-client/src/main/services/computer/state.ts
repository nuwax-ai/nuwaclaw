import * as http from "http";

/** 服务器生命周期与认证共享可变状态（server/lastError/interventionSecret/runningPort） */
export const serverState = {
  server: null as http.Server | null,
  lastError: null as string | null,
  interventionSecret: null as string | null,
  runningPort: null as number | null,
};
