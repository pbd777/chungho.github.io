import * as THREE from 'three'
import { FBXLoader }  from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'

// 하드코딩 목록은 서버 /api/models 로 대체됨 — 하위 호환용으로만 유지
export let BUILDINGS = []

/**
 * HDR 환경맵 로드 — scene.environment(IBL) + scene.background 동시 적용
 */
export async function loadHDR(renderer, scene, url = '/models/base.hdr') {
  return new Promise((resolve, reject) => {
    const loader = new RGBELoader()
    loader.load(
      url,
      (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping
        scene.environment = texture   // IBL — PBR 재질 반사/조명에 사용 (유지)
        scene.background  = null                        // 배경 투명 — CSS로 처리
        console.log('[IVAS] HDR 환경맵 로드 완료:', url)
        resolve(texture)
      },
      undefined,
      (err) => {
        console.warn('[IVAS] HDR 로드 실패:', url, err)
        reject(err)
      }
    )
  })
}



/**
 * LoadingManager로 텍스처 경로 리매핑
 *
 * Blender FBX export 시 텍스처 경로가 절대경로 또는 상대경로로 박혀있음.
 * 예) C:\Users\...\Texture\wall.png  또는  ../Material/Texture/wall.png
 * → 파일명만 추출해서 /models/textures/{파일명} 으로 리다이렉트
 */
function createFBXLoader() {
  const manager = new THREE.LoadingManager()
  manager.setURLModifier((url) => {
    if (url.startsWith('/models/textures/')) return url
    if (url.startsWith('blob:') || url.startsWith('data:')) return url
    const filename = url.split(/[\\/]/).pop()
    if (/\.(png|jpg|jpeg|tga|bmp|webp)$/i.test(filename)) {
      const remapped = `/models/textures/${filename}`
      console.log(`[IVAS] 텍스처 리매핑: ${url} → ${remapped}`)
      return remapped
    }
    return url
  })
  return new FBXLoader(manager)
}

const gltfLoader = new GLTFLoader()

function loadModel(url) {
  const ext = url.split('.').pop().toLowerCase()
  if (ext === 'fbx') {
    return new Promise((resolve, reject) => {
      createFBXLoader().load(url, resolve, undefined, reject)
    })
  }
  if (ext === 'gltf' || ext === 'glb') {
    return new Promise((resolve, reject) => {
      gltfLoader.load(url, gltf => resolve(gltf.scene), undefined, reject)
    })
  }
  return Promise.reject(new Error(`지원하지 않는 포맷: ${ext}`))
}

export async function loadBuildings(scene, onStatus) {
  // 서버에서 모델 파일 목록을 가져와 BUILDINGS 동적 구성
  try {
    const res = await fetch('/api/models')
    const data = await res.json()
    BUILDINGS = data.files.map(f => ({
      id:    f.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_'),
      label: f.name.replace(/\.[^.]+$/, ''),
      file:  f.name,
      color: 0x1a2e50,
    }))
  } catch (err) {
    console.warn('[IVAS] 모델 목록 fetch 실패 — 빈 목록으로 진행', err)
    BUILDINGS = []
  }

  const loaded = []
  if (BUILDINGS.length === 0) {
    onStatus('__none__', 'loaded')
    return loaded
  }
  for (const def of BUILDINGS) {
    onStatus(def.id, 'loading')
    try {
      const obj = await loadModel(`/models/${def.file}`)
      applyModel(obj, def, scene)
      loaded.push({ def, object: obj })
      onStatus(def.id, 'loaded')
    } catch (err) {
      console.warn(`[IVAS] 모델 없음: ${def.file} → placeholder`, err)
      const ph = makePlaceholder(def)
      scene.add(ph)
      loaded.push({ def, object: ph })
      onStatus(def.id, 'placeholder')
    }
  }

  return loaded
}

function applyModel(obj, def, scene) {
  const isGLTF = /\.(gltf|glb)$/i.test(def.file)

  obj.traverse(child => {
    if (!child.isMesh) return
    child.castShadow = true
    child.receiveShadow = true
    child.frustumCulled = false

    const mats = Array.isArray(child.material) ? child.material : [child.material]
    mats.forEach(mat => {
      if (!mat) return

      if (isGLTF) {
        if (mat.emissiveMap) {
          mat.lightMap          = mat.emissiveMap
          mat.lightMapIntensity = 1.0
          mat.emissiveMap       = null
          mat.emissive.setHex(0x000000)
        }
        if (mat.map) {
          mat.map.wrapS = THREE.RepeatWrapping
          mat.map.wrapT = THREE.RepeatWrapping
        }
      } else {
        mat.roughness       = 0.65
        mat.metalness       = 0.15
        mat.envMapIntensity = 1.0
      }

      mat.needsUpdate = true
    })
  })

  obj.userData.id    = def.id
  obj.userData.label = def.label
  scene.add(obj)
}

function makePlaceholder(def) {
  const [w, h, d] = [8, 4, 8]
  const geo = new THREE.BoxGeometry(w, h, d)
  const mat = new THREE.MeshStandardMaterial({
    color: def.color, roughness: 0.6, metalness: 0.2,
    transparent: true, opacity: 0.75,
  })
  const mesh = new THREE.Mesh(geo, mat)
  const idx = BUILDINGS.findIndex(b => b.id === def.id)
  mesh.position.set(idx * 12, h / 2, 0)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData = { id: def.id, label: def.label, isPlaceholder: true }

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: 0x4a7acc, transparent: true, opacity: 0.5 })
  )
  mesh.add(edges)
  return mesh
}

export function fitCameraToScene(scene, loaded) {
  const box = new THREE.Box3()
  loaded.forEach(({ object }) => box.expandByObject(object))
  if (box.isEmpty()) return null
  const center = new THREE.Vector3()
  box.getCenter(center)
  return { center, box }
}
