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
    weRunProviderText: runtime.werunProvider === 'cloud' ? '云函数' : 'HTTP 服务',
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
    pendingPacketExplain: '',
    lastSentPacketExplain: '',
    lastReceivedPacketExplain: '',
    bleNamePrefix: BLE_DEFAULTS.namePrefix || '',
    bleLengthMode: normalizeConfiguredLengthMode(BLE_DEFAULTS.lengthMode),
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
    bleLastError: '',
    bleDebugText: '',
    blePlatform: '',
  },

  onLoad() {
    const legacyCheck = protocol.assertExampleMatches()
    const compactCheck = protocol.assertCompactExampleMatches()
    if (!legacyCheck.ok) {
      console.error('protocol legacy example mismatch', legacyCheck)
    }
    if (!compactCheck.ok) {
      console.error('protocol compact example mismatch', compactCheck)
    }

    this.setData({
      exampleHex: bufferToHex(protocol.exampleCompactPacket()),
      weRunServerConfigured: werunService.hasConfiguredWeRunServer(),
      blePlatform: detectBlePlatform(),
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

  logBleStage(message) {
    const previous = String(this.data.bleDebugText || '')
    const nextLine = `${formatDebugTime()} ${message}`
    const nextLogs = previous
      ? `${nextLine}\n${previous}`
      : nextLine
    this.setData({
      bleDebugText: nextLogs,
    })
  },

  async checkWeRunServerHealth() {
    if (!werunService.hasConfiguredWeRunServer()) {
      this.setData({ weRunServerHealthText: '未配置解密通道' })
      return
    }

    this.setData({ weRunServerHealthText: '检查中...' })
    try {
      const health = await werunService.pingWeRunServer()
      const providerText = health && health.provider === 'cloud' ? '云函数' : '服务端'
      const configured = health && health.configured ? `${providerText}已配 AppID/AppSecret` : `${providerText}未配 AppID/AppSecret`
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
    const packet = this.buildVestPacket(currentGear)
    const pendingPacketHex = bufferToHex(packet)
    this.setData({
      currentGear,
      currentGearText: formatGearText(currentGear),
      pendingPacketHex,
      pendingPacketExplain: formatPacketExplain(pendingPacketHex),
      packetReadyText: this.data.connected
        ? `已连接，可直接发送（${formatLengthModeText(this.data.bleLengthMode)}）`
        : `未连接，仅生成指令（${formatLengthModeText(this.data.bleLengthMode)}）`,
    })
  },

  async onStartScan() {
    try {
      this.setData({
        bleDebugText: '',
      })
      this.logBleStage('开始扫描设备')
      await promisify(wx.openBluetoothAdapter)()
      this.logBleStage('蓝牙适配器已打开')
      await promisify(wx.startBluetoothDevicesDiscovery)({
        allowDuplicatesKey: false,
      })
      this.logBleStage('设备扫描已启动')
      this.setData({
        scanning: true,
        statusText: '扫描中',
        devices: [],
        bleContractStatus: '等待连接后确认服务/特征',
        bleContractSource: '将优先匹配配置中的 UUID，找不到时自动探测。',
        bleLastError: '',
        bleServices: [],
      })
    } catch (error) {
      console.error('start scan failed', error)
      this.logBleStage(`扫描失败：${getErrorSummary(error)}`)
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
    const dataset = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset
      : {}
    const deviceid = dataset.deviceid || ''
    const name = dataset.name || ''
    if (!deviceid) return
    const isIos = this.data.blePlatform === 'ios'
    const connectSettleMs = isIos ? 2200 : 1200
    const discoverAttempts = isIos ? 5 : 3
    const discoverDelayMs = isIos ? 1400 : 900

    try {
      this.setData({
        statusText: '连接中',
        bleContractStatus: '连接已发起，等待服务发现',
        bleContractSource: '将优先匹配配置中的 UUID，找不到时自动探测。',
        bleLastError: '',
        bleServices: [],
        bleDebugText: '',
      })
      this.logBleStage(`开始连接设备：${name || deviceid}`)
      await promisify(wx.stopBluetoothDevicesDiscovery)()
      this.logBleStage('已停止扫描，准备建立连接')
      await promisify(wx.createBLEConnection)({ deviceId: deviceid, timeout: 10000 })
      this.logBleStage(`BLE 连接已建立，等待服务稳定（${connectSettleMs}ms）`)
      await sleep(connectSettleMs)

      const contract = await this.discoverBleContractWithRetry(deviceid, {
        attempts: discoverAttempts,
        delayMs: discoverDelayMs,
      })
      this.logBleStage(`服务发现成功：write=${contract.active.writeCharacteristicId || '无'} notify=${contract.active.notifyCharacteristicId || '无'}`)
      if (!contract.active.writeServiceId || !contract.active.writeCharacteristicId) {
        throw new Error('未发现可写 BLE 特征')
      }

      let notifyWarningText = ''
      if (contract.active.notifyCharacteristicId) {
        this.logBleStage('开始启用通知特征')
        try {
          await promisify(wx.notifyBLECharacteristicValueChange)({
            deviceId: deviceid,
            serviceId: contract.active.notifyServiceId,
            characteristicId: contract.active.notifyCharacteristicId,
            state: true,
          })
          this.logBleStage('通知特征启用成功')
        } catch (notifyError) {
          notifyWarningText = `；notify 启用失败：${getErrorSummary(notifyError)}`
          this.logBleStage(`通知特征启用失败：${getErrorSummary(notifyError)}`)
        }
      }

      this.setData({
        scanning: false,
        connected: true,
        connectedDeviceId: deviceid,
        connectedDeviceName: name || deviceid,
        statusText: '已连接',
        bleContractStatus: contract.statusText + notifyWarningText,
        bleContractSource: isIos
          ? `${contract.sourceText}；当前为 iOS 兼容模式`
          : contract.sourceText,
        bleActiveWriteServiceId: contract.active.writeServiceId,
        bleActiveNotifyServiceId: contract.active.notifyServiceId,
        bleActiveNotifyCharacteristicId: contract.active.notifyCharacteristicId,
        bleActiveWriteCharacteristicId: contract.active.writeCharacteristicId,
        bleWritePropertyText: contract.active.writePropertyText,
        bleNotifyPropertyText: contract.active.notifyPropertyText,
        bleServices: contract.services,
        bleLastError: '',
      }, () => {
        this.refreshPacketPreview()
      })
      this.logBleStage('连接流程完成')
      wx.showToast({ title: '连接成功', icon: 'success' })
    } catch (error) {
      const errorDetail = formatBleError(error)
      console.error('connect failed', error)
      this.logBleStage(`连接失败：${errorDetail.fullText}`)
      try {
        await promisify(wx.closeBLEConnection)({ deviceId: deviceid })
      } catch (closeError) {
        console.warn('close connection after failure failed', closeError)
      }
      wx.showToast({ title: errorDetail.toastText, icon: 'none' })
      this.resetBleConnectionState(`连接失败：${errorDetail.summary}`)
      this.setData({
        bleContractStatus: `失败：${errorDetail.summary}`,
        bleContractSource: errorDetail.hint,
        bleLastError: errorDetail.fullText,
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
    this.resetBleConnectionState('待连接')
  },

  async onSendGear(e) {
    const useCurrent = Boolean(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.useCurrent)
    const gear = useCurrent ? this.resolveCurrentGear() : Number(e.currentTarget.dataset.gear || 0)
    const packet = this.buildVestPacket(gear)
    const lastSentHex = bufferToHex(packet)

    const nextState = {
      currentGear: gear,
      currentGearText: formatGearText(gear),
      lastSentHex,
      pendingPacketHex: lastSentHex,
      pendingPacketExplain: formatPacketExplain(lastSentHex),
      lastSentPacketExplain: formatPacketExplain(lastSentHex),
    }

    if (!useCurrent) {
      nextState.controlMode = 'manual'
      nextState.manualGear = gear
      nextState.manualGearText = formatGearText(gear)
      nextState.controlModeSummary = '手动模式以你选定的档位为准，不随建议自动变更。'
    }

    this.setData(nextState)

    await this.sendPacket(packet, '已发送')
  },

  async onSendExamplePacket() {
    const packet = protocol.exampleCompactPacket()
    const lastSentHex = bufferToHex(packet)
    this.setData({
      lastSentHex,
      pendingPacketHex: lastSentHex,
      pendingPacketExplain: formatPacketExplain(lastSentHex),
      lastSentPacketExplain: formatPacketExplain(lastSentHex),
    })
    await this.sendPacket(packet, '真机示例包已发送')
  },

  async sendPacket(packet, successTitle) {
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

      wx.showToast({ title: successTitle || '已发送', icon: 'success' })
    } catch (error) {
      console.error('write failed', error)
      wx.showToast({ title: '发送失败', icon: 'none' })
    }
  },

  async discoverBleContractWithRetry(deviceId, options = {}) {
    const attempts = Number(options.attempts || 1)
    const delayMs = Number(options.delayMs || 0)
    let lastError = null

    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1 && delayMs > 0) {
        await sleep(delayMs)
      }

      try {
        this.logBleStage(`第 ${attempt} 次服务发现开始`)
        const contract = await this.discoverBleContract(deviceId)
        if (!contract.active.writeServiceId || !contract.active.writeCharacteristicId) {
          throw createBleStepError('discover', `第 ${attempt} 次服务发现未找到可写特征`)
        }
        if (attempt > 1) {
          contract.statusText = `${contract.statusText}（第 ${attempt} 次发现成功）`
        }
        this.logBleStage(`第 ${attempt} 次服务发现成功`)
        return contract
      } catch (error) {
        lastError = error
        console.warn(`discover contract failed at attempt ${attempt}`, getErrorSummary(error))
        this.logBleStage(`第 ${attempt} 次服务发现失败：${getErrorSummary(error)}`)
      }
    }

    throw lastError || createBleStepError('discover', '服务发现失败')
  },

  async discoverBleContract(deviceId) {
    const serviceResult = await promisify(wx.getBLEDeviceServices)({ deviceId })
    const rawServices = Array.isArray(serviceResult && serviceResult.services) ? serviceResult.services : []
    this.logBleStage(`发现 ${rawServices.length} 个 service`)
    if (!rawServices.length) {
      throw createBleStepError('discover', '未发现 BLE 服务')
    }
    const services = []

    for (let i = 0; i < rawServices.length; i++) {
      const service = rawServices[i]
      if (!service || !service.uuid) continue
      const serviceId = normalizeBleId(service.uuid)
      let rawCharacteristics = []

      try {
        const characteristicResult = await promisify(wx.getBLEDeviceCharacteristics)({
          deviceId,
          serviceId,
        })
        rawCharacteristics = Array.isArray(characteristicResult && characteristicResult.characteristics)
          ? characteristicResult.characteristics
          : []
        this.logBleStage(`Service ${shortBleId(serviceId)} 有 ${rawCharacteristics.length} 个 characteristic`)
      } catch (error) {
        console.warn(`get characteristics failed for ${serviceId}`, getErrorSummary(error))
        this.logBleStage(`读取 ${shortBleId(serviceId)} 特征失败：${getErrorSummary(error)}`)
      }

      services.push({
        serviceId,
        isPrimary: Boolean(service.isPrimary),
        characteristics: rawCharacteristics.filter((item) => item && item.uuid).map((item) => {
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
      lastReceivedPacketExplain: formatPacketExplain(hex),
      lastReceivedPacketText: parsed ? formatParsedPacket(parsed.fields) : '未按当前协议解析成功',
      deviceReportedGearText: parsed ? formatGearText(parsed.fields.front) : this.data.deviceReportedGearText,
      deviceReportedBatteryText: parsed ? `${parsed.fields.battery}%` : this.data.deviceReportedBatteryText,
      deviceReportedPowerText: parsed ? formatPowerText(parsed.fields.power) : this.data.deviceReportedPowerText,
    })
  },

  buildVestPacket(gear) {
    return protocol.buildPacket({
      command: 'send',
      lengthMode: this.data.bleLengthMode,
      productType: protocol.PRODUCT.VEST,
      power: protocol.POWER.ON,
      front: gear,
      collar: gear,
      back: gear,
      light: protocol.LIGHT.ON,
      envTempC: 0,
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
      bleServices: [],
      bleLastError: '',
    }, () => {
      this.refreshPacketPreview()
    })
  },
})

function promisify(api) {
  return (options = {}) =>
    new Promise((resolve, reject) => {
      const safeOptions = options && typeof options === 'object' ? options : {}
      safeOptions.success = resolve
      safeOptions.fail = reject
      api(safeOptions)
    })
}

function bufferToHex(buf) {
  const u8 = new Uint8Array(buf)
  return Array.from(u8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function upsertDevice(list, device) {
  const idx = list.findIndex((item) => item.deviceId === device.deviceId)
  if (idx === -1) {
    return list.concat(device)
  }
  const next = list.slice()
  const current = next[idx] && typeof next[idx] === 'object' ? next[idx] : {}
  const incoming = device && typeof device === 'object' ? device : {}
  next[idx] = mergePlainObjects(current, incoming)
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

    const notifyCharacteristic = findCharacteristic(
      service.characteristics,
      preferredNotifyCharacteristicId,
      hasNotifyProperty
    )
    const crossServiceNotifyCandidate =
      findNotifyAcrossServices(orderedServices, preferredNotifyCharacteristicId)
    const notifyCandidate = notifyCharacteristic
      ? {
          serviceId: service.serviceId,
          characteristic: notifyCharacteristic,
        }
      : crossServiceNotifyCandidate

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
  if (mode === protocol.LENGTH_MODE.COMPACT) return '紧凑双字节(12字节)'
  if (mode === protocol.LENGTH_MODE.DOUBLE_BYTE) return '完整双字节(15字节)'
  return '单字节长度(14字节)'
}

function formatPacketExplain(hex) {
  const text = String(hex || '').replace(/\s/g, '').toLowerCase()
  if (!text) return '暂无'

  const bytes = []
  for (let i = 0; i < text.length; i += 2) {
    bytes.push(parseInt(text.substr(i, 2), 16))
  }
  if (bytes.some((item) => Number.isNaN(item))) return 'HEX 格式无效'

  if (bytes.length === 12 && bytes[0] === 0xaa && bytes[11] === 0x0d) {
    const length = (bytes[1] << 8) | bytes[2]
    return [
      '紧凑帧 12 字节（真机当前使用）',
      `[0] AA 起始`,
      `[1-2] ${toHexByte(bytes[1])} ${toHexByte(bytes[2])} 总长度=${length}`,
      `[3] ${toHexByte(bytes[3])} 指令：${bytes[3] === 0x01 ? '发数据' : bytes[3] === 0x02 ? '同步' : '未知'}`,
      `[4] ${toHexByte(bytes[4])} 产品：${formatProductTypeText(bytes[4])}`,
      `[5] ${toHexByte(bytes[5])} 电源：${bytes[5] === 0 ? '开机' : '关机'}`,
      `[6] ${toHexByte(bytes[6])} 前腹：${formatGearText(bytes[6])}`,
      `[7] ${toHexByte(bytes[7])} 衣领：${formatGearText(bytes[7])}`,
      `[8] ${toHexByte(bytes[8])} 后背：${formatGearText(bytes[8])}`,
      `[9] ${toHexByte(bytes[9])} 熄灯：${bytes[9] === 0 ? '开' : '关'}`,
      `[10] ${toHexByte(bytes[10])} 环境温度：${formatSignedTemp(bytes[10])}`,
      `[11] 0D 结束`,
    ].join('\n')
  }

  const parsed = protocol.parsePacket(hexStringToArrayBuffer(text), {
    lengthMode: protocol.LENGTH_MODE.AUTO,
  })
  if (!parsed) return '未识别为已知协议帧'

  const fields = parsed.fields
  return [
    `文档帧 ${fields.declaredLength} 字节`,
    `指令：${COMMAND_TEXT[fields.cmd] || fields.cmd}`,
    `产品：${PRODUCT_TEXT[fields.productType] || fields.productType}`,
    `电源：${formatPowerText(fields.power)}`,
    `前腹：${formatGearText(fields.front)} | 衣领：${formatGearText(fields.collar)} | 后背：${formatGearText(fields.back)}`,
    `熄灯：${fields.light === protocol.LIGHT.ON ? '开' : '关'}`,
    `环境温度：${fields.envTempC}°C | 电池：${fields.battery}% | 定时：${fields.timerMinutes} 分钟`,
  ].join('\n')
}

function hexStringToArrayBuffer(hex) {
  const text = String(hex || '').replace(/\s/g, '')
  const out = new Uint8Array(text.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(text.substr(i * 2, 2), 16)
  }
  return out.buffer
}

function toHexByte(value) {
  return value.toString(16).padStart(2, '0').toUpperCase()
}

function formatProductTypeText(productType) {
  return PRODUCT_TEXT[productType] || `未知(${productType})`
}

function formatSignedTemp(value) {
  const temp = value > 127 ? value - 256 : value
  return `${temp}°C`
}

function normalizeConfiguredLengthMode(mode) {
  const text = String(mode || '').trim()
  if (text === protocol.LENGTH_MODE.COMPACT) return protocol.LENGTH_MODE.COMPACT
  if (text === protocol.LENGTH_MODE.DOUBLE_BYTE) return protocol.LENGTH_MODE.DOUBLE_BYTE
  if (text === protocol.LENGTH_MODE.SINGLE_BYTE) return protocol.LENGTH_MODE.SINGLE_BYTE
  return protocol.LENGTH_MODE.COMPACT
}

function formatPowerText(power) {
  return power === protocol.POWER.ON ? '开机' : '关机'
}

function createBleStepError(step, message, rawError) {
  const error = rawError instanceof Error ? rawError : new Error(message)
  error.bleStep = step
  if (message) {
    error.message = message
  }
  return error
}

function formatBleError(error) {
  const errCode = error && typeof error.errCode !== 'undefined'
    ? error.errCode
    : error && typeof error.code !== 'undefined'
      ? error.code
      : ''
  const errMsg = String(
    (error && (error.errMsg || error.message)) || '未知错误'
  ).trim()
  const step = error && error.bleStep ? error.bleStep : ''
  const stepText = step === 'discover'
    ? '服务发现阶段'
    : step === 'notify'
      ? '通知订阅阶段'
      : step === 'write'
        ? '写入阶段'
        : step === 'connect'
          ? '建立连接阶段'
          : '连接阶段'
  const summary = errCode !== '' ? `${stepText}，错误码 ${errCode}` : `${stepText}，${errMsg}`
  const fullText = errCode !== '' ? `${summary}，${errMsg}` : summary
  const hint = buildBleErrorHint(errCode, step)
  const toastText = errCode !== '' ? `连接失败(${errCode})` : '连接失败'

  return {
    summary,
    fullText,
    hint,
    toastText,
  }
}

function buildBleErrorHint(errCode, step) {
  if (String(errCode) === '10004') {
    return '已连上设备但未发现服务，常见于连接后发现过快或固件未正确暴露 service。'
  }
  if (String(errCode) === '10005') {
    return '已发现 service，但特征读取失败，请核对 characteristic UUID 和设备权限。'
  }
  if (String(errCode) === '10006') {
    return '当前连接已断开，检查设备是否被其他 APP 占用、是否自动休眠或距离过远。'
  }
  if (String(errCode) === '10012') {
    return '连接超时，建议重启设备蓝牙并重试，必要时缩短连接距离。'
  }
  if (String(errCode) === '10013') {
    return '连接参数无效，通常是 deviceId 已过期或 service/characteristic UUID 不匹配。'
  }
  if (step === 'discover') {
    return '连接已建立，但服务发现未成功；可以重点检查设备真实 UUID，或增加连接后等待时间。'
  }
  return '请结合 BLE 状态、已发现服务与特征、以及设备是否被其他 APP 占用一起排查。'
}

function getErrorSummary(error) {
  if (!error) return 'unknown error'
  if (typeof error === 'string') return error
  const errCode = typeof error.errCode !== 'undefined'
    ? error.errCode
    : typeof error.code !== 'undefined'
      ? error.code
      : ''
  const errMsg = (error.errMsg || error.message || 'unknown error')
  return errCode !== '' ? `${errMsg} (${errCode})` : String(errMsg)
}

function formatDebugTime() {
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function shortBleId(id) {
  const text = String(id || '').toUpperCase()
  return text.length > 8 ? text.slice(0, 8) : text
}

function detectBlePlatform() {
  try {
    const info = wx.getSystemInfoSync ? wx.getSystemInfoSync() : {}
    const platform = String((info && info.platform) || '').toLowerCase()
    if (platform === 'ios' || platform === 'android') {
      return platform
    }
  } catch (error) {
    console.warn('detect platform failed', getErrorSummary(error))
  }
  return ''
}

function mergePlainObjects(base, patch) {
  const target = {}
  const baseKeys = Object.keys(base || {})
  const patchKeys = Object.keys(patch || {})

  for (let i = 0; i < baseKeys.length; i++) {
    const key = baseKeys[i]
    target[key] = base[key]
  }
  for (let i = 0; i < patchKeys.length; i++) {
    const key = patchKeys[i]
    target[key] = patch[key]
  }
  return target
}
