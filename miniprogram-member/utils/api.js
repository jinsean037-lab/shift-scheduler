const app = getApp()
let warmupPromise = null

function baseUrl() {
  return (app.globalData && app.globalData.apiBase) || 'https://shift-scheduler-9316.onrender.com/api'
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function rawRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: baseUrl() + path,
      method: options.method || 'GET',
      data: options.data || {},
      header: Object.assign({ 'Content-Type': 'application/json' }, options.header || {}),
      timeout: options.timeout || 20000,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data || {})
        else {
          const err = new Error((res.data && (res.data.msg || res.data.error)) || '请求失败')
          err.statusCode = res.statusCode
          reject(err)
        }
      },
      fail(err) {
        const e = new Error(err.errMsg || '网络错误')
        e.isNetworkError = true
        reject(e)
      }
    })
  })
}

function isWakeupError(err) {
  const msg = (err && err.message) || ''
  return err && (err.isNetworkError || /timeout|超时|fail|ERR_NAME_NOT_RESOLVED|socket|TLS/i.test(msg))
}

async function warmupService(options = {}) {
  const retries = options.retries || 4
  const showTip = options.showTip !== false
  let lastError = null

  for (let i = 0; i < retries; i += 1) {
    try {
      await rawRequest('/config', { timeout: i === 0 ? 12000 : 20000 })
      return true
    } catch (err) {
      lastError = err
      if (!isWakeupError(err)) throw err
      if (showTip && i === 0) {
        wx.showLoading({ title: '服务唤醒中', mask: true })
      }
      await delay(1800 + i * 1200)
    }
  }

  throw new Error((lastError && lastError.message) || '服务暂时无法连接，请稍后重试')
}

async function ensureServiceReady(options = {}) {
  if (!warmupPromise) {
    warmupPromise = warmupService(options).finally(() => {
      warmupPromise = null
      try { wx.hideLoading() } catch (_) {}
    })
  }
  return warmupPromise
}

async function request(path, options = {}) {
  if (!options.skipWarmup) {
    await ensureServiceReady({ showTip: options.showWakeupTip !== false })
  }

  try {
    return await rawRequest(path, options)
  } catch (err) {
    if (!options.noRetry && isWakeupError(err)) {
      await ensureServiceReady({ showTip: true, retries: 3 })
      return rawRequest(path, Object.assign({}, options, { noRetry: true }))
    }
    throw err
  }
}

function currentUser() {
  return wx.getStorageSync('memberUser') || null
}

function requireUser() {
  const user = currentUser()
  if (!user || !user.name) {
    wx.reLaunch({ url: '/pages/login/login' })
    return null
  }
  return user
}

function toast(title, icon = 'none') {
  wx.showToast({ title, icon, duration: 1800 })
}

function slotLabel(slotId) {
  const map = {
    am1: '8:00-10:00',
    am2: '10:00-12:00',
    pm1: '14:30-16:00',
    pm2: '16:00-17:30'
  }
  return map[slotId] || slotId || ''
}

function statusLabel(status) {
  const map = {
    pending: '待处理',
    approved: '已同意',
    rejected: '已拒绝',
    revoked: '已撤回'
  }
  return map[status] || status || ''
}

function getLocation() {
  return new Promise((resolve, reject) => {
    wx.getLocation({
      type: 'gcj02',
      success: resolve,
      fail: () => reject(new Error('请允许定位后再打卡'))
    })
  })
}

module.exports = {
  request,
  warmupService,
  ensureServiceReady,
  currentUser,
  requireUser,
  toast,
  slotLabel,
  statusLabel,
  getLocation
}
