App({
  globalData: {
    apiBase: 'https://shift-scheduler-93l6.onrender.com/api',
    user: null,
    subscribeTemplateIds: {
      shiftSwap: 'sUpPazzV67bnvZAaeHMOYznai9GOZ_TRLL2dJYrfBuM',
      shiftSubstitute: '6hP43mHFnHj9yHLgClg8YMlDFW31YqTtBxYf7CUxkW8',
      missedCheckout: 'tAPP0R-7ZnsS5NshiCLGfKEgpN6YXlguQBI494uo7_w',
      missedCheckin: 'Fq6xyq1ox9iIs8xo8LCbql9Ek-2wC_sZryVOrY3XWaI'
    }
  },
  onLaunch() {
    const user = wx.getStorageSync('memberUser')
    if (user && user.name) this.globalData.user = user
  }
})
