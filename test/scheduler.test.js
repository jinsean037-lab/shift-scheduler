const test = require('node:test')
const assert = require('node:assert/strict')

const {
  addMemberToStore,
  autoCloseExpiredCheckins,
  buildMemberWeekSchedule,
  calculateMemberWorkTime,
  calculateAutoOvertimeHours,
  defaultStore,
  getMemberTodayStatus,
  checkinDistanceMeters,
  normalizeMaxPerSlot,
  removeMemberRelatedData,
  slotOverlapMinutes,
  wgs84ToGcj02,
} = require('../backend/server')

test('adding a member preserves existing passwords and creates only the new account', () => {
  const store = defaultStore()
  store.members = ['旧成员']
  store.passwords = { '旧成员': 'changed-password' }

  const result = addMemberToStore(store, '新成员', '654321')

  assert.equal(result.ok, true)
  assert.equal(store.passwords['旧成员'], 'changed-password')
  assert.equal(store.passwords['新成员'], '654321')
  assert.deepEqual(store.memberProfiles['新成员'], {})
  assert.equal(store.memberEmails['新成员'], '')
})

test('removing a member supports nested schedules and cleans related data', () => {
  const store = defaultStore()
  store.members = ['甲', '乙']
  store.passwords = { '甲': '111111', '乙': '222222' }
  store.schedule = { '周一': { am1: ['甲', '乙'], pm1: ['甲'] } }
  store.scheduleTime = { '周一|am1|甲': 1, '周一|am1|乙': 2 }
  store.waitlist = [{ name: '甲', day: '周二', slotId: 'am1' }]
  store.memberEmails = { '甲': 'a@example.com', '乙': 'b@example.com' }
  store.memberProfiles = { '甲': { phone: '1' }, '乙': { phone: '2' } }

  removeMemberRelatedData(store, '甲')

  assert.deepEqual(store.schedule['周一'].am1, ['乙'])
  assert.equal(store.schedule['周一'].pm1, undefined)
  assert.equal(store.scheduleTime['周一|am1|甲'], undefined)
  assert.equal(store.passwords['甲'], undefined)
  assert.equal(store.memberEmails['甲'], undefined)
  assert.equal(store.memberProfiles['甲'], undefined)
  assert.deepEqual(store.waitlist, [])
})

test('multi-slot work time is based on actual overlap, not any tiny intersection', () => {
  assert.equal(slotOverlapMinutes(15 * 60 + 50, 16 * 60 + 10, 14 * 60 + 30, 16 * 60, 15), 20)

  const store = defaultStore()
  store.members = ['甲']
  store.scheduleStart = '2026-06-01T00:00:00+08:00'
  store.scheduleEnd = '2026-06-30T23:59:59+08:00'
  store.schedule = { '周一': { pm1: ['甲'], pm2: ['甲'] } }
  store.checkins = [
    { id: 'in1', name: '甲', date: '2026-06-01', time: '15:50:00', type: 'in', slotId: 'pm1' },
    { id: 'out1', name: '甲', date: '2026-06-01', time: '16:10:00', type: 'out', slotId: 'pm1' },
  ]

  const data = calculateMemberWorkTime(store, '甲', 2026, 6)

  assert.equal(data.workByDate['2026-06-01'].checkinHours, 1)
})

test('shift capacity setting is normalized to a 1-10 integer', () => {
  assert.equal(normalizeMaxPerSlot('3'), 3)
  assert.equal(normalizeMaxPerSlot(2.8), 2)
  assert.equal(normalizeMaxPerSlot(0), 1)
  assert.equal(normalizeMaxPerSlot(11), 1)
  assert.equal(normalizeMaxPerSlot('bad', 4), 4)
})

test('auto overtime rounds excess checkout duration to half hours', () => {
  assert.equal(calculateAutoOvertimeHours('am1', '07:45:00', '10:30:00'), 1)
  assert.equal(calculateAutoOvertimeHours('am1', '08:00:00', '10:20:00'), 0.5)
  assert.equal(calculateAutoOvertimeHours('pm1', '14:30:00', '16:00:00'), 0)
})

test('checkin distance accepts both web and mini program coordinate systems', () => {
  const center = { lat: 23.1036, lng: 113.2936 }
  const miniProgramCenter = wgs84ToGcj02(center.lat, center.lng)

  assert.ok(checkinDistanceMeters(center.lat, center.lng) < 1)
  assert.ok(checkinDistanceMeters(miniProgramCenter.lat, miniProgramCenter.lng) < 1)
})

test('member today status reflects shared checkin records', () => {
  const store = defaultStore()
  store.members = ['甲']
  store.scheduleStart = '2026-09-14T00:00:00+08:00'
  store.scheduleEnd = '2026-09-20T23:59:59+08:00'
  store.schedule = { '周二': { am1: ['甲'] } }
  store.checkins = [
    { id: 'in1', name: '甲', date: '2026-09-15', time: '2026-09-15T00:05:00.000Z', type: 'in', slotId: 'am1' },
  ]

  let status = getMemberTodayStatus(store, '甲', '2026-09-15')
  assert.equal(status.shifts[0].status, 'in_progress')

  store.checkins.push({ id: 'out1', name: '甲', date: '2026-09-15', time: '2026-09-15T02:00:00.000Z', type: 'out', slotId: 'am1' })
  status = getMemberTodayStatus(store, '甲', '2026-09-15')
  assert.equal(status.shifts[0].status, 'completed')
})

test('weekly schedule uses approved substitute overrides', () => {
  const store = defaultStore()
  store.members = ['甲', '乙']
  store.scheduleStart = '2026-09-14T00:00:00+08:00'
  store.scheduleEnd = '2026-09-20T23:59:59+08:00'
  store.schedule = { '周一': { am1: ['甲'] } }
  store.shiftSubstituteOverrides = [{
    id: 'sub1',
    from: '甲',
    to: '乙',
    date: '2026-09-14',
    day: '周一',
    slotId: 'am1',
    status: 'approved'
  }]

  const week = buildMemberWeekSchedule(store, '2026-09-16')

  assert.equal(week.weekStart, '2026-09-14')
  assert.deepEqual(week.days[0].slots[0].members, ['乙'])
})

test('expired open checkin is auto checked out at slot end', () => {
  const store = defaultStore()
  store.checkins = [{
    id: 'in1',
    name: '甲',
    date: '2026-09-17',
    time: '2026-09-17T00:00:00.000Z',
    type: 'in',
    slotId: 'am1'
  }]

  const changed = autoCloseExpiredCheckins(store, new Date('2026-09-18T00:00:00.000Z'))
  const autoOut = store.checkins.find(c => c.type === 'out')

  assert.equal(changed, true)
  assert.equal(autoOut.autoCheckout, true)
  assert.equal(autoOut.slotId, 'am1')
  assert.equal(autoOut.time, '2026-09-17T02:00:00.000Z')
})
