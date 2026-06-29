import { defineConfig } from 'vite'
import fs from 'fs'
import path from 'path'

// 빌드 타임에 public/models/ 파일 목록을 읽어 정적 배포용으로 주입
function getStaticModels() {
  const modelsDir = path.resolve(__dirname, 'public/models')
  try {
    return fs.readdirSync(modelsDir)
      .filter(f => /\.(fbx|gltf|glb)$/i.test(f))
      .map(name => ({ name }))
  } catch {
    return []
  }
}

export default defineConfig({
  server: {
    port: 5173,
    open: true,
    host: true,
  },
  assetsInclude: ['**/*.fbx'],
  define: {
    __STATIC_MODELS__: JSON.stringify(getStaticModels()),
  },
})
