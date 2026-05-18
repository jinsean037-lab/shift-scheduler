const express = require('express')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = 3000
const STORE_FILE = path.join(__dirname, '..', 'data', 'store.json')

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// ========== 默认数据 ==========
const DEFAULT_MEMBERS = (
  process.env.DEFAULT_MEMBERS ||
  '赫敏然,吴卓泓,周子曦,施金,蔡心玥,冯一诺,刘锐曦,罗璐,周田,张新源,马衍茹,邹绪扬,熊卓然,方悠,黄畅锋,孙歌瑶,王梓豪,姚雅洁,陈宇涵,彭德东,王润橦'
).split(',')

function getDefaultStore() {
  const schedule = {}
  ;['周一','周二','周三','周四','周五'].forEach(day => {
    schedule[day] = { am1:[], am2:[], pm1:[], pm2:[] }
  })
  return {
    startTime: null,
    maxPerSlot: 2,
    schedule,
    waitlist: [],
    cancelRequests: [],
    passwords: {},
    members: [...DEFAULT_MEMBERS]
  }
}

// ========== 文件读写 ==========
function loadStore() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, 'utf8')
      const data = JSON.parse(raw)
      // 补全 members
      DEFAULT_MEMBERS.forEach(m => {
        if (!data.members.includes(m)) data.members.push(m)
      })
      return data
    }
  } catch(e) {
    console.error('[file] loadStore 失败:', e.message)
  }
  return getDefaultStore()
}

function saveStore(store) {
  try {
    const dir = path.dirname(STORE_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf8')
  } catch(e) {
    console.error('[file] saveStore 失败:', e.message)
  }
}

// 初始化 store
let store = loadStore()

// 确保默认密码
if (!store.passwords) store.passwords = {}
store.members.forEach(m => {
  if (!store.passwords[m]) {
    store.passwords[m] = String(Math.floor(10000000 + Math.random() * 90000000))
  }
})
saveStore(store)

console.log('[init] 成员数:', store.members.length)
console.log('[init] 密码已就绪')

// ========== API ==========

// 获取配置
app.get('/api/config', (req, res) => {
  res.json({ maxPerSlot: store.maxPerSlot || 2, startTime: store.startTime })
})

// 登录
app.post('/api/login', (req, res) => {
  const { name, password } = req.body
  if (!name || !password) return res.json({ ok: false, msg: '请输入姓名和密码' })
  if (!store.members.includes(name)) return res.json({ ok: false, msg: '该姓名不在成员名单中' })
  if (password !== store.passwords[name]) return res.json({ ok: false, msg: '密码错误' })
  res.json({ ok: true, name, isAdmin: name === 'admin' })
})

// 管理员登录
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body
  if (password === 'admin123') return res.json({ ok: true })
  res.json({ ok: false, msg: '管理员密码错误' })
})

// 获取排班表
app.get('/api/schedule', (req, res) => {
  res.json({ ok: true, schedule: store.schedule, members: store.members })
})

// 获取我的班次
app.get('/api/my-shifts', (req, res) => {
  const { name } = req.query
  if (!name) return res.json({ ok: false, msg: '缺少参数' })
  const shifts = []
  Object.entries(store.schedule).forEach(([day, slots]) => {
    Object.entries(slots).forEach(([slot, names]) => {
      if (names.includes(name)) shifts.push({ day, slot })
    })
  })
  res.json({ ok: true, shifts })
})

// 选时段
app.post('/api/pick', (req, res) => {
  const { name, day, slotId } = req.body
  if (!store.startTime) return res.json({ ok: false, msg: '尚未开始' })
  const now = Date.now() + 8 * 3600 * 1000
  if (now < new Date(store.startTime).getTime()) return res.json({ ok: false, msg: '未到开始时间' })

  const key = `${day}|${slotId}`
  if (!store.schedule[day]) store.schedule[day] = {}
  if (!store.schedule[day][slotId]) store.schedule[day][slotId] = []

  const list = store.schedule[day][slotId]
  if (list.includes(name)) return res.json({ ok: false, msg: '不能重复选择' })

  // 检查是否已选2个
  let myCount = 0
  Object.values(store.schedule).forEach(slots => {
    Object.values(slots).forEach(names => {
      if (names.includes(name)) myCount++
    })
  })
  if (myCount >= 2) return res.json({ ok: false, msg: '每人最多选2个时段' })

  // 是否已满
  if (list.length >= (store.maxPerSlot || 2)) {
    return res.json({ ok: false, msg: '该时段已满，可候补' })
  }

  list.push(name)
  store.scheduleTime = store.scheduleTime || {}
  store.scheduleTime[`${key}|${name}`] = Date.now()
  saveStore(store)
  res.json({ ok: true, schedule: store.schedule })
})

// 取消申请
app.post('/api/cancel-request', (req, res) => {
  const { name, day, slotId } = req.body
  const key = `${day}|${slotId}`
  const existing = store.cancelRequests.find(r => r.name === name && r.day === day && r.slotId === slotId)
  if (existing) return res.json({ ok: false, msg: '已提交过取消申请' })
  store.cancelRequests.push({ name, day, slotId, time: Date.now() })
  saveStore(store)
  res.json({ ok: true })
})

// 候补
app.post('/api/waitlist', (req, res) => {
  const { name, day, slotId } = req.body
  const key = `${day}|${slotId}`
  const list = (store.schedule[day] && store.schedule[day][slotId]) || []
  if (list.includes(name)) return res.json({ ok: false, msg: '你已在此时段' })
  const existing = store.waitlist.find(w => w.name === name && w.day === day && w.slotId === slotId)
  if (existing) return res.json({ ok: false, msg: '已在候补列表' })
  store.waitlist.push({ name, day, slotId, time: Date.now() })
  saveStore(store)
  res.json({ ok: true })
})

// ========== 管理员 API ==========

// 设置开始时间
app.post('/api/admin/set-start', (req, res) => {
  const { startTime } = req.body
  store.startTime = startTime
  saveStore(store)
  res.json({ ok: true })
})

// 获取候补列表
app.get('/api/admin/waitlist', (req, res) => {
  res.json({ ok: true, waitlist: store.waitlist || [] })
})

// 批准候补
app.post('/api/admin/waitlist/approve', (req, res) => {
  const { name, day, slotId } = req.body
  const key = `${day}|${slotId}`
  if (!store.schedule[day]) store.schedule[day] = {}
  if (!store.schedule[day][slotId]) store.schedule[day][slotId] = []
  const list = store.schedule[day][slotId]
  if (list.length >= 3) return res.json({ ok: false, msg: '该时段已有3人' })
  if (!list.includes(name)) list.push(name)
  store.scheduleTime = store.scheduleTime || {}
  store.scheduleTime[`${key}|${name}`] = Date.now()
  // 移除候补
  store.waitlist = store.waitlist.filter(w => !(w.name === name && w.day === day && w.slotId === slotId))
  saveStore(store)
  res.json({ ok: true, schedule: store.schedule })
})

// 获取取消申请
app.get('/api/admin/cancel-requests', (req, res) => {
  res.json({ ok: true, cancelRequests: store.cancelRequests || [] })
})

// 批准取消
app.post('/api/admin/cancel-approve', (req, res) => {
  const { name, day, slotId } = req.body
  const key = `${day}|${slotId}`
  if (store.schedule[day] && store.schedule[day][slotId]) {
    const list = store.schedule[day][slotId]
    const idx = list.indexOf(name)
    if (idx >= 0) list.splice(idx, 1)
  }
  store.cancelRequests = store.cancelRequests.filter(r => !(r.name === name && r.day === day && r.slotId === slotId))
  saveStore(store)
  res.json({ ok: true, schedule: store.schedule })
})

// 密码管理
app.get('/api/admin/passwords', (req, res) => {
  res.json({ ok: true, passwords: store.passwords || {} })
})

app.post('/api/admin/reset-password', (req, res) => {
  const { name } = req.body
  if (!store.passwords[name]) return res.json({ ok: false, msg: '成员不存在' })
  const newPwd = String(Math.floor(10000000 + Math.random() * 90000000))
  store.passwords[name] = newPwd
  saveStore(store)
  res.json({ ok: true, newPassword: newPwd })
})

// 手动分配
app.post('/api/admin/assign', (req, res) => {
  const { name, day, slotId } = req.body
  const key = `${day}|${slotId}`
  if (!store.schedule[day]) store.schedule[day] = {}
  if (!store.schedule[day][slotId]) store.schedule[day][slotId] = []
  const list = store.schedule[day][slotId]
  if (list.includes(name)) return res.json({ ok: false, msg: '已分配' })
  list.push(name)
  saveStore(store)
  res.json({ ok: true, schedule: store.schedule })
})

// 重置排班表
app.post('/api/admin/reset', (req, res) => {
  ;['周一','周二','周三','周四','周五'].forEach(day => {
    store.schedule[day] = { am1:[], am2:[], pm1:[], pm2:[] }
  })
  store.waitlist = []
  store.cancelRequests = []
  saveStore(store)
  res.json({ ok: true })
})

// 成员管理
app.get('/api/admin/members', (req, res) => {
  res.json({ ok: true, members: store.members || [] })
})

app.post('/api/admin/members/add', (req, res) => {
  const { name } = req.body
  if (!name) return res.json({ ok: false, msg: '请输入姓名' })
  if (store.members.includes(name)) return res.json({ ok: false, msg: '成员已存在' })
  store.members.push(name)
  if (!store.passwords[name]) {
    store.passwords[name] = String(Math.floor(10000000 + Math.random() * 90000000))
  }
  saveStore(store)
  res.json({ ok: true })
})

app.post('/api/admin/members/remove', (req, res) => {
  const { name } = req.body
  store.members = store.members.filter(m => m !== name)
  saveStore(store)
  res.json({ ok: true })
})

// 修改密码（管理员）
app.post('/api/admin/change-password', (req, res) => {
  const { oldPassword, newPassword } = req.body
  if (oldPassword !== 'admin123') return res.json({ ok: false, msg: '原密码错误' })
  // 管理员密码是固定的 admin123，不需要改
  res.json({ ok: true, msg: '管理员密码未变更（固定为 admin123）' })
})

// 启动
app.listen(PORT, '0.0.0.0', () => {
  console.log(`排班系统运行中: http://localhost:${PORT}`)
  console.log(`[db] 文件持久化已启用 (${STORE_FILE})`)
})
