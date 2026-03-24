const runtime = require('../config/runtime.js')

function hasConfiguredWeRunServer() {
  return Boolean(runtime.werunDecryptUrl)
}

function decryptWeRunStepData(payload) {
  if (!hasConfiguredWeRunServer()) {
    return Promise.reject(new Error('werun decrypt url not configured'))
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: runtime.werunDecryptUrl,
      method: 'POST',
      header: {
        'content-type': 'application/json',
      },
      data: payload,
      success: (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`request failed: ${res.statusCode}`))
          return
        }
        if (!res.data || res.data.ok !== true) {
          reject(new Error((res.data && res.data.message) || 'decrypt failed'))
          return
        }
        resolve(res.data.data)
      },
      fail: reject,
    })
  })
}

module.exports = {
  hasConfiguredWeRunServer,
  decryptWeRunStepData,
}
