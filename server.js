const express = require('express')
const path = require('path')

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
  members: [
    '赫敏然', '吴卓泓', '周子曦', '施金', '蔡心玥', '冯一诺', '刘锐曦', '罗璐', '周田', '张新源',
    '马衍茹', '邹绪扬', '熊卓然', '方悠', '黄畅锋', '孙歌瑶', '王梓豪', '姚雅洁', '陈宇涵', '彭德东', '王润橦'
  ],
  schedule: {},
  waitlist: [] // 候补名单: [{ name, day, slotId, time }]
}

function readStore() {
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
      maxPerSlot: store.maxPerSlot
    })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 登录验证
app.post('/api/login', async (req, res) => {
  try {
    const { name } = req.body
    if (!name || !name.trim()) {
      return res.json({ ok: false, msg: '请输入姓名' })
    }
    const store = readStore()
    const trimmed = name.trim()
    if (!store.members.includes(trimmed)) {
      return res.json({ ok: false, msg: '姓名不在名单中，请联系管理员添加' })
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
      waitlist: store.waitlist
    })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 选择/取消选择时段
app.post('/api/select', async (req, res) => {
  try {
    const { name, day, slotId } = req.body
    if (!name || !day || !slotId) {
      return res.json({ ok: false, msg: '参数缺失' })
    }

    const store = readStore()

    if (!store.members.includes(name)) {
      return res.json({ ok: false, msg: '用户不存在' })
    }

    const key = `${day}|${slotId}`
    if (!store.schedule[key]) {
      store.schedule[key] = []
    }

    const list = store.schedule[key]
    const idx = list.indexOf(name)

    if (idx >= 0) {
      list.splice(idx, 1)
      if (list.length === 0) delete store.schedule[key]
      writeStore(store)
      return res.json({ ok: true, action: 'removed', schedule: store.schedule })
    }

    if (list.length >= store.maxPerSlot) {
      return res.json({ ok: false, msg: `该时段已满（${store.maxPerSlot}/${store.maxPerSlot}），可申请候补` })
    }

    list.push(name)
    writeStore(store)
    res.json({ ok: true, action: 'added', schedule: store.schedule })
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

// 管理员：重置排班
app.post('/api/admin/reset', async (req, res) => {
  try {
    const store = readStore()
    store.schedule = {}
    store.waitlist = []
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
    // 从候补名单移除
    store.waitlist = store.waitlist.filter(w => !(w.name === name && w.day === day && w.slotId === slotId))
    writeStore(store)
    res.json({ ok: true, schedule: store.schedule, waitlist: store.waitlist })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 启动
app.listen(PORT, '0.0.0.0', () => {
  console.log(`排班系统运行中: http://localhost:${PORT}`)
})
