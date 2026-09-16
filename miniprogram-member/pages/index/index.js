const { request, requireUser, toast, slotLabel, getLocation } = require('../../utils/api')

Page({
  data: {
    userName: '',
    todayText: '',
    todayShifts: [],
    checkingIn: false,
    checkingOut: false
  },
  onShow() {
    const user = requireUser()
    if (!user) return
    this.setData({
      userName: user.name,
      todayText: new Date().toLocaleDateString()
    })
    this.loadToday()
  },
  onPullDownRefresh() {
    this.loadToday().finally(() => wx.stopPullDownRefresh())
  },
  async loadToday() {
    const user = requireUser()
    if (!user) return
    try {
      const data = await request('/member/today-status?name=' + encodeURIComponent(user.name))
      const todayShifts = (data.shifts || []).map(s => ({
          key: (s.date || s.day) + '_' + (s.slotId || s.slot),
          day: s.day,
          date: s.date || '',
          slot: s.slotId || s.slot,
          slotLabel: s.slotLabel || slotLabel(s.slotId || s.slot),
          status: s.status || 'pending',
          statusText: s.statusText || '未签到'
        }))
      this.setData({
        todayText: (data.date || '') + ' ' + (data.weekday || ''),
        todayShifts
      })
    } catch (e) {
      toast(e.message || '加载失败')
    }
  },
  async checkin() {
    const user = requireUser()
    if (!user) return
    this.setData({ checkingIn: true })
    try {
      const loc = await getLocation()
      const data = await request('/checkin', {
        method: 'POST',
        data: { name: user.name, lat: loc.latitude, lng: loc.longitude }
      })
      toast(data.msg || (data.ok ? '签到成功' : '签到失败'), data.ok ? 'success' : 'none')
      this.loadToday()
    } catch (e) {
      toast(e.message || '签到失败')
    } finally {
      this.setData({ checkingIn: false })
    }
  },
  async checkout() {
    const user = requireUser()
    if (!user) return
    this.setData({ checkingOut: true })
    try {
      const loc = await getLocation()
      const data = await request('/checkout', {
        method: 'POST',
        data: { name: user.name, lat: loc.latitude, lng: loc.longitude }
      })
      if (data.ok && data.autoOvertime) {
        wx.showModal({
          title: '已自动申请补报',
          content: data.msg || '超出标准班次的工时已按加班自动提交补报申请',
          showCancel: false
        })
      } else {
        toast(data.msg || (data.ok ? '签退成功' : '签退失败'), data.ok ? 'success' : 'none')
      }
      this.loadToday()
    } catch (e) {
      toast(e.message || '签退失败')
    } finally {
      this.setData({ checkingOut: false })
    }
  }
})
