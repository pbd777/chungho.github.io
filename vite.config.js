import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5173,
    open: true,
    host: true,
    allowedHosts: true,
    proxy: {
      // /api/* 요청을 Vite 개발 서버가 Express(3001)로 프록시
      // 외부에서는 5173 포트 하나만 노출하면 됨 (ngrok 터널 1개로 해결)
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/hls': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  assetsInclude: ['**/*.fbx'],
})
