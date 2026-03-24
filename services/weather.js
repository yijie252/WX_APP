const WEATHER_ENDPOINT =
  'https://api.open-meteo.com/v1/forecast?current=temperature_2m,apparent_temperature,weather_code&timezone=auto'

function fetchCurrentWeather(latitude, longitude) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${WEATHER_ENDPOINT}&latitude=${latitude}&longitude=${longitude}`,
      method: 'GET',
      success: (res) => {
        const current = res.data && res.data.current
        if (!current) {
          reject(new Error('weather response missing current'))
          return
        }

        resolve({
          temperature: Number(current.temperature_2m),
          feelsLike: Number(current.apparent_temperature),
          weatherCode: Number(current.weather_code),
          weatherText: mapWeatherCode(Number(current.weather_code)),
          observationTime: current.time || '',
        })
      },
      fail: reject,
    })
  })
}

function buildMockWeather() {
  return {
    temperature: 8,
    feelsLike: 4,
    weatherCode: 3,
    weatherText: mapWeatherCode(3),
    observationTime: '',
  }
}

function mapWeatherCode(code) {
  if (code === 0) return '晴'
  if (code === 1) return '大部晴'
  if (code === 2) return '多云'
  if (code === 3) return '阴'
  if (code === 45 || code === 48) return '雾'
  if ([51, 53, 55, 56, 57].includes(code)) return '毛毛雨'
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return '雨'
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '雪'
  if ([95, 96, 99].includes(code)) return '雷暴'
  return '未知'
}

module.exports = {
  fetchCurrentWeather,
  buildMockWeather,
  mapWeatherCode,
}
