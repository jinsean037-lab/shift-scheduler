const express = require('express')
const path = require('path')
const { MongoClient } = require('mongodb')
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, HeadingLevel, BorderStyle, ShadingType
} = require('docx')
// v5.0 邮件模块
const nodemailer = require('nodemailer')

// ========== SMTP 配置（v5.0）============
// 163 SMTP：smtp.163.com:465 (SSL)。授权码从环境变量读，本地默认值便于开发。
const SMTP_HOST   = process.env.SMTP_HOST   || 'smtp.163.com'
const SMTP_PORT   = parseInt(process.env.SMTP_PORT || '465', 10)
const SMTP_SECURE = process.env.SMTP_SECURE !== 'false'  // 默认 SSL
const SMTP_USER   = process.env.SMTP_USER   || 'lnxyxgbss@163.com'
const SMTP_PASS   = process.env.SMTP_PASS   || 'VNvc3XzCUpBBsZBN'
const SMTP_FROM_NAME = process.env.SMTP_FROM_NAME || '中山大学岭南学院学工办'

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
    maxPerSlot: 1,
    startTime: null,
    scheduleStart: null,
    scheduleEnd: null,
    members: [...DEFAULT_MEMBERS],
    passwords: { ...DEFAULT_PASSWORDS },
    schedule: {},
    scheduleTime: {},
    waitlist: [],
    cancelRequests: [],
    shiftSwapRequests: [],
    shiftSwapOverrides: [],
    checkins: [],
    overtimes: [],
    confirmedPeriods: [],
    // 工时申报
    workTimeClaim: {
      year: null,
      month: null,
      isOpen: false,
      submissions: {} // { '王梓豪': { name, bankAccount, department, studentId, dorm, phone, totalHours, totalPay, submittedAt, meetingsAttended } }
    },
    // 2026-07-02 新增：每周例会定义（按月键存储）
    // { '2026-07': { weeks: [{ week: 1, date: '2026-07-08', hours: 0.5 }, ...] } }
    // hours=0 表示本次例会无工时但仍然显示在成员勾选列表里
    meetings: {},
    // v5.0 邮件模块
    emailLogs: [],        // { at, to, subject, status, error?, messageId? } 最新 200 条
    // 成员邮箱字段：旧数据从 {name:'xxx', password:'yyy'} 升级后会读 members[name].email
    // 值班搭子留言
    partnerMessages: [],
  suppCheckouts: [],
  suppCheckouts: []
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
    maxPerSlot: 1,
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

    // v5.0：给所有有邮箱的成员发"排班已开启"通知（后台异步，不阻塞响应）
    if (store.memberEmails && Object.keys(store.memberEmails).length > 0) {
      const tpl = buildScheduleConfirmEmail(store, scheduleStart, scheduleEnd)
      Object.values(store.memberEmails).forEach((email) => {
        if (!email) return
        sendEmail({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text })
          .catch(err => console.warn('[email] schedule-confirm 邮件发送失败:', err))
      })
    }
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
    store.shiftSwapRequests = []
    store.shiftSwapOverrides = []
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
      maxPerSlot: store.maxPerSlot || 1,
      schedule,
      members: store.members,
      waitlist: store.waitlist || [],
      cancelRequests: store.cancelRequests || [],
      scheduleStart: store.scheduleStart,
      scheduleEnd: store.scheduleEnd,
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
    .sort((a, b) => (a.time||'').localeCompare(b.time||''))
  if (pending.length > 0 && !list.includes(pending[0].name)) {
    list.push(pending[0].name)
    const key = `${day}|${slotId}`
    store.scheduleTime[`${key}|${pending[0].name}`] = Date.now()
    pending[0].status = 'auto-approved'
    return pending[0].name
  }
  return null
}

function isScheduleActive(store) {
  if (!store.scheduleStart || !store.scheduleEnd) return false
  const now = Date.now()
  const start = new Date(store.scheduleStart).getTime()
  const end = new Date(store.scheduleEnd).getTime()
  return Number.isFinite(start) && Number.isFinite(end) && now >= start && now <= end
}

function getScheduleList(store, day, slotId) {
  if (!store.schedule) store.schedule = {}
  if (store.schedule[day] && Array.isArray(store.schedule[day][slotId])) {
    return store.schedule[day][slotId]
  }
  const flatKey = `${day}|${slotId}`
  if (Array.isArray(store.schedule[flatKey])) {
    return store.schedule[flatKey]
  }
  return null
}

function getShiftSwapList(store) {
  if (!Array.isArray(store.shiftSwapRequests)) store.shiftSwapRequests = []
  return store.shiftSwapRequests
}

function getShiftSwapOverrides(store) {
  if (!Array.isArray(store.shiftSwapOverrides)) store.shiftSwapOverrides = []
  return store.shiftSwapOverrides
}

function dateToWeekday(dateStr) {
  const d = new Date(`${dateStr}T12:00:00+08:00`)
  return ['周日','周一','周二','周三','周四','周五','周六'][d.getDay()]
}

function getBeijingDateString() {
  const now = new Date()
  const beijingMs = now.getTime() + 8 * 3600 * 1000
  return new Date(beijingMs).toISOString().slice(0, 10)
}

// 2026-07-02 新增：返回 Beijing 时间的 "YYYY-MM-DD HH:MM:SS" 字符串（用于 submittedAt 等展示字段）
function getBeijingDateTimeString(date) {
  const d = date instanceof Date ? date : new Date()
  const beijingMs = d.getTime() + 8 * 3600 * 1000
  const bj = new Date(beijingMs)
  return bj.toISOString().slice(0, 19).replace('T', ' ')
}

function isDateInSchedulePeriod(store, dateStr) {
  if (!store.scheduleStart || !store.scheduleEnd || !dateStr) return false
  const start = String(store.scheduleStart).slice(0, 10)
  const end = String(store.scheduleEnd).slice(0, 10)
  return dateStr >= start && dateStr <= end
}

function cloneScheduleList(store, day, slotId) {
  const list = getScheduleList(store, day, slotId)
  return Array.isArray(list) ? [...list] : []
}

function getEffectiveSlotMembers(store, dateStr, day, slotId) {
  let members = cloneScheduleList(store, day, slotId)
  const overrides = getShiftSwapOverrides(store).filter(o => o.status === 'approved')
  for (const item of overrides) {
    if (item.fromDate === dateStr && item.fromDay === day && item.fromSlotId === slotId) {
      members = members.map(n => n === item.from ? item.to : n)
    }
    if (item.toDate === dateStr && item.toDay === day && item.toSlotId === slotId) {
      members = members.map(n => n === item.to ? item.from : n)
    }
  }
  return members
}

function listDatesForWeekday(startDate, endDate, weekday) {
  const result = []
  if (!startDate || !endDate || !weekday) return result
  let current = new Date(`${startDate}T12:00:00+08:00`)
  const end = new Date(`${endDate}T12:00:00+08:00`)
  while (current <= end) {
    const dateStr = current.toISOString().slice(0, 10)
    if (dateToWeekday(dateStr) === weekday) result.push(dateStr)
    current.setDate(current.getDate() + 1)
  }
  return result
}

function getEffectiveShiftsForMember(store, name) {
  const shifts = []
  const start = store.scheduleStart ? String(store.scheduleStart).slice(0, 10) : null
  const end = store.scheduleEnd ? String(store.scheduleEnd).slice(0, 10) : null
  const sched = store.schedule || {}
  if (!start || !end) return shifts
  for (const day of ['周一','周二','周三','周四','周五']) {
    const dayData = sched[day]
    if (!dayData || typeof dayData !== 'object') continue
    for (const date of listDatesForWeekday(start, end, day)) {
      for (const slotId of Object.keys(dayData)) {
        const members = getEffectiveSlotMembers(store, date, day, slotId)
        if (members.includes(name)) {
          const slotInfo = (store.timeSlots || defaultStore().timeSlots).find(t => t.id === slotId)
          shifts.push({ day, date, slot: slotId, slotId, slotLabel: slotInfo ? slotInfo.label : slotId })
        }
      }
    }
  }
  shifts.sort((a, b) => (a.date + a.slot).localeCompare(b.date + b.slot))
  return shifts
}

function publicShiftSwap(item) {
  return {
    id: item.id,
    from: item.from,
    to: item.to,
    fromDate: item.fromDate || null,
    toDate: item.toDate || null,
    fromDay: item.fromDay || item.day,
    fromSlotId: item.fromSlotId || item.slotId,
    toDay: item.toDay || item.day,
    toSlotId: item.toSlotId || item.slotId,
    status: item.status,
    reason: item.reason || '',
    createdAt: item.createdAt,
    reviewedAt: item.reviewedAt || null
  }
}

// 成员：发起换班申请。仅允许在已确认排班的生效期内，将自己的一个班次和对方的一个班次互换。
app.post('/api/shift-swap/request', async (req, res) => {
  try {
    const { from, to, reason } = req.body
    const fromDay = req.body.fromDay || req.body.day
    const fromSlotId = req.body.fromSlotId || req.body.slotId
    const fromDate = req.body.fromDate
    const toDay = req.body.toDay
    const toSlotId = req.body.toSlotId
    const toDate = req.body.toDate
    if (!from || !to || !fromDay || !fromSlotId || !fromDate || !toDay || !toSlotId || !toDate) return res.json({ ok: false, msg: '参数缺失' })
    if (from === to) return res.json({ ok: false, msg: '不能和自己换班' })
    if (fromDate === toDate && fromDay === toDay && fromSlotId === toSlotId) return res.json({ ok: false, msg: '不能选择同一个班次互换' })
    const store = await readStore()
    if (!isScheduleActive(store)) return res.json({ ok: false, msg: '当前不在排班表生效期间，暂不能换班' })
    if (!isDateInSchedulePeriod(store, fromDate) || !isDateInSchedulePeriod(store, toDate)) return res.json({ ok: false, msg: '换班日期不在当前排班生效周期内' })
    if (dateToWeekday(fromDate) !== fromDay || dateToWeekday(toDate) !== toDay) return res.json({ ok: false, msg: '换班日期与周几不匹配' })
    if (!store.members.includes(from) || !store.members.includes(to)) return res.json({ ok: false, msg: '成员不存在' })
    const fromList = getEffectiveSlotMembers(store, fromDate, fromDay, fromSlotId)
    const toList = getEffectiveSlotMembers(store, toDate, toDay, toSlotId)
    if (!fromList || !fromList.includes(from)) return res.json({ ok: false, msg: '你不在原班次中，无法发起换班' })
    if (!toList || !toList.includes(to)) return res.json({ ok: false, msg: '对方不在要互换的班次中' })
    if (fromList.includes(to) || toList.includes(from)) return res.json({ ok: false, msg: '双方已同时出现在相关班次中，无需互换' })
    const swaps = getShiftSwapList(store)
    const duplicate = swaps.find(s =>
      s.from === from &&
      s.to === to &&
      s.fromDate === fromDate &&
      (s.fromDay || s.day) === fromDay &&
      (s.fromSlotId || s.slotId) === fromSlotId &&
      s.toDate === toDate &&
      (s.toDay || s.day) === toDay &&
      (s.toSlotId || s.slotId) === toSlotId &&
      s.status === 'pending'
    )
    if (duplicate) return res.json({ ok: false, msg: '该换班申请已提交，等待对方确认' })
    const record = {
      id: `swap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      from,
      to,
      fromDate,
      fromDay,
      fromSlotId,
      toDate,
      toDay,
      toSlotId,
      reason: (reason || '').slice(0, 200),
      status: 'pending',
      createdAt: new Date().toISOString()
    }
    swaps.push(record)
    await writeStore({ shiftSwapRequests: swaps })
    res.json({ ok: true, msg: '换班申请已发送，等待对方确认', request: publicShiftSwap(record) })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 成员：查看与自己相关的换班申请
app.get('/api/shift-swaps', async (req, res) => {
  try {
    const name = req.query.name
    if (!name) return res.json({ ok: true, requests: [] })
    const store = await readStore()
    const requests = getShiftSwapList(store)
      .filter(s => s.from === name || s.to === name)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .map(publicShiftSwap)
    res.json({ ok: true, requests })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 成员：同意或拒绝别人发给自己的换班申请。同意后立即互换两个具体班次，打卡按新名单生效。
app.post('/api/shift-swap/review', async (req, res) => {
  try {
    const { id, reviewer, action } = req.body
    if (!id || !reviewer || !action) return res.json({ ok: false, msg: '参数缺失' })
    const store = await readStore()
    const swaps = getShiftSwapList(store)
    const item = swaps.find(s => s.id === id)
    if (!item) return res.json({ ok: false, msg: '申请不存在' })
    if (item.to !== reviewer) return res.json({ ok: false, msg: '只有被换班成员可以处理该申请' })
    if (item.status !== 'pending') return res.json({ ok: false, msg: '该申请已处理' })
    if (action !== 'approve' && action !== 'reject') return res.json({ ok: false, msg: '操作无效' })
    if (action === 'reject') {
      item.status = 'rejected'
      item.reviewedAt = new Date().toISOString()
      await writeStore({ shiftSwapRequests: swaps })
      return res.json({ ok: true, msg: '已拒绝换班申请', request: publicShiftSwap(item) })
    }
    if (!isScheduleActive(store)) return res.json({ ok: false, msg: '当前不在排班表生效期间，无法确认换班' })
    const fromDate = item.fromDate
    const fromDay = item.fromDay || item.day
    const fromSlotId = item.fromSlotId || item.slotId
    const toDate = item.toDate
    const toDay = item.toDay || item.day
    const toSlotId = item.toSlotId || item.slotId
    if (!fromDate || !toDate) return res.json({ ok: false, msg: '该申请缺少具体日期，请重新发起换班' })
    if (!isDateInSchedulePeriod(store, fromDate) || !isDateInSchedulePeriod(store, toDate)) return res.json({ ok: false, msg: '换班日期已不在当前排班生效周期内' })
    const fromList = getEffectiveSlotMembers(store, fromDate, fromDay, fromSlotId)
    const toList = getEffectiveSlotMembers(store, toDate, toDay, toSlotId)
    if (!fromList || !fromList.includes(item.from)) return res.json({ ok: false, msg: '发起人的原班次已变化，无法确认换班' })
    if (!toList || !toList.includes(item.to)) return res.json({ ok: false, msg: '你的原班次已变化，无法确认换班' })
    if (fromList.includes(item.to) || toList.includes(item.from)) return res.json({ ok: false, msg: '双方已同时出现在相关班次中，无需互换' })
    item.status = 'approved'
    item.reviewedAt = new Date().toISOString()
    const overrides = getShiftSwapOverrides(store)
    overrides.push({
      id: item.id,
      from: item.from,
      to: item.to,
      fromDate,
      fromDay,
      fromSlotId,
      toDate,
      toDay,
      toSlotId,
      status: 'approved',
      createdAt: item.createdAt,
      approvedAt: item.reviewedAt
    })
    await writeStore({ shiftSwapRequests: swaps, shiftSwapOverrides: overrides })
    res.json({ ok: true, msg: '换班成功，仅对所选日期生效', request: publicShiftSwap(item) })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 成员：撤回自己发出的待确认换班申请
app.post('/api/shift-swap/revoke', async (req, res) => {
  try {
    const { id, name } = req.body
    if (!id || !name) return res.json({ ok: false, msg: '参数缺失' })
    const store = await readStore()
    const swaps = getShiftSwapList(store)
    const item = swaps.find(s => s.id === id)
    if (!item) return res.json({ ok: false, msg: '申请不存在' })
    if (item.from !== name) return res.json({ ok: false, msg: '只能撤回自己发起的申请' })
    if (item.status !== 'pending') return res.json({ ok: false, msg: '该申请已处理，无法撤回' })
    item.status = 'revoked'
    item.reviewedAt = new Date().toISOString()
    await writeStore({ shiftSwapRequests: swaps })
    res.json({ ok: true, msg: '已撤回换班申请', request: publicShiftSwap(item) })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

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
    store.shiftSwapRequests = []
    store.shiftSwapOverrides = []
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

// 管理员：调整排班配置（v5.2：maxPerSlot 等可在线调）
app.post('/api/admin/settings', async (req, res) => {
  try {
    const store = await readStore()
    let changed = []
    if (req.body && typeof req.body.maxPerSlot === 'number' && req.body.maxPerSlot >= 1 && req.body.maxPerSlot <= 10) {
      store.maxPerSlot = Math.floor(req.body.maxPerSlot)
      changed.push('maxPerSlot')
    }
    if (changed.length === 0) return res.json({ ok: false, msg: '没有可应用的设置项（maxPerSlot 必须是 1-10 的整数）' })
    await writeStore({ maxPerSlot: store.maxPerSlot })
    res.json({ ok: true, maxPerSlot: store.maxPerSlot, changed, msg: `已更新：${changed.join(', ')}` })
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

    // v5.0：给成员发密码重置邮件（如果有邮箱）
    const email = store.memberEmails && store.memberEmails[name]
    if (email) {
      const tpl = buildPasswordResetEmail(name, newPassword)
      sendEmail({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text })
        .then(r => { if (!r.ok) console.warn('[email] reset-password 邮件发送失败:', r.error) })
    }
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
    const shifts = getEffectiveShiftsForMember(store, name)
    // 优先嵌套格式: { '周一':{am1:[...],am2:[...]}, ... }
    const sched = store.schedule || {}
    if (shifts.length === 0) {
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
    }
    const wl = (store.waitlist || []).filter(w => w.name === name)
    const cr = (store.cancelRequests || []).filter(r => r.name === name)
    const sr = getShiftSwapList(store)
      .filter(r => r.from === name || r.to === name)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .map(publicShiftSwap)
    res.json({ shifts, waitlist: wl, cancelRequests: cr, shiftSwapRequests: sr })
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

// 补签退时间窗：slot 实际时段 + 60 分钟加班容忍
// 补签退可能晚于 slot 结束时间（成员实际下班时间），所以单独定义一个更宽的窗口
const SUPP_WINDOWS = {
  am1: { start: '08:00', end: '11:00' },  // 10:00 + 60
  am2: { start: '10:00', end: '13:00' },  // 12:00 + 60
  pm1: { start: '14:30', end: '17:00' },  // 16:00 + 60
  pm2: { start: '16:00', end: '18:30' }   // 17:30 + 60
}

// 各 slot 的标准时长（小时），用于：
// 1) "已签到未签退"时估算工时
// 2) **配对后截断**：成员正常签到签退最多只能获得该 slot 的标准时长，超出部分必须靠补报
// 2026-07-02 修正：之前固定 2h 估算 + 不截断配对，导致 6/3 那种 09:52-12:02 被算成 2.5h、6/9 那种跨天补签退错填算成 14h
const SLOT_HOURS = {
  am1: 2,    // 8:00-10:00
  am2: 2,    // 10:00-12:00
  pm1: 1.5,  // 14:30-16:00
  pm2: 1.5,  // 16:00-17:30
}

// 2026-07-02 v3：每个 slot 的标准时段（分钟数），用于多 slot 工时分配
// 和 SLOT_WINDOWS（±15min buffer 的签到窗口）区别开，这里是严格的 slot 时段边界
const SLOT_STANDARD_WINDOWS = {
  am1: { startMin:  480, endMin:  600 },  // 8:00-10:00
  am2: { startMin:  600, endMin:  720 },  // 10:00-12:00
  pm1: { startMin:  870, endMin:  960 },  // 14:30-16:00
  pm2: { startMin:  960, endMin: 1050 },  // 16:00-17:30
}

// 跨天配对判定：配对时长超过这个阈值视为错配（应改补签退时间），强制按 slot 截断
const MAX_PAIR_DURATION_MIN = 240  // 4 小时

// 2026-07-02 v3：判定 in/out pair 与某个 slot 是否有覆盖
// - 有 outMin：要求 inMin ≤ slotEnd+buf 且 outMin ≥ slotStart-buf（相交）
// - 无 outMin（只有签到）：要求 inMin 落在 slotStart-buf 到 slotEnd+buf 之间
function isPairCoveringSlot(inMin, outMin, slotStart, slotEnd, buf) {
  if (outMin === null || outMin === undefined) {
    return inMin >= slotStart - buf && inMin <= slotEnd + buf
  }
  return inMin <= slotEnd + buf && outMin >= slotStart - buf
}

// 按 in-time 推断所属 slot（in-record 没有 slotId 时的回退方案）
function slotByInTime(timeStr) {
  const m = timeToMinutes(timeStr)
  if (m >= 7.75*60 && m < 10.25*60) return 'am1'   // 7:45-10:15
  if (m >= 9.75*60 && m < 12.25*60) return 'am2'   // 9:45-12:15
  if (m >= 14.25*60 && m < 16.25*60) return 'pm1'  // 14:15-16:15
  if (m >= 15.75*60 && m < 17.75*60) return 'pm2'  // 15:45-17:45
  return null
}

// 2026-07-02 v3：获取某成员在指定日期实际排班的所有 slot（合并换班覆盖）
function getMemberScheduledSlots(store, dateStr, name) {
  const weekday = dateToWeekday(dateStr)
  const slotIds = []
  if (!weekday || !['周一','周二','周三','周四','周五'].includes(weekday)) return slotIds
  if (!isDateInSchedulePeriod(store, dateStr)) return slotIds
  for (const slotId of ['am1', 'am2', 'pm1', 'pm2']) {
    const members = getEffectiveSlotMembers(store, dateStr, weekday, slotId)
    if (members.includes(name)) slotIds.push(slotId)
  }
  return slotIds
}

// 打卡地点围栏（中山大学南校园岭南行政中心）
const CHECKIN_LOCATION = {
  name: '岭南行政中心（中山大学南校园）',
  lat: 23.1036,
  lng: 113.2936,
  radius: 200 // 米
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
  const today = getBeijingDateString()
  const todayWeekday = dateToWeekday(today)
  const daySchedule = schedule[todayWeekday]
  if (!daySchedule) return []
  const nowHHMM = getBeijingTimeHHMM()
  const result = []
  for (const slotId of Object.keys(daySchedule)) {
    const members = getEffectiveSlotMembers(store, today, todayWeekday, slotId)
    if (Array.isArray(members) && members.includes(name)) {
      const win = SLOT_WINDOWS[slotId]
      if (win && nowHHMM >= win.start && nowHHMM <= win.end) {
        result.push({ slotId, date: today, ...win })
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
    const today = getBeijingDateString()
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
      const hasOut = (store.checkins || []).find(c => c.name === name && c.date === today && c.type === 'out' && timeStrToMinutes(c.time) > timeStrToMinutes(inRec.time))
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
    let lastOutMs;
            if (lastOut.time && lastOut.time.includes('T')) { lastOutMs = new Date(lastOut.time).getTime(); }
            else { const lm = (lastOut.time||'').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/); lastOutMs = lm ? (new Date()).setHours(parseInt(lm[1]),parseInt(lm[2]),0,0) : Date.now(); }
            diffMs = Date.now() - lastOutMs
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

app.get('/api/my-checkins', async (req, res) => {
  try {
    const name = req.query.name
    if (!name) return res.json({ checkins: [], stats: {} })
    const store = await readStore()
    const checkins = (store.checkins || []).filter(c => c.name === name).sort((a, b) => a.time.localeCompare(b.time))

    // 统计：使用与 calculateMemberWorkTime 相同的精确配对逻辑
    const byDate = {}
    checkins.forEach(c => {
      if (!byDate[c.date]) byDate[c.date] = []
      byDate[c.date].push(c)
    })

    let totalMinutes = 0
    let completedShifts = 0  // 每次签到=1次值班

    Object.keys(byDate).forEach(date => {
      const recs = byDate[date].sort((a, b) => a.time.localeCompare(b.time))
      const ins = recs.filter(r => r.type === 'in')
      const outs = recs.filter(r => r.type === 'out' && !r.isSupp)  // 过滤补签退
      const usedOuts = new Set()

      ins.forEach(iRec => {
        completedShifts++  // 每次签到计入一次值班
        const iMin = timeToMinutes(iRec.time)

        // 找时间最近的未使用签退
        let bestOut = null
        for (const o of outs) {
          if (usedOuts.has(o.id || o.time)) continue
          const oMin = timeToMinutes(o.time)
          if (oMin >= iMin) {
            if (!bestOut || oMin < timeToMinutes(bestOut.time)) bestOut = o
          }
        }
        // 跨天情况（如凌晨签退）
        if (!bestOut) {
          for (const o of outs) {
            if (usedOuts.has(o.id || o.time)) continue
            const oMin = timeToMinutes(o.time)
            if (oMin < iMin) {
              if (!bestOut || oMin > timeToMinutes(bestOut.time)) bestOut = o
            }
          }
        }

        if (bestOut) {
          usedOuts.add(bestOut.id || bestOut.time)
          let diffMinutes = timeToMinutes(bestOut.time) - iMin
          if (diffMinutes < 0) diffMinutes += 24 * 60
          totalMinutes += diffMinutes
        }
      })
    })

    const totalHours = Math.round(totalMinutes / 60 * 10) / 10

    res.json({
      checkins,
      stats: {
        totalCheckins: checkins.filter(c => c.type === 'in').length,
        totalCheckouts: checkins.filter(c => c.type === 'out').length,
        completedDays: completedShifts,
        totalHours: totalHours
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

// 管理员：查看本月（或指定月份）各成员值班情况
// 优先使用排班周期（scheduleStart/scheduleEnd）与查询月份的交集；
// 若没有排班周期，则按自然月统计。
// 每条班次附带打卡状态：completed(已签到+签退) / in_progress(签到未签退) /
//   missed(过去未打卡) / supp_completed(补签退) / today(今天未打卡) / pending(未来)
app.get('/api/admin/monthly-shifts', async (req, res) => {
  try {
    const store = await readStore()
    // 默认本月（北京时间）
    const beijingMs = Date.now() + 8 * 3600 * 1000
    const beijingNow = new Date(beijingMs)
    const year  = parseInt(req.query.year)  || beijingNow.getFullYear()
    const month = parseInt(req.query.month) || (beijingNow.getMonth() + 1)
    if (!year || !month || month < 1 || month > 12) {
      return res.status(400).json({ ok: false, msg: '年份或月份无效' })
    }

    // 本月自然范围（按北京时间字符串，避免服务器时区错位）
    const p2 = n => (n < 10 ? '0' + n : '' + n)
    const monthStartStr = `${year}-${p2(month)}-01`
    const daysInMonth = new Date(year, month, 0).getDate()
    const monthEndStr   = `${year}-${p2(month)}-${p2(daysInMonth)}`

    // 与排班周期取交集
    const schedStart = store.scheduleStart ? String(store.scheduleStart).slice(0, 10) : null
    const schedEnd   = store.scheduleEnd   ? String(store.scheduleEnd).slice(0, 10)   : null
    let effStart = monthStartStr
    let effEnd   = monthEndStr
    let periodSource = 'month'
    if (schedStart && schedEnd) {
      effStart = monthStartStr > schedStart ? monthStartStr : schedStart
      effEnd   = monthEndStr   < schedEnd   ? monthEndStr   : schedEnd
      periodSource = 'schedule'
    }

    const today = getBeijingDateString()
    const days = ['周一','周二','周三','周四','周五']
    const slotIds = ['am1','am2','pm1','pm2']
    const slotInfo = store.timeSlots || defaultStore().timeSlots
    const checkins = store.checkins || []
    const members = store.members || []
    const schedule = store.schedule || {}

    const result = []
    for (const name of members) {
      const shifts = []
      for (const day of days) {
        const dayData = schedule[day]
        if (!dayData || typeof dayData !== 'object') continue
        // 本月内本星期对应的所有日期
        const dates = listDatesForWeekday(effStart, effEnd, day)
        for (const date of dates) {
          for (const slotId of slotIds) {
            const list = dayData[slotId]
            if (!Array.isArray(list) || !list.includes(name)) continue
            // 应用换班覆盖（如果该成员当日因换班不在该班次，则跳过）
            const effectiveMembers = getEffectiveSlotMembers(store, date, day, slotId)
            if (!effectiveMembers.includes(name)) continue

            // 打卡状态
            // 补签退记录没有 slotId（成员只填了姓名/日期/时间），需要按 SLOT_WINDOWS 时间窗反查所属 slot
            const sameDay = checkins.filter(c => c.name === name && c.date === date)
            const hasIn   = sameDay.some(c => c.type === 'in' && c.slotId === slotId)
            const hasOut  = sameDay.some(c => c.type === 'out' && c.slotId === slotId && !c.isSupp)
            const suppWin = SUPP_WINDOWS[slotId]
            const suppMatchesSlot = sameDay.some(c => {
              if (c.type !== 'out' || !c.isSupp) return false
              // 已经有 slotId 的补签退：直接比对；没有 slotId 的：按 supp 时间窗匹配
              // supp 窗口比签到窗口更宽（允许 slot 结束后 60min 内补签）
              if (c.slotId) return c.slotId === slotId
              if (!suppWin || !c.time) return false
              const t = String(c.time).slice(0, 5)
              return t >= suppWin.start && t <= suppWin.end
            })

            let status
            if (hasIn && hasOut)             status = 'completed'
            else if (hasIn && suppMatchesSlot) status = 'supp_completed'
            else if (hasIn)                  status = 'in_progress'
            else if (suppMatchesSlot)         status = 'supp_completed'  // 只有补签退无签到的边界
            else if (date < today)            status = 'missed'
            else if (date === today)          status = 'today'
            else                              status = 'pending'

            const sInfo = slotInfo.find(t => t.id === slotId)
            shifts.push({
              date,
              weekday: day,
              slotId,
              slotLabel: sInfo ? sInfo.label : slotId,
              status
            })
          }
        }
      }
      shifts.sort((a, b) => (a.date + a.slotId).localeCompare(b.date + b.slotId))

      const stats = {
        total:       shifts.length,
        completed:   shifts.filter(s => s.status === 'completed' || s.status === 'supp_completed').length,
        inProgress:  shifts.filter(s => s.status === 'in_progress').length,
        missed:      shifts.filter(s => s.status === 'missed').length,
        pending:     shifts.filter(s => s.status === 'pending' || s.status === 'today').length
      }

      // 该成员本月工时（包含打卡 + 已批准的补报；补签退也参与配对）
      const work = calculateMemberWorkTime(store, name, year, month)
      stats.totalHours = work.totalHours
      stats.totalPay   = work.totalPay
      stats.workDays   = work.workDays

      result.push({ name, shifts, stats })
    }

    // 按值班次数降序，再按姓名
    result.sort((a, b) => (b.stats.total - a.stats.total) || a.name.localeCompare(b.name, 'zh'))

    // 总体统计
    const totals = result.reduce((acc, m) => {
      acc.total       += m.stats.total
      acc.completed   += m.stats.completed
      acc.inProgress  += m.stats.inProgress
      acc.missed      += m.stats.missed
      acc.pending     += m.stats.pending
      acc.totalHours  += (m.stats.totalHours || 0)
      acc.totalPay    += (m.stats.totalPay   || 0)
      return acc
    }, { total: 0, completed: 0, inProgress: 0, missed: 0, pending: 0, totalHours: 0, totalPay: 0 })
    totals.totalHours = Math.round(totals.totalHours * 10) / 10
    totals.totalPay   = Math.round(totals.totalPay   * 10) / 10

    res.json({
      ok: true,
      year,
      month,
      period: { start: effStart, end: effEnd, source: periodSource },
      scheduleInfo: {
        scheduleStart: schedStart,
        scheduleEnd:   schedEnd,
        isConfirmed:   !!(schedStart && schedEnd)
      },
      today,
      totals,
      members: result
    })
  } catch (e) {
    console.error('monthly-shifts error:', e)
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
// ========== 2026-07-02 新增：每月例会管理 ==========
// 管理员：获取指定年月的例会定义
app.get('/api/admin/meetings', async (req, res) => {
  try {
    const year = parseInt(req.query.year)
    const month = parseInt(req.query.month)
    if (!year || !month) return res.status(400).json({ ok: false, msg: '缺少year/month参数' })
    const store = await readStore()
    const key = `${year}-${String(month).padStart(2, '0')}`
    const weeks = (store.meetings && store.meetings[key] && store.meetings[key].weeks) || []
    res.json({ ok: true, year, month, weeks })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 管理员：保存指定年月的例会定义（替换式，weeks 必传）
// body: { year, month, weeks: [{ week: 1, date: '2026-07-08', hours: 0.5 }, ...] }
app.post('/api/admin/meetings', async (req, res) => {
  try {
    const { year, month, weeks } = req.body || {}
    if (!year || !month) return res.status(400).json({ ok: false, msg: '缺少year/month参数' })
    if (!Array.isArray(weeks)) return res.status(400).json({ ok: false, msg: 'weeks 必须为数组' })
    
    const store = await readStore()
    if (!store.meetings) store.meetings = {}
    const key = `${year}-${String(month).padStart(2, '0')}`
    
    // 兜底清洗：丢掉非法条目（week 缺失/date 非 YYYY-MM-DD/hours 非有限数）
    const cleaned = weeks
      .filter(w => w && typeof w.week === 'number' && w.week >= 1)
      .map(w => ({
        week: w.week,
        date: (typeof w.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w.date)) ? w.date : null,
        hours: (typeof w.hours === 'number' && isFinite(w.hours) && w.hours >= 0) ? Math.round(w.hours * 2) / 2 : 0,
      }))
      .filter(w => w.date)
      .sort((a, b) => a.week - b.week)
    
    store.meetings[key] = { year, month, weeks: cleaned }
    await writeStore({ meetings: store.meetings })
    res.json({ ok: true, msg: '例会设置已保存', year, month, weeks: cleaned })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// 成员：获取指定年月的例会定义（同时返回当前已提交的参会状态，便于 UI 渲染回显）
app.get('/api/meetings', async (req, res) => {
  try {
    const year = parseInt(req.query.year)
    const month = parseInt(req.query.month)
    const name = req.query.name
    if (!year || !month) return res.status(400).json({ ok: false, msg: '缺少year/month参数' })
    
    const store = await readStore()
    const key = `${year}-${String(month).padStart(2, '0')}`
    const weeks = (store.meetings && store.meetings[key] && store.meetings[key].weeks) || []
    
    let attended = {}
    if (name) {
      const sub = ((store.workTimeClaim && store.workTimeClaim.submissions) || {})[name]
      if (sub && sub.meetingsAttended) attended = sub.meetingsAttended
    }
    
    res.json({ ok: true, year, month, weeks, attended })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

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

    // v5.0：开启申报时给所有成员发邮件
    if (isOpen && store.memberEmails && Object.keys(store.memberEmails).length > 0) {
      const tpl = buildWorktimeClaimOpenEmail(store, year, month)
      Object.values(store.memberEmails).forEach((email) => {
        if (!email) return
        sendEmail({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text })
          .catch(err => console.warn('[email] worktime-claim/toggle 邮件发送失败:', err))
      })
    }
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// v5.0：发送月度总结邮件（管理员手动触发）
// body: { year, month, name?: 'all'|string }
app.post('/api/admin/email/monthly-summary', async (req, res) => {
  try {
    const { year, month, name } = req.body || {}
    if (!year || !month) return res.json({ ok: false, msg: '缺少year/month参数' })
    const store = await readStore()
    const targets = (name && name !== 'all') ? [name] : (Object.keys(store.memberEmails || {}))
    let sentCount = 0
    let failCount = 0
    const results = []
    for (const n of targets) {
      const email = (store.memberEmails || {})[n]
      if (!email) { results.push({ name: n, ok: false, error: '未设置邮箱' }); continue }
      const tpl = buildMonthlySummaryEmail(store, n, year, month)
      // 重新 read 不必要，store 已经最新
      const r = await sendEmail({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text })
      results.push({ name: n, ok: r.ok, error: r.error })
      if (r.ok) sentCount++; else failCount++
    }
    res.json({ ok: true, sentCount, failCount, results })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// v5.0：测试邮件发送
app.post('/api/admin/email/test', async (req, res) => {
  try {
    const { to } = req.body || {}
    if (!to) return res.json({ ok: false, msg: '缺少收件人 to' })
    const result = await sendEmail({
      to,
      subject: '【测试】排班系统邮件连通性测试',
      text: '这是一封测试邮件，证明 SMTP 配置正确。\n如果你收到这封邮件说明 163 SMTP 已配置成功。',
      html: '<div style="font-family:Arial,sans-serif;padding:24px;background:#f9fafb;border-radius:8px"><h2 style="color:#8B1A1A">📧 邮件测试</h2><p>这是一封来自 <b>学工办助理排班管理系统</b> 的连通性测试邮件。</p><p style="color:#888;font-size:13px">如果你看到这封邮件，说明 SMTP 配置已生效。</p></div>',
    })
    if (result.ok) res.json({ ok: true, info: result.info })
    else res.json({ ok: false, error: result.error })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// v5.0：读邮件发送日志
app.get('/api/admin/email/logs', async (req, res) => {
  try {
    const store = await readStore()
    const logs = (store.emailLogs || []).slice(0, 100)
    res.json({ ok: true, logs })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// v5.0：管理员读所有成员的邮箱映射（{ name: email }，空字符串表示未设）
app.get('/api/admin/email/members', async (req, res) => {
  try {
    const store = await readStore()
    const emails = {}
    const list = store.members || []
    list.forEach(n => {
      emails[n] = (store.memberEmails && store.memberEmails[n]) || ''
    })
    res.json({ ok: true, emails, members: list })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// v5.0：修改成员邮箱（成员可改自己，管理员可改任意人）
// body: { name, email }  name 来自 currentUser（成员）或 body（管理员）
app.put('/api/member/email', async (req, res) => {
  try {
    const { name, email } = req.body || {}
    if (!name) return res.json({ ok: false, msg: '缺少姓名' })
    const value = (email || '').trim()
    // 简单邮箱格式校验
    if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return res.json({ ok: false, msg: '邮箱格式不正确' })
    const store = await readStore()
    if (!store.members.includes(name)) return res.json({ ok: false, msg: '成员不存在' })
    if (!store.memberEmails) store.memberEmails = {}
    store.memberEmails[name] = value
    await writeStore({ memberEmails: store.memberEmails })
    res.json({ ok: true, msg: '邮箱已更新' })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// v5.0：读某成员邮箱
app.get('/api/member/email', async (req, res) => {
  try {
    const name = req.query.name
    if (!name) return res.json({ ok: false, msg: '缺少姓名' })
    const store = await readStore()
    const email = (store.memberEmails && store.memberEmails[name]) || ''
    res.json({ ok: true, name, email })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// v5.0：成员个人信息（独立维护：银行账号、院系、学号、宿舍、电话）
// 首次进系统时必须完善，避免每月申报手填。
// PUT /api/member/profile body: { name, profile: { bankAccount, department, studentId, dorm, phone } }
app.get('/api/member/profile', async (req, res) => {
  try {
    const name = req.query.name
    if (!name) return res.json({ ok: false, msg: '缺少姓名' })
    const store = await readStore()
    let profile = (store.memberProfiles && store.memberProfiles[name]) || {}
    // 兜底：旧 submission 里的字段也回填（兼容历史）
    if (!profile.bankAccount || !profile.studentId || !profile.phone) {
      const sub = ((store.workTimeClaim && store.workTimeClaim.submissions) || {})[name]
      if (sub) {
        profile = {
          bankAccount: profile.bankAccount || sub.bankAccount || '',
          department:  profile.department  || sub.department  || '岭南学院',
          studentId:   profile.studentId   || sub.studentId   || '',
          dorm:        profile.dorm        || sub.dorm        || '',
          phone:       profile.phone       || sub.phone       || '',
        }
      }
    }
    res.json({ ok: true, name, profile })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

app.put('/api/member/profile', async (req, res) => {
  try {
    const { name, profile } = req.body || {}
    if (!name) return res.json({ ok: false, msg: '缺少姓名' })
    if (!profile || typeof profile !== 'object') return res.json({ ok: false, msg: 'profile 必须为对象' })
    const store = await readStore()
    if (!store.members.includes(name)) return res.json({ ok: false, msg: '成员不存在' })
    const clean = {
      bankAccount: String(profile.bankAccount || '').trim(),
      department:  String(profile.department || '岭南学院').trim(),
      studentId:   String(profile.studentId || '').trim(),
      dorm:        String(profile.dorm || '').trim(),
      phone:       String(profile.phone || '').trim(),
    }
    if (!store.memberProfiles) store.memberProfiles = {}
    store.memberProfiles[name] = clean
    await writeStore({ memberProfiles: store.memberProfiles })
    res.json({ ok: true, msg: '个人信息已保存', profile: clean })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '服务器错误' })
  }
})

// v5.0：成员读自己的所有已获得荣誉（v5.0.1：只显示当月，不再自动回溯 N 个月）
app.get('/api/member/achievements', async (req, res) => {
  try {
    const name = req.query.name
    if (!name) return res.json({ ok: false, msg: '缺少姓名' })
    const store = await readStore()
    // 当前 wtc 申报的年月（用户所在月份的"当月"）
    const wtc = store.workTimeClaim || {}
    const months = []
    if (wtc.year && wtc.month) months.push({ year: wtc.year, month: wtc.month })
    const allAchs = []
    months.forEach(({ year, month }) => {
      try {
        const achs = computeMemberMonthlyAchievements(store, name, year, month)
        achs.forEach(a => allAchs.push({ ...a, year, month }))
      } catch (_) {}
    })
    res.json({ ok: true, achievements: allAchs })
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
    const { name, bankAccount, department, studentId, dorm, phone, meetingsAttended } = req.body
    if (!name) return res.status(400).json({ ok: false, msg: '缺少name参数' })
    
    const store = await readStore()
    const wtc = store.workTimeClaim || { year: null, month: null, isOpen: false, submissions: {} }
    
    if (!wtc.isOpen) {
      return res.status(400).json({ ok: false, msg: '当前未开放工时申报' })
    }
    
    // 计算工时
    const workData = calculateMemberWorkTime(store, name, wtc.year, wtc.month)
    
    // 清洗例会参会勾选：只接受 { week: bool } 结构，丢掉非数字 key
    let sanitizedMeetings = {}
    if (meetingsAttended && typeof meetingsAttended === 'object') {
      const monthKey = `${wtc.year}-${String(wtc.month).padStart(2, '0')}`
      const monthMeetings = (store.meetings && store.meetings[monthKey] && store.meetings[monthKey].weeks) || []
      const validWeeks = new Set(monthMeetings.map(m => m.week))
      Object.entries(meetingsAttended).forEach(([k, v]) => {
        const wk = parseInt(k)
        if (validWeeks.has(wk)) sanitizedMeetings[wk] = !!v
      })
    }
    
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
      meetingsAttended: sanitizedMeetings,
      submittedAt: getBeijingDateTimeString()
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
// 返回：{ totalHours, totalPay, workByDate, workDays, daily }
//   daily: 数组，按月内日期顺序，每项 { date, weekday, isToday, scheduled, checkinSlots,
//          approvedOvertimes, pendingOvertimes, totalHours, status }
//   status: 'completed'(已打卡) | 'overtime'(已补报/补报覆盖缺勤) | 'absent'(缺勤) | 'none'(无排班无工作)
const SLOT_LABEL_MAP = { am1: '8:00-10:00', am2: '10:00-12:00', pm1: '14:30-16:00', pm2: '16:00-17:30' }

// 把任意 time 字段归一化为 "HH:MM"
// 普通打卡存的是 now.toISOString()（"YYYY-MM-DDTHH:MM:SS.sssZ"，UTC）
// 补签退存的是 "HH:MM:SS"（item.time + ':00'，已经是本地时间）
// 早期可能直接就是 "HH:MM"
// 2026-07-02 修复：ISO 时间是 UTC，需要 +8h 转 Beijing 时区；非 ISO 已经是本地时间
function normalizeHHMM(timeStr) {
  if (!timeStr) return ''
  const isoIdx = timeStr.indexOf('T')
  if (isoIdx >= 0) {
    // ISO 格式：解析为 UTC Date 对象，再转 Beijing (+8)
    const d = new Date(timeStr)
    if (!isNaN(d.getTime())) {
      const beijingMs = d.getTime() + 8 * 3600 * 1000
      const bj = new Date(beijingMs)
      const hh = String(bj.getUTCHours()).padStart(2, '0')
      const mm = String(bj.getUTCMinutes()).padStart(2, '0')
      return hh + ':' + mm
    }
    return ''
  }
  // 非 ISO（HH:MM 或 HH:MM:SS）已经是本地时间
  const [h, m] = timeStr.split(':')
  if (!h || !m) return timeStr
  return h.padStart(2, '0') + ':' + m.padStart(2, '0')
}
function calculateMemberWorkTime(store, name, year, month) {
  const checkins = store.checkins || []
  const allOvertimes = store.overtimes || []
  const overtimes = allOvertimes.filter(ot => ot.status === 'approved')
  
  // 月份范围
  const monthStart = new Date(year, month - 1, 1)
  const monthEnd = new Date(year, month, 0) // 月末
  const monthStartStr = monthStart.toISOString().slice(0, 10)
  const monthEndStr = monthEnd.toISOString().slice(0, 10)
  
  // 按日期汇总工时（每次打卡配对独立向上取整，不封顶2h）
  const workByDate = {}
  
  // 1. 打卡记录：每次 in/out 配对独立计算，连续班次自动合并
  const myCheckins = checkins.filter(c => c.name === name && c.date >= monthStartStr && c.date <= monthEndStr)
  const byDate = {}
  myCheckins.forEach(c => {
    if (!byDate[c.date]) byDate[c.date] = []
    byDate[c.date].push(c)
  })
  
  Object.keys(byDate).forEach(date => {
    const recs = byDate[date].sort((a, b) => a.time.localeCompare(b.time))
    const ins = recs.filter(r => r.type === 'in')
    // 拆成两个池：先配正常签退，没有时回退到补签退
    const normalOuts = recs.filter(r => r.type === 'out' && !r.isSupp)
    const suppOuts   = recs.filter(r => r.type === 'out' &&  r.isSupp)
    const usedOuts = new Set()

    // 在指定池中找最近的 out（含跨天回退）
    function findBestOutInPool(pool, iMin) {
      let best = null
      for (const o of pool) {
        if (usedOuts.has(o.id || o.time)) continue
        const oMin = timeToMinutes(o.time)
        if (oMin >= iMin && (!best || oMin < timeToMinutes(best.time))) best = o
      }
      if (!best) { // 跨天
        for (const o of pool) {
          if (usedOuts.has(o.id || o.time)) continue
          const oMin = timeToMinutes(o.time)
          if (oMin < iMin && (!best || oMin > timeToMinutes(best.time))) best = o
        }
      }
      return best
    }

    // Step 1: 为每个 in 找最近 out 配对（先正常签退，再回退到补签退）
    const rawPairs = []
    ins.forEach(iRec => {
      const iMin = timeToMinutes(iRec.time)
      let bestOut = findBestOutInPool(normalOuts, iMin)
      if (!bestOut) bestOut = findBestOutInPool(suppOuts, iMin)
      if (bestOut) {
        usedOuts.add(bestOut.id || bestOut.time)
        rawPairs.push({ in: iRec, out: bestOut, isSupp: !!bestOut.isSupp })
      } else {
        rawPairs.push({ in: iRec, out: null, isSupp: false })
      }
    })
    
    // Step 2: 连续班次合并（午休 11:30-15:00 或 gap<=180min 视为连续）
    const mergedPairs = []
    let currentMerge = null
    for (let pi = 0; pi < rawPairs.length; pi++) {
      if (!currentMerge) {
        currentMerge = { firstIn: rawPairs[pi].in, lastOut: rawPairs[pi].out, hasSupp: !!rawPairs[pi].isSupp, slots: [rawPairs[pi].in] }
      } else {
        const prevOutMin = currentMerge.lastOut ? timeToMinutes(currentMerge.lastOut.time) : -9999
        const curInMin = timeToMinutes(rawPairs[pi].in.time)
        const gap = curInMin - prevOutMin
        const isLunchBreak = (prevOutMin >= 11*60+30 && prevOutMin <= 13*60) && (curInMin >= 14*60 && curInMin <= 15*60)
        if ((gap >= 0 && gap <= 180) || isLunchBreak) {
          currentMerge.lastOut = rawPairs[pi].out
          if (rawPairs[pi].isSupp) currentMerge.hasSupp = true
          currentMerge.slots.push(rawPairs[pi].in)
        } else {
          mergedPairs.push(currentMerge)
          currentMerge = { firstIn: rawPairs[pi].in, lastOut: rawPairs[pi].out, hasSupp: !!rawPairs[pi].isSupp, slots: [rawPairs[pi].in] }
        }
      }
    }
    if (currentMerge) mergedPairs.push(currentMerge)
    
    // Step 3: 计算每个合并组的工时
    // 2026-07-02 v3 重写：按 slot 时间边界分配，支持同日多班连打
    // - 多个排班 slot：每个被覆盖的 slot 计完整时长（合并的 in/out pair 跨界覆盖）
    // - 单个排班 slot：cap 在 slot 标准时长内（溢出需补报）
    // - 无排班：回退到 slotByInTime 推断
    const scheduledSlots = getMemberScheduledSlots(store, date, name)
    const SLOT_BUF = 15  // 配对覆盖判定的 buffer（与 slotByInTime 对齐）

    mergedPairs.forEach(mp => {
      if (mp.lastOut) {
        const inMin = timeToMinutes(mp.firstIn.time)
        const outMin = timeToMinutes(mp.lastOut.time)
        let diffMinutes = outMin - inMin
        if (diffMinutes < 0) diffMinutes += 24 * 60

        // 限制 1：配对时长超过 4h 视为错配（跨天错填补签退的常见 bug）
        const originalDiff = diffMinutes
        if (diffMinutes > MAX_PAIR_DURATION_MIN) {
          diffMinutes = MAX_PAIR_DURATION_MIN
        }

        // 限制 2：按 slot 边界分配
        let cappedBySlot = false
        let rounded = 0
        const slotBreakdown = []

        if (scheduledSlots.length === 0) {
          // 无排班但有打卡：回退到单 slot 推断（按 firstIn 的 slotId 或 in-time）
          const slotId = (mp.firstIn && mp.firstIn.slotId) || slotByInTime(mp.firstIn.time)
          if (slotId && SLOT_HOURS[slotId]) {
            const slotCapMin = SLOT_HOURS[slotId] * 60
            if (diffMinutes > slotCapMin) { diffMinutes = slotCapMin; cappedBySlot = true }
            rounded = Math.ceil((Math.max(0, diffMinutes) / 60) * 2) / 2
            slotBreakdown.push({ slotId, hours: rounded })
          } else {
            rounded = Math.ceil((Math.max(0, diffMinutes) / 60) * 2) / 2
          }
        } else if (scheduledSlots.length === 1) {
          // 单 slot：cap 在 slot 标准时长（避免溢出浪费）
          const sid = scheduledSlots[0]
          const slotCapMin = SLOT_HOURS[sid] * 60
          if (diffMinutes > slotCapMin) { diffMinutes = slotCapMin; cappedBySlot = true }
          rounded = Math.ceil((Math.max(0, diffMinutes) / 60) * 2) / 2
          slotBreakdown.push({ slotId: sid, hours: rounded })
        } else {
          // 多 slot：每个被覆盖的 slot 计完整时长（in/out pair 跨过 slot 边界）
          for (const sid of scheduledSlots) {
            const { startMin, endMin } = SLOT_STANDARD_WINDOWS[sid]
            if (isPairCoveringSlot(inMin, outMin, startMin, endMin, SLOT_BUF)) {
              const h = SLOT_HOURS[sid]
              rounded += h
              slotBreakdown.push({ slotId: sid, hours: h })
            }
          }
          // 没覆盖到任何排班 slot：回退到按 firstIn 的 slotId 单 slot 算
          if (rounded === 0) {
            const slotId = (mp.firstIn && mp.firstIn.slotId) || slotByInTime(mp.firstIn.time)
            if (slotId && SLOT_HOURS[slotId]) {
              const slotCapMin = SLOT_HOURS[slotId] * 60
              if (diffMinutes > slotCapMin) { diffMinutes = slotCapMin; cappedBySlot = true }
              rounded = Math.ceil((Math.max(0, diffMinutes) / 60) * 2) / 2
              slotBreakdown.push({ slotId, hours: rounded })
            } else {
              rounded = Math.ceil((Math.max(0, diffMinutes) / 60) * 2) / 2
            }
          }
        }

        if (!workByDate[date]) workByDate[date] = { hours: 0, slots: [], checkinHours: 0, overtimeHours: 0 }
        workByDate[date].hours += rounded
        workByDate[date].checkinHours += rounded
        workByDate[date].slots.push({
          merged: true,
          slotCount: mp.slots.length,
          in: mp.firstIn.time,
          out: mp.lastOut.time,
          supp: !!mp.hasSupp,
          originalDuration: originalDiff,        // 原始配对时长（分钟），用于排查
          cappedBySlot,                          // true 表示被 slot 时长截断
          slotBreakdown,                         // v3：每个 slot 的分配工时（用于 UI/debug）
          scheduledSlots,                        // v3：当天所有排班 slot（用于 UI/debug）
        })
      } else {
        // 无签退：按成员当天排班的每个 slot 估算（v3：也支持多 slot）
        let estHours = 0
        const slotBreakdown = []
        const inMin = timeToMinutes(mp.firstIn.time)

        if (scheduledSlots.length === 0) {
          // 没排班：按 in-time 推断（与原来行为一致）
          const fallbackSid = (mp.firstIn && mp.firstIn.slotId) || slotByInTime(mp.firstIn.time)
          const sid = fallbackSid || 'am1'
          const h = SLOT_HOURS[sid] || 2
          const rounded = Math.ceil(h * 2) / 2
          estHours += rounded
          slotBreakdown.push({ slotId: sid, hours: rounded })
        } else {
          // 有排班：每个被 in-time 覆盖的 slot 计完整时长
          for (const sid of scheduledSlots) {
            const { startMin, endMin } = SLOT_STANDARD_WINDOWS[sid]
            if (isPairCoveringSlot(inMin, null, startMin, endMin, SLOT_BUF)) {
              const h = SLOT_HOURS[sid]
              const rounded = Math.ceil(h * 2) / 2
              estHours += rounded
              slotBreakdown.push({ slotId: sid, hours: rounded })
            }
          }
          // Fallback: 一个 slot 都没匹配上，按 in-record 的 slotId 兜底
          if (slotBreakdown.length === 0) {
            const sid = (mp.firstIn && mp.firstIn.slotId) || slotByInTime(mp.firstIn.time) || 'am1'
            const h = SLOT_HOURS[sid] || 2
            const rounded = Math.ceil(h * 2) / 2
            estHours += rounded
            slotBreakdown.push({ slotId: sid, hours: rounded })
          }
        }

        if (!workByDate[date]) workByDate[date] = { hours: 0, slots: [], checkinHours: 0, overtimeHours: 0 }
        workByDate[date].hours += estHours
        workByDate[date].checkinHours += estHours
        workByDate[date].slots.push({ estimated: true, slotCount: mp.slots.length, hours: estHours, slotBreakdown, scheduledSlots })
      }
    })
  })
  
  // 2. 已通过补报：按次累加，不限制每日一次
  overtimes.filter(ot => ot.name === name && ot.date >= monthStartStr && ot.date <= monthEndStr).forEach(ot => {
    const date = ot.date
    if (!workByDate[date]) workByDate[date] = { hours: 0, slots: [], checkinHours: 0, overtimeHours: 0 }
    const rounded = Math.ceil((ot.hours || 0) * 2) / 2
    workByDate[date].hours += rounded
    workByDate[date].overtimeHours += rounded
    workByDate[date].slots.push({ overtime: true, hours: ot.hours, content: ot.content })
  })
  
  // 总时长 = 每日累加（不再封顶2h/天）
  let totalHours = 0
  Object.values(workByDate).forEach(d => {
    d.finalHours = d.hours // 已按次向上取整
    totalHours += d.hours
  })

  // 2026-07-02 新增：把本月例会参会工时叠加进 totalHours
  // 例会参会数据来自 submissions[name].meetingsAttended（成员自己勾的）
  const monthKey = `${year}-${String(month).padStart(2, '0')}`
  const monthMeetings = (store.meetings && store.meetings[monthKey] && store.meetings[monthKey].weeks) || []
  const submissionForTotal = (store.workTimeClaim && store.workTimeClaim.submissions && store.workTimeClaim.submissions[name]) || null
  const meetingsAttendedForTotal = (submissionForTotal && submissionForTotal.meetingsAttended) || {}
  let meetingHoursTotal = 0
  monthMeetings.forEach(m => {
    if (meetingsAttendedForTotal[m.week]) meetingHoursTotal += (m.hours || 0)
  })
  totalHours += meetingHoursTotal

  const totalPay = parseFloat((totalHours * 25).toFixed(1))
  
  // ========== 构建每日明细（用于日历展示）==========
  // 状态判定规则：
  //   - 'completed' ✓ 已打卡（按班打卡，不论是否有补报）
  //   - 'overtime'  📝 仅补报（无打卡但有通过补报，覆盖缺勤或额外工作）
  //   - 'absent'    ⚠️ 缺勤（被排班且未打卡且无通过补报）
  //   - 'none'      — 无排班无工作
  const daysInMonth = new Date(year, month, 0).getDate()
  const todayStr = getBeijingDateString()
  const daily = []
  let absentCount = 0
  let overtimeCount = 0
  let completedCount = 0
  let incompleteCount = 0
  
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const weekday = dateToWeekday(dateStr)
    
    // 排班信息：检查该成员在指定日期的每个时段是否被排班
    const scheduled = []
    if (isDateInSchedulePeriod(store, dateStr) && ['周一','周二','周三','周四','周五'].includes(weekday)) {
      for (const slotId of ['am1', 'am2', 'pm1', 'pm2']) {
        const members = getEffectiveSlotMembers(store, dateStr, weekday, slotId)
        if (members.includes(name)) {
          scheduled.push({ slotId, label: SLOT_LABEL_MAP[slotId] || slotId })
        }
      }
    }
    
    // 打卡时段明细（已配对的 in/out，按 in 时间升序）
    const dayRecs = (byDate[dateStr] || []).slice().sort((a, b) => a.time.localeCompare(b.time))
    const checkinSlots = dayRecs
      .filter(r => r.type === 'in')
      .map(iRec => {
        // 找与该 in 配对的 out（同日，按已配对规则）
        const dayOuts = dayRecs.filter(r => r.type === 'out')
        const iMin = timeToMinutes(iRec.time)
        let bestOut = null
        for (const o of dayOuts) {
          const oMin = timeToMinutes(o.time)
          if (oMin >= iMin && (!bestOut || oMin < timeToMinutes(bestOut.time))) bestOut = o
        }
        if (!bestOut) {
          for (const o of dayOuts) {
            const oMin = timeToMinutes(o.time)
            if (oMin < iMin && (!bestOut || oMin > timeToMinutes(bestOut.time))) bestOut = o
          }
        }
        return {
          in: normalizeHHMM(iRec.time),
          out: bestOut ? normalizeHHMM(bestOut.time) : null,
          supp: !!(bestOut && bestOut.isSupp)
        }
      })
    
    // 补报记录（通过 / 待审核）
    const dayApproved = allOvertimes.filter(ot => ot.name === name && ot.date === dateStr && ot.status === 'approved')
    const dayPending  = allOvertimes.filter(ot => ot.name === name && ot.date === dateStr && ot.status === 'pending')
    const approvedOvertimes = dayApproved.map(ot => ({ hours: ot.hours, content: ot.content }))
    const pendingOvertimes  = dayPending.map(ot => ({ hours: ot.hours, content: ot.content }))
    
    const wbDate = workByDate[dateStr] || { hours: 0 }
    const hasAnyCheckin = checkinSlots.length > 0
    const hasCompletedCheckin = checkinSlots.some(cs => cs.out)
    const hasIncompleteCheckin = hasAnyCheckin && !hasCompletedCheckin
    const hasApprovedOt = approvedOvertimes.length > 0
    const hasPendingOt = pendingOvertimes.length > 0
    const isScheduled = scheduled.length > 0
    
    // 状态判定（优先级：完成 > 未完成签到 > 通过补报 > 待审补报 > 缺勤 > 无排班）
    let status = 'none'
    if (hasCompletedCheckin) {
      status = 'completed'
      completedCount++
    } else if (hasIncompleteCheckin) {
      // 有签到但没签退：按 2h 估算（已在 workByDate 中），不算缺勤
      status = 'incomplete'
      incompleteCount++
    } else if (hasApprovedOt) {
      // 规则：当天有通过的补报 → 算"补报"状态，不算缺勤
      status = 'overtime'
      overtimeCount++
    } else if (hasPendingOt) {
      // 有待审核补报：暂按"补报（待审）"展示
      status = 'overtime-pending'
    } else if (isScheduled) {
      status = 'absent'
      absentCount++
    } else {
      status = 'none'
    }
    
    daily.push({
      date: dateStr,
      weekday,
      isToday: dateStr === todayStr,
      scheduled,
      checkinSlots,
      approvedOvertimes,
      pendingOvertimes,
      totalHours: wbDate.hours || 0,
      status
    })
  }
  
  // 2026-07-02 新增：例会列表（带成员的参会状态，便于 UI 一并渲染）
  // 复用上面 totalHours 计算时已经取过的 monthMeetings + meetingsAttendedForTotal
  const meetings = monthMeetings.map(m => ({
    week: m.week,
    date: m.date,
    hours: m.hours,
    attended: !!meetingsAttendedForTotal[m.week],
    attendedHours: meetingsAttendedForTotal[m.week] ? (m.hours || 0) : 0
  }))

  return {
    totalHours,
    totalPay,
    workByDate,
    workDays: Object.keys(workByDate).length,
    daily,
    monthSummary: { completedDays: completedCount, incompleteDays: incompleteCount, overtimeDays: overtimeCount, absentDays: absentCount, daysInMonth },
    meetings,
  }
}

function timeToMinutes(timeStr) {
  if (!timeStr) return 0
  // 兼容三种格式：
  //   "HH:MM"            （如 "08:32"）
  //   "HH:MM:SS"         （如 "08:32:00"，补签退记录，已经本地时间）
  //   "YYYY-MM-DDTHH:MM:SS.sssZ"  （普通打卡存的是 now.toISOString()，UTC）
  // 2026-07-02 修复：ISO 时间是 UTC，需 +8h 转 Beijing；非 ISO 已经是本地时间
  const isoIdx = timeStr.indexOf('T')
  if (isoIdx >= 0) {
    const d = new Date(timeStr)
    if (!isNaN(d.getTime())) {
      const beijingMs = d.getTime() + 8 * 3600 * 1000
      const bj = new Date(beijingMs)
      return bj.getUTCHours() * 60 + bj.getUTCMinutes()
    }
    return 0
  }
  const [h, m] = timeStr.split(':').map(Number)
  if (isNaN(h) || isNaN(m)) return 0
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

// ========== 值班搭子留言 ==========

app.post('/api/partner-message', async (req, res) => {
  try {
    const store = await readStore()
    const { from, to, message } = req.body
    if (!from || !to || !message) return res.status(400).json({ ok: false, msg: '参数不完整' })
    if (message.length > 200) return res.status(400).json({ ok: false, msg: '留言不能超过200字' })
    const msg = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      from, to, message,
      createdAt: new Date().toISOString(),
      read: false
    }
    if (!store.partnerMessages) store.partnerMessages = []
    store.partnerMessages.push(msg)
    await writeStore({ partnerMessages: store.partnerMessages })
    res.json({ ok: true, msg: '留言发送成功' })
  } catch (e) {
    console.error('留言保存失败:', e)
    res.status(500).json({ ok: false, msg: '保存失败' })
  }
})

app.get('/api/partner-messages', async (req, res) => {
  const store = await readStore()
  const name = req.query.name
  if (!name) return res.status(400).json({ ok: false, msg: '缺少name参数' })
  // 返回发给该用户和该用户发出的所有留言（按时间倒序）
  const msgs = (store.partnerMessages || []).filter(m => m.to === name || m.from === name)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  res.json({ ok: true, messages: msgs })
})

app.put('/api/partner-message/:id/read', async (req, res) => {
  try {
    const store = await readStore()
    const id = req.params.id
    const msg = (store.partnerMessages || []).find(m => m.id === id)
    if (!msg) return res.status(404).json({ ok: false, msg: '留言不存在' })
    msg.read = true
    await writeStore({ partnerMessages: store.partnerMessages })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, msg: '操作失败' })
  }
})



// ========== 补签退申请 (v4.2) ==========
app.post('/api/supp-checkout', async (req, res) => {
  try {
    const { name, date, time, reason } = req.body
    if (!name || !date || !time) return res.json({ ok: false, msg: '参数不完整' })
    const store = await readStore()
    if (!store.suppCheckouts) store.suppCheckouts = []
    const dup = store.suppCheckouts.find(c => c.name === name && c.date === date && c.status === 'pending')
    if (dup) return res.json({ ok: false, msg: '该日期已有待审核的补签退申请' })
    const record = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      name, date, time, reason: reason || '',
      status: 'pending',
      createdAt: new Date().toISOString(),
      reviewedAt: null,
      reviewedBy: null,
      comment: ''
    }
    store.suppCheckouts.push(record)
    await writeStore(store)
    res.json({ ok: true, msg: '申请已提交' })
  } catch (e) { res.json({ ok: false, msg: '服务器错误' }) }
})

// 获取补签退列表（管理员）
app.get('/api/supp-checkouts', async (req, res) => {
  try {
    const store = await readStore()
    res.json({ ok: true, list: store.suppCheckouts || [] })
  } catch (e) { res.json({ ok: false, msg: '服务器错误' }) }
})

// 审核补签退（管理员）
app.put('/api/supp-checkout/:id/review', async (req, res) => {
  try {
    const { id } = req.params
    const { action, comment } = req.body
    if (!['approve', 'reject'].includes(action)) return res.json({ ok: false, msg: '无效操作' })
    const store = await readStore()
    const item = (store.suppCheckouts || []).find(c => c.id === id)
    if (!item) return res.json({ ok: false, msg: '记录不存在' })
    if (item.status !== 'pending') return res.json({ ok: false, msg: '该申请已审核' })
    item.status = action === 'approve' ? 'approved' : 'rejected'
    item.reviewedAt = new Date().toISOString()
    item.reviewedBy = req.body.adminName || 'admin'
    item.comment = comment || ''
    if (action === 'approve') {
      if (!store.checkins) store.checkins = []
      store.checkins.push({
        id: 'supp_' + item.id,
        name: item.name,
        date: item.date,
        time: item.time + ':00',
        type: 'out',
        isSupp: true,
        latitude: null,
        longitude: null,
        createdAt: new Date().toISOString()
      })
    }
    await writeStore(store)
    res.json({ ok: true, msg: action === 'approve' ? '已通过' : '已拒绝' })
  } catch (e) { res.json({ ok: false, msg: '服务器错误' }) }
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

// ========== v5.1 邮件模块（多 provider，自动 fallback）============
// 设计：Render 平台出站 SMTP 端口被黑洞（ETIMEDOUT/ENETUNREACH）。
//       改用 HTTP API（443 端口）可绕过。四个 provider 自动选择：
//         1) SENDGRID_API_KEY 设置 → 走 SendGrid HTTP API（推荐，支持 163.com 等免费邮箱作为 Single Sender）
//         2) BREVO_API_KEY 设置    → 走 Brevo HTTP API（需要自有域名，免费邮箱被拒）
//         3) RESEND_API_KEY 设置   → 走 Resend HTTP API（需先 verify 域才能群发）
//         4) 都没设                → 走 nodemailer/SMTP（兼容老配置，本地调试用）
//       可用 MAIL_PROVIDER 强制指定，否则按 env 自动判定。

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY  // SG.xxx（注意保密）
const SENDGRID_FROM    = process.env.SENDGRID_FROM     // 'lnxyxgbss@163.com'（已通过 Single Sender Verification）
const BREVO_API_KEY    = process.env.BREVO_API_KEY     // xkeysib-xxx
const BREVO_FROM       = process.env.BREVO_FROM        // 已 verify 域的发件邮箱
const RESEND_API_KEY   = process.env.RESEND_API_KEY    // re_xxx
const RESEND_FROM      = process.env.RESEND_FROM       // 'noreply@yourdomain.com'

function pickProvider() {
  if (process.env.MAIL_PROVIDER === 'sendgrid' && SENDGRID_API_KEY) return 'sendgrid'
  if (process.env.MAIL_PROVIDER === 'brevo'    && BREVO_API_KEY)    return 'brevo'
  if (process.env.MAIL_PROVIDER === 'resend'   && RESEND_API_KEY)   return 'resend'
  if (process.env.MAIL_PROVIDER === 'smtp')                         return 'smtp'
  // auto: 优先 sendgrid > brevo > resend > smtp
  if (SENDGRID_API_KEY) return 'sendgrid'
  if (BREVO_API_KEY)    return 'brevo'
  if (RESEND_API_KEY)   return 'resend'
  return 'smtp'
}

// Brevo（原 Sendinblue）HTTP API — 免费 300 封/天，无需自有域名，只需 verify 发件邮箱
// SendGrid HTTP API — 免费 100 封/天，支持 Single Sender Verification（可用 163.com 等免费邮箱）
async function sendViaSendGrid(opts) {
  const payload = {
    personalizations: [{ to: [{ email: opts.to }] }],
    from: { email: SENDGRID_FROM, name: MAIL_FROM_NAME },
    subject: opts.subject || '',
    content: [
      { type: 'text/plain', value: opts.text || '' },
      { type: 'text/html',  value: opts.html || '' }
    ]
  }
  const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
  // SendGrid 成功时返回 202 + 空 body，不要 try parse JSON
  if (r.status === 202) return { messageId: r.headers.get('x-message-id') || '' }
  const body = await r.text()
  throw new Error(`SendGrid HTTP ${r.status}: ${body}`)
}

async function sendViaBrevo(opts) {
  const payload = {
    sender: { name: MAIL_FROM_NAME, email: BREVO_FROM },
    to: [{ email: opts.to }],
    subject: opts.subject || '',
    htmlContent: opts.html || '',
    textContent: opts.text || ''
  }
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': BREVO_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(payload)
  })
  if (!r.ok) {
    const body = await r.text()
    throw new Error(`Brevo HTTP ${r.status}: ${body}`)
  }
  return await r.json()
}

// Resend HTTP API — 免费 100/天 + 3000/月，免费测试域只发给账户持有人，需 verify 域才能群发
async function sendViaResend(opts) {
  const payload = {
    from: `${MAIL_FROM_NAME} <${RESEND_FROM}>`,
    to: opts.to,
    subject: opts.subject || '',
    html: opts.html || '',
    text: opts.text || ''
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
  if (!r.ok) {
    const body = await r.text()
    throw new Error(`Resend HTTP ${r.status}: ${body}`)
  }
  return await r.json()
}

// 创建并复用 transporter（懒加载）—— 仅当 fallback 到 SMTP 时用到
let _transporter = null
function getMailer() {
  if (_transporter) return _transporter
  _transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    // 显式设置超时，避免 SMTP 卡住让前端显示"发送中"挂死
    connectionTimeout: 15000,
    greetingTimeout:  15000,
    socketTimeout:    30000,
  })
  return _transporter
}

// 核心发送：调用后阻塞异步发送，并把结果写入 store.emailLogs
// opts: { to, subject, html, text, fromName? }
// 返回: { ok, info?, error?, provider? }
async function sendEmail(opts) {
  const store = await readStore()
  if (!opts || !opts.to) return { ok: false, error: '缺少收件人' }
  const provider = pickProvider()
  const log = {
    at: getBeijingDateTimeString(),
    to: opts.to,
    subject: opts.subject || '',
    status: 'pending',
    provider,
  }
  function appendLog(entry) {
    store.emailLogs = Array.isArray(store.emailLogs) ? store.emailLogs : []
    store.emailLogs.unshift(entry)
    if (store.emailLogs.length > 200) store.emailLogs.length = 200
    try { writeStore({ emailLogs: store.emailLogs }) } catch (_) {}
  }
  appendLog(log)
  try {
    let info
    if (provider === 'sendgrid') {
      info = await sendViaSendGrid(opts)
    } else if (provider === 'brevo') {
      info = await sendViaBrevo(opts)
    } else if (provider === 'resend') {
      info = await sendViaResend(opts)
    } else {
      const mailer = getMailer()
      info = await mailer.sendMail({
        from: `"${SMTP_FROM_NAME}" <${SMTP_USER}>`,
        to: opts.to,
        subject: opts.subject || '',
        text: opts.text || '',
        html: opts.html || '',
      })
    }
    log.status = 'ok'
    log.messageId = (info && (info.messageId || info.id)) || ''
    appendLog(log)
    return { ok: true, info, provider }
  } catch (e) {
    log.status = 'fail'
    log.error = (e && (e.message || String(e))) || '未知错误'
    // v5.0.2：ETIMEDOUT/ENETUNREACH 常见是部署平台到 SMTP 服务器的网络问题（不是配置问题），给运维提示
    if (e && (e.code === 'ETIMEDOUT' || e.code === 'ENETUNREACH' || e.code === 'ECONNREFUSED')) {
      log.error = log.error + ' ｜ 诊断：部署平台（如 Render）到 ' + SMTP_HOST + ':' + SMTP_PORT + ' 的出站网络不通。建议换 Brevo/Resend/SendGrid 等 HTTP API 服务。'
    }
    // Brevo/Resend 401/403 提示凭据问题
    if (typeof log.error === 'string' && /\b(401|403)\b/.test(log.error)) {
      log.error = log.error + ' ｜ 诊断：API Key 无效或发件邮箱未 verify。Brevo 需在 Brevo 控制台 verify 发件邮箱；Resend 免费 plan 需 verify 自有域。'
    }
    appendLog(log)
    return { ok: false, error: log.error, provider }
  }
}

// ========== v5.0 称号算法 ==========
// 评定一个成员在某月获得的称号（数组），可叠加

// 某成员的月度累计工时（按 store.allLogs 计算，跨月累计）
function getMemberTotalHours(store, name) {
  let total = 0
  const months = new Set()
  // 用 allLogs 是更优雅但没存，就用 submissions[name] 不全
  // 简化为：从各月 workTimeClaim.submissions 累加；如果没值则返回 0
  if (store.workTimeClaim && store.workTimeClaim.submissions && store.workTimeClaim.submissions[name]) {
    total = store.workTimeClaim.submissions[name].totalHours || 0
  }
  // 退路：用 overtime approved 累加
  if (store.overtimes) {
    store.overtimes.forEach(ot => {
      if (ot.name === name && ot.status === 'approved') total += (ot.hours || 0)
    })
  }
  // 也累加上已批准 schedule hours / 没有好源数据时跳过
  return total
}

// 计算某成员当月 day-detail（用于称号判定）
function computeMemberMonthlyAchievements(store, name, year, month) {
  const achs = []
  if (!store.workTimeClaim || !store.workTimeClaim.year || !store.workTimeClaim.month) {
    return achs
  }
  const wtc = store.workTimeClaim
  // 复用之前的 calculateMemberWorkTime
  let workData
  try {
    workData = calculateMemberWorkTime(store, name, wtc.year, wtc.month)
  } catch (_) {
    workData = {}
  }
  const ms = workData.monthSummary || {}
  const daily = workData.daily || []
  const meetings = workData.meetings || []

  // 🏆 全勤达人：本月所有排班天都完成（completed），且至少有一天排班
  const scheduledDays = daily.filter(d => d.scheduled && d.scheduled.length > 0)
  const completedDays = scheduledDays.filter(d => d.status === 'completed' || d.status === 'incomplete')
  if (scheduledDays.length >= 3 && completedDays.length === scheduledDays.length) {
    achs.push({ id: 'full_attend', icon: '🏆', name: '本月全勤达人', desc: '本月所有排班天都准时打卡' })
  }

  // 🌟 例会全勤：本月所有例会都参会
  if (meetings.length > 0 && meetings.every(m => m.attended)) {
    achs.push({ id: 'meeting_full', icon: '🌟', name: '例会全勤', desc: '本月所有例会都参会了' })
  }

  // ⏰ 守时之神：本月 5 天以上签到记录时间在 [班次-15min, 班次+5min] 范围内（v1 简化：要求所有有数据的签到都守时）
  // 这里略复杂：暂不实现，v2 时再做

  // 📚 学习标兵（v1 临时用例会时长达到阈值的标签）
  const meetingHours = meetings.reduce((s, m) => s + (m.attendedHours || 0), 0)
  if (meetingHours >= 1.5) {
    achs.push({ id: 'learner', icon: '📚', name: '学习标兵', desc: '本月例会参会 ≥ ' + meetingHours.toFixed(1) + ' 小时' })
  }

  // 🌙 深夜值班：本月有至少 2 次 pm2 班次打卡
  const lateShifts = daily.filter(d =>
    d.scheduled && d.scheduled.some(s => s.slotId === 'pm2') && (d.status === 'completed' || d.status === 'incomplete')
  ).length
  if (lateShifts >= 2) {
    achs.push({ id: 'late_shift', icon: '🌙', name: '深夜守护者', desc: '本月完成 ' + lateShifts + ' 个 pm2 班次' })
  }

  // ⭐ 累计里程碑（100h/200h/500h/1000h）—— 跨月累计
  const totalHours = getMemberTotalHours(store, name)
  const milestones = [100, 200, 500, 1000]
  milestones.forEach(ms_val => {
    if (totalHours >= ms_val && totalHours < ms_val + 10) {  // 只在刚跨过节点那一周给
      // v1 简化：每个里程碑都展示（不要求"首次跨过"）
      achs.push({
        id: 'milestone_' + ms_val,
        icon: '🥇',
        name: '累计 ' + ms_val + ' 小时',
        desc: '你已累计值班 ' + totalHours.toFixed(1) + ' 小时',
      })
    }
  })

  // 🎯 单日标准：本月有 1 天以上达到当天 3h+ 班次（勤奋型）
  const heavyDays = daily.filter(d => (d.totalHours || 0) >= 3).length
  if (heavyDays >= 1) {
    achs.push({ id: 'hard_worker', icon: '💪', name: '勤奋之星', desc: '本月有 ' + heavyDays + ' 天超过 3 小时' })
  }

  // 🐦 早起鸟：本月有 am1 或 am2 班次打卡（前提 am 班）
  const morningShifts = daily.filter(d =>
    d.scheduled && d.scheduled.some(s => s.slotId === 'am1' || s.slotId === 'am2') && (d.status === 'completed' || d.status === 'incomplete')
  ).length
  if (morningShifts >= 1) {
    achs.push({ id: 'early_bird', icon: '🐦', name: '早起鸟', desc: '本月完成 ' + morningShifts + ' 个早班' })
  }

  // 🌈 满勤+例会双满：本月全勤 + 例会全勤 都达成
  const hasFull = achs.some(a => a.id === 'full_attend')
  const hasMeetFull = achs.some(a => a.id === 'meeting_full')
  if (hasFull && hasMeetFull) {
    achs.push({ id: 'double_perfect', icon: '🌈', name: '双满贯', desc: '本月值班 + 例会双全勤' })
  }

  return achs
}

// ========== v5.0 邮件模板 ==========

// 月度总结邮件 HTML 模板
function buildMonthlySummaryEmail(store, name, year, month) {
  let workData
  try { workData = calculateMemberWorkTime(store, name, year, month) } catch (_) { workData = {} }
  const totalHours = workData.totalHours || 0
  const totalPay = workData.totalPay || 0
  const days = (workData.daily || []).filter(d => (d.totalHours > 0) || (d.scheduled && d.scheduled.length > 0))
  const meetings = workData.meetings || []
  const achs = computeMemberMonthlyAchievements(store, name, year, month)

  // 日历字符串
  const monthLabel = year + ' 年 ' + month + ' 月'
  const subject = `【${SMTP_FROM_NAME}】${name} · ${monthLabel} 工时与荣誉总结`

  // 行（每天）：简洁
  const dayRows = days.map(d => {
    const statusCls = d.status === 'completed' ? '#d1fae5' : d.status === 'incomplete' ? '#dbeafe' : d.status === 'overtime' ? '#fef3c7' : d.status === 'absent' ? '#fee2e2' : '#f3f4f6'
    const statusText = ({completed:'✓完成', incomplete:'🕐待补', overtime:'📝补报', 'overtime-pending':'⏳待审', absent:'⚠️缺勤', none:'—'})[d.status] || d.status
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eef0f3;color:#444">${d.date.slice(5)} ${d.weekday || ''}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eef0f3;text-align:center">
        <span style="padding:2px 8px;border-radius:10px;font-size:12px;background:${statusCls}">${statusText}</span>
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #eef0f3;text-align:right;font-weight:600">${(d.totalHours || 0).toFixed(1)}h</td>
    </tr>`
  }).join('')

  // 称号行
  const achRows = achs.map(a => `
    <tr><td style="padding:14px 18px;font-size:28px;width:60px;vertical-align:top">${a.icon}</td>
    <td style="padding:14px 18px;vertical-align:top">
      <div style="font-size:15px;font-weight:700;color:#7c3aed;margin-bottom:4px">${a.name}</div>
      <div style="font-size:13px;color:#666">${a.desc}</div>
    </td></tr>`).join('')

  // 例会行
  const meetRows = meetings.map(m => `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0">第 ${m.week} 周 · ${m.date}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;text-align:right;color:${m.attended ? '#166534' : '#9ca3af'}">${m.attended ? '✅ 参会 · ' + m.hours + 'h' : '○ 未参会 · ' + m.hours + 'h'}</td>
    </tr>`).join('')

  const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:'Microsoft YaHei',Arial,sans-serif;color:#333">
  <div style="max-width:680px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06)">
    <div style="background:linear-gradient(135deg,#8B1A1A,#c9302c);color:#fff;padding:28px 36px;text-align:center">
      <div style="font-size:13px;opacity:0.85;letter-spacing:2px">中山大学岭南学院 · 学工办助理</div>
      <h1 style="margin:8px 0 0;font-size:24px;font-weight:600">${monthLabel} 工时与荣誉总结</h1>
    </div>

    <div style="padding:24px 36px">
      <div style="font-size:15px;line-height:1.7;margin-bottom:6px">亲爱的 <b style="color:#8B1A1A">${name}</b> 同学：</div>
      <div style="font-size:14px;line-height:1.7;color:#555;margin-bottom:20px">这是你 ${monthLabel} 的勤工助学值班总结，请查收。</div>

      <div style="display:flex;gap:14px;margin-bottom:24px;text-align:center">
        <div style="flex:1;padding:18px;background:linear-gradient(135deg,#fef3c7,#fde68a);border-radius:10px">
          <div style="font-size:13px;color:#92400e">累计工时</div>
          <div style="font-size:28px;font-weight:700;color:#92400e;margin-top:4px">${totalHours.toFixed(1)}<span style="font-size:14px">h</span></div>
        </div>
        <div style="flex:1;padding:18px;background:linear-gradient(135deg,#fce7f3,#fbcfe8);border-radius:10px">
          <div style="font-size:13px;color:#9d174d">本月报酬</div>
          <div style="font-size:28px;font-weight:700;color:#9d174d;margin-top:4px">¥${totalPay.toFixed(1)}</div>
        </div>
        <div style="flex:1;padding:18px;background:linear-gradient(135deg,#dbeafe,#bfdbfe);border-radius:10px">
          <div style="font-size:13px;color:#1e40af">值班天数</div>
          <div style="font-size:28px;font-weight:700;color:#1e40af;margin-top:4px">${ms_days(workData)}<span style="font-size:14px">天</span></div>
        </div>
      </div>

      ${achs.length > 0 ? `
      <h2 style="font-size:17px;margin:24px 0 12px;color:#8B1A1A;letter-spacing:1px">🏅 本月获得的荣誉</h2>
      <table style="width:100%;border-collapse:collapse;background:#faf6ff;border:1px solid #e9d5ff;border-radius:10px;overflow:hidden">${achRows}</table>
      ` : `
      <div style="margin:20px 0;padding:14px;background:#f9fafb;border-radius:8px;color:#666;font-size:14px;text-align:center">💪 本月暂未获得荣誉称号，继续加油！</div>
      `}

      ${meetings.length > 0 ? `
      <h2 style="font-size:17px;margin:24px 0 12px;color:#8B1A1A;letter-spacing:1px">📅 本月例会参会</h2>
      <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden"><tbody>${meetRows || '<tr><td style="padding:14px;text-align:center;color:#999" colspan="2">本月无例会</td></tr>'}</tbody></table>
      ` : ''}

      <h2 style="font-size:17px;margin:24px 0 12px;color:#8B1A1A;letter-spacing:1px">📋 每日明细</h2>
      <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-size:13px">
        <thead><tr style="background:#f8fafc"><th style="padding:10px 12px;text-align:left;border-bottom:1px solid #e5e7eb">日期</th><th style="padding:10px 12px;border-bottom:1px solid #e5e7eb">状态</th><th style="padding:10px 12px;text-align:right;border-bottom:1px solid #e5e7eb">工时</th></tr></thead>
        <tbody>${dayRows || '<tr><td colspan="3" style="padding:20px;text-align:center;color:#999">本月无排班和打卡记录</td></tr>'}</tbody>
      </table>

      <div style="margin-top:28px;padding:16px;background:#fef9c3;border-left:4px solid #facc15;border-radius:6px;font-size:13px;color:#713f12;line-height:1.6">
        💡 <b>温馨提示</b>：如有疑问或数据不符，请登录系统核对每周打卡记录，或在工作群联系管理员。
      </div>
    </div>

    <div style="padding:18px 36px;background:#f9fafb;border-top:1px solid #eef0f3;font-size:12px;color:#888;text-align:center;line-height:1.6">
      ${SMTP_FROM_NAME}<br>
      本邮件由系统自动发送，请勿直接回复
    </div>
  </div>
</body></html>`

  const text = `${monthLabel} 工时与荣誉总结\n姓名：${name}\n累计工时：${totalHours.toFixed(1)}h\n本月报酬：¥${totalPay.toFixed(1)}\n荣誉：${achs.map(a => a.name).join('、') || '无'}`
  return { subject, html, text }
}

function ms_days(workData) {
  const ms = (workData && workData.monthSummary) || {}
  return (ms.completedDays || 0) + (ms.overtimeDays || 0)
}

// 其他通用模板
function buildScheduleConfirmEmail(store, scheduleStart, scheduleEnd, days, slotCount) {
  const subject = `【${SMTP_FROM_NAME}】${formatMonth(new Date(scheduleStart))}排班已开启，请尽快选班`
  const html = `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f6f7f9;font-family:'Microsoft YaHei',Arial,sans-serif">
<div style="max-width:600px;margin:24px auto;background:#fff;border-radius:10px;padding:32px">
  <h2 style="color:#8B1A1A;margin:0 0 18px">📅 排班已开启</h2>
  <p style="line-height:1.7;color:#444">新一轮排班表已发布，请尽快登录系统选班。</p>
  <div style="padding:16px;background:#fef3c7;border-radius:8px;margin:18px 0">
    <div><b>排班周期：</b>${scheduleStart} ~ ${scheduleEnd}</div>
    <div><b>已排时段数：</b>${slotCount}</div>
  </div>
  <p style="color:#888;font-size:13px">${SMTP_FROM_NAME} · 自动通知</p>
</div>
</body></html>`
  return { subject, html, text: `排班已开启：${scheduleStart} ~ ${scheduleEnd}` }
}

function buildWorktimeClaimOpenEmail(store, year, month) {
  const subject = `【${SMTP_FROM_NAME}】${year} 年 ${month} 月工时申报已开放`
  const html = `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f6f7f9;font-family:'Microsoft YaHei',Arial,sans-serif">
<div style="max-width:600px;margin:24px auto;background:#fff;border-radius:10px;padding:32px">
  <h2 style="color:#8B1A1A;margin:0 0 18px">💼 月度工时申报已开放</h2>
  <p style="line-height:1.7;color:#444">${year} 年 ${month} 月工时申报已开放，请登录系统核对工时并提交。</p>
  <div style="padding:16px;background:#dbeafe;border-radius:8px;margin:18px 0;color:#1e40af">
    ⏰ 请在管理员关闭申报之前提交
  </div>
  <p style="color:#888;font-size:13px">${SMTP_FROM_NAME} · 自动通知</p>
</div>
</body></html>`
  return { subject, html, text: `${year} 年 ${month} 月工时申报已开放` }
}

function buildPasswordResetEmail(name, newPassword) {
  const subject = `【${SMTP_FROM_NAME}】密码已重置通知`
  const html = `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f6f7f9;font-family:'Microsoft YaHei',Arial,sans-serif">
<div style="max-width:600px;margin:24px auto;background:#fff;border-radius:10px;padding:32px">
  <h2 style="color:#8B1A1A;margin:0 0 18px">🔑 密码已重置</h2>
  <p style="line-height:1.7;color:#444">管理员已为账号 <b style="color:#8B1A1A">${name}</b> 重置登录密码：</p>
  <div style="padding:18px;background:#f3f4f6;border-radius:8px;margin:18px 0;text-align:center">
    <div style="font-size:28px;font-weight:700;letter-spacing:4px;color:#8B1A1A;font-family:Consolas,Monaco,monospace">${newPassword}</div>
  </div>
  <p style="line-height:1.7;color:#666;font-size:13px">⚠️ 请尽快登录系统并在"修改密码"中重置成自己的密码。如非本人操作请及时联系管理员。</p>
  <p style="color:#888;font-size:13px">${SMTP_FROM_NAME} · 自动通知</p>
</div>
</body></html>`
  return { subject, html, text: `账号 ${name} 密码已重置为：${newPassword}` }
}

function formatMonth(d) {
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月'
}
