module.exports = {
  // 小程序 request 合法域名对应的微信运动解密接口。
  // 当前先指向本机可访问地址；真机需保证手机能访问这台电脑的 8787 端口。
  // 若后续改成正式 HTTPS 域名，请直接替换这里。
  werunDecryptUrl: 'http://100.86.214.143:8787/api/werun/decrypt',

  // 可选：微信运动服务健康检查地址。
  // 留空时会根据 werunDecryptUrl 自动推导 /health。
  werunHealthUrl: 'http://100.86.214.143:8787/health',

  // BLE 首选参数。若真机发现与固件不一致，优先以设备实际广播/服务为准。
  ble: {
    namePrefix: '',
    preferredServiceId: '0000FF00-0000-1000-8000-00805F9B34FB',
    preferredNotifyCharacteristicId: '0000FF01-0000-1000-8000-00805F9B34FB',
    preferredWriteCharacteristicId: '0000FF02-0000-1000-8000-00805F9B34FB',
    lengthMode: 'single_byte',
  },
}
