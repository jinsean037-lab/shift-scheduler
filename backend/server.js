const express = require('express')
const path = require('path')
const { MongoClient } = require('mongodb')

// ========== MongoDB 连接 ==========
const MONGO_URI = process.env.MONGO_URI || 'mongodb://1327446407_db_user:<db_password>@ac-1pkoj3t-shard-00-00.mdoh4fq.mongodb.net:27017,ac-1pkoj3t-shard-00-01.mdoh4fq.mongodb.net:27017,ac-1pkoj3t-shard-00-02.mdoh4fq.mongodb.net:27017/?ssl=true&replicaSet=atlas-fvozf6-shard-0&authSource=admin&appName=Cluster0'
const DB_NAME = 'shift-scheduler'
const COLLECTION_NAME = 'store'

let dbClient = null
let storeCollection = null

// ========== 默认成员数据（首次启动 / 数据库为空时使用）==========
const DEFAULT_MEMBERS = (process.env.DEFAULT_MEMBERS ||
  '赫敏然,吴卓泓,周子曦,施金,蔡心玥,冯一诺,刘锐曦,罗璐,周田,张新源,马衍茹,邹绪扬,熊卓然,方悠,黄畅锋,孙歌瑶,王梓豪,姚雅洁,陈宇涵,彭德东,王润橦').split(',')

const DEFAULT_PASSWORDS = {
  '赫敏然': '77893457', '吴卓泓': '85630183', '周子曦': '65103265', '施金': '81621329', '蔡心玥': '85481151',
  '冯一诺': '88137988', '刘锐曦': '82034008', '罗璐': '76813401', '周田': '65989126', '张新源': '58175831',
  '马衍茹': '91998599', '邹绪扬': '29822335', '熊卓然': '85197554', '方悠': '58101585', '黄畅锋': '15470436',
  '孙歌瑶': '81680381', '王梓豪': '49907581', '姚雅洁': '35122532', '陈宇涵': '07342267', '彭德东': '62375667',
  '王润橦': '11176906'
}

// 默认 store 结构
function defaultStore() {
  return {
    timeSlots: [
      { id: 'am1', label: '8:00-10:00', period: '上午' },
      { id: 'am2', label: '10:00-12:00', period: '上午' },
      { id: 'pm1', label: '14:30-16:00', period: '下午' },
      { id: 'pm2', label: '16:00-17:30', period: '下午' }
    ],
    days: ['周一', '周二', '周三', '周四', '周五'],
    maxPerSlot: 2,
    startTime: null,
    members: [...DEFAULT_MEMBERS],
    passwords: { ...DEFAULT_PASSWORDS },
    schedule: {},
    scheduleTime: {},
    waitlist: [],
    cancelRequests: []
  }
}

// ========== MongoDB 操作 ==========

async function connectMongo() {
  // 如果 URI 是占位符，跳过 MongoDB
  if (MONGO_URI.includes('<db_password>')) {
    console.log('[mongo] URI 为占位符，跳过 MongoDB');
    return false;
  }
  if (dbClient) return true
  try {
    console.log('[mongo] 正在连接...')
    dbClient = new MongoClient(MONGO_URI)
    await dbClient.connect()
    const db = dbClient.db(DB_NAME)
    storeCollection = db.collection(COLLECTION_NAME)

    // 确保有一条文档存在
    const existing = await storeCollection.findOne({})
    if (!existing) {
      const initial = defaultStore()
      initial._id = 'singleton'
      await storeCollection.insertOne(initial)
      console.log('[mongo] 已创建初始数据')
    }

    console.log('[mongo] 连接成功 ✅')
    return true
  } catch (e) {
    console.error('[mongo] 连接失败:', e.message)
    dbClient = null
    storeCollection = null
    return false
  }
}

async function readStore() {
  if (!storeCollection) return defaultStore()
  try {
    const doc = await storeCollection.findOne({ _id: 'singleton' })
    if (!doc) return defaultStore()
    // 合并默认值 + 数据库数据
    const result = defaultStore()
    Object.assign(result, doc)
    // 确保密码表完整
    result.passwords = { ...DEFAULT_PASSWORDS, ...(result.passwords || {}) }
    delete result._id
    return result
  } catch (e) {
    console.error('[mongo] readStore 失败:', e.message)
    return defaultStore()
  }
}

async function writeStore(data) {
  if (!storeCollection) return
  try {
    await storeCollection.updateOne(
      { _id: 'singleton' },
      { $set: data }
    )
  } catch (e) {
    console.error('[mongo] writeStore 失败:', e.message)
  }
}


// ========== 文件持久化（MongoDB 不可用时的 fallback）==========
const fs = require('fs');
const STORE_FILE = require('path').join(__dirname, 'data', 'store.json');
let useFileFallback = false;
let localStore = null;

function loadFromFile() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, 'utf8');
      localStore = JSON.parse(raw);
      // 合并 DEFAULT_MEMBERS
      if (localStore.members && Array.isArray(localStore.members)) {
        DEFAULT_MEMBERS.forEach(m => {
          if (!localStore.members.includes(m)) localStore.members.push(m);
        });
      }
      console.log('[file] 已从', STORE_FILE, '加载数据');
    } else {
      localStore = getDefaultStore();
      saveToFile();
    }
  } catch (e) {
    console.error('[file] loadFromFile 失败:', e.message);
    localStore = getDefaultStore();
  }
}

function saveToFile() {
  try {
    const dir = require('path').dirname(STORE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(STORE_FILE, JSON.stringify(localStore, null, 2), 'utf8');
  } catch (e) {
    console.error('[file] saveToFile 失败:', e.message);
  }
}

function getDefaultStore() {
  return {
    startTime: null,
    maxPerSlot: 2,
    schedule: {
      '周一': { am1:[], am2:[], pm1:[], pm2:[] },
      '周二': { am1:[], am2:[], pm1:[], pm2:[] },
      '周三': { am1:[], am2:[], pm1:[], pm2:[] },
      '周四': { am1:[], am2:[], pm1:[], pm2:[] },
      '周五': { am1:[], am2:[], pm1:[], pm2:[] }
    },
    passwords: {},
    members: [...DEFAULT_MEMBERS]
  };
}

function ensureMembers() {
  if (!localStore) localStore = getDefaultStore();
  if (!localStore.members) localStore.members = [...DEFAULT_MEMBERS];
  DEFAULT_MEMBERS.forEach(m => {
    if (!localStore.members.includes(m)) localStore.members.push(m);
  });
  // 自动生成默认密码
  if (!localStore.passwords) localStore.passwords = {};
  localStore.members.forEach(m => {
    if (!localStore.passwords[m]) localStore.passwords[m] = String(Math.floor(10000000 + Math.random()*90000000));
  });
  saveToFile();
}


// ========== Express 应用 ==========
const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// ========== 检查是否在排班开始时间前 ==========
function isBeforeStartTime(store) {
  if (!store.startTime) return false
  const startDate = new Date(store.startTime)
  const nowBeijingMs = Date.now() + 8 * 60 * 60 * 1000
  return nowBeijingMs < startDate.getTime()
}

// ========== API 路由 ==========

// 获取配置
app.get('/api/config', async (req, res) => {
  try {
    const store = await readStore()
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
    const store = await readStore()
    res.json({ startTime: store.startTime })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 管理员：设置开始时间
app.post('/api/admin/start-time', async (req, res) => {
  try {
    const { startTime } = req.body
    const store = await readStore()
    store.startTime = startTime || null
    await writeStore({ startTime: store.startTime })
    res.json({ ok: true, startTime: store.startTime })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 登录验证（姓名+密码）
app.post('/api/login', async (req, res) => {
  try {
    const { name, password } = req.body
    if (!name || !name.trim()) return res.json({ ok: false, msg: '请输入姓名' })
    if (!password || !password.trim()) return res.json({ ok: false, msg: '请输入密码' })
    const store = await readStore()
    const trimmed = name.trim()
    if (!store.members.includes(trimmed)) {
      return res.json({ ok: false, msg: '姓名不在名单中，请联系管理员添加' })
    }
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
    const store = await readStore()
    // 统一转换为嵌套格式 { '周一':{am1:[...],am2:[...]}, ... }
    const raw = store.schedule || {}
    const days = ['周一','周二','周三','周四','周五']
    const slotIds = ['am1','am2','pm1','pm2']
    const schedule = {}
    for (const d of days) {
      schedule[d] = {}
      for (const s of slotIds) {
        // 优先读嵌套格式
        if (raw[d] && Array.isArray(raw[d][s])) {
          schedule[d][s] = raw[d][s]
        } else {
          // 兼容扁平格式
          const flatKey = `${d}|${s}`
          schedule[d][s] = Array.isArray(raw[flatKey]) ? raw[flatKey] : []
        }
      }
    }
    res.json({
      timeSlots: store.timeSlots || defaultStore().timeSlots,
      days: store.days || defaultStore().days,
      maxPerSlot: store.maxPerSlot || 2,
      schedule,
      members: store.members,
      waitlist: store.waitlist || [],
      cancelRequests: store.cancelRequests || [],
      startTime: store.startTime
    })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 选择时段
app.post('/api/select', async (req, res) => {
  try {
    const { name, day, slotId } = req.body
    const slot = slotId || req.body.slot
    if (!name || !day || !slot) return res.json({ ok: false, msg: '参数缺失' })
    const store = await readStore()
    if (isBeforeStartTime(store)) {
      return res.json({ ok: false, msg: '排班尚未开始，请等待管理员设置开始时间' })
    }
    if (!store.members.includes(name)) return res.json({ ok: false, msg: '用户不存在' })
    // 统一使用嵌套格式
    if (!store.schedule[day]) store.schedule[day] = {}
    if (!store.schedule[day][slot]) store.schedule[day][slot] = []
    const list = store.schedule[day][slot]
    if (list.includes(name)) return res.json({ ok: true, action: 'none', schedule: store.schedule, msg: '已选择该时段' })
    if (list.length >= store.maxPerSlot) {
      return res.json({ ok: false, msg: `该时段已满（${store.maxPerSlot}/${store.maxPerSlot}），可申请候补` })
    }
    list.push(name)
    store.scheduleTime[`${day}|${slot}|${name}`] = Date.now()
    await writeStore({ schedule: store.schedule, scheduleTime: store.scheduleTime })
    res.json({ ok: true, action: 'added', schedule: store.schedule })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 自动候补填补
function autoFillFromWaitlist(store, day, slotId) {
  const key = `${day}|${slotId}`
  if (!store.schedule[key]) store.schedule[key] = []
  const list = store.schedule[key]
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

// 申请取消班次
app.post('/api/cancel-request', async (req, res) => {
  try {
    const { name, day, slotId, reason } = req.body
    if (!name || !day || !slotId) return res.json({ ok: false, msg: '参数缺失' })
    const store = await readStore()
    // 兼容嵌套格式和扁平格式
    let list = null
    let key = ''
    // 嵌套格式: schedule[day][slotId]
    if (store.schedule[day] && Array.isArray(store.schedule[day][slotId])) {
      list = store.schedule[day][slotId]
      key = `${day}|${slotId}`
    }
    // 扁平格式: schedule[day|slotId]
    if (!list && Array.isArray(store.schedule[`${day}|${slotId}`])) {
      list = store.schedule[`${day}|${slotId}`]
      key = `${day}|${slotId}`
    }
    if (!list || !list.includes(name)) return res.json({ ok: false, msg: '你不在该班次中' })

    const exists = store.cancelRequests.find(r => r.name === name && r.day === day && r.slotId === slotId && r.status === 'pending')
    if (exists) return res.json({ ok: false, msg: '已提交取消申请' })

    const entryTime = store.scheduleTime[`${key}|${name}`]
    if (entryTime) {
      const elapsed = Date.now() - entryTime
      if (elapsed <= 3 * 60 * 1000) {
        // 3分钟内：直接取消 + 自动候补填补
        const idx = list.indexOf(name)
        if (idx >= 0) list.splice(idx, 1)
        if (list.length === 0) {
          // 兼容嵌套和扁平格式删除
          if (store.schedule[day] && store.schedule[day][slotId] !== undefined) {
            delete store.schedule[day][slotId]
          } else {
            delete store.schedule[key]
          }
        }
        delete store.scheduleTime[`${key}|${name}`]
        const filledBy = autoFillFromWaitlist(store, day, slotId)
        await writeStore({
          schedule: store.schedule,
          scheduleTime: store.scheduleTime,
          waitlist: store.waitlist,
          cancelRequests: store.cancelRequests
        })
        const msg = filledBy ? `已取消（3分钟内），空位已自动填补候补人员 ${filledBy}` : '已取消（3分钟内）'
        return res.json({ ok: true, action: 'auto-cancelled', msg })
      }
    }

    store.cancelRequests.push({ name, day, slotId, reason: reason || '', time: new Date().toISOString(), status: 'pending' })
    await writeStore({ cancelRequests: store.cancelRequests })
    res.json({ ok: true, action: 'applied', msg: '取消申请已提交，等待管理员审批' })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 取消取消申请
app.post('/api/cancel-request/revoke', async (req, res) => {
  try {
    const { name, day, slotId } = req.body
    const store = await readStore()
    const idx = store.cancelRequests.findIndex(r => r.name === name && r.day === day && r.slotId === slotId)
    if (idx >= 0) store.cancelRequests.splice(idx, 1)
    await writeStore({ cancelRequests: store.cancelRequests })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 申请候补
app.post('/api/waitlist', async (req, res) => {
  try {
    const { name, day, slotId } = req.body
    if (!name || !day || !slotId) return res.json({ ok: false, msg: '参数缺失' })
    const store = await readStore()
    if (isBeforeStartTime(store)) return res.json({ ok: false, msg: '排班尚未开始，请等待管理员设置开始时间' })
    if (!store.members.includes(name)) return res.json({ ok: false, msg: '用户不存在' })
    const exists = store.waitlist.find(w => w.name === name && w.day === day && w.slotId === slotId)
    if (exists) return res.json({ ok: false, msg: '已在候补名单中' })
    store.waitlist.push({ name, day, slotId, time: new Date().toISOString() })
    await writeStore({ waitlist: store.waitlist })
    res.json({ ok: true, msg: '候补申请已提交' })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 取消候补
app.post('/api/waitlist/cancel', async (req, res) => {
  try {
    const { name, day, slotId } = req.body
    const store = await readStore()
    const idx = store.waitlist.findIndex(w => w.name === name && w.day === day && w.slotId === slotId)
    if (idx >= 0) store.waitlist.splice(idx, 1)
    await writeStore({ waitlist: store.waitlist })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 管理员验证
const ADMIN_PASSWORD = 'admin123'
app.post('/api/admin/login', async (req, res) => {
  try {
    const { password } = req.body
    if (password === ADMIN_PASSWORD) res.json({ ok: true, isAdmin: true })
    else res.json({ ok: false, msg: '密码错误' })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 管理员：添加成员
app.post('/api/admin/member', async (req, res) => {
  try {
    const { name } = req.body
    if (!name || !name.trim()) return res.json({ ok: false, msg: '请输入姓名' })
    const store = await readStore()
    const trimmed = name.trim()
    if (store.members.includes(trimmed)) return res.json({ ok: false, msg: '该成员已存在' })
    store.members.push(trimmed)
    await writeStore({ members: store.members })
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
    if (idx < 0) return res.json({ ok: false, msg: '成员不存在' })
    store.members.splice(idx, 1)
    for (const key of Object.keys(store.schedule)) {
      store.schedule[key] = store.schedule[key].filter(n => n !== name)
      if (store.schedule[key].length === 0) delete store.schedule[key]
    }
    store.waitlist = store.waitlist.filter(w => w.name !== name)
    await writeStore({ members: store.members, schedule: store.schedule, waitlist: store.waitlist })
    res.json({ ok: true, members: store.members, schedule: store.schedule })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 管理员：重置排班
app.post('/api/admin/reset', async (req, res) => {
  try {
    await writeStore({ schedule: {}, waitlist: [], cancelRequests: [] })
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

// 管理员：获取候补名单
app.get('/api/admin/waitlist', async (req, res) => {
  try {
    const store = await readStore()
    res.json({ waitlist: store.waitlist })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 管理员：获取取消申请
app.get('/api/admin/cancel-requests', async (req, res) => {
  try {
    const store = await readStore()
    res.json({ cancelRequests: store.cancelRequests || [] })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 管理员：拒绝候补
app.post('/api/admin/waitlist/reject', async (req, res) => {
  try {
    const { name, day, slotId } = req.body
    const store = await readStore()
    const item = store.waitlist.find(w => w.name === name && w.day === day && w.slotId === slotId)
    if (item) item.status = 'rejected'
    await writeStore({ waitlist: store.waitlist })
    res.json({ ok: true, waitlist: store.waitlist })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 批准取消：移除当事人 + 候补填补
app.post('/api/admin/cancel/approve', async (req, res) => {
  try {
    const { name, day, slotId } = req.body
    const store = await readStore()
    const key = `${day}|${slotId}`
    const list = store.schedule[key] || []
    const idx = list.indexOf(name)
    if (idx >= 0) {
      list.splice(idx, 1)
      if (list.length === 0) delete store.schedule[key]
      delete store.scheduleTime[`${key}|${name}`]
    }
    const item = store.cancelRequests.find(r => r.name === name && r.day === day && r.slotId === slotId)
    if (item) item.status = 'approved'
    const filledBy = autoFillFromWaitlist(store, day, slotId)
    await writeStore({
      schedule: store.schedule,
      scheduleTime: store.scheduleTime,
      cancelRequests: store.cancelRequests,
      waitlist: store.waitlist
    })
    const msg = filledBy ? `已批准取消，候补 ${filledBy} 已自动填入` : '已批准取消'
    res.json({ ok: true, schedule: store.schedule, cancelRequests: store.cancelRequests, filledBy })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 管理员：拒绝取消申请
app.post('/api/admin/cancel/reject', async (req, res) => {
  try {
    const { name, day, slotId } = req.body
    const store = await readStore()
    const item = store.cancelRequests.find(r => r.name === name && r.day === day && r.slotId === slotId)
    if (item) item.status = 'rejected'
    await writeStore({ cancelRequests: store.cancelRequests })
    res.json({ ok: true, cancelRequests: store.cancelRequests })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 管理员：为成员分配班次
app.post('/api/admin/assign', async (req, res) => {
  try {
    const { name, day, slotId } = req.body
    if (!name || !day || !slotId) return res.json({ ok: false, msg: '参数缺失' })
    const store = await readStore()
    if (!store.members.includes(name)) return res.json({ ok: false, msg: '成员不存在' })
    const key = `${day}|${slotId}`
    if (!store.schedule[key]) store.schedule[key] = []
    const list = store.schedule[key]
    if (list.includes(name)) return res.json({ ok: false, msg: '该成员已在此班次' })
    list.push(name)
    store.scheduleTime[`${key}|${name}`] = Date.now()
    await writeStore({ schedule: store.schedule, scheduleTime: store.scheduleTime })
    res.json({ ok: true, schedule: store.schedule })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 管理员：移除成员班次
app.post('/api/admin/unassign', async (req, res) => {
  try {
    const { name, day, slotId } = req.body
    const store = await readStore()
    const key = `${day}|${slotId}`
    const list = store.schedule[key] || []
    const idx = list.indexOf(name)
    if (idx >= 0) {
      list.splice(idx, 1)
      if (list.length === 0) delete store.schedule[key]
    }
    await writeStore({ schedule: store.schedule })
    res.json({ ok: true, schedule: store.schedule })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 管理员：批准候补
app.post('/api/admin/waitlist/approve', async (req, res) => {
  try {
    const { name, day, slotId } = req.body
    const store = await readStore()
    const key = `${day}|${slotId}`
    if (!store.schedule[key]) store.schedule[key] = []
    const list = store.schedule[key]
    if (list.length >= 3) return res.json({ ok: false, msg: '该时段已有3人，无法继续添加' })
    if (!list.includes(name)) list.push(name)
    store.scheduleTime[`${key}|${name}`] = Date.now()
    const item = store.waitlist.find(w => w.name === name && w.day === day && w.slotId === slotId)
    if (item) item.status = 'approved'
    await writeStore({ schedule: store.schedule, scheduleTime: store.scheduleTime, waitlist: store.waitlist })
    res.json({ ok: true, schedule: store.schedule, waitlist: store.waitlist })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})


// ========== 密码管理 ==========

// 成员修改自己的密码
app.post('/api/change-password', async (req, res) => {
  try {
    const { name, oldPassword, newPassword } = req.body
    if (!name || !oldPassword || !newPassword) return res.json({ ok: false, msg: '参数缺失' })
    if (newPassword.length < 6) return res.json({ ok: false, msg: '新密码至少6位' })
    const store = await readStore()
    if (store.passwords[name] !== oldPassword) return res.json({ ok: false, msg: '原密码错误' })
    store.passwords[name] = newPassword
    await writeStore({ passwords: store.passwords })
    res.json({ ok: true, msg: '密码修改成功' })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 管理员：查看所有成员密码
app.get('/api/admin/passwords', async (req, res) => {
  try {
    const store = await readStore()
    res.json({ passwords: store.passwords || {} })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 管理员：重置成员密码
app.post('/api/admin/reset-password', async (req, res) => {
  try {
    const { name, newPassword } = req.body
    if (!name) return res.json({ ok: false, msg: '缺少姓名' })
    if (!newPassword || newPassword.length < 6) return res.json({ ok: false, msg: '新密码至少6位' })
    const store = await readStore()
    if (!store.members.includes(name)) return res.json({ ok: false, msg: '成员不存在' })
    store.passwords[name] = newPassword
    await writeStore({ passwords: store.passwords })
    res.json({ ok: true, passwords: store.passwords, msg: `已重置 ${name} 的密码` })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})


// ========== 启动 ==========
// ========== 前端兼容路由（适配旧版前端 API 调用）==========

// 兼容: GET /api/my-shifts?name=xxx
app.get('/api/my-shifts', async (req, res) => {
  try {
    const name = req.query.name
    if (!name) return res.json({ shifts: [], waitlist: [] })
    const store = await readStore()
    const shifts = []
    // 优先嵌套格式: { '周一':{am1:[...],am2:[...]}, ... }
    const sched = store.schedule || {}
    for (const day of ['周一','周二','周三','周四','周五']) {
      const dayData = sched[day]
      if (dayData && typeof dayData === 'object') {
        for (const slotId of ['am1','am2','pm1','pm2']) {
          if (Array.isArray(dayData[slotId]) && dayData[slotId].includes(name)) {
            const slotInfo = (store.timeSlots || defaultStore().timeSlots).find(t => t.id === slotId)
            shifts.push({ day, slot: slotId, slotLabel: slotInfo ? slotInfo.label : slotId })
          }
        }
      }
    }
    // 兼容扁平格式: { '周一|am1':[...] }
    for (const key of Object.keys(sched)) {
      if (key.includes('|')) {
        const [day, slotId] = key.split('|')
        const names = sched[key]
        if (Array.isArray(names) && names.includes(name) && !shifts.find(s => s.day === day && s.slot === slotId)) {
          const slotInfo = (store.timeSlots || defaultStore().timeSlots).find(t => t.id === slotId)
          shifts.push({ day, slot: slotId, slotLabel: slotInfo ? slotInfo.label : slotId })
        }
      }
    }
    const wl = (store.waitlist || []).filter(w => w.name === name)
    res.json({ shifts, waitlist: wl })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 兼容: POST /api/cancel（直接取消）
app.post('/api/cancel', async (req, res) => {
  try {
    const { name, day, slot } = req.body
    if (!name || !day || !slot) return res.json({ ok: false, msg: '参数缺失' })
    const store = await readStore()
    // 嵌套格式
    const list = (store.schedule[day] && store.schedule[day][slot]) || []
    if (!list.includes(name)) return res.json({ ok: false, msg: '你不在该班次中' })
    const idx = list.indexOf(name)
    if (idx >= 0) list.splice(idx, 1)
    autoFillFromWaitlist(store, day, slot)
    await writeStore({ schedule: store.schedule, scheduleTime: store.scheduleTime, waitlist: store.waitlist })
    res.json({ ok: true, msg: '已取消' })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 兼容: POST /api/cancel-waitlist
app.post('/api/cancel-waitlist', async (req, res) => {
  try {
    const { name, day, slot } = req.body
    const store = await readStore()
    const idx = (store.waitlist || []).findIndex(w => w.name === name && w.day === day && (w.slotId === slot || w.slot === slot))
    if (idx >= 0) store.waitlist.splice(idx, 1)
    await writeStore({ waitlist: store.waitlist })
    res.json({ ok: true, msg: '已退出候补' })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

async function start() {
  const connected = await connectMongo()
  if (!connected) {
    console.log('[warn] MongoDB 连接失败，回退到文件存储模式')
    useFileFallback = true
    loadFromFile()
    ensureMembers()
    console.log(`[db] 文件持久化已启用 (data/store.json)`)
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`排班系统运行中: http://localhost:${PORT}`)
    if (!useFileFallback) console.log(`[db] MongoDB 持久化已启用`)
  })
}

start().catch(e => {
  console.error('[fatal] 启动失败:', e.message)
  process.exit(1)
})
