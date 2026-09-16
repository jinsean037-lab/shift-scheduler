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
    requestingKey: '',
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
  async requestOneSubscribe(e) {
    const key = e.currentTarget.dataset.key
    await this.requestSubscribeByKey(key)
  },
  async requestSubscribeByKey(key) {
    const allIds = getApp().globalData.subscribeTemplateIds || {}
    const templateId = allIds[key]
    if (!templateId) {
      toast('模板 ID 尚未配置')
      return
    }
    this.setData({ requestingKey: key })
    try {
      const result = await new Promise((resolve, reject) => {
        wx.requestSubscribeMessage({
          tmplIds: [templateId],
          success: resolve,
          fail: reject
        })
      })
      this.setData({
        subscribeResult: Object.assign({}, this.data.subscribeResult, result)
      })
      await this.save()
      wx.showModal({
        title: result[templateId] === 'accept' ? '消息订阅成功' : '订阅授权已保存',
        content: result[templateId] === 'accept'
          ? '你已开启该项提醒，后续系统会按设置发送通知。'
          : '该项提醒未授权成功，系统已保存当前设置。',
        showCancel: false
      })
    } catch (e) {
      const msg = e && (e.errMsg || e.message)
      wx.showModal({
        title: '授权未完成',
        content: msg || '微信未返回具体原因，请稍后重试',
        showCancel: false
      })
    } finally {
      this.setData({ requestingKey: '' })
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
      if (!this.data.requestingKey) toast(data.ok ? '已保存' : '保存失败', data.ok ? 'success' : 'none')
    } catch (e) {
      toast(e.message || '保存失败')
    } finally {
      this.setData({ saving: false })
    }
  }
})
