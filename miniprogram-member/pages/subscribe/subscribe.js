const { request, requireUser, toast } = require('../../utils/api')

Page({
  data: {
    settings: {
      missedCheckin: true,
      missedCheckout: true,
      shiftSwap: true,
      shiftSubstitute: true
    },
    saving: false,
    requesting: false,
    subscribeResult: {}
  },
  onLoad() {
    this.loadSettings()
  },
  async loadSettings() {
    const user = requireUser()
    if (!user) return
    try {
      const data = await request('/member/wechat-subscription?name=' + encodeURIComponent(user.name))
      this.setData({ settings: Object.assign({}, this.data.settings, data.settings || {}) })
    } catch (e) {
      toast(e.message || '加载失败')
    }
  },
  onSwitch(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ ['settings.' + key]: e.detail.value })
  },
  async requestSubscribe() {
    const ids = Object.values(getApp().globalData.subscribeTemplateIds || {}).filter(Boolean)
    if (!ids.length) {
      toast('模板 ID 尚未配置')
      return
    }
    this.setData({ requesting: true })
    try {
      const result = await new Promise((resolve, reject) => {
        wx.requestSubscribeMessage({
          tmplIds: ids,
          success: resolve,
          fail: reject
        })
      })
      this.setData({ subscribeResult: result })
      toast('授权结果已记录')
      await this.save()
    } catch (e) {
      toast('授权未完成')
    } finally {
      this.setData({ requesting: false })
    }
  },
  async save() {
    const user = requireUser()
    if (!user) return
    this.setData({ saving: true })
    try {
      const data = await request('/member/wechat-subscription', {
        method: 'PUT',
        data: {
          name: user.name,
          settings: Object.assign({}, this.data.settings, { subscribeResult: this.data.subscribeResult })
        }
      })
      toast(data.ok ? '已保存' : '保存失败', data.ok ? 'success' : 'none')
    } catch (e) {
      toast(e.message || '保存失败')
    } finally {
      this.setData({ saving: false })
    }
  }
})
