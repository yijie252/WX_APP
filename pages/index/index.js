const protocol = require('../../utils/protocol.js')
const weatherService = require('../../services/weather.js')
const werunService = require('../../services/werun.js')
const adaptive = require('../../utils/adaptive.js')

const BLE_CONFIG = {
  serviceId: '0000FF00-0000-1000-8000-00805F9B34FB',
  notifyCharacteristicId: '0000FF01-0000-1000-8000-00805F9B34FB',
  writeCharacteristicId: '0000FF02-0000-1000-8000-00805F9B34FB',
}

const GEAR_TEXT = {
  0: '关闭',
  1: '低档',
  2: '中档',
  3: '高档',
}

function bufferToHex(buf) {
  const u8 = new Uint8Array(buf)
  return Array.from(u8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function upsertDevice(list, device) {
  const idx = list.findIndex((item) => item.deviceId === device.deviceId)
  if (idx === -1) {
    return list.concat(device)
  }
  const next = list.slice()
  next[idx] = { ...next[idx], ...device }
  return next
}

Page({
  data: {
    exampleHex: '',
    statusText: '待连接',
    scanning: false,
    connected: false,
    connectedDeviceId: '',
    connectedDeviceName: '',
    devices: [],
    lastSentHex: '',
    lastReceivedHex: '',
    weatherLoading: false,
    weatherSource: 'mock',
    weatherText: '未获取',
    outdoorTemp: 8,
    feelsLikeTemp: 4,
    weatherObservationTime: '',
    weRunStatus: '未获取',
    weRunServerConfigured: false,
    weRunEncryptedReady: false,
    weRunCloudId: '',
    weRunLastStep: 0,
    stepCount: 3000,
    stepSource: 'manual',
    controlMode: 'auto',
    manualGear: 1,
    manualGearText: '低档',
    currentGear: 1,
    currentGearText: '低档',
    adaptiveGearText: '低档',
    adaptiveTempBand: '',
    adaptiveActivityBand: '',
    adaptiveSummary: '',
    adaptiveReasons: [],
    pendingPacketHex: '',
    packetReadyText: '未生成',
  },

  onLoad() {
    const check = protocol.assertExampleMatches()
    if (!check.ok) {
      console.error('protocol example mismatch', check)
    }

    this.setData({
      exampleHex: bufferToHex(protocol.exampleQueryPacket()),
      weRunServerConfigured: werunService.hasConfiguredWeRunServer(),
    })
    this.refreshAdaptiveSuggestion()
    this.refreshPacketPreview()

    wx.onBluetoothDeviceFound((res) => {
      const found = Array.isArray(res.devices) ? res.devices : []
      let nextDevices = this.data.devices

      found.forEach((device) => {
        const name = device.name || device.localName || ''
        if (!name) return
        nextDevices = upsertDevice(nextDevices, {
          deviceId: device.deviceId,
          name,
          RSSI: device.RSSI,
        })
      })

      if (nextDevices !== this.data.devices) {
        this.setData({ devices: nextDevices })
      }
    })

    wx.onBLECharacteristicValueChange((res) => {
      const hex = bufferToHex(res.value)
      this.setData({ lastReceivedHex: hex })
    })
  },

  onUnload() {
    wx.stopBluetoothDevicesDiscovery()
    if (this.data.connectedDeviceId) {
      wx.closeBLEConnection({ deviceId: this.data.connectedDeviceId })
    }
    wx.closeBluetoothAdapter()
  },

  onCopyExample() {
    wx.setClipboardData({
      data: this.data.exampleHex,
    })
  },

  onStepInput(e) {
    const stepCount = Number(e.detail.value || 0)
    this.setData({
      stepCount,
      stepSource: 'manual',
    })
    this.refreshAdaptiveSuggestion()
  },

  async onFetchWeather() {
    this.setData({ weatherLoading: true })
    try {
      const location = await promisify(wx.getLocation)({
        type: 'wgs84',
      })
      const weather = await weatherService.fetchCurrentWeather(location.latitude, location.longitude)
      this.setData({
        weatherLoading: false,
        weatherSource: 'live',
        weatherText: weather.weatherText,
        outdoorTemp: weather.temperature,
        feelsLikeTemp: weather.feelsLike,
        weatherObservationTime: weather.observationTime,
      })
      this.refreshAdaptiveSuggestion()
    } catch (error) {
      console.warn('fetch weather failed, fallback to mock', error)
      const mock = weatherService.buildMockWeather()
      this.setData({
        weatherLoading: false,
        weatherSource: 'mock',
        weatherText: `${mock.weatherText}（模拟）`,
        outdoorTemp: mock.temperature,
        feelsLikeTemp: mock.feelsLike,
        weatherObservationTime: '',
      })
      this.refreshAdaptiveSuggestion()
      wx.showToast({ title: '天气改用模拟数据', icon: 'none' })
    }
  },

  async onFetchWeRun() {
    try {
      const loginResult = await promisify(wx.login)()
      const result = await promisify(wx.getWeRunData)()
      const hasCloudId = Boolean(result.cloudID)

      if (werunService.hasConfiguredWeRunServer() && result.encryptedData && result.iv && loginResult.code) {
        const decrypted = await werunService.decryptWeRunStepData({
          code: loginResult.code,
          encryptedData: result.encryptedData,
          iv: result.iv,
          cloudID: result.cloudID || '',
        })

        this.setData({
          weRunStatus: '已解密并回填步数',
          weRunEncryptedReady: true,
          weRunCloudId: result.cloudID || '',
          weRunLastStep: Number(decrypted.latestStep || 0),
          stepCount: Number(decrypted.latestStep || 0),
          stepSource: 'werun',
        })
        this.refreshAdaptiveSuggestion()
        wx.showToast({ title: '已同步微信运动', icon: 'success' })
        return
      }

      this.setData({
        weRunStatus: hasCloudId ? '已获取 cloudID，待服务端解密' : '已获取加密数据，待服务端解密',
        weRunEncryptedReady: true,
        weRunCloudId: result.cloudID || '',
      })
      wx.showToast({ title: '已获取加密数据', icon: 'success' })
    } catch (error) {
      console.warn('get werun failed', error)
      this.setData({
        weRunStatus: '获取失败或未授权',
        weRunEncryptedReady: false,
        weRunCloudId: '',
      })
      wx.showToast({ title: '微信运动未就绪', icon: 'none' })
    }
  },

  onApplyAdaptiveNow() {
    const gear = this.resolveAdaptiveGear()
    this.setData({
      controlMode: 'manual',
      manualGear: gear,
      manualGearText: formatGearText(gear),
    }, () => {
      this.refreshAdaptiveSuggestion()
      wx.showToast({ title: '已采纳建议', icon: 'success' })
    })
  },

  onSwitchMode(e) {
    const mode = e.currentTarget.dataset.mode
    if (!mode || mode === this.data.controlMode) return
    this.setData({
      controlMode: mode,
    }, () => {
      this.refreshAdaptiveSuggestion()
    })
  },

  onSelectManualGear(e) {
    const gear = Number(e.currentTarget.dataset.gear || 0)
    this.setData({
      manualGear: gear,
      manualGearText: formatGearText(gear),
    }, () => {
      this.refreshAdaptiveSuggestion()
    })
  },

  refreshAdaptiveSuggestion() {
    const result = adaptive.buildAdaptiveSuggestion({
      outdoorTemp: this.data.outdoorTemp,
      feelsLike: this.data.feelsLikeTemp,
      stepCount: this.data.stepCount,
    })
    this.setData({
      adaptiveGearText: result.gearText,
      adaptiveTempBand: result.tempBand,
      adaptiveActivityBand: result.activityBand,
      adaptiveSummary: result.summary,
      adaptiveReasons: result.reasons,
      currentGear: this.resolveCurrentGear(result.gear),
      currentGearText: formatGearText(this.resolveCurrentGear(result.gear)),
    }, () => {
      this.refreshPacketPreview()
    })
  },

  refreshPacketPreview() {
    const currentGear = this.resolveCurrentGear()
    const packet = this.buildSockPacket(currentGear)
    this.setData({
      currentGear,
      currentGearText: formatGearText(currentGear),
      pendingPacketHex: bufferToHex(packet),
      packetReadyText: this.data.connected ? '已连接，可直接发送' : '未连接，仅生成指令',
    })
  },

  async onStartScan() {
    try {
      await promisify(wx.openBluetoothAdapter)()
      await promisify(wx.startBluetoothDevicesDiscovery)({
        allowDuplicatesKey: false,
      })
      this.setData({
        scanning: true,
        statusText: '扫描中',
        devices: [],
      })
    } catch (error) {
      console.error('start scan failed', error)
      wx.showToast({ title: '蓝牙不可用', icon: 'none' })
      this.setData({ statusText: '蓝牙不可用' })
    }
  },

  async onStopScan() {
    try {
      await promisify(wx.stopBluetoothDevicesDiscovery)()
    } catch (error) {
      console.warn('stop scan failed', error)
    }
    this.setData({
      scanning: false,
      statusText: this.data.connected ? '已连接' : '待连接',
    })
  },

  async onConnectDevice(e) {
    const { deviceid, name } = e.currentTarget.dataset
    if (!deviceid) return

    try {
      await promisify(wx.stopBluetoothDevicesDiscovery)()
      await promisify(wx.createBLEConnection)({ deviceId: deviceid, timeout: 10000 })

      await promisify(wx.getBLEDeviceServices)({ deviceId: deviceid })
      await promisify(wx.getBLEDeviceCharacteristics)({
        deviceId: deviceid,
        serviceId: BLE_CONFIG.serviceId,
      })
      await promisify(wx.notifyBLECharacteristicValueChange)({
        deviceId: deviceid,
        serviceId: BLE_CONFIG.serviceId,
        characteristicId: BLE_CONFIG.notifyCharacteristicId,
        state: true,
      })

      this.setData({
        scanning: false,
        connected: true,
        connectedDeviceId: deviceid,
        connectedDeviceName: name || deviceid,
        statusText: '已连接',
      })
      wx.showToast({ title: '连接成功', icon: 'success' })
    } catch (error) {
      console.error('connect failed', error)
      wx.showToast({ title: '连接失败', icon: 'none' })
      this.setData({
        connected: false,
        connectedDeviceId: '',
        connectedDeviceName: '',
        statusText: '连接失败',
      })
    }
  },

  async onDisconnect() {
    if (!this.data.connectedDeviceId) return
    try {
      await promisify(wx.closeBLEConnection)({ deviceId: this.data.connectedDeviceId })
    } catch (error) {
      console.warn('disconnect failed', error)
    }
    this.setData({
      connected: false,
      connectedDeviceId: '',
      connectedDeviceName: '',
      statusText: '待连接',
    })
  },

  async onSendGear(e) {
    const useCurrent = Boolean(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.useCurrent)
    const gear = useCurrent ? this.resolveCurrentGear() : Number(e.currentTarget.dataset.gear || 0)
    const packet = this.buildSockPacket(gear)

    const nextState = {
      currentGear: gear,
      currentGearText: formatGearText(gear),
      lastSentHex: bufferToHex(packet),
      pendingPacketHex: bufferToHex(packet),
    }

    if (!useCurrent) {
      nextState.controlMode = 'manual'
      nextState.manualGear = gear
      nextState.manualGearText = formatGearText(gear)
    }

    this.setData(nextState)

    if (!this.data.connectedDeviceId) {
      wx.showToast({ title: '已生成指令，尚未连接设备', icon: 'none' })
      return
    }

    try {
      await promisify(wx.writeBLECharacteristicValue)({
        deviceId: this.data.connectedDeviceId,
        serviceId: BLE_CONFIG.serviceId,
        characteristicId: BLE_CONFIG.writeCharacteristicId,
        value: packet,
      })

      wx.showToast({ title: '已发送', icon: 'success' })
    } catch (error) {
      console.error('write failed', error)
      wx.showToast({ title: '发送失败', icon: 'none' })
    }
  },

  buildSockPacket(gear) {
    return protocol.buildPacket({
      command: 'send',
      productType: protocol.PRODUCT.SOCK_L,
      power: protocol.POWER.ON,
      front: gear,
      collar: protocol.GEAR.OFF,
      back: protocol.GEAR.OFF,
      light: protocol.LIGHT.ON,
      envTempC: Math.round(Number(this.data.feelsLikeTemp) || 0),
      battery: 0,
      timerMinutes: 0,
    })
  },

  resolveAdaptiveGear() {
    return adaptive.parseGearText ? adaptive.parseGearText(this.data.adaptiveGearText) : parseGearText(this.data.adaptiveGearText)
  },

  resolveCurrentGear(adaptiveGear) {
    if (this.data.controlMode === 'manual') {
      return Number(this.data.manualGear || 0)
    }
    if (typeof adaptiveGear === 'number') return adaptiveGear
    return this.resolveAdaptiveGear()
  },
})

function promisify(api) {
  return (options = {}) =>
    new Promise((resolve, reject) => {
      api({
        ...options,
        success: resolve,
        fail: reject,
      })
    })
}

function parseGearText(text) {
  if (text === '高档') return 3
  if (text === '中档') return 2
  if (text === '低档') return 1
  return 0
}

function formatGearText(gear) {
  return GEAR_TEXT[gear] || '关闭'
}
