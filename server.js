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
  members: [],
  schedule: {}
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
    const store = await readStore()
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
    const store = await readStore()
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
    const store = await readStore()
    res.json({
      timeSlots: store.timeSlots,
      days: store.days,
      maxPerSlot: store.maxPerSlot,
      schedule: store.schedule,
      members: store.members
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

    const store = await readStore()

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
      await writeStore(store)
      return res.json({ ok: true, action: 'removed', schedule: store.schedule })
    }

    if (list.length >= store.maxPerSlot) {
      return res.json({ ok: false, msg: `该时段已满（${store.maxPerSlot}/${store.maxPerSlot}）` })
    }

    list.push(name)
    await writeStore(store)
    res.json({ ok: true, action: 'added', schedule: store.schedule })
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
    const store = await readStore()
    const trimmed = name.trim()
    if (store.members.includes(trimmed)) {
      return res.json({ ok: false, msg: '该成员已存在' })
    }
    store.members.push(trimmed)
    await writeStore(store)
    res.json({ ok: true, members: store.members })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 管理员：删除成员
app.post('/api/admin/member/remove', async (req, res) => {
  try {
    const { name } = req.body
    const store = await readStore()
    const idx = store.members.indexOf(name)
    if (idx < 0) {
      return res.json({ ok: false, msg: '成员不存在' })
    }
    store.members.splice(idx, 1)
    for (const key of Object.keys(store.schedule)) {
      store.schedule[key] = store.schedule[key].filter(n => n !== name)
      if (store.schedule[key].length === 0) delete store.schedule[key]
    }
    await writeStore(store)
    res.json({ ok: true, members: store.members, schedule: store.schedule })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 管理员：重置排班
app.post('/api/admin/reset', async (req, res) => {
  try {
    const store = await readStore()
    store.schedule = {}
    await writeStore(store)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 管理员：获取所有成员
app.get('/api/admin/members', async (req, res) => {
  try {
    const store = await readStore()
    res.json({ members: store.members })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 启动
app.listen(PORT, '0.0.0.0', () => {
  console.log(`排班系统运行中: http://localhost:${PORT}`)
})
