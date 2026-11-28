const { request, requireUser, toast, slotLabel } = require('../../utils/api')

// v7.7 忙碌程度五档（与打卡页一致）
const BUSY_EMOJI = { 1: '😌', 2: '😊', 3: '😐', 4: '😫', 5: '🤯' }

function avgEmojiOf(v) {
  if (v === undefined || v === null || v === '') return ''
  const n = Math.round(Number(v))
  return BUSY_EMOJI[n] || ''
}

Page({
  data: {
    shifts: [],
    weekDays: [],
    weekRange: ''
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
      const name = encodeURIComponent(user.name)
      const [data, week] = await Promise.all([
        request('/my-shifts?name=' + name),
        request('/member/week-schedule?name=' + name)
      ])
      const shifts = (data.shifts || []).map(s => ({
        key: (s.date || s.day) + '_' + (s.slotId || s.slot),
        date: s.date || '',
        day: s.day || '',
        slotId: s.slotId || s.slot,
        slotLabel: s.slotLabel || slotLabel(s.slotId || s.slot)
      }))
      const weekDays = (week.days || []).map(day => ({
        date: day.date,
        shortDate: day.shortDate || (day.date || '').slice(5).replace('-', '/'),
        weekday: day.weekday,
        isToday: !!day.isToday,
        slots: (day.slots || []).map(slot => ({
          key: `${day.date}_${slot.slotId}`,
          slotId: slot.slotId,
          slotLabel: slot.label || slotLabel(slot.slotId),
          membersText: (slot.members || []).join('、') || '—',
          avgRating: (slot.avgRating === undefined ? null : slot.avgRating),
          avgEmoji: avgEmojiOf(slot.avgRating)
        }))
      }))
      const weekRange = week.weekStart && week.weekEnd
        ? `${week.weekStart.slice(5).replace('-', '/')} - ${week.weekEnd.slice(5).replace('-', '/')}`
        : ''
      this.setData({ shifts, weekDays, weekRange })
    } catch (e) {
      toast(e.message || '加载失败')
    }
  }
})
