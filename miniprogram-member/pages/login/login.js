const { request, toast } = require('../../utils/api')

Page({
  data: {
    name: '',
    password: '',
    loading: false
  },
  onLoad() {
    const user = wx.getStorageSync('memberUser')
    if (user && user.name) wx.switchTab({ url: '/pages/index/index' })
  },
  onNameInput(e) {
    this.setData({ name: e.detail.value })
  },
  onPasswordInput(e) {
    this.setData({ password: e.detail.value })
  },
  async login() {
    const name = this.data.name.trim()
    const password = this.data.password.trim()
    if (!name || !password) return toast('请输入姓名和密码')
    this.setData({ loading: true })
    try {
      const data = await request('/login', {
        method: 'POST',
        data: { name, password }
      })
      if (!data.ok) return toast(data.msg || '登录失败')
      const user = { name: data.name || name, role: 'member' }
      wx.setStorageSync('memberUser', user)
      getApp().globalData.user = user
      this.bindWechat(user.name)
      wx.switchTab({ url: '/pages/index/index' })
    } catch (e) {
      toast(e.message || '网络错误')
    } finally {
      this.setData({ loading: false })
    }
  },
  bindWechat(name) {
    wx.login({
      success: async (loginRes) => {
        if (!loginRes.code) return
        try {
          await request('/member/wechat-bind', {
            method: 'POST',
            data: { name, code: loginRes.code }
          })
        } catch (_) {}
      }
    })
  }
})
