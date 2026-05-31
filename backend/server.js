const express = require('express')
const path = require('path')
const { MongoClient } = require('mongodb')
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, HeadingLevel, BorderStyle, ShadingType
} = require('docx')

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
    confirmedPeriods: [],
    // 工时申报
    workTimeClaim: {
      year: null,
      month: null,
      isOpen: false,
      submissions: {} // { '王梓豪': { name, bankAccount, department, studentId, dorm, phone, totalHours, totalPay, submittedAt } }
    }
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
    
    // 归档当前排班到历史（去重：相同起止日期不再重复追加）
    if (store.schedule && Object.keys(store.schedule).length > 0) {
      const effStart = scheduleStart || store.scheduleStart || new Date().toISOString().slice(0, 10)
      const effEnd   = scheduleEnd   || store.scheduleEnd   || new Date().toISOString().slice(0, 10)
      if (!store.confirmedPeriods) store.confirmedPeriods = []
      const alreadyExists = store.confirmedPeriods.some(p => p.start === effStart && p.end === effEnd)
      if (!alreadyExists) {
        store.confirmedPeriods.push({
          start: effStart,
          end: effEnd,
          schedule: JSON.parse(JSON.stringify(store.schedule)),
          confirmedAt: new Date().toISOString()
        })
      }
    }
    
    // 设置新的排班周期
    store.scheduleStart = scheduleStart || null
    store.scheduleEnd = scheduleEnd || null
    // 确认后保留当前排班数据（前端通过 scheduleStart/scheduleEnd 判断是否为已确认状态）
    // 不清空 schedule，用于管理员和助理在前端查看已确认的排班表
    
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
    // 归档当前排班（去重：相同起止日期不再重复追加）
    if (store.schedule && Object.keys(store.schedule).length > 0) {
      const effStart = store.scheduleStart || new Date().toISOString().slice(0, 10)
      const effEnd   = store.scheduleEnd   || new Date().toISOString().slice(0, 10)
      if (!store.confirmedPeriods) store.confirmedPeriods = []
      const alreadyExists = store.confirmedPeriods.some(p => p.start === effStart && p.end === effEnd)
      if (!alreadyExists) {
        store.confirmedPeriods.push({
          start: effStart,
          end: effEnd,
          schedule: JSON.parse(JSON.stringify(store.schedule)),
          confirmedAt: new Date().toISOString()
        })
      }
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
    // 使用嵌套格式（与前端 renderSchedule 一致）
    if (!store.schedule[day]) store.schedule[day] = {}
    if (!store.schedule[day][slotId]) store.schedule[day][slotId] = []
    const list = store.schedule[day][slotId]
    if (list.includes(name)) return res.json({ ok: false, msg: '该成员已在此班次' })
    list.push(name)
    store.scheduleTime[`${day}|${slotId}|${name}`] = Date.now()
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
    // 使用嵌套格式（与前端 renderSchedule 一致）
    if (!store.schedule[day] || !store.schedule[day][slotId]) return res.json({ ok: true })
    const list = store.schedule[day][slotId]
    const idx = list.indexOf(name)
    if (idx >= 0) {
      list.splice(idx, 1)
      if (list.length === 0) delete store.schedule[day][slotId]
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

// ========== 工时申报 API ==========

// 管理员：开启/关闭本月工时申报
app.post('/api/admin/worktime-claim/toggle', async (req, res) => {
  try {
    const { year, month, isOpen } = req.body
    const store = await readStore()
    if (!store.workTimeClaim) store.workTimeClaim = { year: null, month: null, isOpen: false, submissions: {} }
    
    if (isOpen) {
      // 开启新的一轮申报，清空之前的提交
      store.workTimeClaim = { year, month, isOpen: true, submissions: {} }
    } else {
      store.workTimeClaim.isOpen = false
    }
    
    await writeStore({ workTimeClaim: store.workTimeClaim })
    res.json({ ok: true, workTimeClaim: store.workTimeClaim })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 获取工时申报状态（成员和管理员通用）
app.get('/api/worktime-claim/status', async (req, res) => {
  try {
    const store = await readStore()
    const wtc = store.workTimeClaim || { year: null, month: null, isOpen: false, submissions: {} }
    res.json({ ok: true, workTimeClaim: wtc })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 成员：获取自己的工时数据（从打卡+补报计算）
app.get('/api/worktime-claim/my-data', async (req, res) => {
  try {
    const name = req.query.name
    if (!name) return res.status(400).json({ ok: false, msg: '缺少name参数' })
    
    const store = await readStore()
    const wtc = store.workTimeClaim || { year: null, month: null, isOpen: false, submissions: {} }
    
    if (!wtc.isOpen || !wtc.year || !wtc.month) {
      return res.json({ ok: true, isOpen: false, msg: '当前未开放工时申报' })
    }
    
    // 计算该成员在指定月份的工作时间
    const year = wtc.year
    const month = wtc.month
    const workData = calculateMemberWorkTime(store, name, year, month)
    
    // 获取已提交的申报信息（如果有）
    const submission = wtc.submissions[name] || null
    
    res.json({
      ok: true,
      isOpen: true,
      year,
      month,
      workData,
      submission
    })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 成员：提交工时申报
app.post('/api/worktime-claim/submit', async (req, res) => {
  try {
    const { name, bankAccount, department, studentId, dorm, phone } = req.body
    if (!name) return res.status(400).json({ ok: false, msg: '缺少name参数' })
    
    const store = await readStore()
    const wtc = store.workTimeClaim || { year: null, month: null, isOpen: false, submissions: {} }
    
    if (!wtc.isOpen) {
      return res.status(400).json({ ok: false, msg: '当前未开放工时申报' })
    }
    
    // 计算工时
    const workData = calculateMemberWorkTime(store, name, wtc.year, wtc.month)
    
    // 保存提交
    wtc.submissions[name] = {
      name,
      bankAccount: bankAccount || '',
      department: department || '岭南学院',
      studentId: studentId || '',
      dorm: dorm || '',
      phone: phone || '',
      totalHours: workData.totalHours,
      totalPay: workData.totalPay,
      workDays: workData.workDays,
      submittedAt: new Date().toISOString()
    }
    
    store.workTimeClaim = wtc
    await writeStore({ workTimeClaim: wtc })
    
    res.json({ ok: true, msg: '申报提交成功', submission: wtc.submissions[name] })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 管理员：获取所有成员的申报统计
app.get('/api/admin/worktime-claim/all', async (req, res) => {
  try {
    const store = await readStore()
    const wtc = store.workTimeClaim || { year: null, month: null, isOpen: false, submissions: {} }
    
    // 为所有成员计算工时（包括未提交的）
    const allMembers = store.members || []
    const result = []
    
    for (const name of allMembers) {
      const submission = wtc.submissions[name]
      if (submission) {
        result.push({ ...submission, submitted: true })
      } else {
        // 未提交，计算工时供参考
        const workData = calculateMemberWorkTime(store, name, wtc.year, wtc.month)
        result.push({
          name,
          totalHours: workData.totalHours,
          totalPay: workData.totalPay,
          submitted: false
        })
      }
    }
    
    // 重新计算每个已提交成员的工时（避免旧数据残留）
    for (const item of result) {
      if (item.submitted) {
        const workData = calculateMemberWorkTime(store, item.name, wtc.year, wtc.month)
        item.totalHours = workData.totalHours
        item.totalPay = workData.totalPay
      }
    }
    
    res.json({ ok: true, year: wtc.year, month: wtc.month, isOpen: wtc.isOpen, submissions: result })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 辅助函数：计算成员在指定月份的工作时间
function calculateMemberWorkTime(store, name, year, month) {
  const checkins = store.checkins || []
  const overtimes = (store.overtimes || []).filter(ot => ot.status === 'approved')
  
  // 月份范围
  const monthStart = new Date(year, month - 1, 1)
  const monthEnd = new Date(year, month, 0) // 月末
  const monthStartStr = monthStart.toISOString().slice(0, 10)
  const monthEndStr = monthEnd.toISOString().slice(0, 10)
  
  // 按日期汇总工时（每次打卡配对独立向上取整，不封顶2h）
  const workByDate = {}
  
  // 1. 打卡记录：每次 in/out 配对独立计算
  const myCheckins = checkins.filter(c => c.name === name && c.date >= monthStartStr && c.date <= monthEndStr)
  const byDate = {}
  myCheckins.forEach(c => {
    if (!byDate[c.date]) byDate[c.date] = []
    byDate[c.date].push(c)
  })
  
  Object.keys(byDate).forEach(date => {
    const recs = byDate[date].sort((a, b) => a.time.localeCompare(b.time))
    let inTime = null
    recs.forEach(r => {
      if (r.type === 'in') {
        inTime = r.time
      } else if (r.type === 'out' && inTime) {
        const inMinutes = timeToMinutes(inTime.slice(11, 16))
        const outMinutes = timeToMinutes(r.time.slice(11, 16))
        const hours = Math.max(0, (outMinutes - inMinutes) / 60)
        const rounded = Math.ceil(hours * 2) / 2 // 向上取整到0.5h
        if (!workByDate[date]) workByDate[date] = { hours: 0, slots: [] }
        workByDate[date].hours += rounded
        workByDate[date].slots.push({ in: inTime.slice(11, 16), out: r.time.slice(11, 16) })
        inTime = null
      }
    })
  })
  
  // 2. 已通过补报：按次累加，不限制每日一次
  overtimes.filter(ot => ot.name === name && ot.date >= monthStartStr && ot.date <= monthEndStr).forEach(ot => {
    const date = ot.date
    if (!workByDate[date]) workByDate[date] = { hours: 0, slots: [] }
    const rounded = Math.ceil((ot.hours || 0) * 2) / 2
    workByDate[date].hours += rounded
    workByDate[date].slots.push({ overtime: true, hours: ot.hours, content: ot.content })
  })
  
  // 总时长 = 每日累加（不再封顶2h/天）
  let totalHours = 0
  Object.values(workByDate).forEach(d => {
    d.finalHours = d.hours // 已按次向上取整
    totalHours += d.hours
  })
  
  const totalPay = parseFloat((totalHours * 25).toFixed(1))
  
  return { totalHours, totalPay, workByDate, workDays: Object.keys(workByDate).length }
}

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

// ========== 工时申报导出 .docx ==========

// 管理员：导出单个成员的考勤表 .docx
app.get('/api/admin/worktime-claim/export/:name', async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name)
    const store = await readStore()
    const wtc = store.workTimeClaim || { year: null, month: null, isOpen: false, submissions: {} }
    
    if (!wtc.year || !wtc.month) {
      return res.status(400).json({ ok: false, msg: '当前没有开放的申报周期' })
    }
    
    const submission = wtc.submissions[name]
    if (!submission) {
      return res.status(404).json({ ok: false, msg: '该成员尚未提交申报' })
    }
    
    // 计算工时数据（按日期+时段）
    const workData = calculateMemberWorkTime(store, name, wtc.year, wtc.month)
    
    // 生成 docx
    const docBuffer = await generateAttendanceDocx(wtc.year, wtc.month, submission, workData, store)
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}_${wtc.year}年${wtc.month}月_勤工助学考勤表.docx`)
    res.send(docBuffer)
  } catch (e) {
    console.error('导出考勤表错误:', e)
    res.status(500).json({ ok: false, msg: '导出失败: ' + e.message })
  }
})

// 管理员：一键导出所有已提交成员的考勤表（zip）
app.get('/api/admin/worktime-claim/export-all', async (req, res) => {
  try {
    const store = await readStore()
    const wtc = store.workTimeClaim || { year: null, month: null, isOpen: false, submissions: {} }
    
    if (!wtc.year || !wtc.month) {
      return res.status(400).json({ ok: false, msg: '当前没有开放的申报周期' })
    }
    
    const submittedNames = Object.keys(wtc.submissions).filter(k => wtc.submissions[k])
    if (submittedNames.length === 0) {
      return res.status(400).json({ ok: false, msg: '暂无已提交的申报' })
    }
    
    // 如果只有一个成员，直接返回单个文件
    if (submittedNames.length === 1) {
      const name = submittedNames[0]
      const submission = wtc.submissions[name]
      const workData = calculateMemberWorkTime(store, name, wtc.year, wtc.month)
      const docBuffer = await generateAttendanceDocx(wtc.year, wtc.month, submission, workData, store)
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${wtc.year}年${wtc.month}月_全部考勤表.docx`)
      return res.send(docBuffer)
    }
    
    // 多个成员：需要 archiver 生成 zip，暂时逐个导出提示
    // 这里简化为返回第一个的下载链接列表
    res.json({ 
      ok: true, 
      msg: '请点击每个成员的「导出」按钮单独下载',
      names: submittedNames,
      exportUrls: submittedNames.map(n => `/api/admin/worktime-claim/export/${encodeURIComponent(n)}`)
    })
  } catch (e) {
    console.error('批量导出错误:', e)
    res.status(500).json({ ok: false, msg: '导出失败: ' + e.message })
  }
})

// 生成勤工助学考勤表 docx
async function generateAttendanceDocx(year, month, submission, workData, store) {
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, 
          WidthType, AlignmentType, BorderStyle } = require('docx')
  
  // 时段映射：将打卡时间归类到上午/下午/晚上
  function classifySlot(timeStr) {
    if (!timeStr) return ''
    const h = parseInt(timeStr.split(':')[0])
    if (h >= 6 && h < 12) return '上午'
    if (h >= 12 && h < 18) return '下午'
    if (h >= 18 && h <= 23) return '晚上'
    return ''
  }
  
  // 构建日期→时段映射
  const dateSlots = {}
  Object.entries(workData.workByDate || {}).forEach(([date, info]) => {
    dateSlots[date] = { am: '', pm: '', eve: '' }
    ;(info.slots || []).forEach(s => {
      if (s.overtime) {
        // 补报：根据内容或默认填入
        if (!dateSlots[date].am) dateSlots[date].am = '补报'
        else if (!dateSlots[date].pm) dateSlots[date].pm = '补报'
        else if (!dateSlots[date].eve) dateSlots[date].eve = '补报'
      } else {
        const period = classifySlot(s.in)
        const slotStr = s.in + '-' + s.out
        if (period === '上午' && !dateSlots[date].am) dateSlots[date].am = slotStr
        else if (period === '下午' && !dateSlots[date].pm) dateSlots[date].pm = slotStr
        else if (period === '晚上' && !dateSlots[date].eve) dateSlots[date].eve = slotStr
      }
    })
  })
  
  // 当月天数
  const daysInMonth = new Date(year, month, 0).getDate()
  
  // ========== 构建 Word 文档内容 ==========
  const children = []
  
  // 标题
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: `（${year}）年（${month}）月勤工助学考勤表`, bold: true, size: 32 })]
  }))
  
  // 空行
  children.push(new Paragraph({ children: [new TextRun('')] }))
  
  // 个人信息表
  children.push(new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text: '个人信息', bold: true, size: 24 })]
  }))
  
  const infoTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          cell('姓名', true), cell(submission.name || ''),
          cell('院系', true), cell(submission.department || '岭南学院'),
        ]
      }),
      new TableRow({
        children: [
          cell('学号', true), cell(submission.studentId || ''),
          cell('银行账号', true), cell(submission.bankAccount || ''),
        ]
      }),
      new TableRow({
        children: [
          cell('宿舍', true), cell(submission.dorm || ''),
          cell('联系电话', true), cell(submission.phone || ''),
        ]
      }),
    ]
  })
  children.push(infoTable)
  children.push(new Paragraph({ children: [new TextRun('')] }))
  
  // 固定信息表
  children.push(new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text: '工作信息', bold: true, size: 24 })]
  }))
  
  const fixedTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          cell('工作单位', true), cell('岭南学院'),
          cell('工作部门', true), cell('学工办'),
        ]
      }),
      new TableRow({
        children: [
          cell('工作岗位', true), cell('学生助理'),
          cell('报酬标准', true), cell('25元/小时'),
        ]
      }),
      new TableRow({
        children: [
          cell('工作主要内容', true), 
          new TableCell({ ...cellOpts(), columnSpan: 3, children: [new Paragraph({ children: [new TextRun('学生助理')] })] }),
        ]
      }),
    ]
  })
  children.push(fixedTable)
  children.push(new Paragraph({ children: [new TextRun('')] }))
  
  // 工作时间表（按模板分三列：1-11, 12-22, 23-31）
  children.push(new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text: '工作时间记录', bold: true, size: 24 })]
  }))
  
  // 表头行
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      cell('日期', true), cell('上午', true), cell('日期', true), cell('下午', true), cell('日期', true), cell('晚上', true),
    ]
  })
  
  const dataRows = []
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const slots = dateSlots[dateStr] || {}
    
    if (d <= 11) {
      // 第一列组：日期 1-11
      dataRows.push(new TableRow({
        children: [
          cell(String(d)), cell(slots.am || ''),
          cell(''), cell(''),
          cell(''), cell(''),
        ]
      }))
    } else if (d <= 22) {
      // 第二列组：日期 12-22
      dataRows.push(new TableRow({
        children: [
          cell(''), cell(''),
          cell(String(d)), cell(slots.pm || slots.am || ''),
          cell(''), cell(''),
        ]
      }))
    } else {
      // 第三列组：日期 23-31
      dataRows.push(new TableRow({
        children: [
          cell(''), cell(''),
          cell(''), cell(''),
          cell(String(d)), cell(slots.eve || slots.pm || slots.am || ''),
        ]
      }))
    }
  }
  
  const workTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows]
  })
  children.push(workTable)
  children.push(new Paragraph({ children: [new TextRun('')] }))
  
  // 汇总
  children.push(new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text: '汇总', bold: true, size: 24 })]
  }))
  
  const summaryTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          cell('月工作时间总计（小时）', true), 
          new TableCell({ ...cellOpts(), children: [new Paragraph({ children: [new TextRun((workData.totalHours || 0).toFixed(1))] })] }),
          cell('月劳动报酬总计（元）', true),
          new TableCell({ ...cellOpts(), children: [new Paragraph({ children: [new TextRun((workData.totalPay || 0).toFixed(1))] })] }),
        ]
      }),
      new TableRow({
        children: [
          cell('所在单位考评意见', true),
          new TableCell({ ...cellOpts(), columnSpan: 3, children: [new Paragraph({ children: [new TextRun('')] })] }),
        ]
      }),
      new TableRow({
        children: [
          cell('备注', true),
          new TableCell({ ...cellOpts(), columnSpan: 3, children: [new Paragraph({ children: [new TextRun('')] })] }),
        ]
      }),
    ]
  })
  children.push(summaryTable)
  
  const doc = new Document({ sections: [{ children }] })
  const buffer = await Packer.toBuffer(doc)
  return buffer
}

// 辅助函数：创建表格单元格
function cell(text, isHeader = false) {
  return new TableCell({
    ...cellOpts(isHeader),
    children: [new Paragraph({ children: [new TextRun({ text: String(text), bold: isHeader, size: isHeader ? 22 : 20 })] })]
  })
}

function cellOpts(isHeader = false) {
  return {
    width: { size: isHeader ? 16.66 : 16.66, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1 },
      bottom: { style: BorderStyle.SINGLE, size: 1 },
      left: { style: BorderStyle.SINGLE, size: 1 },
      right: { style: BorderStyle.SINGLE, size: 1 },
    },
    shading: isHeader ? { fill: 'F0F0F0' } : undefined,
    verticalAlign: 'center',
  }
}

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
