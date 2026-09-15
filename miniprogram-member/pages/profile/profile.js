const { request, requireUser, toast } = require('../../utils/api')

Page({
  data: {
    userName: '',
    email: '',
    profile: {
      bankAccount: '',
      department: '岭南学院',
      studentId: '',
      dorm: '',
      phone: ''
    },
    saving: false
  },
  onShow() {
    this.loadProfile()
  },
  async loadProfile() {
    const user = requireUser()
    if (!user) return
    this.setData({ userName: user.name })
    try {
      const [profileData, emailData] = await Promise.all([
        request('/member/profile?name=' + encodeURIComponent(user.name)),
        request('/member/email?name=' + encodeURIComponent(user.name))
      ])
      this.setData({
        profile: Object.assign({}, this.data.profile, profileData.profile || {}),
        email: emailData.email || ''
      })
    } catch (e) {
      toast(e.message || '加载失败')
    }
  },
  onEmailInput(e) {
    this.setData({ email: e.detail.value })
  },
  onProfileInput(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ ['profile.' + key]: e.detail.value })
  },
  async saveProfile() {
    const user = requireUser()
    if (!user) return
    this.setData({ saving: true })
    try {
      const [profileResult, emailResult] = await Promise.all([
        request('/member/profile', {
          method: 'PUT',
          data: { name: user.name, profile: this.data.profile }
        }),
        request('/member/email', {
          method: 'PUT',
          data: { name: user.name, email: this.data.email }
        })
      ])
      toast((profileResult.ok && emailResult.ok) ? '已保存' : '保存失败', profileResult.ok ? 'success' : 'none')
    } catch (e) {
      toast(e.message || '保存失败')
    } finally {
      this.setData({ saving: false })
    }
  },
  goSubscribe() {
    wx.navigateTo({ url: '/pages/subscribe/subscribe' })
  },
  logout() {
    wx.removeStorageSync('memberUser')
    getApp().globalData.user = null
    wx.reLaunch({ url: '/pages/login/login' })
  }
})
