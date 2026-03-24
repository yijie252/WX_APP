function buildAdaptiveSuggestion(input) {
  const outdoorTemp = normalizeNumber(input.outdoorTemp, 10)
  const stepCount = normalizeNumber(input.stepCount, 0)
  const feelsLike = normalizeNumber(input.feelsLike, outdoorTemp)

  const tempBand = resolveTempBand(feelsLike)
  const activityBand = resolveActivityBand(stepCount)
  const gear = resolveGear(tempBand.key, activityBand.key)
  const gearText = formatGear(gear)

  const reasons = [
    `体感温度 ${formatTemp(feelsLike)}，归类为${tempBand.label}`,
    `当日步数 ${stepCount}，归类为${activityBand.label}`,
    `规则命中：${tempBand.label} + ${activityBand.label} -> ${gearText}`,
  ]

  return {
    gear,
    gearText,
    tempBand: tempBand.label,
    activityBand: activityBand.label,
    reasons,
    summary: `根据体感温度和活动量，当前建议使用${gearText}。`,
  }
}

function resolveTempBand(feelsLike) {
  if (feelsLike <= 0) {
    return { key: 'very_cold', label: '严寒' }
  }
  if (feelsLike <= 8) {
    return { key: 'cold', label: '偏冷' }
  }
  if (feelsLike <= 15) {
    return { key: 'cool', label: '凉爽' }
  }
  return { key: 'mild', label: '温和' }
}

function resolveActivityBand(stepCount) {
  if (stepCount < 3000) {
    return { key: 'low', label: '低活动' }
  }
  if (stepCount < 8000) {
    return { key: 'medium', label: '中活动' }
  }
  return { key: 'high', label: '高活动' }
}

function resolveGear(tempKey, activityKey) {
  const ruleMap = {
    very_cold: {
      low: 3,
      medium: 3,
      high: 2,
    },
    cold: {
      low: 2,
      medium: 2,
      high: 1,
    },
    cool: {
      low: 1,
      medium: 1,
      high: 0,
    },
    mild: {
      low: 0,
      medium: 0,
      high: 0,
    },
  }

  const tempRules = ruleMap[tempKey] || ruleMap.cool
  return tempRules[activityKey] ?? 0
}

function formatGear(gear) {
  if (gear === 3) return '高档'
  if (gear === 2) return '中档'
  if (gear === 1) return '低档'
  return '关闭'
}

function normalizeNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function formatTemp(value) {
  return `${normalizeNumber(value, 0)}°C`
}

module.exports = {
  buildAdaptiveSuggestion,
}
