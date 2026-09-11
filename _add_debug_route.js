const fs = require('fs')
const path = require('path')

const serverJsPath = path.join(__dirname, 'backend', 'server.js')
let content = fs.readFileSync(serverJsPath, 'utf8')

const debugRoute = `
// 调试：查看打卡数据格式（临时）
app.get('/api/debug-checkins', async (req, res) => {
  try {
    const name = req.query.name || '周子曦'
    const store = await readStore()
    const allCheckins = store.checkins || []
    const userCheckins = allCheckins.filter(c => c.name === name)
    res.json({
      totalCheckinsInStore: allCheckins.length,
      userCheckinsCount: userCheckins.length,
      sample: userCheckins.slice(0, 10).map(c => ({
        date: c.date,
        time: c.time,
        type: c.type,
        isSupp: c.isSupp,
        timeType: typeof c.time,
        timeLength: c.time ? c.time.length : null
      }))
    })
  } catch (e) {
    res.json({ error: e.message })
  }
})
`

// 插入到 /api/my-checkins 路由之前
const insertBefore = "app.get('/api/my-checkins'"
const idx = content.indexOf(insertBefore)

if (idx !== -1) {
  content = content.slice(0, idx) + debugRoute + '\n' + content.slice(idx)
  fs.writeFileSync(serverJsPath, content, 'utf8')
  console.log('✅ 调试路由已添加到 /api/debug-checkins')
  console.log('   用法: 浏览器访问 https://shift-scheduler-9316.onrender.com/api/debug-checkins?name=周子曦')
} else {
  console.log('❌ 找不到插入点')
}
