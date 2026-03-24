/**
 * 暖绒设备 ↔ 小程序 BLE 应用层协议
 * （依据《设备和APP蓝牙通讯协议》与示例 AA0E01010101030200280401E00D）
 *
 * 长度字段（第 2 字节，紧跟 0xAA）：
 * - 文档写「两个字节」，示例为单字节 0x0E。
 * - 按示例：整帧总长 14 字节，第二字节 0x0E = 14 = 从首字节 AA 到末字节 0x0D 的全帧字节数。
 *
 * 帧布局（总长 14）：
 * [0] 0xAA
 * [1] 总长度（本帧全部字节数）
 * [2] 指令 0x01 发数据 / 0x02 同步
 * [3] 产品类型
 * [4] 开关机 0开 1关
 * [5] 前腹档位（袜子左脚，文档补充）
 * [6] 衣领档位（袜子右脚）
 * [7] 后背档位
 * [8] 熄灯 0开 1关
 * [9] 环境温度 有符号
 * [10] 电池
 * [11..12] 定时分钟 大端 uint16
 * [13] 0x0D
 */

/** @typedef {'send'|'sync'} CommandKind */

const CMD = {
  SEND_DATA: 0x01,
  SYNC_DEVICE: 0x02,
}

const PRODUCT = {
  VEST: 1,
  JACKET: 2,
  PANTS: 3,
  SOCK_L: 4,
  SOCK_R: 5,
  SHOE_L: 6,
  SHOE_R: 7,
  GLOVE_L: 8,
  GLOVE_R: 9,
}

const GEAR = {
  OFF: 0,
  LOW: 1,
  MID: 2,
  HIGH: 3,
}

const POWER = {
  ON: 0,
  OFF: 1,
}

const LIGHT = {
  ON: 0,
  OFF: 1,
}

const START = 0xaa
const END = 0x0d
const PAYLOAD_LEN = 11

/**
 * @param {object} p
 * @param {CommandKind} [p.command='send']
 * @param {number} p.productType
 * @param {number} p.power
 * @param {number} p.front
 * @param {number} p.collar
 * @param {number} p.back
 * @param {number} p.light
 * @param {number} p.envTempC
 * @param {number} p.battery
 * @param {number} [p.timerMinutes=0]
 * @returns {ArrayBuffer}
 */
function buildPacket(p) {
  const cmd = p.command === 'sync' ? CMD.SYNC_DEVICE : CMD.SEND_DATA
  const timerMinutes = Math.max(0, Math.min(0xffff, Math.floor(Number(p.timerMinutes) || 0)))

  const payload = new Uint8Array(PAYLOAD_LEN)
  payload[0] = u8(cmd)
  payload[1] = u8(p.productType)
  payload[2] = u8(p.power)
  payload[3] = u8(p.front)
  payload[4] = u8(p.collar)
  payload[5] = u8(p.back)
  payload[6] = u8(p.light)
  payload[7] = toUnsignedByte(clampSignedInt8(p.envTempC))
  payload[8] = u8(p.battery)
  payload[9] = (timerMinutes >> 8) & 0xff
  payload[10] = timerMinutes & 0xff

  const totalLen = 1 + 1 + PAYLOAD_LEN + 1
  const out = new Uint8Array(totalLen)
  out[0] = START
  out[1] = totalLen
  out.set(payload, 2)
  out[2 + PAYLOAD_LEN] = END

  return out.buffer
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {{ raw: Uint8Array, fields: object } | null}
 */
function parsePacket(buffer) {
  const raw = new Uint8Array(buffer)
  if (raw.length < 14) return null
  if (raw[0] !== START || raw[raw.length - 1] !== END) return null
  if (raw[1] !== raw.length) return null

  const t = raw[9]
  const envTempC = t > 127 ? t - 256 : t
  const timerMinutes = (raw[11] << 8) | raw[12]

  return {
    raw,
    fields: {
      cmd: raw[2],
      productType: raw[3],
      power: raw[4],
      front: raw[5],
      collar: raw[6],
      back: raw[7],
      light: raw[8],
      envTempC,
      battery: raw[10],
      timerMinutes,
    },
  }
}

function exampleQueryPacket() {
  return buildPacket({
    command: 'send',
    productType: PRODUCT.VEST,
    power: POWER.OFF,
    front: GEAR.LOW,
    collar: GEAR.HIGH,
    back: GEAR.MID,
    light: LIGHT.ON,
    envTempC: 0x28,
    battery: 4,
    timerMinutes: 480,
  })
}

function assertExampleMatches() {
  const hex = 'aa0e01010101030200280401e00d'
  const expected = hexToBytes(hex)
  const actual = new Uint8Array(exampleQueryPacket())
  if (expected.length !== actual.length) return { ok: false, reason: 'length' }
  for (let i = 0; i < expected.length; i++) {
    if (expected[i] !== actual[i]) return { ok: false, reason: `byte ${i}`, expected, actual }
  }
  return { ok: true }
}

function u8(n) {
  return Math.max(0, Math.min(255, Math.floor(Number(n) || 0)))
}

function clampSignedInt8(n) {
  let v = Math.round(Number(n) || 0)
  if (v < -128) v = -128
  if (v > 127) v = 127
  return v
}

function toUnsignedByte(signed) {
  return signed < 0 ? 256 + signed : signed
}

function hexToBytes(hex) {
  const a = hex.replace(/\s/g, '')
  const out = new Uint8Array(a.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(a.substr(i * 2, 2), 16)
  return out
}

module.exports = {
  CMD,
  PRODUCT,
  GEAR,
  POWER,
  LIGHT,
  buildPacket,
  parsePacket,
  exampleQueryPacket,
  assertExampleMatches,
}
