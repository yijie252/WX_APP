/**
 * 暖绒设备 ↔ 小程序 BLE 应用层协议
 * （依据《设备和APP蓝牙通讯协议》与示例 AA0E01010101030200280401E00D）
 *
 * 长度字段：
 * - 文档写「两个字节」，但示例为单字节 0x0E。
 * - 默认按示例构包；若真机固件明确要求双字节长度，可切换到 double_byte。
 *
 * 单字节长度模式帧布局（总长 14）：
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

const LENGTH_MODE = {
  AUTO: 'auto',
  SINGLE_BYTE: 'single_byte',
  DOUBLE_BYTE: 'double_byte',
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
  const lengthMode = normalizeBuildLengthMode(p.lengthMode)
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

  const lengthFieldBytes = lengthMode === LENGTH_MODE.DOUBLE_BYTE ? 2 : 1
  const payloadOffset = 1 + lengthFieldBytes
  const totalLen = 1 + lengthFieldBytes + PAYLOAD_LEN + 1
  const out = new Uint8Array(totalLen)
  out[0] = START
  if (lengthMode === LENGTH_MODE.DOUBLE_BYTE) {
    out[1] = (totalLen >> 8) & 0xff
    out[2] = totalLen & 0xff
  } else {
    out[1] = totalLen
  }
  out.set(payload, payloadOffset)
  out[payloadOffset + PAYLOAD_LEN] = END

  return out.buffer
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {{ raw: Uint8Array, fields: object } | null}
 */
function parsePacket(buffer, options = {}) {
  const raw = new Uint8Array(buffer)
  const modes = resolveParseModes(options.lengthMode)
  for (let i = 0; i < modes.length; i++) {
    const parsed = parseWithLengthMode(raw, modes[i])
    if (parsed) {
      return {
        raw,
        fields: parsed,
      }
    }
  }
  return null
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

function normalizeBuildLengthMode(mode) {
  return mode === LENGTH_MODE.DOUBLE_BYTE ? LENGTH_MODE.DOUBLE_BYTE : LENGTH_MODE.SINGLE_BYTE
}

function resolveParseModes(mode) {
  if (mode === LENGTH_MODE.SINGLE_BYTE || mode === LENGTH_MODE.DOUBLE_BYTE) {
    return [mode]
  }
  return [LENGTH_MODE.SINGLE_BYTE, LENGTH_MODE.DOUBLE_BYTE]
}

function parseWithLengthMode(raw, lengthMode) {
  const lengthFieldBytes = lengthMode === LENGTH_MODE.DOUBLE_BYTE ? 2 : 1
  const payloadOffset = 1 + lengthFieldBytes
  const minimumLength = 1 + lengthFieldBytes + PAYLOAD_LEN + 1

  if (raw.length < minimumLength) return null
  if (raw[0] !== START || raw[raw.length - 1] !== END) return null

  const declaredLength =
    lengthMode === LENGTH_MODE.DOUBLE_BYTE ? ((raw[1] << 8) | raw[2]) : raw[1]

  if (declaredLength !== raw.length) return null

  const t = raw[payloadOffset + 7]
  const envTempC = t > 127 ? t - 256 : t
  const timerMinutes = (raw[payloadOffset + 9] << 8) | raw[payloadOffset + 10]

  return {
    cmd: raw[payloadOffset],
    productType: raw[payloadOffset + 1],
    power: raw[payloadOffset + 2],
    front: raw[payloadOffset + 3],
    collar: raw[payloadOffset + 4],
    back: raw[payloadOffset + 5],
    light: raw[payloadOffset + 6],
    envTempC,
    battery: raw[payloadOffset + 8],
    timerMinutes,
    declaredLength,
    lengthMode,
  }
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
  LENGTH_MODE,
  buildPacket,
  parsePacket,
  exampleQueryPacket,
  assertExampleMatches,
}
