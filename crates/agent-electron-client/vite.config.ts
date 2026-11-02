import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import * as path from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));

// 使用 Vite 的 mode 参数决定加载哪个 env 文件
// 注意：loadEnv 相对于 root 查找 env 文件，所以 root 必须是包含 .env.development 的目录
function getFeatureFlags(mode: string) {
  // __dirname 是 vite.config.ts 所在目录（crates/agent-electron-client/），包含 .env.development
  const env = loadEnv(mode, __dirname, '');
  // loadEnv 返回布尔值或 undefined，需要转换为字符串 'true'/'false'
  const toViteFlag = (value: unknown): string =>
    value === true || value === 'true' ? 'true' : 'false';
  return {
    __INJECT_GUI_MCP__: toViteFlag(env.INJECT_GUI_MCP),
    __LOG_FULL_SECRETS__: toViteFlag(env.NUWAX_AGENT_LOG_FULL_SECRETS),
    __ENABLE_GUI_AGENT_SERVER__: toViteFlag(env.ENABLE_GUI_AGENT_SERVER),
    // 暗黑模式开关（默认关闭，恒浅色；设 DARK_THEME=true 恢复）
    __DARK_THEME__: toViteFlag(env.DARK_THEME),
  };
}

export default defineConfig(({ mode }) => {
  // 品牌注入（nuwa-work 商业版）：renderer 无 process 运行时，靠 define 注入；
  // 未设置时替换为空串，constants.ts 里回落默认值（社区版）。loadEnv 同时读 .env 文件与 shell env
  const brandingEnv = loadEnv(mode, __dirname, 'NUWAX_');
  const brandingDefines = {
    'process.env.NUWAX_APP_IDENTIFIER': JSON.stringify(brandingEnv.NUWAX_APP_IDENTIFIER ?? ''),
    'process.env.NUWAX_APP_DISPLAY_NAME': JSON.stringify(brandingEnv.NUWAX_APP_DISPLAY_NAME ?? ''),
    'process.env.NUWAX_UPDATE_FEED_BASE': JSON.stringify(brandingEnv.NUWAX_UPDATE_FEED_BASE ?? ''),
    'process.env.NUWAX_PORT_OFFSET': JSON.stringify(brandingEnv.NUWAX_PORT_OFFSET ?? '0'),
  };

  return {
  plugins: [
    react(),
    {
      name: 'configure-server',
      configureServer(server) {
        // 添加中间件来处理node_modules请求
        server.middlewares.use('/node_modules/.vite', (req, res, next) => {
          // 将请求重定向到正确的路径
          const filePath = path.join(__dirname, 'node_modules', '.vite', req.url || '');
          if (req.url && !req.url.includes('..')) {
            try {
              const content = readFileSync(filePath, 'utf-8');
              res.setHeader('Content-Type', 'application/javascript');
              res.end(content);
              return;
            } catch (e) {
              // 文件不存在，继续下一个中间件
            }
          }
          next();
        });
      },
    },
  ],
  root: './src/renderer',
  publicDir: '../../public',
  // 开发模式使用绝对路径，生产构建使用相对路径
  base: mode === 'production' ? './' : '/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Feature flags - 构建时静态替换（仅影响渲染进程）
    ...getFeatureFlags(mode),
    ...brandingDefines,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@main': path.resolve(__dirname, './src/main'),
      '@preload': path.resolve(__dirname, './src/preload'),
      '@renderer': path.resolve(__dirname, './src/renderer'),
      '@shared': path.resolve(__dirname, './src/shared'),
    },
  },
  build: {
    outDir: '../../dist',
    // 主进程 tsc 也输出到 dist/（dist/main/, dist/services/ 等），
    // 关闭 emptyOutDir 避免 vite build 清除主进程产物。
    // TODO: 后续可将 tsc outDir 改为 dist-main/ 以彻底隔离，届时可恢复 emptyOutDir: true
    emptyOutDir: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        // 优化代码分割，将第三方库分离
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-antd': ['antd', '@ant-design/icons'],
        },
      },
    },
  },
  server: {
    // 跟随端口偏移注入（与 constants DEFAULT_DEV_SERVER_PORT 同式）：商业版 dev 注
    // NUWAX_PORT_OFFSET=1000 → 61173，与社区版 dev（60173）同机双开不撞（strictPort 下撞则直接失败）
    port: 60173 + (Number.parseInt(process.env.NUWAX_PORT_OFFSET?.trim() ?? '0', 10) || 0),
    strictPort: true,
    fs: {
      // 允许访问项目根目录下的node_modules
      allow: ['..', '../..', '../../node_modules'],
    },
  },
  };
});
