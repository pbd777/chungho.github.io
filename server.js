/**
 * IVAS-Factory Layout + CCTV + Model Upload Server
 *
 * GET  /api/layout              : 배치 데이터 불러오기
 * POST /api/layout              : 배치 데이터 저장
 * GET  /api/layout/backup       : 백업 목록
 *
 * GET    /api/models              : 업로드된 FBX 파일 목록
 * POST   /api/models/upload       : FBX 파일 업로드 (덮어쓰기)
 * DELETE /api/models/:filename    : FBX 파일 삭제
 * GET    /admin                   : 모델 업로드 관리 페이지
 *
 * POST /api/cctv/:id/start      : RTSP → HLS 변환 시작 (FFmpeg)
 * POST /api/cctv/:id/stop       : FFmpeg 프로세스 종료
 */
import express        from 'express'
import cors           from 'cors'
import fs             from 'fs'
import path           from 'path'
import { spawn }      from 'child_process'
import { fileURLToPath } from 'url'
import multer         from 'multer'

const __dirname   = path.dirname(fileURLToPath(import.meta.url))
const app         = express()
const PORT        = 3001
const LAYOUT_DIR  = path.join(__dirname, 'data')
const LAYOUT_FILE = path.join(LAYOUT_DIR, 'layout.json')
const BACKUP_DIR  = path.join(LAYOUT_DIR, 'backups')
const HLS_DIR     = path.join(__dirname, 'data', 'hls')
const MODELS_DIR  = path.join(__dirname, 'public', 'models')

;[LAYOUT_DIR, BACKUP_DIR, HLS_DIR, MODELS_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
})

app.use(cors())
app.use(express.json())

// ── Multer: FBX 업로드 설정 ───────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, MODELS_DIR),
  filename:    (req, file, cb) => {
    // 원본 파일명 그대로 저장 (덮어쓰기)
    // 한글/특수문자 방지를 위해 latin1→utf8 디코딩
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8')
    cb(null, originalName)
  }
})

const ALLOWED_EXTS = ['.fbx', '.gltf', '.glb']

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (ALLOWED_EXTS.includes(ext)) return cb(null, true)
    cb(new Error('FBX, GLTF, GLB 파일만 업로드 가능합니다'))
  },
  limits: { fileSize: 500 * 1024 * 1024 }  // 500MB
})

// ── 어드민 페이지 (/admin) ────────────────────────────────────────────────
app.get('/admin', (req, res) => {
  const files = fs.readdirSync(MODELS_DIR)
    .filter(f => ALLOWED_EXTS.includes(path.extname(f).toLowerCase()))
    .map(f => {
      const stat = fs.statSync(path.join(MODELS_DIR, f))
      const mb   = (stat.size / 1024 / 1024).toFixed(1)
      const date = stat.mtime.toLocaleString('ko-KR')
      return { name: f, mb, date }
    })

  const fileRows = files.map(f => `
    <tr>
      <td>${f.name}</td>
      <td>${f.mb} MB</td>
      <td>${f.date}</td>
      <td><button class="btn-del" onclick="deleteFile(this, '${encodeURIComponent(f.name)}')">삭제</button></td>
    </tr>`).join('')

  res.send(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>IVAS-Factory · 모델 관리</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0 }
    body { font-family: 'Segoe UI', sans-serif; background: #0f1520; color: #c8d8f0; min-height: 100vh; padding: 40px 24px }
    h1 { font-size: 20px; font-weight: 600; color: #7eb8f7; margin-bottom: 6px }
    .sub { font-size: 13px; color: #5a7090; margin-bottom: 32px }
    .card { background: #1a2540; border: 1px solid #2a3a5a; border-radius: 10px; padding: 24px; margin-bottom: 24px; max-width: 680px }
    .card h2 { font-size: 14px; font-weight: 600; color: #a0c4f0; margin-bottom: 16px; letter-spacing: .03em }
    .drop-zone {
      border: 2px dashed #2e4a7a; border-radius: 8px; padding: 36px 24px;
      text-align: center; cursor: pointer; transition: border-color .2s, background .2s;
      background: #111e35
    }
    .drop-zone:hover, .drop-zone.drag-over { border-color: #4a8adc; background: #152040 }
    .drop-zone .icon { font-size: 36px; margin-bottom: 10px }
    .drop-zone p { font-size: 14px; color: #7090b0; margin-bottom: 4px }
    .drop-zone .hint { font-size: 12px; color: #445566 }
    #file-input { display: none }
    .btn {
      display: inline-block; margin-top: 16px; padding: 10px 24px;
      background: #1e5cb0; color: #e0f0ff; border: none; border-radius: 6px;
      font-size: 14px; font-weight: 600; cursor: pointer; transition: background .2s
    }
    .btn:hover { background: #2870cc }
    .btn:disabled { background: #2a3a5a; color: #445566; cursor: not-allowed }
    #selected-files { margin-top: 14px; font-size: 13px; color: #7eb8f7 }
    #progress-wrap { margin-top: 16px; display: none }
    .progress-bar-bg { background: #0f1e35; border-radius: 4px; height: 8px; overflow: hidden }
    .progress-bar { height: 100%; background: #2870cc; width: 0%; transition: width .3s }
    #status { margin-top: 12px; font-size: 13px; min-height: 20px }
    .status-ok  { color: #4ccc88 }
    .status-err { color: #f07060 }
    table { width: 100%; border-collapse: collapse; font-size: 13px }
    th { text-align: left; color: #5a7090; font-weight: 500; padding: 6px 8px; border-bottom: 1px solid #1e2e4a }
    td { padding: 8px 8px; border-bottom: 1px solid #1a2840; color: #a0b8d0 }
    td:first-child { color: #c8d8f0; font-weight: 500 }
    tr:last-child td { border-bottom: none }
    .empty { color: #445566; font-size: 13px; text-align: center; padding: 20px 0 }
    .btn-del {
      padding: 4px 12px; font-size: 12px; font-weight: 600;
      background: transparent; color: #c05050; border: 1px solid #5a2020;
      border-radius: 4px; cursor: pointer; transition: background .15s, color .15s
    }
    .btn-del:hover { background: #5a2020; color: #ffaaaa }
    .btn-del:disabled { opacity: .4; cursor: not-allowed }
  </style>
</head>
<body>
  <h1>▣ IVAS-Factory · 모델 관리</h1>
  <p class="sub">FBX, GLTF, GLB 파일을 업로드하면 씬에 즉시 반영됩니다 (기존 파일 덮어쓰기)</p>

  <div class="card">
    <h2>FBX 업로드</h2>
    <div class="drop-zone" id="drop-zone" onclick="document.getElementById('file-input').click()">
      <div class="icon">📦</div>
      <p>여기에 모델 파일을 드래그하거나 클릭해서 선택</p>
      <p class="hint">최대 500MB · .fbx .gltf .glb 허용</p>
    </div>
    <input type="file" id="file-input" accept=".fbx,.gltf,.glb" multiple/>
    <div id="selected-files"></div>
    <div id="progress-wrap">
      <div class="progress-bar-bg"><div class="progress-bar" id="progress-bar"></div></div>
    </div>
    <div id="status"></div>
    <button class="btn" id="upload-btn" disabled onclick="uploadFiles()">업로드</button>
  </div>

  <div class="card">
    <h2>현재 모델 파일 목록</h2>
    ${files.length === 0
      ? '<p class="empty">등록된 FBX 파일이 없습니다</p>'
      : `<table><thead><tr><th>파일명</th><th>크기</th><th>수정일시</th><th></th></tr></thead><tbody>${fileRows}</tbody></table>`}
  </div>

  <script>
    let selectedFiles = []

    // 드래그 앤 드롭
    const dropZone = document.getElementById('drop-zone')
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over') })
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'))
    dropZone.addEventListener('drop', e => {
      e.preventDefault()
      dropZone.classList.remove('drag-over')
      handleFiles([...e.dataTransfer.files])
    })

    document.getElementById('file-input').addEventListener('change', e => {
      handleFiles([...e.target.files])
    })

    function handleFiles(files) {
      const fbxFiles = files.filter(f => /\.(fbx|gltf|glb)$/i.test(f.name))
      if (fbxFiles.length === 0) {
        setStatus('FBX, GLTF, GLB 파일만 업로드 가능합니다', 'err')
        return
      }
      selectedFiles = fbxFiles
      const names = fbxFiles.map(f => f.name + ' (' + (f.size/1024/1024).toFixed(1) + 'MB)').join(', ')
      document.getElementById('selected-files').textContent = '선택됨: ' + names
      document.getElementById('upload-btn').disabled = false
      setStatus('')
    }

    async function uploadFiles() {
      if (selectedFiles.length === 0) return
      const btn = document.getElementById('upload-btn')
      btn.disabled = true

      const formData = new FormData()
      selectedFiles.forEach(f => formData.append('fbx', f))

      const progressWrap = document.getElementById('progress-wrap')
      const progressBar  = document.getElementById('progress-bar')
      progressWrap.style.display = 'block'
      progressBar.style.width = '0%'
      setStatus('업로드 중…', '')

      try {
        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.open('POST', '/api/models/upload')
          xhr.upload.onprogress = e => {
            if (e.lengthComputable) {
              progressBar.style.width = (e.loaded / e.total * 100).toFixed(0) + '%'
            }
          }
          xhr.onload = () => {
            if (xhr.status === 200) resolve(JSON.parse(xhr.responseText))
            else reject(new Error(xhr.responseText))
          }
          xhr.onerror = () => reject(new Error('네트워크 오류'))
          xhr.send(formData)
        })

        progressBar.style.width = '100%'
        setStatus('✅ 업로드 완료! 브라우저에서 페이지를 새로고침하면 씬에 반영됩니다', 'ok')
        setTimeout(() => location.reload(), 1500)

      } catch (err) {
        setStatus('❌ 업로드 실패: ' + err.message, 'err')
        btn.disabled = false
      }
    }

    function setStatus(msg, type) {
      const el = document.getElementById('status')
      el.textContent = msg
      el.className = type === 'ok' ? 'status-ok' : type === 'err' ? 'status-err' : ''
    }

    async function deleteFile(btn, encodedName) {
      const name = decodeURIComponent(encodedName)
      if (!confirm(name + '\\n\\n이 파일을 삭제하시겠습니까?')) return
      btn.disabled = true
      btn.textContent = '삭제 중…'
      try {
        const res = await fetch('/api/models/' + encodedName, { method: 'DELETE' })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || '삭제 실패')
        btn.closest('tr').remove()
        const tbody = document.querySelector('table tbody')
        if (tbody && tbody.rows.length === 0) {
          tbody.closest('table').outerHTML = '<p class="empty">등록된 FBX 파일이 없습니다</p>'
        }
      } catch (err) {
        btn.disabled = false
        btn.textContent = '삭제'
        alert('삭제 실패: ' + err.message)
      }
    }
  </script>
</body>
</html>`)
})

// ── Model Upload API ──────────────────────────────────────────────────────
app.get('/api/models', (req, res) => {
  const files = fs.readdirSync(MODELS_DIR)
    .filter(f => ALLOWED_EXTS.includes(path.extname(f).toLowerCase()))
    .map(f => {
      const stat = fs.statSync(path.join(MODELS_DIR, f))
      return { name: f, size: stat.size, updatedAt: stat.mtime }
    })
  res.json({ files })
})

app.delete('/api/models/:filename', (req, res) => {
  const filename = decodeURIComponent(req.params.filename)
  if (!ALLOWED_EXTS.includes(path.extname(filename).toLowerCase())) {
    return res.status(400).json({ error: 'FBX, GLTF, GLB 파일만 삭제 가능합니다' })
  }
  const filePath = path.join(MODELS_DIR, path.basename(filename))
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '파일을 찾을 수 없습니다' })
  }
  try {
    fs.unlinkSync(filePath)
    console.log(`[Models] 삭제: ${filename}`)
    res.json({ ok: true, deleted: filename })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/models/upload', (req, res) => {
  upload.array('fbx')(req, res, err => {
    if (err) {
      console.error('[Upload] 실패:', err.message)
      return res.status(400).json({ error: err.message })
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '파일이 없습니다' })
    }
    const saved = req.files.map(f => ({ name: f.filename, size: f.size }))
    saved.forEach(f => console.log(`[Upload] 저장: ${f.name} (${(f.size/1024/1024).toFixed(1)}MB)`))
    res.json({ ok: true, files: saved })
  })
})

// ── HLS 세그먼트 정적 서빙 ────────────────────────────────────────────────
app.use('/hls', express.static(HLS_DIR, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
      res.setHeader('Cache-Control', 'no-cache')
    }
    if (filePath.endsWith('.ts')) {
      res.setHeader('Content-Type', 'video/mp2t')
      res.setHeader('Cache-Control', 'no-cache')
    }
  }
}))

// ── Layout API ────────────────────────────────────────────────────────────
app.get('/api/layout', (req, res) => {
  if (!fs.existsSync(LAYOUT_FILE)) return res.json({ objects: [] })
  try { res.json(JSON.parse(fs.readFileSync(LAYOUT_FILE, 'utf-8'))) }
  catch { res.status(500).json({ error: '파일 읽기 실패' }) }
})

app.post('/api/layout', (req, res) => {
  const { objects, savedBy, memo, annotations } = req.body
  if (!Array.isArray(objects)) return res.status(400).json({ error: 'objects 배열 필요' })
  if (fs.existsSync(LAYOUT_FILE)) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    fs.copyFileSync(LAYOUT_FILE, path.join(BACKUP_DIR, `layout_${ts}.json`))
  }
  const payload = { savedAt: new Date().toISOString(), savedBy: savedBy || 'unknown', memo: memo || '', objects, annotations: annotations || [] }
  fs.writeFileSync(LAYOUT_FILE, JSON.stringify(payload, null, 2), 'utf-8')
  console.log(`[Layout] 저장 — ${objects.length}개 오브젝트`)
  res.json({ ok: true, savedAt: payload.savedAt })
})

app.get('/api/layout/backup', (req, res) => {
  const files = fs.existsSync(BACKUP_DIR)
    ? fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.json')).sort().reverse().slice(0, 20)
    : []
  res.json({ backups: files })
})

// ── CCTV / HLS API ────────────────────────────────────────────────────────
const CCTV_RTSP = {
  'cctv-01': 'rtsp://210.99.70.120:1935/live/cctv003.stream',
  'cctv-02': 'rtsp://210.99.70.120:1935/live/cctv004.stream',
}
const ffmpegProcs = {}

app.post('/api/cctv/:id/start', (req, res) => {
  const { id } = req.params
  const rtsp    = CCTV_RTSP[id]
  if (!rtsp) return res.status(404).json({ error: `CCTV id 없음: ${id}` })
  if (ffmpegProcs[id]) return res.json({ ok: true, reused: true })

  const outDir = path.join(HLS_DIR, id)
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const m3u8 = path.join(outDir, 'stream.m3u8')

  const args = [
    '-fflags', 'nobuffer', '-rtsp_transport', 'tcp', '-i', rtsp,
    '-c:v', 'copy', '-c:a', 'aac', '-ar', '44100',
    '-f', 'hls', '-hls_time', '2', '-hls_list_size', '3',
    '-hls_flags', 'delete_segments+append_list', '-hls_allow_cache', '0',
    '-hls_segment_filename', path.join(outDir, 'seg%03d.ts'), m3u8
  ]

  const ffmpegPath = process.env.FFMPEG_PATH || 'E:\\ffmpeg\\bin\\ffmpeg.exe'
  const proc = spawn(ffmpegPath, args)
  ffmpegProcs[id] = proc
  proc.stderr.on('data', d => process.stdout.write(`[FFmpeg:${id}] ${d}`))
  proc.on('close', code => { console.log(`[CCTV] ${id} FFmpeg 종료 (code ${code})`); delete ffmpegProcs[id] })
  console.log(`[CCTV] ${id} 스트림 시작 → ${rtsp}`)

  waitForFile(m3u8, 10000)
    .then(() => res.json({ ok: true, hlsUrl: `/hls/${id}/stream.m3u8` }))
    .catch(() => res.status(504).json({ error: 'FFmpeg 스트림 시작 타임아웃' }))
})

app.post('/api/cctv/:id/stop', (req, res) => {
  const { id } = req.params
  const proc   = ffmpegProcs[id]
  if (proc) { proc.kill('SIGTERM'); delete ffmpegProcs[id] }
  res.json({ ok: true })
})

function waitForFile(filePath, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const start    = Date.now()
    const interval = setInterval(() => {
      if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
        clearInterval(interval); resolve()
      } else if (Date.now() - start > timeout) {
        clearInterval(interval); reject(new Error('timeout'))
      }
    }, 300)
  })
}

process.on('SIGINT',  () => { Object.values(ffmpegProcs).forEach(p => p.kill()); process.exit() })
process.on('SIGTERM', () => { Object.values(ffmpegProcs).forEach(p => p.kill()); process.exit() })

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] http://0.0.0.0:${PORT}`)
  console.log(`[Admin]  http://0.0.0.0:${PORT}/admin`)
})
