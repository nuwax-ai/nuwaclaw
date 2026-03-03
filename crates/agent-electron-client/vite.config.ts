import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import * as path from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));

export default defineConfig(({ command }) => ({
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
  base: command === 'build' ? './' : '/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
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
    port: 60173,
    strictPort: true,
    fs: {
      // 允许访问项目根目录下的node_modules
      allow: ['..', '../..', '../../node_modules'],
    },
  },
}));
