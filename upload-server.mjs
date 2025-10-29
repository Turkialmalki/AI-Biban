import express from 'express'
import bodyParser from 'body-parser'
import fs from 'node:fs'
import path from 'node:path'

const app = express()

// حدود مريحة + قبول JSON أو نص خام
app.use(bodyParser.json({ limit: '25mb' }))
app.use(bodyParser.text({ type: '*/*', limit: '25mb' }))

// فحص سريع للصحة
app.get('/api/health', (req, res) => res.json({ ok: true }))

app.post('/api/upload', (req, res) => {
  try {
    const started = Date.now()
    // نحاول JSON أولًا
    let dataUrl = (req.body && req.body.dataUrl) ? req.body.dataUrl : null
    // لو ما فيه، جرّب النص الخام
    if (!dataUrl && typeof req.body === 'string') dataUrl = req.body

    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.includes(',')) {
      console.error('[upload] 400 Missing dataUrl')
      return res.status(400).json({ error: 'Missing dataUrl' })
    }

    const idx = dataUrl.indexOf(',')
    const b64 = dataUrl.slice(idx + 1)
    const buf = Buffer.from(b64, 'base64')

    const dir = path.join(process.cwd(), 'public', 'snaps')
    fs.mkdirSync(dir, { recursive: true })
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const file = path.join(dir, `${id}.jpg`)
    fs.writeFileSync(file, buf)

    console.log(`[upload] saved ${file} in ${Date.now() - started}ms`)
    res.json({ id, url: `/snaps/${id}.jpg` })
  } catch (e) {
    console.error('upload error', e)
    res.status(500).json({ error: 'server error' })
  }
})

const port = 8787
app.listen(port, '0.0.0.0', () =>
  console.log(`[UPLOAD] http://0.0.0.0:${port}/api/upload`)
)
