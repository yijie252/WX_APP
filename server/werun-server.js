/**
 * 微信运动最小解密服务
 *
 * 用法：
 * 1. 复制同目录 `.env.example` 为 `.env`
 * 2. 填写 WECHAT_APPID / WECHAT_SECRET
 * 3. 运行：node werun-server.js
 *
 * 接口：
 * POST /api/werun/decrypt
 * body: { code, encryptedData, iv }
 */

const http = require('http')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

loadEnv(path.join(__dirname, '.env'))

const PORT = Number(process.env.PORT || 8787)
const APPID = process.env.WECHAT_APPID || ''
const SECRET = process.env.WECHAT_SECRET || ''

const server = http.createServer(async (req, res) => {
  setCors(res)

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === 'GET' && req.url === '/health') {
    return json(res, 200, { ok: true, message: 'werun server ready' })
  }

  if (req.method === 'POST' && req.url === '/api/werun/decrypt') {
    try {
      if (!APPID || !SECRET) {
        return json(res, 500, { ok: false, message: 'WECHAT_APPID / WECHAT_SECRET not configured' })
      }

      const body = await readJson(req)
      const code = body.code
      const encryptedData = body.encryptedData
      const iv = body.iv

      if (!code || !encryptedData || !iv) {
        return json(res, 400, { ok: false, message: 'code, encryptedData, iv are required' })
      }

      const session = await exchangeSession(code)
      if (!session.session_key) {
        return json(res, 400, {
          ok: false,
          message: session.errmsg || 'jscode2session failed',
          data: session,
        })
      }

      const decrypted = decryptWeRunData(session.session_key, encryptedData, iv)
      const stepInfoList = Array.isArray(decrypted.stepInfoList) ? decrypted.stepInfoList : []
      const latestStep = stepInfoList.length ? Number(stepInfoList[stepInfoList.length - 1].step || 0) : 0

      return json(res, 200, {
        ok: true,
        data: {
          latestStep,
          stepInfoList,
          openid: session.openid || '',
        },
      })
    } catch (error) {
      return json(res, 500, { ok: false, message: error.message || 'server error' })
    }
  }

  return json(res, 404, { ok: false, message: 'not found' })
})

server.listen(PORT, () => {
  console.log(`werun server listening on http://localhost:${PORT}`)
})

async function exchangeSession(code) {
  const url =
    `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(APPID)}` +
    `&secret=${encodeURIComponent(SECRET)}` +
    `&js_code=${encodeURIComponent(code)}` +
    `&grant_type=authorization_code`

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`jscode2session http ${response.status}`)
  }
  return response.json()
}

function decryptWeRunData(sessionKey, encryptedData, iv) {
  const key = Buffer.from(sessionKey, 'base64')
  const encrypted = Buffer.from(encryptedData, 'base64')
  const ivBuffer = Buffer.from(iv, 'base64')

  const decipher = crypto.createDecipheriv('aes-128-cbc', key, ivBuffer)
  decipher.setAutoPadding(true)

  let decoded = decipher.update(encrypted, undefined, 'utf8')
  decoded += decipher.final('utf8')
  return JSON.parse(decoded)
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (error) {
        reject(new Error('invalid json body'))
      }
    })
    req.on('error', reject)
  })
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  })
  res.end(JSON.stringify(payload))
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
  lines.forEach((line) => {
    const text = line.trim()
    if (!text || text.startsWith('#')) return
    const idx = text.indexOf('=')
    if (idx === -1) return
    const key = text.slice(0, idx).trim()
    const value = text.slice(idx + 1).trim()
    if (key && !(key in process.env)) {
      process.env[key] = value
    }
  })
}
