const runtime = require('./config/runtime.js')

App({
  onLaunch() {
    if (!wx.cloud) {
      console.warn('wx.cloud is not available in this base library')
      return
    }

    wx.cloud.init({
      env: runtime.cloudEnvId || wx.cloud.DYNAMIC_CURRENT_ENV,
      traceUser: true,
    })
  },
})
