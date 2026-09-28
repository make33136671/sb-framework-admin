import { defineConfig } from '@vben/vite-config';

export default defineConfig(async () => {
  return {
    application: {},
    vite: {
      server: {
        proxy: {
          // DramaFlow API（契约 §5.2：本地联调 6000）
          // 不改写路径：后端路由本身就是 /admin/* 与 /api/*，
          // 前端请求已带完整前缀（VITE_GLOB_API_URL=http://localhost:6000/admin）。
          // ws:true 是 /api/TaskStream/Stream 的 WebSocket 升级所必需（契约 §5.3）。
          '/api': {
            changeOrigin: true,
            target: 'http://localhost:6000',
            ws: true,
          },
          // 媒体与品牌资源：本地把 media_root（/root/DramaFlow/media）经后端静态目录暴露为 /storage
          '/storage': {
            changeOrigin: true,
            target: 'http://localhost:6000',
          },
        },
      },
    },
  };
});
