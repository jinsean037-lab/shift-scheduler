const { request, requireUser, toast, slotLabel } = require('../../utils/api')

// v7.7 忙碌程度五档（与打卡页一致）
const BUSY_EMOJI = { 1: '😌', 2: '😊', 3: '😐', 4: '😫', 5: '🤯' }
const BUSY_CLASS = { 1: 'busy-1', 2: 'busy-2', 3: 'busy-3', 4: 'busy-4', 5: 'busy-5' }

function avgEmojiOf(v) {
  if (v === undefined || v === null || v === '') return ''
  const n = Math.round(Number(v))
  return BUSY_EMOJI[n] || ''
}

function pigImgOf(v) {
  if (v === undefined || v === null || v === '') return ''
  const n = Math.min(5, Math.max(1, Math.round(Number(v))))
  return '/assets/pig/busy-' + n + '.png'
}

function busyClassOf(v) {
  if (v === undefined || v === null || v === '') return 'busy-none'
  const n = Math.round(Number(v))
  return BUSY_CLASS[n] || 'busy-none'
}

Page({
  data: {
    shifts: [],
    weekDays: [],
    weekRange: '',
    stats: {
      totalSlots: 0,
      myCount: 0,
      avgAll: '',
      avgEmoji: '',
      busyClass: 'busy-none'
    }
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
          key: day.date + '_' + slot.slotId,
          slotId: slot.slotId,
          slotLabel: slot.label || slotLabel(slot.slotId),
          membersText: (slot.members || []).join('、') || '—',
          avgRating: (slot.avgRating === undefined ? null : slot.avgRating),
          avgEmoji: avgEmojiOf(slot.avgRating),
          pigImg: pigImgOf(slot.avgRating),
          busyClass: busyClassOf(slot.avgRating)
        }))
      }))
      // 概览统计：全部班次数 / 我的班次数 / 全周平均忙碌度
      let totalSlots = 0
      let ratedSum = 0
      let ratedCount = 0
      weekDays.forEach(d => {
        (d.slots || []).forEach(s => {
          totalSlots += 1
          if (s.avgRating) {
            ratedSum += Number(s.avgRating)
            ratedCount += 1
          }
        })
      })
      const avgAll = ratedCount ? Math.round((ratedSum / ratedCount) * 10) / 10 : ''
      const weekRange = week.weekStart && week.weekEnd
        ? week.weekStart.slice(5).replace('-', '/') + ' - ' + week.weekEnd.slice(5).replace('-', '/')
        : ''
      this.setData({
        shifts,
        weekDays,
        weekRange,
        stats: {
          totalSlots: totalSlots,
          myCount: shifts.length,
          avgAll: avgAll,
          avgEmoji: avgEmojiOf(avgAll),
          pigImg: pigImgOf(avgAll),
          busyClass: busyClassOf(avgAll)
        }
      })
    } catch (e) {
      toast(e.message || '加载失败')
    }
  }
})
