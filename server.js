const express = require('express')
const path = require('path')

// ========== 默认成员数据（Render 重启后从此恢复）==========
const DEFAULT_MEMBERS = (process.env.DEFAULT_MEMBERS || '赫敏然,吴卓泓,周子曦,施金,蔡心玥,冯一诺,刘锐曦,罗璐,周田,张新源,马衍茹,邹绪扬,熊卓然,方悠,黄畅锋,孙歌瑶,王梓豪,姚雅洁,陈宇涵,彭德东,王润橦').split(',')

const DEFAULT_PASSWORDS = {
  '赫敏然':'77893457','吴卓泓':'85630183','周子曦':'65103265','施金':'81621329','蔡心玥':'85481151',
  '冯一诺':'88137988','刘锐曦':'82034008','罗璐':'76813401','周田':'65989126','张新源':'58175831',
  '马衍茹':'91998599','邹绪扬':'29822335','熊卓然':'85197554','方悠':'58101585','黄畅锋':'15470436',
  '孙歌瑶':'81680381','王梓豪':'49907581','姚雅洁':'35122532','陈宇涵':'07342267','彭德东':'62375667',
  '王润橦':'11176906'
}

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// ========== 内存存储（Render 免费版适用）==========

const store = {
  timeSlots: [
    { id: 'am1', label: '8:00-10:00', period: '上午' },
    { id: 'am2', label: '10:00-12:00', period: '上午' },
    { id: 'pm1', label: '14:30-16:00', period: '下午' },
    { id: 'pm2', label: '16:00-17:30', period: '下午' }
  ],
  days: ['周一', '周二', '周三', '周四', '周五'],
  maxPerSlot: 2,
  startTime: null, // 排班开始时间（北京时间 ISO 字符串），null 表示不限制
  members: [
    '赫敏然', '吴卓泓', '周子曦', '施金', '蔡心玥', '冯一诺', '刘锐曦', '罗璐', '周田', '张新源',
    '马衍茹', '邹绪扬', '熊卓然', '方悠', '黄畅锋', '孙歌瑶', '王梓豪', '姚雅洁', '陈宇涵', '彭德东', '王润橦'
  ],
  // 成员密码（8位数字）
  passwords: {
    '赫敏然': '77893457', '吴卓泓': '85630183', '周子曦': '65103265', '施金': '81621329', '蔡心玥': '85481151',
    '冯一诺': '88137988', '刘锐曦': '82034008', '罗璐': '76813401', '周田': '65989126', '张新源': '58175831',
    '马衍茹': '91998599', '邹绪扬': '29822335', '熊卓然': '85197554', '方悠': '58101585', '黄畅锋': '15470436',
    '孙歌瑶': '81680381', '王梓豪': '49907581', '姚雅洁': '35122532', '陈宇涵': '07342267', '彭德东': '62375667',
    '王润橦': '11176906'
  },
  schedule: {},           // { "周|am1": ["张三", "李四"] }
  scheduleTime: {},    // { "周|am1|张三": timestamp } 记录每个成员选班的时间（UTC ms）
  waitlist: [],        //候补名单: [{ name, day, slotId, time, status }]
  cancelRequests: []   //取消班次申请: [{ name, day, slotId, time, status, reason }]
}

// ========== 懒初始化：实例休眠重启后自动恢复成员名单 ==========
function ensureMembers() {
  if (store.members.length === 0 && DEFAULT_MEMBERS.length > 0) {
    store.members = [...DEFAULT_MEMBERS]
    store.passwords = { ...DEFAULT_PASSWORDS }
    console.log('[init] 已从环境变量恢复成员名单:', store.members.length + '人')
  }
}

function readStore() {
  ensureMembers() // 每次读store时也检查，防止睡醒后第一次请求仍为空
  return store
}

function writeStore(data) {
  Object.assign(store, data)
}

// ========== API 路由 ==========

// 获取配置
app.get('/api/config', async (req, res) => {
  try {
    const store = readStore()
    res.json({
      timeSlots: store.timeSlots,
      days: store.days,
      maxPerSlot: store.maxPerSlot,
      startTime: store.startTime,
      members: store.members
    })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 管理员：获取开始时间设置
app.get('/api/admin/start-time', async (req, res) => {
  try {
    const store = readStore()
    res.json({ startTime: store.startTime })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 管理员：设置开始时间
app.post('/api/admin/start-time', async (req, res) => {
  try {
    const { startTime } = req.body
    const store = readStore()
    // startTime 为 null 表示不限制，字符串表示北京时间 ISO 格式
    store.startTime = startTime || null
    writeStore(store)
    res.json({ ok: true, startTime: store.startTime })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 检查是否在排班开始时间前
function isBeforeStartTime(store) {
  if (!store.startTime) return false // 不限制
  // 将北京时间 startTime 转为 UTC Date 对比
  const startDate = new Date(store.startTime)
  const nowBeijingMs = Date.now() + 8 * 60 * 60 * 1000 // 当前北京时间转 UTC
  return nowBeijingMs < startDate.getTime()
}

// 登录验证（姓名+密码）
app.post('/api/login', async (req, res) => {
  try {
    const { name, password } = req.body
    if (!name || !name.trim()) {
      return res.json({ ok: false, msg: '请输入姓名' })
    }
    if (!password || !password.trim()) {
      return res.json({ ok: false, msg: '请输入密码' })
    }
    const store = readStore()
    const trimmed = name.trim()
    if (!store.members.includes(trimmed)) {
      return res.json({ ok: false, msg: '姓名不在名单中，请联系管理员添加' })
    }
    // 验证密码
    if (store.passwords[trimmed] !== password.trim()) {
      return res.json({ ok: false, msg: '密码错误' })
    }
    res.json({ ok: true, name: trimmed })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 获取完整排班表
app.get('/api/schedule', async (req, res) => {
  try {
    const store = readStore()
    res.json({
      timeSlots: store.timeSlots,
      days: store.days,
      maxPerSlot: store.maxPerSlot,
      schedule: store.schedule,
      members: store.members,
      waitlist: store.waitlist,
      cancelRequests: store.cancelRequests || [],
      startTime: store.startTime
    })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 选择时段（只能添加，不能取消）
app.post('/api/select', async (req, res) => {
  try {
    const { name, day, slotId } = req.body
    if (!name || !day || !slotId) {
      return res.json({ ok: false, msg: '参数缺失' })
    }

    const store = readStore()

    // 检查是否在排班开始时间前
    if (isBeforeStartTime(store)) {
      return res.json({ ok: false, msg: '排班尚未开始，请等待管理员设置开始时间' })
    }

    if (!store.members.includes(name)) {
      return res.json({ ok: false, msg: '用户不存在' })
    }

    const key = `${day}|${slotId}`
    if (!store.schedule[key]) {
      store.schedule[key] = []
    }

    const list = store.schedule[key]
    
    // 已选择则忽略
    if (list.includes(name)) {
      return res.json({ ok: true, action: 'none', schedule: store.schedule, msg: '已选择该时段' })
    }

    if (list.length >= store.maxPerSlot) {
      return res.json({ ok: false, msg: `该时段已满（${store.maxPerSlot}/${store.maxPerSlot}），可申请候补` })
    }

    list.push(name)
    store.scheduleTime[`${key}|${name}`] = Date.now() // 记录选班时间
    writeStore(store)
    res.json({ ok: true, action: 'added', schedule: store.schedule })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 申请取消班次（3分钟内可自由取消，超过需申请）
app.post('/api/cancel-request', async (req, res) => {
  try {
    const { name, day, slotId, reason } = req.body
    if (!name || !day || !slotId) {
      return res.json({ ok: false, msg: '参数缺失' })
    }
    const store = readStore()
    const key = `${day}|${slotId}`
    const list = store.schedule[key] || []
    if (!list.includes(name)) {
      return res.json({ ok: false, msg: '你不在该班次中' })
    }

    // 检查是否已申请
    const exists = store.cancelRequests.find(r => r.name === name && r.day === day && r.slotId === slotId && r.status === 'pending')
    if (exists) {
      return res.json({ ok: false, msg: '已提交取消申请' })
    }

    // 检查是否在3分钟内——自由取消
    const entryTime = store.scheduleTime[`${key}|${name}`]
    if (entryTime) {
      const elapsed = Date.now() - entryTime
      if (elapsed <= 3 * 60 * 1000) {
        // 3分钟内：直接取消
        const idx = list.indexOf(name)
        if (idx >= 0) list.splice(idx, 1)
        if (list.length === 0) delete store.schedule[key]
        delete store.scheduleTime[`${key}|${name}`]

        // 自动从候补名单中填补最早一人
        const slot = store.timeSlots.find(s => s.id === slotId)
        const waitlistKey = `${day}|${slotId}`
        const slotWaitlist = store.waitlist
          .filter(w => w.day === day && w.slotId === slotId && (!w.status || w.status === 'pending') || w.status === 'auto-approved')
          .sort((a, b) => new Date(a.time) - new Date(b.time))

        // 先清理已被淘汰的候补条目（同一人被批准或拒绝后状态已变，不会再出现）

        // 找到第一个未处理的候补
        const next = store.waitlist.find(w =>
          w.day === day && w.slotId === slotId &&
          (!w.status || w.status === 'pending') &&
          !list.includes(w.name)
        )
        if (next) {
          list.push(next.name)
          store.scheduleTime[`${key}|${next.name}`] = Date.now() // 记录选中时间
          next.status = 'auto-approved'
          // 如果填补后超过maxPerSlot，不限制（候补填补场景允许）
        }

        writeStore(store)
        return res.json({ ok: true, action: 'auto-cancelled', msg: '已取消（3分钟内），空位已自动填补候补人员' })
      }
    }

    // 超过3分钟：提交申请
    store.cancelRequests.push({
      name,
      day,
      slotId,
      reason: reason || '',
      time: new Date().toISOString(),
      status: 'pending'
    })
    writeStore(store)
    res.json({ ok: true, action: 'applied', msg: '取消申请已提交，等待管理员审批' })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 取消取消申请
app.post('/api/cancel-request/revoke', async (req, res) => {
  try {
    const { name, day, slotId } = req.body
    const store = readStore()
    const idx = store.cancelRequests.findIndex(r => r.name === name && r.day === day && r.slotId === slotId)
    if (idx >= 0) {
      store.cancelRequests.splice(idx, 1)
      writeStore(store)
    }
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 申请候补
app.post('/api/waitlist', async (req, res) => {
  try {
    const { name, day, slotId } = req.body
    if (!name || !day || !slotId) {
      return res.json({ ok: false, msg: '参数缺失' })
    }
    const store = readStore()
    // 检查是否在排班开始时间前
    if (isBeforeStartTime(store)) {
      return res.json({ ok: false, msg: '排班尚未开始，请等待管理员设置开始时间' })
    }
    if (!store.members.includes(name)) {
      return res.json({ ok: false, msg: '用户不存在' })
    }
    // 检查是否已在候补名单
    const exists = store.waitlist.find(w => w.name === name && w.day === day && w.slotId === slotId)
    if (exists) {
      return res.json({ ok: false, msg: '已在候补名单中' })
    }
    store.waitlist.push({ name, day, slotId, time: new Date().toISOString() })
    writeStore(store)
    res.json({ ok: true, msg: '候补申请已提交' })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 取消候补
app.post('/api/waitlist/cancel', async (req, res) => {
  try {
    const { name, day, slotId } = req.body
    const store = readStore()
    const idx = store.waitlist.findIndex(w => w.name === name && w.day === day && w.slotId === slotId)
    if (idx >= 0) {
      store.waitlist.splice(idx, 1)
      writeStore(store)
    }
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 管理员：拒绝候补
app.post('/api/admin/waitlist/reject', async (req, res) => {
  try {
    const { name, day, slotId } = req.body
    const store = readStore()
    const item = store.waitlist.find(w => w.name === name && w.day === day && w.slotId === slotId)
    if (item) {
      item.status = 'rejected'
      writeStore(store)
    }
    res.json({ ok: true, waitlist: store.waitlist })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 管理员验证
const ADMIN_PASSWORD = 'admin123' // 简单密码，可改
app.post('/api/admin/login', async (req, res) => {
  try {
    const { password } = req.body
    if (password === ADMIN_PASSWORD) {
      res.json({ ok: true, isAdmin: true })
    } else {
      res.json({ ok: false, msg: '密码错误' })
    }
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 管理员：添加成员
app.post('/api/admin/member', async (req, res) => {
  try {
    const { name } = req.body
    if (!name || !name.trim()) {
      return res.json({ ok: false, msg: '请输入姓名' })
    }
    const store = readStore()
    const trimmed = name.trim()
    if (store.members.includes(trimmed)) {
      return res.json({ ok: false, msg: '该成员已存在' })
    }
    store.members.push(trimmed)
    writeStore(store)
    res.json({ ok: true, members: store.members })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 管理员：删除成员
app.post('/api/admin/member/remove', async (req, res) => {
  try {
    const { name } = req.body
    const store = readStore()
    const idx = store.members.indexOf(name)
    if (idx < 0) {
      return res.json({ ok: false, msg: '成员不存在' })
    }
    store.members.splice(idx, 1)
    for (const key of Object.keys(store.schedule)) {
      store.schedule[key] = store.schedule[key].filter(n => n !== name)
      if (store.schedule[key].length === 0) delete store.schedule[key]
    }
    store.waitlist = store.waitlist.filter(w => w.name !== name)
    writeStore(store)
    res.json({ ok: true, members: store.members, schedule: store.schedule })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 管理员：重置排班（保留开始时间设置）
app.post('/api/admin/reset', async (req, res) => {
  try {
    const store = readStore()
    store.schedule = {}
    store.waitlist = []
    store.cancelRequests = []
    writeStore(store)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 管理员：获取所有成员
app.get('/api/admin/members', async (req, res) => {
  try {
    const store = readStore()
    res.json({ members: store.members })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 管理员：获取候补名单
app.get('/api/admin/waitlist', async (req, res) => {
  try {
    const store = readStore()
    res.json({ waitlist: store.waitlist })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 管理员：获取取消申请
app.get('/api/admin/cancel-requests', async (req, res) => {
  try {
    const store = readStore()
    res.json({ cancelRequests: store.cancelRequests || [] })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 自动候补填补：按候补顺序填入最早一人（突破maxPerSlot限制）
function autoFillFromWaitlist(store, day, slotId) {
  const key = `${day}|${slotId}`
  if (!store.schedule[key]) store.schedule[key] = []
  const list = store.schedule[key]
  // 按申请时间排序，找最早的候补
  const pending = store.waitlist
    .filter(w => w.day === day && w.slotId === slotId && (!w.status || w.status === 'pending'))
    .sort((a, b) => new Date(a.time) - new Date(b.time))
  if (pending.length > 0 && !list.includes(pending[0].name)) {
    list.push(pending[0].name)
    store.scheduleTime[`${key}|${pending[0].name}`] = Date.now()
    pending[0].status = 'auto-approved'
    return pending[0].name
  }
  return null
}

// 批准取消时：先移除当事人，再自动候补填补
app.post('/api/admin/cancel/approve', async (req, res) => {
  try {
    const { name, day, slotId } = req.body
    const store = readStore()
    const key = `${day}|${slotId}`
    const list = store.schedule[key] || []
    const idx = list.indexOf(name)
    if (idx >= 0) {
      list.splice(idx, 1)
      if (list.length === 0) delete store.schedule[key]
      delete store.scheduleTime[`${key}|${name}`]
    }
    // 标记为已批准
    const item = store.cancelRequests.find(r => r.name === name && r.day === day && r.slotId === slotId)
    if (item) item.status = 'approved'
    // 从候补填补
    const filledBy = autoFillFromWaitlist(store, day, slotId)
    writeStore(store)
    const msg = filledBy
      ? `已批准取消，候补 ${filledBy} 已自动填入`
      : '已批准取消'
    res.json({ ok: true, schedule: store.schedule, cancelRequests: store.cancelRequests, filledBy })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 管理员：拒绝取消申请
app.post('/api/admin/cancel/reject', async (req, res) => {
  try {
    const { name, day, slotId } = req.body
    const store = readStore()
    const item = store.cancelRequests.find(r => r.name === name && r.day === day && r.slotId === slotId)
    if (item) item.status = 'rejected'
    writeStore(store)
    res.json({ ok: true, cancelRequests: store.cancelRequests })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 管理员：为成员分配班次
app.post('/api/admin/assign', async (req, res) => {
  try {
    const { name, day, slotId } = req.body
    if (!name || !day || !slotId) {
      return res.json({ ok: false, msg: '参数缺失' })
    }
    const store = readStore()
    if (!store.members.includes(name)) {
      return res.json({ ok: false, msg: '成员不存在' })
    }
    const key = `${day}|${slotId}`
    if (!store.schedule[key]) store.schedule[key] = []
    const list = store.schedule[key]
    if (list.includes(name)) {
      return res.json({ ok: false, msg: '该成员已在此班次' })
    }
    list.push(name)
    store.scheduleTime[`${key}|${name}`] = Date.now() // 记录选班时间（管理员分配）
    writeStore(store)
    res.json({ ok: true, schedule: store.schedule })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 管理员：移除成员班次
app.post('/api/admin/unassign', async (req, res) => {
  try {
    const { name, day, slotId } = req.body
    const store = readStore()
    const key = `${day}|${slotId}`
    const list = store.schedule[key] || []
    const idx = list.indexOf(name)
    if (idx >= 0) {
      list.splice(idx, 1)
      if (list.length === 0) delete store.schedule[key]
    }
    writeStore(store)
    res.json({ ok: true, schedule: store.schedule })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 管理员：批准候补（直接添加到排班，允许突破上限到3人）
app.post('/api/admin/waitlist/approve', async (req, res) => {
  try {
    const { name, day, slotId } = req.body
    const store = readStore()
    const key = `${day}|${slotId}`
    if (!store.schedule[key]) store.schedule[key] = []
    const list = store.schedule[key]
    // 管理员批准候补时，允许突破 maxPerSlot 限制（最多3人）
    if (list.length >= 3) {
      return res.json({ ok: false, msg: '该时段已有3人，无法继续添加' })
    }
    if (!list.includes(name)) list.push(name)
    store.scheduleTime[`${key}|${name}`] = Date.now()
    // 标记候补为已批准
    const item = store.waitlist.find(w => w.name === name && w.day === day && w.slotId === slotId)
    if (item) item.status = 'approved'
    writeStore(store)
    res.json({ ok: true, schedule: store.schedule, waitlist: store.waitlist })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 启动
app.listen(PORT, '0.0.0.0', () => {
  ensureMembers() // 启动时检查，自动恢复休眠前的成员名单
  console.log(`排班系统运行中: http://localhost:${PORT}`)
})
