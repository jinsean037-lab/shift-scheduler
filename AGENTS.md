# shift-scheduler-v3 — 学工办助理排班管理系统

## 关键数据模型怪癖

**补签退（supp checkout）记录没有 `slotId` 字段。**

`POST /api/supp-checkout` 只接收 `name/date/time/reason`，管理员批准后 push 到 `store.checkins` 的记录：
```js
{ id: 'supp_' + item.id, name, date, time: item.time + ':00', type: 'out', isSupp: true }
// 没有 slotId，没有 lat/lng
```

**任何过滤 `c.slotId === someSlot` 的代码都会悄悄把补签退排除掉。** 这就是 2026-06-03 修的几个 bug 的根因：
- 月度状态判断时补签退被判成"缺勤"或"进行中"
- `loadAdminCheckins` 算不出工时（因为把 `outs` 过滤成了 `!c.isSupp`）
- `calculateMemberWorkTime` 同上

修复方式：补签退应通过 `SLOT_WINDOWS` 时间窗反查所属 slot（`server.js:1305-1310`）：
```js
const SLOT_WINDOWS = {
  am1: { start: '07:45', end: '10:15' },
  am2: { start: '09:45', end: '12:15' },
  pm1: { start: '14:15', end: '16:15' },
  pm2: { start: '15:45', end: '17:45' }  // ±15min tolerance
}
// supp time slice(0,5) 落在哪个窗口就归哪个 slot
```

配对时也要把补签退当作签退的"回退选项"——先配正常签退，没有时再用补签退。

## 补签退时间窗必须比签到窗口更宽

补签退是成员声明的"实际离开时间"，**可能晚于 slot 结束时间（加班）**。所以匹配时要用单独的 `SUPP_WINDOWS`（`server.js:1311-1317`）：
```js
const SUPP_WINDOWS = {
  am1: { start: '08:00', end: '11:00' },  // slot 10:00 + 60min 加班容忍
  am2: { start: '10:00', end: '13:00' },
  pm1: { start: '14:30', end: '17:00' },
  pm2: { start: '16:00', end: '18:30' }
}
```
不要用 `SLOT_WINDOWS`（签到窗口）来匹配 supp——会漏掉 10:00 之后才补签的加班情况。

## 跨天记录配对必须按日期过滤

`loadAdminCheckins` 按名字分组（不是按天），所以一个成员的 ins/outs 可能来自不同日期。配对时 **必须** 先 `o.date === iDate` 过滤，否则会把昨天 18:30 的签退错配给今天 8:30 的签到 → 算出 10h（实际只有 2h）。`calculateMemberWorkTime` 已经是先按日期 group 了所以没问题。

## 补签退的优先级

在 `loadAdminCheckins` 配对时，**supp 优先于 normal out**——supp 是成员声明的"实际离开时间"，意图就是覆盖缺失的签退。如果当日既有 normal out 又有 supp，用 supp 的时间（即使 normal out 更晚）。

## 部署

用户手动 `git push` → Render 自动部署。生产用 MongoDB (`MONGO_URI` 环境变量)，本地/回退用 `data/store.json`。

## 主页面布局（2026-06-30 修过）

`.main-page` 是 flex column，包含 `.app-header`（sticky top:0 z-index:100 高 56px）和 `.app-body`（flex row min-height: calc(100vh - 56px)）。

`.app-body` 内有 `.sidebar`（220px 宽 sticky top:56px）和 `.main-content`（flex:1）。

**已踩过的坑**：
- 必须在 `.app-body` 显式写 `flex-direction: row; overflow: hidden;`，否则在某些情况下（特别是内容很长时）布局会塌成 column，sidebar 占据一行、main-content 掉到下一行，**主内容会"跑到界面下面"**
- `.main-content` 必须有 `height: calc(100vh - 56px); overflow-x: auto;`——否则宽表格会撑破 flex 布局
- `.page-view` 必须有 `width: 100%`——确保填满 main-content 的内容区
- 移动端断点 `@media (max-width: 900px)`（**不是 768px**）才把 `.app-body` 改为 column，避免在 800-900px 区间的平板上误触发

修 admin 页面布局错位时优先检查这几点。

## 文件结构（避免重复探索）

- `backend/server.js` — 单文件 Express 服务，~2400 行，所有 API + 业务逻辑
- `backend/public/index.html` — 单文件 SPA，~4800 行，登录+成员端+管理员端全在一起
- 管理员子菜单项 → 页面 view 容器 → `loadAdminXxx()` 函数，命名三件套要保持一致
