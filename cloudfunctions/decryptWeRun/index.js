const https = require('https')
const crypto = require('crypto')

const localConfig = loadLocalConfig()
const APPID = localConfig.appId || process.env.WECHAT_APPID || ''
const SECRET = localConfig.appSecret || process.env.WECHAT_SECRET || ''

exports.main = async (event) => {
  const action = event && event.action ? event.action : 'decrypt'

  if (action === 'health') {
    return {
      ok: true,
      data: {
        configured: Boolean(APPID && SECRET),
        config: {
          hasAppId: Boolean(APPID),
          hasSecret: Boolean(SECRET),
        },
        provider: 'cloud',
      },
    }
  }

  if (!APPID || !SECRET) {
    return {
      ok: false,
      message: 'WECHAT_APPID / WECHAT_SECRET not configured in cloud function',
    }
  }

  try {
    const code = event.code
    const encryptedData = event.encryptedData
    const iv = event.iv

    if (!code || !encryptedData || !iv) {
      return {
        ok: false,
        message: 'code, encryptedData, iv are required',
      }
    }

    const session = await exchangeSession(code)
    if (!session.session_key) {
      return {
        ok: false,
        message: session.errmsg || 'jscode2session failed',
        data: session,
      }
    }

    const decrypted = decryptWeRunData(session.session_key, encryptedData, iv)
    const stepInfoList = Array.isArray(decrypted.stepInfoList) ? decrypted.stepInfoList : []
    const latestStep = stepInfoList.length
      ? Number(stepInfoList[stepInfoList.length - 1].step || 0)
      : 0

    return {
      ok: true,
      data: {
        latestStep,
        stepInfoList,
        openid: session.openid || '',
      },
    }
  } catch (error) {
    return {
      ok: false,
      message: error.message || 'cloud function failed',
    }
  }
}

async function exchangeSession(code) {
  const url =
    `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(APPID)}` +
    `&secret=${encodeURIComponent(SECRET)}` +
    `&js_code=${encodeURIComponent(code)}` +
    `&grant_type=authorization_code`

  return requestJson(url)
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

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let raw = ''
      res.on('data', (chunk) => {
        raw += chunk
      })
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`http ${res.statusCode}`))
          return
        }
        try {
          resolve(JSON.parse(raw || '{}'))
        } catch (error) {
          reject(new Error('invalid json response'))
        }
      })
    })

    req.on('error', reject)
  })
}

function loadLocalConfig() {
  try {
    return require('./local.config.js')
  } catch (error) {
    return {}
  }
}
