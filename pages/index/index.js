const protocol = require('../../utils/protocol.js')
const weatherService = require('../../services/weather.js')
const werunService = require('../../services/werun.js')
const adaptive = require('../../utils/adaptive.js')
const runtime = require('../../config/runtime.js')

const BLE_DEFAULTS = runtime.ble || {}

const GEAR_TEXT = {
  0: '关闭',
  1: '低档',
  2: '中档',
  3: '高档',
}

const COMMAND_TEXT = {
  [protocol.CMD.SEND_DATA]: '发数据',
  [protocol.CMD.SYNC_DEVICE]: '同步',
}

const PRODUCT_TEXT = {
  [protocol.PRODUCT.VEST]: '马甲',
  [protocol.PRODUCT.JACKET]: '外套',
  [protocol.PRODUCT.PANTS]: '裤子',
  [protocol.PRODUCT.SOCK_L]: '左袜',
  [protocol.PRODUCT.SOCK_R]: '右袜',
  [protocol.PRODUCT.SHOE_L]: '左鞋',
  [protocol.PRODUCT.SHOE_R]: '右鞋',
  [protocol.PRODUCT.GLOVE_L]: '左手套',
  [protocol.PRODUCT.GLOVE_R]: '右手套',
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
    lastReceivedPacketText: '暂无',
    deviceReportedGearText: '暂无',
    deviceReportedBatteryText: '暂无',
    deviceReportedPowerText: '暂无',
    weatherLoading: false,
    weatherSource: 'mock',
    weatherText: '未获取',
    outdoorTemp: 8,
    feelsLikeTemp: 4,
    weatherObservationTime: '',
    weRunStatus: '未获取',
    weRunServerConfigured: false,
    weRunServerHealthText: '未检查',
    weRunEncryptedReady: false,
    weRunCloudId: '',
    weRunLastStep: 0,
    stepCount: 3000,
    stepSource: 'manual',
    controlMode: 'auto',
    controlModeSummary: '自动模式会跟随天气和步数实时更新建议档位。',
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
    bleNamePrefix: BLE_DEFAULTS.namePrefix || '',
    bleLengthMode:
      BLE_DEFAULTS.lengthMode === protocol.LENGTH_MODE.DOUBLE_BYTE
        ? protocol.LENGTH_MODE.DOUBLE_BYTE
        : protocol.LENGTH_MODE.SINGLE_BYTE,
    blePreferredServiceId: normalizeBleId(BLE_DEFAULTS.preferredServiceId),
    blePreferredNotifyCharacteristicId: normalizeBleId(BLE_DEFAULTS.preferredNotifyCharacteristicId),
    blePreferredWriteCharacteristicId: normalizeBleId(BLE_DEFAULTS.preferredWriteCharacteristicId),
    bleContractStatus: '待发现',
    bleContractSource: '将优先匹配配置中的 UUID，找不到时自动探测。',
    bleActiveWriteServiceId: '',
    bleActiveNotifyServiceId: '',
    bleActiveNotifyCharacteristicId: '',
    bleActiveWriteCharacteristicId: '',
    bleWritePropertyText: '暂无',
    bleNotifyPropertyText: '暂无',
    bleServices: [],
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

    if (werunService.hasConfiguredWeRunServer()) {
      this.checkWeRunServerHealth()
    }

    wx.onBluetoothDeviceFound((res) => {
      const found = Array.isArray(res.devices) ? res.devices : []
      let nextDevices = this.data.devices

      found.forEach((device) => {
        const name = device.name || device.localName || ''
        if (!name) return
        if (!matchesNamePrefix(name, this.data.bleNamePrefix)) return
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
      if (!this.data.connectedDeviceId || res.deviceId !== this.data.connectedDeviceId) return
      this.handleBleValueChange(res)
    })

    wx.onBLEConnectionStateChange((res) => {
      if (res.deviceId !== this.data.connectedDeviceId) return
      if (!res.connected) {
        this.resetBleConnectionState('连接已断开')
      }
    })
  },

  onUnload() {
    wx.stopBluetoothDevicesDiscovery()
    if (this.data.connectedDeviceId) {
      wx.closeBLEConnection({ deviceId: this.data.connectedDeviceId })
    }
    wx.closeBluetoothAdapter()
  },

  async checkWeRunServerHealth() {
    if (!werunService.hasConfiguredWeRunServer()) {
      this.setData({ weRunServerHealthText: '未配置解密服务' })
      return
    }

    this.setData({ weRunServerHealthText: '检查中...' })
    try {
      const health = await werunService.pingWeRunServer()
      const configured = health && health.configured ? '服务端已配 AppID/AppSecret' : '服务端未配 AppID/AppSecret'
      this.setData({
        weRunServerHealthText: `可达，${configured}`,
      })
    } catch (error) {
      console.warn('werun health check failed', error)
      this.setData({
        weRunServerHealthText: `不可达：${error.message || '健康检查失败'}`,
      })
    }
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

  onLengthModeChange(e) {
    const mode = e.currentTarget.dataset.mode
    if (!mode || mode === this.data.bleLengthMode) return
    this.setData({
      bleLengthMode: mode,
    }, () => {
      this.refreshPacketPreview()
    })
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
      if (werunService.hasConfiguredWeRunServer()) {
        this.checkWeRunServerHealth()
      }

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
    this.setData({
      controlMode: 'auto',
    }, () => {
      this.refreshAdaptiveSuggestion()
      wx.showToast({ title: '已切回自动模式', icon: 'success' })
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
    const currentGear = this.resolveCurrentGear(result.gear)
    this.setData({
      adaptiveGearText: result.gearText,
      adaptiveTempBand: result.tempBand,
      adaptiveActivityBand: result.activityBand,
      adaptiveSummary: result.summary,
      adaptiveReasons: result.reasons,
      controlModeSummary:
        this.data.controlMode === 'auto'
          ? '自动模式会跟随天气和步数实时更新建议档位。'
          : '手动模式以你选定的档位为准，不随建议自动变更。',
      currentGear,
      currentGearText: formatGearText(currentGear),
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
      packetReadyText: this.data.connected
        ? `已连接，可直接发送（${formatLengthModeText(this.data.bleLengthMode)}）`
        : `未连接，仅生成指令（${formatLengthModeText(this.data.bleLengthMode)}）`,
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
        bleContractStatus: '等待连接后确认服务/特征',
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

      const contract = await this.discoverBleContract(deviceid)
      if (!contract.active.writeServiceId || !contract.active.writeCharacteristicId) {
        throw new Error('未发现可写 BLE 特征')
      }

      if (contract.active.notifyCharacteristicId) {
        await promisify(wx.notifyBLECharacteristicValueChange)({
          deviceId: deviceid,
          serviceId: contract.active.notifyServiceId,
          characteristicId: contract.active.notifyCharacteristicId,
          state: true,
        })
      }

      this.setData({
        scanning: false,
        connected: true,
        connectedDeviceId: deviceid,
        connectedDeviceName: name || deviceid,
        statusText: '已连接',
        bleContractStatus: contract.statusText,
        bleContractSource: contract.sourceText,
        bleActiveWriteServiceId: contract.active.writeServiceId,
        bleActiveNotifyServiceId: contract.active.notifyServiceId,
        bleActiveNotifyCharacteristicId: contract.active.notifyCharacteristicId,
        bleActiveWriteCharacteristicId: contract.active.writeCharacteristicId,
        bleWritePropertyText: contract.active.writePropertyText,
        bleNotifyPropertyText: contract.active.notifyPropertyText,
        bleServices: contract.services,
      }, () => {
        this.refreshPacketPreview()
      })
      wx.showToast({ title: '连接成功', icon: 'success' })
    } catch (error) {
      console.error('connect failed', error)
      wx.showToast({ title: '连接失败', icon: 'none' })
      this.resetBleConnectionState(`连接失败：${error.message || '未知错误'}`)
    }
  },

  async onDisconnect() {
    if (!this.data.connectedDeviceId) return
    try {
      await promisify(wx.closeBLEConnection)({ deviceId: this.data.connectedDeviceId })
    } catch (error) {
      console.warn('disconnect failed', error)
    }
    this.resetBleConnectionState('待连接')
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
      nextState.controlModeSummary = '手动模式以你选定的档位为准，不随建议自动变更。'
    }

    this.setData(nextState)

    if (!this.data.connectedDeviceId) {
      wx.showToast({ title: '已生成指令，尚未连接设备', icon: 'none' })
      return
    }

    if (!this.data.bleActiveWriteServiceId || !this.data.bleActiveWriteCharacteristicId) {
      wx.showToast({ title: '未解析到写入通道', icon: 'none' })
      return
    }

    try {
      await promisify(wx.writeBLECharacteristicValue)({
        deviceId: this.data.connectedDeviceId,
        serviceId: this.data.bleActiveWriteServiceId,
        characteristicId: this.data.bleActiveWriteCharacteristicId,
        value: packet,
      })

      wx.showToast({ title: '已发送', icon: 'success' })
    } catch (error) {
      console.error('write failed', error)
      wx.showToast({ title: '发送失败', icon: 'none' })
    }
  },

  async discoverBleContract(deviceId) {
    const serviceResult = await promisify(wx.getBLEDeviceServices)({ deviceId })
    const rawServices = Array.isArray(serviceResult.services) ? serviceResult.services : []
    const services = []

    for (let i = 0; i < rawServices.length; i++) {
      const service = rawServices[i]
      const serviceId = normalizeBleId(service.uuid)
      let rawCharacteristics = []

      try {
        const characteristicResult = await promisify(wx.getBLEDeviceCharacteristics)({
          deviceId,
          serviceId,
        })
        rawCharacteristics = Array.isArray(characteristicResult.characteristics)
          ? characteristicResult.characteristics
          : []
      } catch (error) {
        console.warn('get characteristics failed', serviceId, error)
      }

      services.push({
        serviceId,
        isPrimary: Boolean(service.isPrimary),
        characteristics: rawCharacteristics.map((item) => {
          const properties = normalizeBleProperties(item.properties)
          return {
            uuid: normalizeBleId(item.uuid),
            properties,
            propsText: formatCharacteristicProps(properties),
          }
        }),
      })
    }

    const active = chooseBleContract(services, {
      serviceId: this.data.blePreferredServiceId,
      notifyCharacteristicId: this.data.blePreferredNotifyCharacteristicId,
      writeCharacteristicId: this.data.blePreferredWriteCharacteristicId,
    })

    return {
      services: attachCharacteristicRoles(services, active),
      active,
      statusText: active.notifyCharacteristicId
        ? '已确认写入/通知通道'
        : '仅确认写入通道，设备未暴露通知特征',
      sourceText: active.sourceText,
    }
  },

  handleBleValueChange(res) {
    const hex = bufferToHex(res.value)
    const parsed = protocol.parsePacket(res.value, {
      lengthMode: protocol.LENGTH_MODE.AUTO,
    })

    this.setData({
      lastReceivedHex: hex,
      lastReceivedPacketText: parsed ? formatParsedPacket(parsed.fields) : '未按当前协议解析成功',
      deviceReportedGearText: parsed ? formatGearText(parsed.fields.front) : this.data.deviceReportedGearText,
      deviceReportedBatteryText: parsed ? `${parsed.fields.battery}%` : this.data.deviceReportedBatteryText,
      deviceReportedPowerText: parsed ? formatPowerText(parsed.fields.power) : this.data.deviceReportedPowerText,
    })
  },

  buildSockPacket(gear) {
    return protocol.buildPacket({
      command: 'send',
      lengthMode: this.data.bleLengthMode,
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

  resetBleConnectionState(statusText) {
    this.setData({
      connected: false,
      connectedDeviceId: '',
      connectedDeviceName: '',
      statusText,
      bleActiveWriteServiceId: '',
      bleActiveNotifyServiceId: '',
      bleActiveNotifyCharacteristicId: '',
      bleActiveWriteCharacteristicId: '',
      bleWritePropertyText: '暂无',
      bleNotifyPropertyText: '暂无',
    }, () => {
      this.refreshPacketPreview()
    })
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

function matchesNamePrefix(name, prefix) {
  if (!prefix) return true
  return String(name || '').toLowerCase().indexOf(String(prefix).toLowerCase()) === 0
}

function normalizeBleId(id) {
  return String(id || '').trim().toUpperCase()
}

function normalizeBleProperties(properties) {
  const props = properties || {}
  return {
    read: Boolean(props.read),
    write: Boolean(props.write),
    writeNoResponse: Boolean(props.writeNoResponse),
    notify: Boolean(props.notify),
    indicate: Boolean(props.indicate),
  }
}

function hasWriteProperty(properties) {
  return Boolean(properties.write || properties.writeNoResponse)
}

function hasNotifyProperty(properties) {
  return Boolean(properties.notify || properties.indicate)
}

function formatCharacteristicProps(properties) {
  const labels = []
  if (properties.read) labels.push('read')
  if (properties.write) labels.push('write')
  if (properties.writeNoResponse) labels.push('writeNoResponse')
  if (properties.notify) labels.push('notify')
  if (properties.indicate) labels.push('indicate')
  return labels.length ? labels.join(' / ') : '无可识别属性'
}

function chooseBleContract(services, preferences) {
  const preferredServiceId = normalizeBleId(preferences.serviceId)
  const preferredWriteCharacteristicId = normalizeBleId(preferences.writeCharacteristicId)
  const preferredNotifyCharacteristicId = normalizeBleId(preferences.notifyCharacteristicId)

  let orderedServices = services.slice()
  if (preferredServiceId) {
    orderedServices = orderedServices.sort((a, b) => {
      if (a.serviceId === preferredServiceId) return -1
      if (b.serviceId === preferredServiceId) return 1
      return 0
    })
  }

  for (let i = 0; i < orderedServices.length; i++) {
    const service = orderedServices[i]
    const writeCharacteristic = findCharacteristic(service.characteristics, preferredWriteCharacteristicId, hasWriteProperty)
    if (!writeCharacteristic) continue

    const notifyCandidate =
      findCharacteristic(service.characteristics, preferredNotifyCharacteristicId, hasNotifyProperty) ||
      findNotifyAcrossServices(orderedServices, preferredNotifyCharacteristicId)

    return {
      writeServiceId: service.serviceId,
      writeCharacteristicId: writeCharacteristic.uuid,
      notifyServiceId: notifyCandidate ? notifyCandidate.serviceId : '',
      notifyCharacteristicId: notifyCandidate ? notifyCandidate.characteristic.uuid : '',
      writePropertyText: writeCharacteristic.propsText,
      notifyPropertyText: notifyCandidate ? notifyCandidate.characteristic.propsText : '设备未提供 notify/indicate',
      sourceText: buildBleSourceText({
        preferredServiceId,
        writeServiceId: service.serviceId,
        notifyServiceId: notifyCandidate ? notifyCandidate.serviceId : '',
      }),
    }
  }

  return {
    writeServiceId: '',
    notifyServiceId: '',
    writeCharacteristicId: '',
    notifyCharacteristicId: '',
    writePropertyText: '暂无',
    notifyPropertyText: '暂无',
    sourceText: '未找到可写 BLE 服务，请核对固件广播和特征配置',
  }
}

function findCharacteristic(characteristics, preferredId, predicate) {
  const list = Array.isArray(characteristics) ? characteristics : []
  if (preferredId) {
    const preferred = list.find((item) => item.uuid === preferredId && predicate(item.properties))
    if (preferred) return preferred
  }
  return list.find((item) => predicate(item.properties))
}

function findNotifyAcrossServices(services, preferredNotifyCharacteristicId) {
  for (let i = 0; i < services.length; i++) {
    const characteristic = findCharacteristic(
      services[i].characteristics,
      preferredNotifyCharacteristicId,
      hasNotifyProperty
    )
    if (characteristic) {
      return {
        serviceId: services[i].serviceId,
        characteristic,
      }
    }
  }
  return null
}

function attachCharacteristicRoles(services, active) {
  return services.map((service) => {
    const characteristics = service.characteristics.map((item) => ({
      uuid: item.uuid,
      propsText: item.propsText,
      roleText: formatCharacteristicRole(service.serviceId, item.uuid, active),
    }))

    return {
      serviceId: service.serviceId,
      summary: service.isPrimary ? '主服务' : '从服务',
      characteristics,
    }
  })
}

function formatCharacteristicRole(serviceId, uuid, active) {
  const roles = []
  if (serviceId === active.writeServiceId && uuid === active.writeCharacteristicId) {
    roles.push('写入')
  }
  if (serviceId === active.notifyServiceId && uuid === active.notifyCharacteristicId) {
    roles.push('通知')
  }
  return roles.length ? roles.join(' / ') : ''
}

function buildBleSourceText(input) {
  const hitPreferred = input.preferredServiceId && input.writeServiceId === input.preferredServiceId
  const base = hitPreferred ? '命中首选 BLE UUID 配置' : '未命中首选配置，已自动选择可写服务'
  if (input.notifyServiceId && input.notifyServiceId !== input.writeServiceId) {
    return `${base}；通知特征位于独立 service`
  }
  return base
}

function formatParsedPacket(fields) {
  return [
    `${COMMAND_TEXT[fields.cmd] || fields.cmd} / ${PRODUCT_TEXT[fields.productType] || fields.productType}`,
    `档位 ${formatGearText(fields.front)}，电源${formatPowerText(fields.power)}，灯${fields.light === protocol.LIGHT.ON ? '开' : '关'}`,
    `环境 ${fields.envTempC}°C，电池 ${fields.battery}% ，定时 ${fields.timerMinutes} 分钟`,
    `长度字段 ${formatLengthModeText(fields.lengthMode)}，整帧 ${fields.declaredLength} 字节`,
  ].join('；')
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

function formatLengthModeText(mode) {
  return mode === protocol.LENGTH_MODE.DOUBLE_BYTE ? '双字节长度' : '单字节长度'
}

function formatPowerText(power) {
  return power === protocol.POWER.ON ? '开机' : '关机'
}
