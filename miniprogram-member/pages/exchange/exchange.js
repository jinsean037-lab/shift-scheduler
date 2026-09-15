const { request, requireUser, toast, slotLabel, statusLabel } = require('../../utils/api')

function weekdayOf(dateStr) {
  const d = new Date(dateStr + 'T12:00:00+08:00')
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
}

function datesForWeekday(start, end, weekday) {
  const dates = []
  if (!start || !end || !weekday) return dates
  const cur = new Date(String(start).slice(0, 10) + 'T12:00:00+08:00')
  const last = new Date(String(end).slice(0, 10) + 'T12:00:00+08:00')
  while (cur <= last) {
    const date = cur.toISOString().slice(0, 10)
    if (weekdayOf(date) === weekday) dates.push(date)
    cur.setDate(cur.getDate() + 1)
  }
  return dates
}

Page({
  data: {
    modes: [{ label: '换班', value: 'swap' }, { label: '代班', value: 'substitute' }],
    modeIndex: 0,
    isSwap: true,
    myShifts: [{ label: '请选择', value: null }],
    targetShifts: [{ label: '请选择', value: null }],
    members: ['请选择'],
    mode: 'swap',
    myShiftIndex: 0,
    targetShiftIndex: 0,
    memberIndex: 0,
    reason: '',
    schedule: {},
    scheduleStart: '',
    scheduleEnd: '',
    requests: [],
    submitting: false
  },
  onShow() {
    this.loadData()
  },
  onPullDownRefresh() {
    this.loadData().finally(() => wx.stopPullDownRefresh())
  },
  async loadData() {
    const user = requireUser()
    if (!user) return
    try {
      const [my, config, schedule, swaps, subs] = await Promise.all([
        request('/my-shifts?name=' + encodeURIComponent(user.name)),
        request('/config'),
        request('/schedule'),
        request('/shift-swaps?name=' + encodeURIComponent(user.name)),
        request('/shift-substitutes?name=' + encodeURIComponent(user.name))
      ])
      const myShifts = [{ label: '请选择', value: null }].concat((my.shifts || []).map(s => ({
        label: (s.date || '') + ' ' + (s.day || '') + ' ' + (s.slotLabel || slotLabel(s.slotId || s.slot)),
        value: s
      })))
      const members = ['请选择'].concat((config.members || []).filter(n => n !== user.name))
      const requests = []
      ;(swaps.requests || []).forEach(r => {
        requests.push({
          key: 'swap_' + r.id,
          id: r.id,
          type: 'swap',
          title: r.from + ' 与 ' + r.to + ' 换班',
          detail: (r.fromDate || '') + ' ' + slotLabel(r.fromSlotId) + ' ↔ ' + (r.toDate || '') + ' ' + slotLabel(r.toSlotId),
          status: r.status,
          statusText: statusLabel(r.status),
          canReview: r.to === user.name,
          canRevoke: r.from === user.name
        })
      })
      ;(subs.requests || []).forEach(r => {
        requests.push({
          key: 'sub_' + r.id,
          id: r.id,
          type: 'substitute',
          title: r.from + ' 请 ' + r.to + ' 代班',
          detail: (r.date || '') + ' ' + (r.day || '') + ' ' + slotLabel(r.slotId),
          status: r.status,
          statusText: statusLabel(r.status),
          canReview: r.to === user.name,
          canRevoke: r.from === user.name
        })
      })
      this.setData({
        myShifts,
        members,
        schedule: schedule.schedule || {},
        scheduleStart: schedule.scheduleStart || '',
        scheduleEnd: schedule.scheduleEnd || '',
        requests
      })
      this.refreshTargetShifts()
    } catch (e) {
      toast(e.message || '加载失败')
    }
  },
  onModeChange(e) {
    const modeIndex = Number(e.detail.value)
    this.setData({ modeIndex, isSwap: this.data.modes[modeIndex].value === 'swap' })
  },
  onMyShiftChange(e) {
    this.setData({ myShiftIndex: Number(e.detail.value) })
  },
  onMemberChange(e) {
    this.setData({ memberIndex: Number(e.detail.value), targetShiftIndex: 0 })
    this.refreshTargetShifts()
  },
  onTargetShiftChange(e) {
    this.setData({ targetShiftIndex: Number(e.detail.value) })
  },
  onReasonInput(e) {
    this.setData({ reason: e.detail.value })
  },
  refreshTargetShifts() {
    const target = this.data.members[this.data.memberIndex]
    const targetShifts = [{ label: '请选择', value: null }]
    if (target && target !== '请选择') {
      const schedule = this.data.schedule || {}
      Object.keys(schedule).forEach(day => {
        const dayData = schedule[day] || {}
        Object.keys(dayData).forEach(slotId => {
          const list = dayData[slotId] || []
          if (!list.includes(target)) return
          datesForWeekday(this.data.scheduleStart, this.data.scheduleEnd, day).forEach(date => {
            targetShifts.push({
              label: date + ' ' + day + ' ' + slotLabel(slotId),
              value: { date, day, slotId }
            })
          })
        })
      })
    }
    this.setData({ targetShifts })
  },
  async submitRequest() {
    const user = requireUser()
    if (!user) return
    const mode = this.data.modes[this.data.modeIndex].value
    const mine = this.data.myShifts[this.data.myShiftIndex] && this.data.myShifts[this.data.myShiftIndex].value
    const target = this.data.members[this.data.memberIndex]
    if (!mine || !target || target === '请选择') return toast('请选择班次和成员')
    this.setData({ submitting: true })
    try {
      let data
      if (mode === 'swap') {
        const other = this.data.targetShifts[this.data.targetShiftIndex] && this.data.targetShifts[this.data.targetShiftIndex].value
        if (!other) return toast('请选择对方班次')
        data = await request('/shift-swap/request', {
          method: 'POST',
          data: {
            from: user.name,
            to: target,
            fromDate: mine.date,
            fromDay: mine.day,
            fromSlotId: mine.slotId || mine.slot,
            toDate: other.date,
            toDay: other.day,
            toSlotId: other.slotId,
            reason: this.data.reason
          }
        })
      } else {
        data = await request('/shift-substitute/request', {
          method: 'POST',
          data: {
            from: user.name,
            to: target,
            date: mine.date,
            day: mine.day,
            slotId: mine.slotId || mine.slot,
            reason: this.data.reason
          }
        })
      }
      toast(data.msg || (data.ok ? '已提交' : '提交失败'))
      this.setData({ reason: '' })
      this.loadData()
    } catch (e) {
      toast(e.message || '提交失败')
    } finally {
      this.setData({ submitting: false })
    }
  },
  async reviewRequest(e) {
    const user = requireUser()
    if (!user) return
    const { type, id, action } = e.currentTarget.dataset
    const path = type === 'swap' ? '/shift-swap/review' : '/shift-substitute/review'
    try {
      const data = await request(path, {
        method: 'POST',
        data: { id, reviewer: user.name, action }
      })
      toast(data.msg || '已处理')
      this.loadData()
    } catch (err) {
      toast(err.message || '操作失败')
    }
  },
  async revokeRequest(e) {
    const user = requireUser()
    if (!user) return
    const { type, id } = e.currentTarget.dataset
    const path = type === 'swap' ? '/shift-swap/revoke' : '/shift-substitute/revoke'
    try {
      const data = await request(path, {
        method: 'POST',
        data: { id, name: user.name }
      })
      toast(data.msg || '已撤回')
      this.loadData()
    } catch (err) {
      toast(err.message || '撤回失败')
    }
  }
})
