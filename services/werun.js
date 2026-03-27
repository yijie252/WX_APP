const runtime = require('../config/runtime.js')

function hasConfiguredWeRunServer() {
  if (useCloudFunction()) {
    return Boolean(resolveCloudFunctionName())
  }
  return Boolean(resolveDecryptUrl())
}

function decryptWeRunStepData(payload) {
  if (!hasConfiguredWeRunServer()) {
    return Promise.reject(new Error('werun decrypt provider not configured'))
  }

  if (useCloudFunction()) {
    return callWeRunCloudFunction({
      action: 'decrypt',
      payload,
    }).then((data) => normalizeDecryptedPayload(data))
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: resolveDecryptUrl(),
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
        resolve(normalizeDecryptedPayload(res.data.data))
      },
      fail: reject,
    })
  })
}

function pingWeRunServer() {
  if (useCloudFunction()) {
    return callWeRunCloudFunction({
      action: 'health',
      payload: {},
    })
  }

  const healthUrl = resolveHealthUrl()
  if (!healthUrl) {
    return Promise.reject(new Error('werun health url not configured'))
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: healthUrl,
      method: 'GET',
      success: (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`health check failed: ${res.statusCode}`))
          return
        }
        resolve(res.data || {})
      },
      fail: reject,
    })
  })
}

function resolveDecryptUrl() {
  return String(runtime.werunDecryptUrl || '').trim()
}

function resolveCloudFunctionName() {
  return String(runtime.werunCloudFunctionName || '').trim()
}

function resolveHealthUrl() {
  if (runtime.werunHealthUrl) {
    return String(runtime.werunHealthUrl).trim()
  }

  const decryptUrl = resolveDecryptUrl()
  if (!decryptUrl) return ''
  return decryptUrl.replace(/\/api\/werun\/decrypt\/?$/, '/health')
}

function useCloudFunction() {
  return String(runtime.werunProvider || '').trim() === 'cloud'
}

function callWeRunCloudFunction(input) {
  const functionName = resolveCloudFunctionName()
  if (!functionName) {
    return Promise.reject(new Error('werun cloud function not configured'))
  }
  if (!wx.cloud || !wx.cloud.callFunction) {
    return Promise.reject(new Error('wx.cloud is not available'))
  }

  return wx.cloud.callFunction({
    name: functionName,
    data: {
      action: input.action,
      ...(input.payload || {}),
    },
  }).then((res) => {
    const result = res && res.result ? res.result : {}
    if (!result || result.ok !== true) {
      throw new Error((result && result.message) || 'cloud function failed')
    }
    return result.data || {}
  })
}

function normalizeDecryptedPayload(data) {
  const payload = data || {}
  const stepInfoList = Array.isArray(payload.stepInfoList) ? payload.stepInfoList : []
  const latestStep =
    typeof payload.latestStep === 'number'
      ? payload.latestStep
      : stepInfoList.length
        ? Number(stepInfoList[stepInfoList.length - 1].step || 0)
        : 0

  return {
    latestStep,
    stepInfoList,
    openid: payload.openid || '',
  }
}

module.exports = {
  hasConfiguredWeRunServer,
  decryptWeRunStepData,
  pingWeRunServer,
  resolveHealthUrl,
}
