const { request, requireUser, toast, slotLabel } = require('../../utils/api')

Page({
  data: {
    shifts: []
  },
  onShow() {
    this.loadShifts()
  },
  onPullDownRefresh() {
    this.loadShifts().finally(() => wx.stopPullDownRefresh())
  },
  async loadShifts() {
    const user = requireUser()
    if (!user) return
    try {
      const data = await request('/my-shifts?name=' + encodeURIComponent(user.name))
      const shifts = (data.shifts || []).map(s => ({
        key: (s.date || s.day) + '_' + (s.slotId || s.slot),
        date: s.date || '',
        day: s.day || '',
        slotId: s.slotId || s.slot,
        slotLabel: s.slotLabel || slotLabel(s.slotId || s.slot)
      }))
      this.setData({ shifts })
    } catch (e) {
      toast(e.message || '加载失败')
    }
  }
})
