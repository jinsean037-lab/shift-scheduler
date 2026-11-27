const { request, requireUser, toast, slotLabel, getLocation, rateShift } = require('../../utils/api')

function currentUserName() {
  const u = requireUser()
  return u ? u.name : ''
}

Page({
  data: {
    userName: '',
    todayText: '',
    todayShifts: [],
    monthly: { shiftCount: 0, totalHours: 0, totalPay: 0, year: '', month: '' },
    // v7.3 班次评价
    ratingTarget: null,        // 可评价的班次 { date, day, slotId, slotLabel }
    myStars: 0,                // 我已选的星级
    slotAvg: null,             // 该时段历史平均星级
    slotCount: 0,              // 该时段评价人数
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
    this.loadMonthlyStats()
    this.loadRating()
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
  // v7.2：本月值班次数（含补报）/ 总工时 / 预计薪酬
  async loadMonthlyStats() {
    const user = requireUser()
    if (!user) return
    try {
      const data = await request('/member/monthly-stats?name=' + encodeURIComponent(user.name))
      if (!data || !data.ok) return
      this.setData({
        monthly: {
          shiftCount: data.shiftCount || 0,
          totalHours: data.totalHours || 0,
          totalPay: data.totalPay || 0,
          year: data.year || '',
          month: data.month || ''
        }
      })
    } catch (e) {
      console.error('loadMonthlyStats', e)
    }
  },
  // v7.3：加载可评价的班次 + 我的评价 + 该时段平均星级
  async loadRating() {
    const user = requireUser()
    if (!user) return
    try {
      const [todayData, myData, weekData] = await Promise.all([
        request('/member/today-status?name=' + encodeURIComponent(user.name)),
        request('/member/my-ratings?name=' + encodeURIComponent(user.name)),
        request('/member/week-schedule?name=' + encodeURIComponent(user.name))
      ])
      const myRatings = myData.ratings || []
      const keyOf = t => t.date + '|' + t.day + '|' + t.slotId
      const ratedSet = {}
      myRatings.forEach(r => { ratedSet[keyOf(r)] = true })

      // 候选班次：本周我实际值过的班次（含换班/代班后的生效名单）
      const candidates = []
      const weekDays = weekData.days || []
      weekDays.forEach(d => {
        (d.slots || []).forEach(sl => {
          if ((sl.members || []).indexOf(user.name) >= 0) {
            candidates.push({ date: d.date, day: d.weekday, slotId: sl.slotId, slotLabel: sl.label || '' })
          }
        })
      })
      candidates.sort((a, b) => String(a.date).localeCompare(String(b.date)))

      // 优先级：今天的第一班 → 本周最近的未评价班次 → 本周最近的班次 → 最近一条历史评价
      const todayShifts = todayData.shifts || []
      let target = null
      if (todayShifts.length) {
        const s0 = todayShifts[0]
        target = { date: s0.date || '', day: s0.day || '', slotId: s0.slotId || s0.slot, slotLabel: s0.slotLabel || '' }
      } else {
        const unrated = candidates.filter(c => !ratedSet[keyOf(c)])
        if (unrated.length) target = unrated[unrated.length - 1]
        else if (candidates.length) target = candidates[candidates.length - 1]
        else if (myRatings.length) {
          const mine = myRatings[0]
          target = { date: mine.date, day: mine.day, slotId: mine.slotId, slotLabel: '' }
        }
      }
      let myStars = 0
      if (target) {
        const hit = myRatings.find(r => keyOf(r) === keyOf(target))
        if (hit) myStars = hit.stars || 0
      }
      const slotAverages = myData.slotAverages || {}
      const agg = target ? slotAverages[target.day + '|' + target.slotId] : null
      this.setData({
        ratingTarget: target,
        myStars: myStars,
        slotAvg: agg ? agg.avg : null,
        slotCount: agg ? agg.count : 0
      })
    } catch (e) {
      console.error('loadRating', e)
    }
  },
  // v7.3：点星星即时提交评价
  async pickStar(e) {
    const stars = Number(e.currentTarget.dataset.stars)
    const target = this.data.ratingTarget
    if (!target || !stars) return
    this.setData({ myStars: stars })
    try {
      const data = await rateShift({
        name: currentUserName(),
        date: target.date,
        day: target.day,
        slotId: target.slotId,
        stars: stars
      })
      if (data && data.ok) {
        this.setData({ slotAvg: data.slotAvg, slotCount: data.slotCount })
        toast(data.msg || '评价成功', 'success')
      } else {
        toast((data && data.msg) || '评价失败')
      }
    } catch (e) {
      toast(e.message || '评价失败')
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
