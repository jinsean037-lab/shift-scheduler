const test = require('node:test')
const assert = require('node:assert/strict')

const {
  addMemberToStore,
  calculateMemberWorkTime,
  defaultStore,
  removeMemberRelatedData,
  slotOverlapMinutes,
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
