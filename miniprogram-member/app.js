App({
  globalData: {
    apiBase: 'https://shift-scheduler-93l6.onrender.com/api',
    user: null,
    subscribeTemplateIds: {
      beforeShift: '',
      missedCheckin: '',
      missedCheckout: '',
      exchangeNotice: ''
    }
  },
  onLaunch() {
    const user = wx.getStorageSync('memberUser')
    if (user && user.name) this.globalData.user = user
  }
})
