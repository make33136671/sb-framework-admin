import { defineConfig } from '@vben/vite-config';

export default defineConfig(async () => {
  return {
    application: {},
    vite: {
      server: {
        proxy: {
          '/api': {
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api/, ''),
            // mock代理目标地址
            target: 'http://localhost:5320/api',
            ws: true,
          },
          // 后端品牌资源（Logo/Favicon/app-info）走 6010
          // 由安装向导生成到 SB.API/wwwroot/storage/，前端不再保留副本
          '/storage': {
            changeOrigin: true,
            target: 'http://localhost:6010',
          },
        },
      },
    },
  };
});
