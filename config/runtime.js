module.exports = {
  // 微信运动解密优先使用云函数，避免真机依赖本机局域网服务。
  werunProvider: 'cloud',
  werunCloudFunctionName: 'decryptWeRun',

  // 可选：指定云开发环境 ID。
  // 留空时使用当前微信开发者工具选择的云环境。
  cloudEnvId: '',

  // 仍保留 HTTP 配置作为备用方案；当 werunProvider 为 'http' 时启用。
  werunDecryptUrl: '',

  // 可选：HTTP 健康检查地址。留空时会根据 werunDecryptUrl 自动推导 /health。
  werunHealthUrl: '',

  // BLE 首选参数。若真机发现与固件不一致，优先以设备实际广播/服务为准。
  ble: {
    namePrefix: '',
    preferredServiceId: '0000FF00-0000-1000-8000-00805F9B34FB',
    preferredNotifyCharacteristicId: '0000FF01-0000-1000-8000-00805F9B34FB',
    preferredWriteCharacteristicId: '0000FF02-0000-1000-8000-00805F9B34FB',
    lengthMode: 'single_byte',
  },
}
