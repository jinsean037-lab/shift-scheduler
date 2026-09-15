const app = getApp()

function baseUrl() {
  return (app.globalData && app.globalData.apiBase) || 'https://shift-scheduler-9316.onrender.com/api'
}

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: baseUrl() + path,
      method: options.method || 'GET',
      data: options.data || {},
      header: Object.assign({ 'Content-Type': 'application/json' }, options.header || {}),
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data || {})
        else reject(new Error((res.data && (res.data.msg || res.data.error)) || '请求失败'))
      },
      fail(err) {
        reject(new Error(err.errMsg || '网络错误'))
      }
    })
  })
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
  currentUser,
  requireUser,
  toast,
  slotLabel,
  statusLabel,
  getLocation
}
