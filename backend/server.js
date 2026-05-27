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
    scheduleStart: null,
    scheduleEnd: null,
    members: [...DEFAULT_MEMBERS],
    passwords: { ...DEFAULT_PASSWORDS },
    schedule: {},
    scheduleTime: {},
    waitlist: [],
    cancelRequests: [],
    checkins: [],
    overtimes: [],
    confirmedPeriods: []
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
  // 文件存储模式
  if (useFileFallback) {
    if (!localStore) {
      loadFromFile()
    }
    // 合并默认值，确保所有字段存在（scheduleTime, waitlist, cancelRequests 等）
    return Object.assign(defaultStore(), localStore || {})
  }
  if (!storeCollection) return defaultStore()
  try {
    const doc = await storeCollection.findOne({ _id: 'singleton' })
    if (!doc) return defaultStore()
    const result = defaultStore()
    Object.assign(result, doc)
    result.passwords = { ...DEFAULT_PASSWORDS, ...(result.passwords || {}) }
    delete result._id
    return result
  } catch (e) {
    console.error('[mongo] readStore 失败:', e.message)
    return defaultStore()
  }
}

async function writeStore(data) {
  // 文件存储模式
  if (useFileFallback && localStore) {
    Object.assign(localStore, data);
    saveToFile();
    return;
  }
  if (!storeCollection) return;
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
    scheduleStart: null,
    scheduleEnd: null,
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
      scheduleStart: store.scheduleStart,
      scheduleEnd: store.scheduleEnd,
      confirmed: !!(store.scheduleStart && store.scheduleEnd),
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

// 排班确认（设置起止时间，归档当前排班）
app.post('/api/admin/schedule-confirm', async (req, res) => {
  try {
    const { scheduleStart, scheduleEnd } = req.body
    const store = await readStore()
    
    // 如果有当前排班数据，先归档到历史（只要有数据就归档，不管之前有没有设置过时间）
    // 注意：这里用 req.body 里的 scheduleStart/scheduleEnd，而不是 store 里的旧值
    // 因为 store.scheduleStart 在首次确认时可能是 null
    if (store.schedule && Object.keys(store.schedule).length > 0) {
      if (!store.confirmedPeriods) store.confirmedPeriods = []
      store.confirmedPeriods.push({
        start: scheduleStart || store.scheduleStart || new Date().toISOString().slice(0, 10),
        end: scheduleEnd || store.scheduleEnd || new Date().toISOString().slice(0, 10),
        schedule: JSON.parse(JSON.stringify(store.schedule)),
        confirmedAt: new Date().toISOString()
      })
    }
    
    // 设置新的排班周期
    store.scheduleStart = scheduleStart || null
    store.scheduleEnd = scheduleEnd || null
    // 确认后排班数据保留（前端通过 confirmedPeriods 判断只读模式）
    // 不清空 schedule，不清空 waitlist/cancelRequests（保留完整记录）
    
    await writeStore(store)
    res.json({ ok: true, scheduleStart: store.scheduleStart, scheduleEnd: store.scheduleEnd, confirmedPeriods: store.confirmedPeriods })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 管理员：开始新一轮排班（归档当前+清空草稿）
app.post('/api/admin/schedule-archive', async (req, res) => {
  try {
    const store = await readStore()
    // 归档当前排班
    if (store.schedule && Object.keys(store.schedule).length > 0) {
      if (!store.confirmedPeriods) store.confirmedPeriods = []
      store.confirmedPeriods.push({
        start: store.scheduleStart || new Date().toISOString().slice(0, 10),
        end: store.scheduleEnd || new Date().toISOString().slice(0, 10),
        schedule: JSON.parse(JSON.stringify(store.schedule)),
        confirmedAt: new Date().toISOString()
      })
    }
    // 清空草稿
    store.schedule = {}
    store.scheduleTime = {}
    store.waitlist = []
    store.cancelRequests = []
    store.scheduleStart = null
    store.scheduleEnd = null
    await writeStore(store)
    res.json({ ok: true })
  } catch (e) {
    console.error('archive error:', e)
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
    // 已确认的排班表不允许再选班（定格锁定）
    if (store.scheduleStart && store.scheduleEnd) {
      return res.json({ ok: false, msg: '当前排班表已确认生效，暂不可修改。请联系管理员重置后排班。' })
    }
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
  // 兼容嵌套格式和扁平格式
  let list = null
  if (store.schedule[day] && Array.isArray(store.schedule[day][slotId])) {
    list = store.schedule[day][slotId]
  } else if (Array.isArray(store.schedule[`${day}|${slotId}`])) {
    list = store.schedule[`${day}|${slotId}`]
  }
  if (!list) return null
  const pending = store.waitlist
    .filter(w => w.day === day && w.slotId === slotId && (!w.status || w.status === 'pending'))
    .sort((a, b) => new Date(a.time) - new Date(b.time))
  if (pending.length > 0 && !list.includes(pending[0].name)) {
    list.push(pending[0].name)
    const key = `${day}|${slotId}`
    store.scheduleTime[`${key}|${pending[0].name}`] = Date.now()
    pending[0].status = 'auto-approved'
    return pending[0].name
  }
  return null
}

// 检查是否可3分钟内直接取消（不需要原因）
app.post('/api/check-cancel-time', async (req, res) => {
  try {
    const { name, day, slotId } = req.body
    if (!name || !day || !slotId) return res.json({ canDirectCancel: false })
    const store = await readStore()
    let list = null
    let key = ''
    if (store.schedule[day] && Array.isArray(store.schedule[day][slotId])) {
      list = store.schedule[day][slotId]
      key = `${day}|${slotId}`
    }
    if (!list && Array.isArray(store.schedule[`${day}|${slotId}`])) {
      list = store.schedule[`${day}|${slotId}`]
      key = `${day}|${slotId}`
    }
    if (!list || !list.includes(name)) return res.json({ canDirectCancel: false })
    const entryTime = store.scheduleTime[`${key}|${name}`]
    if (entryTime) {
      const elapsed = Date.now() - entryTime
      return res.json({ canDirectCancel: elapsed <= 3 * 60 * 1000 })
    }
    return res.json({ canDirectCancel: false })
  } catch(e) { res.json({ canDirectCancel: false }) }
})

// 申请取消班次
app.post('/api/cancel-request', async (req, res) => {
  try {
    const { name, day, slotId, reason } = req.body
    if (!name || !day || !slotId) return res.json({ ok: false, msg: '参数缺失' })
    const store = await readStore()
    // 已确认的排班表不允许取消
    if (store.scheduleStart && store.scheduleEnd) {
      return res.json({ ok: false, msg: '当前排班表已确认生效，暂不可取消。请联系管理员。' })
    }
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

// 管理员：重置排班（只清空当前草稿，不影响已确认的历史排班）
app.post('/api/admin/reset', async (req, res) => {
  try {
    const store = await readStore()
    store.schedule = {}
    store.scheduleTime = {}
    store.waitlist = []
    store.cancelRequests = []
    store.confirmedPeriods = []
    store.scheduleStart = null
    store.scheduleEnd = null
    await writeStore(store)
    res.json({ ok: true })
  } catch (e) {
    console.error('reset error:', e)
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
    // 嵌套格式: schedule[day][slotId]
    const daySchedule = store.schedule[day] || {}
    const list = daySchedule[slotId] || []
    const idx = list.indexOf(name)
    if (idx >= 0) {
      list.splice(idx, 1)
      if (list.length === 0) delete daySchedule[slotId]
      delete store.scheduleTime[`${day}|${slotId}|${name}`]
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
    // 使用嵌套格式
    if (!store.schedule[day]) store.schedule[day] = {}
    if (!store.schedule[day][slotId]) store.schedule[day][slotId] = []
    const list = store.schedule[day][slotId]
    if (list.length >= 3) return res.json({ ok: false, msg: '该时段已有3人，无法继续添加' })
    if (!list.includes(name)) list.push(name)
    store.scheduleTime[`${day}|${slotId}|${name}`] = Date.now()
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

// 获取所有排班数据（当前草稿 + 历史归档）
app.get('/api/schedule-all', async (req, res) => {
  try {
    const store = await readStore()
    res.json({
      current: {
        start: store.scheduleStart,
        end: store.scheduleEnd,
        schedule: store.schedule
      },
      confirmedPeriods: store.confirmedPeriods || [],
      scheduleTime: store.scheduleTime
    })
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
    const cr = (store.cancelRequests || []).filter(r => r.name === name)
    res.json({ shifts, waitlist: wl, cancelRequests: cr })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// ========== 打卡功能 (v4.0) ==========

// 班次时间窗口（北京时间，±15分钟）
const SLOT_WINDOWS = {
  am1: { start: '07:45', end: '10:15' },
  am2: { start: '09:45', end: '12:15' },
  pm1: { start: '14:15', end: '16:15' },
  pm2: { start: '15:45', end: '17:45' }
}

// 打卡地点围栏（中山大学南校园岭南行政中心）
const CHECKIN_LOCATION = {
  name: '岭南行政中心（中山大学南校园）',
  lat: 23.0948,
  lng: 113.2997,
  radius: 100 // 米
}

// 计算两个经纬度之间的球面距离（Haversine公式，返回米）
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000 // 地球半径（米）
  const toRad = d => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  return R * c
}

// 获取北京时间的 HH:MM 字符串
function getBeijingTimeHHMM() {
  const now = new Date()
  // 北京时间 = UTC+8
  const beijingMs = now.getTime() + 8 * 3600 * 1000
  const beijing = new Date(beijingMs)
  return beijing.toISOString().slice(11, 16)
}

// 获取用户今天所有可打卡班次（在时间窗口内的）
function getTodaySlots(store, name) {
  const schedule = store.schedule || {}
  const todayWeekday = ['周日','周一','周二','周三','周四','周五','周六'][new Date().getDay()]
  const daySchedule = schedule[todayWeekday]
  if (!daySchedule) return []
  const nowHHMM = getBeijingTimeHHMM()
  const result = []
  for (const [slotId, members] of Object.entries(daySchedule)) {
    if (Array.isArray(members) && members.includes(name)) {
      const win = SLOT_WINDOWS[slotId]
      if (win && nowHHMM >= win.start && nowHHMM <= win.end) {
        result.push({ slotId, ...win })
      }
    }
  }
  return result
}

// POST /api/checkin — 签到（必须在排班时间窗口内）
app.post('/api/checkin', async (req, res) => {
  try {
    const { name, lat, lng } = req.body
    if (!name) return res.json({ ok: false, msg: '参数缺失' })
    const store = await readStore()
    const now = new Date()
    const today = now.toISOString().slice(0, 10)
    // 检查今天是否已有未签退的签到
    const pendingIn = (store.checkins || []).find(c => c.name === name && c.date === today && c.type === 'in'
      && !(store.checkins || []).find(o => o.name === name && o.date === today && o.type === 'out'))
    if (pendingIn) return res.json({ ok: false, msg: '当前处于值班中状态，请先签退后再签到下一班次' })
    // 检查是否在排班时间窗口内（北京时间）
    const slots = getTodaySlots(store, name)
    if (slots.length === 0) return res.json({ ok: false, msg: '当前不在你的值班时间段内（需在班次前后15分钟内），无法打卡' })
    // 地点围栏校验
    if (lat != null && lng != null) {
      const dist = haversineDistance(lat, lng, CHECKIN_LOCATION.lat, CHECKIN_LOCATION.lng)
      if (dist > CHECKIN_LOCATION.radius) {
        return res.json({ ok: false, msg: `打卡失败：你不在${CHECKIN_LOCATION.name}附近（距离${Math.round(dist)}米，需在${CHECKIN_LOCATION.radius}米内）` })
      }
    } else {
      return res.json({ ok: false, msg: '无法获取你的位置，请在岭南行政中心附近重新尝试并允许定位' })
    }

    const record = { name, date: today, time: now.toISOString(), type: 'in', slotId: slots[0].slotId, lat: lat || null, lng: lng || null }
    const checkins = store.checkins || []
    checkins.push(record)
    await writeStore({ checkins })
    res.json({ ok: true, msg: '签到成功', record, slotLabel: slots[0].slotId })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// POST /api/checkout — 签退（需在时间窗口内）
app.post('/api/checkout', async (req, res) => {
  try {
    const { name, lat, lng } = req.body
    if (!name) return res.json({ ok: false, msg: '参数缺失' })
    const store = await readStore()
    const now = new Date()
    const today = now.toISOString().slice(0, 10)
    // 找到最近一次未签退的签到记录
    const allIns = (store.checkins || []).filter(c => c.name === name && c.date === today && c.type === 'in').sort((a,b)=>b.time.localeCompare(a.time))
    let checkinRecord = null
    for (const inRec of allIns) {
      const hasOut = (store.checkins || []).find(c => c.name === name && c.date === today && c.type === 'out' && new Date(c.time) > new Date(inRec.time))
      if (!hasOut) { checkinRecord = inRec; break; }
    }
    if (!checkinRecord) return res.json({ ok: false, msg: '请先签到' })
    // 检查是否仍在时间窗口内（北京时间）
    const slotWin = SLOT_WINDOWS[checkinRecord.slotId]
    const nowHHMM = getBeijingTimeHHMM()
    if (slotWin && (nowHHMM < slotWin.start || nowHHMM > slotWin.end)) {
      return res.json({ ok: false, msg: '已超出该班次打卡时间窗口（前后15分钟），无法签退' })
    }
    // 地点围栏校验
    if (lat != null && lng != null) {
      const dist = haversineDistance(lat, lng, CHECKIN_LOCATION.lat, CHECKIN_LOCATION.lng)
      if (dist > CHECKIN_LOCATION.radius) {
        return res.json({ ok: false, msg: `打卡失败：你不在${CHECKIN_LOCATION.name}附近（距离${Math.round(dist)}米，需在${CHECKIN_LOCATION.radius}米内）` })
      }
    } else {
      return res.json({ ok: false, msg: '无法获取你的位置，请在岭南行政中心附近重新尝试并允许定位' })
    }

    const record = { name, date: today, time: now.toISOString(), type: 'out', slotId: checkinRecord.slotId, lat: lat || null, lng: lng || null }
    const checkins = store.checkins || []
    checkins.push(record)
    await writeStore({ checkins })
    res.json({ ok: true, msg: '签退成功', record })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// POST /api/checkout/revoke — 3分钟内撤回签退
app.post('/api/checkout/revoke', async (req, res) => {
  try {
    const { name } = req.body
    if (!name) return res.json({ ok: false, msg: '参数缺失' })
    const store = await readStore()
    const today = new Date().toISOString().slice(0, 10)
    const checkins = store.checkins || []
    // 找最近一条签退记录
    const outs = checkins.filter(c => c.name === name && c.date === today && c.type === 'out').sort((a,b)=>b.time.localeCompare(a.time))
    if (outs.length === 0) return res.json({ ok: false, msg: '没有可撤回的签退记录' })
    const lastOut = outs[0]
    const diffMs = Date.now() - new Date(lastOut.time).getTime()
    if (diffMs > 180000) return res.json({ ok: false, msg: '超过3分钟，无法撤回' })
    // 删除这条签退记录
    const idx = checkins.indexOf(lastOut)
    if (idx > -1) checkins.splice(idx, 1)
    await writeStore({ checkins })
    res.json({ ok: true, msg: '签退已撤回，恢复为值班中状态' })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// POST /api/overtime — 工作补报申请
app.post('/api/overtime', async (req, res) => {
  try {
    const { name, date, hours, content } = req.body
    if (!name || !date || !hours || !content) return res.json({ ok: false, msg: '请填写完整信息' })
    const h = parseFloat(hours)
    if (isNaN(h) || h <= 0 || h > 24) return res.json({ ok: false, msg: '工作时长需为正数且不超过24小时' })
    const store = await readStore()
    const overtimes = store.overtimes || []
    overtimes.push({
      id: Date.now().toString(36), name, date, hours: h, content,
      status: 'pending', createdAt: new Date().toISOString()
    })
    await writeStore({ overtimes })
    res.json({ ok: true, msg: '补报申请已提交，等待管理员审核' })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// GET /api/overtime?name=xxx — 个人补报记录
app.get('/api/overtime', async (req, res) => {
  try {
    const name = req.query.name
    const store = await readStore()
    let list = store.overtimes || []
    if (name) list = list.filter(o => o.name === name)
    list.sort((a,b) => b.createdAt.localeCompare(a.createdAt))
    res.json({ ok: true, list })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// POST /api/admin/overtime/approve — 审核补报
app.post('/api/admin/overtime/approve', async (req, res) => {
  try {
    const { id, action } = req.body  // action: approve | reject
    if (!id || !action) return res.json({ ok: false, msg: '参数缺失' })
    const store = await readStore()
    const overtimes = store.overtimes || []
    const item = overtimes.find(o => o.id === id)
    if (!item) return res.json({ ok: false, msg: '记录不存在' })
    if (item.status !== 'pending') return res.json({ ok: false, msg: '该申请已处理过' })
    item.status = action === 'approve' ? 'approved' : 'rejected'
    item.reviewedAt = new Date().toISOString()
    await writeStore({ overtimes })
    res.json({ ok: true, msg: action === 'approve' ? '已批准补报' : '已拒绝补报' })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// GET /api/my-checkins?name=xxx — 获取个人打卡记录
app.get('/api/my-checkins', async (req, res) => {
  try {
    const name = req.query.name
    if (!name) return res.json({ checkins: [], stats: {} })
    const store = await readStore()
    const checkins = (store.checkins || []).filter(c => c.name === name).sort((a, b) => a.time.localeCompare(b.time))
    // 统计：配对的签到-签退算一次完整值班，计算时长
    let totalMinutes = 0
    let completedDays = 0
    const processed = new Set()
    checkins.forEach(c => {
      if (c.type === 'in' && !processed.has(c.date)) {
        const outRec = checkins.find(o => o.date === c.date && o.type === 'out')
        if (outRec) {
          totalMinutes += (new Date(outRec.time) - new Date(c.time)) / 60000
          completedDays++
        }
        processed.add(c.date)
      }
    })
    res.json({
      checkins,
      stats: {
        totalCheckins: checkins.filter(c => c.type === 'in').length,
        totalCheckouts: checkins.filter(c => c.type === 'out').length,
        completedDays,
        totalHours: Math.round(totalMinutes / 60 * 10) / 10
      }
    })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// GET /api/admin/checkins?date=YYYY-MM-DD — 管理员查看所有打卡记录
app.get('/api/admin/checkins', async (req, res) => {
  try {
    const store = await readStore()
    let checkins = store.checkins || []
    if (req.query.date) {
      checkins = checkins.filter(c => c.date === req.query.date)
    }
    checkins.sort((a, b) => b.time.localeCompare(a.time))
    res.json({ ok: true, checkins })
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
    // 已确认的排班表不允许取消
    if (store.scheduleStart && store.scheduleEnd) {
      return res.json({ ok: false, msg: '当前排班表已确认生效，暂不可取消。请联系管理员。' })
    }
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
