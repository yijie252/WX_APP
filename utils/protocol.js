/**
 * 暖绒设备 ↔ 小程序 BLE 应用层协议
 *
 * 真机实测帧（12 字节，优先使用）：
 *   AA 00 0C 01 01 00 03 03 00 00 00 0D
 *   - 双字节长度 0x000C（含头尾）
 *   - 载荷 8 字节：指令/产品/电源/前腹/衣领/后背/熄灯/环境温度
 *   - 不含电池、定时字段
 *
 * 文档示例帧（14 字节，legacy）：
 *   AA 0E 01 01 01 01 03 02 00 28 04 01 E0 0D
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
  COMPACT: 'compact',
  SINGLE_BYTE: 'single_byte',
  DOUBLE_BYTE: 'double_byte',
}

const START = 0xaa
const END = 0x0d
const FULL_PAYLOAD_LEN = 11
const COMPACT_PAYLOAD_LEN = 8
const COMPACT_FRAME_LEN = 12

/**
 * @param {object} p
 * @param {CommandKind} [p.command='send']
 * @param {string} [p.lengthMode='compact']
 * @param {number} p.productType
 * @param {number} p.power
 * @param {number} p.front
 * @param {number} p.collar
 * @param {number} p.back
 * @param {number} p.light
 * @param {number} p.envTempC
 * @param {number} [p.battery=0]
 * @param {number} [p.timerMinutes=0]
 * @returns {ArrayBuffer}
 */
function buildPacket(p) {
  const lengthMode = normalizeBuildLengthMode(p.lengthMode)
  if (lengthMode === LENGTH_MODE.COMPACT) {
    return buildCompactPacket(p)
  }
  return buildFullPacket(p, lengthMode)
}

function buildCompactPacket(p) {
  const cmd = p.command === 'sync' ? CMD.SYNC_DEVICE : CMD.SEND_DATA
  const payload = new Uint8Array(COMPACT_PAYLOAD_LEN)
  payload[0] = u8(cmd)
  payload[1] = u8(p.productType)
  payload[2] = u8(p.power)
  payload[3] = u8(p.front)
  payload[4] = u8(p.collar)
  payload[5] = u8(p.back)
  payload[6] = u8(p.light)
  payload[7] = toUnsignedByte(clampSignedInt8(p.envTempC))

  const out = new Uint8Array(COMPACT_FRAME_LEN)
  out[0] = START
  out[1] = (COMPACT_FRAME_LEN >> 8) & 0xff
  out[2] = COMPACT_FRAME_LEN & 0xff
  out.set(payload, 3)
  out[COMPACT_FRAME_LEN - 1] = END
  return out.buffer
}

function buildFullPacket(p, lengthMode) {
  const cmd = p.command === 'sync' ? CMD.SYNC_DEVICE : CMD.SEND_DATA
  const timerMinutes = Math.max(0, Math.min(0xffff, Math.floor(Number(p.timerMinutes) || 0)))

  const payload = new Uint8Array(FULL_PAYLOAD_LEN)
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
  const totalLen = 1 + lengthFieldBytes + FULL_PAYLOAD_LEN + 1
  const out = new Uint8Array(totalLen)
  out[0] = START
  if (lengthMode === LENGTH_MODE.DOUBLE_BYTE) {
    out[1] = (totalLen >> 8) & 0xff
    out[2] = totalLen & 0xff
  } else {
    out[1] = totalLen
  }
  out.set(payload, payloadOffset)
  out[payloadOffset + FULL_PAYLOAD_LEN] = END

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
    lengthMode: LENGTH_MODE.SINGLE_BYTE,
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

function exampleCompactPacket() {
  return buildPacket({
    command: 'send',
    lengthMode: LENGTH_MODE.COMPACT,
    productType: PRODUCT.VEST,
    power: POWER.ON,
    front: GEAR.HIGH,
    collar: GEAR.HIGH,
    back: GEAR.OFF,
    light: LIGHT.ON,
    envTempC: 0,
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

function assertCompactExampleMatches() {
  const hex = 'aa000c01010003030000000d'
  const expected = hexToBytes(hex)
  const actual = new Uint8Array(exampleCompactPacket())
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
  if (mode === LENGTH_MODE.COMPACT) return LENGTH_MODE.COMPACT
  if (mode === LENGTH_MODE.DOUBLE_BYTE) return LENGTH_MODE.DOUBLE_BYTE
  if (mode === LENGTH_MODE.SINGLE_BYTE) return LENGTH_MODE.SINGLE_BYTE
  return LENGTH_MODE.COMPACT
}

function resolveParseModes(mode) {
  if (mode === LENGTH_MODE.COMPACT) return [LENGTH_MODE.COMPACT]
  if (mode === LENGTH_MODE.SINGLE_BYTE) return [LENGTH_MODE.SINGLE_BYTE]
  if (mode === LENGTH_MODE.DOUBLE_BYTE) return [LENGTH_MODE.DOUBLE_BYTE]
  return [LENGTH_MODE.COMPACT, LENGTH_MODE.SINGLE_BYTE, LENGTH_MODE.DOUBLE_BYTE]
}

function parseWithLengthMode(raw, lengthMode) {
  if (lengthMode === LENGTH_MODE.COMPACT) {
    return parseCompactPacket(raw)
  }
  return parseFullPacket(raw, lengthMode)
}

function parseCompactPacket(raw) {
  if (raw.length !== COMPACT_FRAME_LEN) return null
  if (raw[0] !== START || raw[raw.length - 1] !== END) return null

  const declaredLength = (raw[1] << 8) | raw[2]
  if (declaredLength !== COMPACT_FRAME_LEN) return null

  const payloadOffset = 3
  const t = raw[payloadOffset + 7]
  const envTempC = t > 127 ? t - 256 : t

  return {
    cmd: raw[payloadOffset],
    productType: raw[payloadOffset + 1],
    power: raw[payloadOffset + 2],
    front: raw[payloadOffset + 3],
    collar: raw[payloadOffset + 4],
    back: raw[payloadOffset + 5],
    light: raw[payloadOffset + 6],
    envTempC,
    battery: 0,
    timerMinutes: 0,
    declaredLength,
    lengthMode: LENGTH_MODE.COMPACT,
  }
}

function parseFullPacket(raw, lengthMode) {
  const lengthFieldBytes = lengthMode === LENGTH_MODE.DOUBLE_BYTE ? 2 : 1
  const payloadOffset = 1 + lengthFieldBytes
  const minimumLength = 1 + lengthFieldBytes + FULL_PAYLOAD_LEN + 1

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
  exampleCompactPacket,
  assertExampleMatches,
  assertCompactExampleMatches,
}
