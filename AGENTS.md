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

`.main-page` 是 flex column，包含 `.app-header`（sticky top:0 z-index:100 高 56px）和 `.app-body`（CSS Grid 220px 1fr 两列）。

**结构**：
- `.app-body { display: grid; grid-template-columns: 220px 1fr; grid-template-areas: "sidebar main"; }`
- `.app-body > .sidebar { grid-area: sidebar; }`
- `.app-body > .main-content { grid-area: main; }`

**最致命的坑（2026-06-30 找到）**：HTML 嵌套错误会导致 view 跑出 main-content 之外。
- 如果 `<div class="page-view">` 内部多了**一个多余的 `</div>`**，HTML 解析器会提前关闭外层的 `<main>`，让后续所有 view 变成 mainPage 的直接子元素
- 表现：sidebar 正常在左，但"主内容"渲染在 main 之外、app-body 之下，看起来"跑到了下面"
- 诊断方法：在浏览器 DevTools 选中 view，查看 `path` 或 `parentElement`——如果直接挂在 `#mainPage` 而不是 `main#mainContent`，就是这个问题
- 修法：用 grep 数 `<div` 和 `</div>` 的数量，必须严格相等

**修 admin 页面布局错位时优先检查**：
1. 选中 view 看是否真的在 `main.main-content` 里（不是 mainPage 直接子）
2. 用 `grep -c '<div' file.html` 和 `grep -c '</div>' file.html` 全文数 div 平衡
3. 检查 mainContent 的 `getBoundingClientRect().height` —— 正常应该接近 viewport 高度减去 header，如果只有几十 px 说明里面的 view 都空了

## 文件结构（避免重复探索）

- `backend/server.js` — 单文件 Express 服务，~2400 行，所有 API + 业务逻辑
- `backend/public/index.html` — 单文件 SPA，~4800 行，登录+成员端+管理员端全在一起
- 管理员子菜单项 → 页面 view 容器 → `loadAdminXxx()` 函数，命名三件套要保持一致

## 工时申报日历视图（2026-07-02 新增 v4.2）

成员端"工时申报"页用日历替代原来的纯数字统计，方便核对每天工时。

**后端** (`server.js` 的 `calculateMemberWorkTime`)：
- 在原有 `workByDate`（docx 导出仍用）之外，新增返回字段 `daily: [...]` 和 `monthSummary: {...}`
- `daily[i]` 是按月顺序的每日对象，含 `date / weekday / isToday / scheduled / checkinSlots / approvedOvertimes / pendingOvertimes / totalHours / status`
- `status` 枚举（**关键业务规则——补报覆盖缺勤**）：
  - `completed` — 有打卡（不论是否同时有补报）
  - `overtime` — 无打卡但有**通过补报**（覆盖原本的缺勤，或无排班的额外工作）
  - `overtime-pending` — 无打卡但有**待审核**补报（不算缺勤也不算完成，仅显示）
  - `absent` — 有排班且无打卡且无任何补报
  - `none` — 无排班无工作
- `monthSummary`：`completedDays / overtimeDays / absentDays / daysInMonth`

**前端** (`backend/public/index.html`)：
- `loadWorkTimeClaim()` 改为渲染 7×5 日历网格 + 5 张色卡汇总（已完成/仅补报/缺勤/总工时/报酬）
- 点击日期 → `showWtDayDetail(dateStr)` 弹 modal，显示排班/打卡/补报明细 + 状态说明
- 缺勤日期的格子右下角显示红色"去补报"按钮 → `wtGoOvertime(dateStr)` 切到 `checkinView` 并预填 `#otDate`
- CSS 在 `.worktime-calendar / .wt-cal-* / .wt-summary-* / .wt-modal-*` 一组类名下，按 status 着色（绿/黄/橙/红/灰）

**修改时注意**：
- 不要破坏 `workByDate[date]` 现有的 `slots / hours / finalHours` 字段（docx 生成器 `generateAttendanceDocx` 仍依赖它们）
- 新增 `checkinHours / overtimeHours` 字段是**追加**的，向后兼容
- 如果要改状态判定逻辑，集中在 `calculateMemberWorkTime` 末尾的"状态判定"块（约 server.js:2030 附近），别在多处重复
- **状态枚举（v4.2 含 incomplete）**：
  - `completed` ✓ 已打卡（有配对的 in/out）
  - `incomplete` 🕐 已签到未签退（有签到但没签退，按2h估算，**不算缺勤**）—— 2026-07-02 加的，修"有2h但归缺勤"的bug
  - `overtime` 📝 补报（无打卡但有通过补报，覆盖缺勤）
  - `overtime-pending` ⏳ 补报待审
  - `absent` ⚠️ 缺勤（排班未到，无签到无补报）
  - `none` — 无排班无工作

**UI 行为**：
- 日历头部有"🔄 刷新"按钮（成员提交补报后回来看，可手动刷新状态）
- 所有详情 modal 都补了一个"关闭"按钮（包括缺勤），不会卡住弹窗
- incomplete 状态的 modal 有"📍 去补签退"按钮，跳转到打卡页
- 月汇总卡新增"签到未签退"蓝色统计卡

## 工时计算的几个时区/格式陷阱（2026-07-02 集中修过）

**打卡记录 `time` 字段三种格式共存**：
- 普通签到/签退：`now.toISOString()` → `"2026-06-01T08:32:00.000Z"`（**UTC**）
- 补签退（admin 批准后写入）：`item.time + ':00'` → `"10:05:00"`（**已经是本地时间**）
- 早期可能直接是 `"HH:MM"`

任何用到 `timeToMinutes` 或显示时间的地方都要先归一化：
- `timeToMinutes(timeStr)`（`server.js:2130`）：如果含 `T`，parse ISO 转 Beijing（+8h）；非 ISO 已经是本地直接用
- `normalizeHHMM(timeStr)`（`server.js:1883`）：同上逻辑，用于 modal/详情里给用户看
- 前端的 `timeStrToMinutes`（`index.html:3750`）已经做得对（regex 提取 + new Date 回退）

**修复历史 bug**：
- 之前 `timeToMinutes` 只支持 `HH:MM`，普通签退的 ISO 时间解析为 NaN → 配对失败 → 误判"已签到未签退"，且 modal 显示 "00:24" 这种 UTC 时间（差 8h）
- 症状：日历上一堆"已签到未签退"蓝色格子，modal 显示 00:24 这种错位时间，工时偏高（如陈宇涵 30h）

## incomplete 估算用 slot 实际时长（2026-07-02）

`SLOT_HOURS`（`server.js:1222`）定义每个 slot 的标准时长：
- `am1`: 2h (8:00-10:00)
- `am2`: 2h (10:00-12:00)
- `pm1`: 1.5h (14:30-16:00)
- `pm2`: 1.5h (16:00-17:30)

`calculateMemberWorkTime` 估算"无签退"时，按 `inRec.slotId` 查 SLOT_HOURS 求和（之前固定 2h/slot，导致 pm1/pm2 重复计费 +1h）

## 配对截断规则（防止工时偏高，2026-07-02）

业务规则：**成员当天有 X 小时排班，正常签到签退最多获得 X 小时**，超出部分必须靠补报。

`calculateMemberWorkTime` 配对合并组后两道截断：
1. **跨天错配截断**：`MAX_PAIR_DURATION_MIN = 240` 分钟，配对时长超过 4h 视为错配（典型场景：成员补签退时间填错成 00:00）。原始时长仍记在 `slots[].originalDuration` 字段供排查。
2. **slot 时长截断**：按 `inRec.slotId` 或 `slotByInTime(inTime)` 推断 slot，`diffMinutes = min(diffMinutes, SLOT_HOURS[slot]*60)`。设置 `slots[].cappedBySlot = true` 标记。

**触发案例**：
- 陈宇涵 6/9 10:16 签到 + 00:00 补签退（管理员错审） → 原 14h → 截断 2h
- 陈宇涵 6/3 09:52-12:02 → 原 2h10m → 四舍五入 2.5h → 截断 2h

**为什么用 cap 而不是 reject**：晚班跨天（10:30 → 00:30 次日）属于正常用法，cap 让工时停在 slot 内即可，超出需补报。完全拒绝会让合法情况受影响。

## 同日多班连打工时分配（2026-07-02 修复）

业务规则：**成员同一天有多个排班 slot（如 pm1+pm2 连在一起），打一次卡（最早 in + 最晚 out）也算多班合计**。 
补签退逻辑同理——只在最开始和最后分别打一次，按 slot 边界拆分。

`calculateMemberWorkTime` Step 3 重写后的三档逻辑（在每档前先把 `getMemberScheduledSlots(store, date, name)` 拿到当天排班的 slot 列表）：
- **0 个排班 slot**：回退到原来逻辑——按 `slotByInTime` 推断 + cap 到单 slot
- **1 个排班 slot**：cap 在该 slot 的标准时长（防止溢出 + 避免重复 cap）
- **多个排班 slot**：对每个排班 slot，判定 `isPairCoveringSlot(inMin, outMin, slotStart, slotEnd, 15)`，覆盖则计该 slot 完整时长（不在合并组时再按 diffMinutes cap）

`SLOT_STANDARD_WINDOWS`（`server.js:1238-1243`）定义每个 slot 的标准时段边界：
```js
am1: { startMin:  480, endMin:  600 },  // 8:00-10:00
am2: { startMin:  600, endMin:  720 },  // 10:00-12:00
pm1: { startMin:  870, endMin:  960 },  // 14:30-16:00
pm2: { startMin:  960, endMin: 1050 },  // 16:00-17:30
```

**判定覆盖**：in 在 slotEnd+15min 之前 AND out 在 slotStart-15min 之后（buffer=15 与 slotByInTime 对齐）。**buffer 不要乱改**——改 buffer 会同时影响 slot 边界匹配的严苛度。

**触发案例**：
- 张新源 6/2 (pm1+pm2 一对 in/out：15:11-17:30) → 1.5 + 1.5 = 3h（之前错误显示 1.5h）

**修改时注意**：
- 新增的 `SLOT_STANDARD_WINDOWS` 名字不要跟 `SLOT_WINDOWS`（±15min 签到窗口）混了
- `isPairCoveringSlot` 是核心辅助函数，改覆盖逻辑时优先改它
- 复用了老的 cap 逻辑——单 slot 还是 cap，多 slot 不 cap（因为只要覆盖就意味着参会完整）

## 每周例会（2026-07-02 上线）

业务规则：**每周例会按"本月第 x 周例会"组织，时长由管理员单独设定（可以 0.5h 或 1h 等）；成员月度申报时一次性勾选参会情况，不参会不扣**。

数据模型：`store.meetings` 按月键存储 `{ '2026-07': { weeks: [{ week, date, hours }] } }`。hours=0 表示本次例会无工时但仍然显示在勾选列表（让成员知道自己有这次例会选项）。

**API**：
- `GET /api/admin/meetings?year=&month=` — 管理员读本月例会定义
- `POST /api/admin/meetings` body `{ year, month, weeks: [{week, date, hours}] }` — 替换式保存
- `GET /api/meetings?year=&month=&name=` — 成员读本月例会 + 自己已勾选状态

**工时叠加**：`calculateMemberWorkTime` 在计算完打卡+补报工时后，从 `store.workTimeClaim.submissions[name].meetingsAttended`（`{ week: bool }`）读参会勾选，按本月 list 遍历：参会 → 累加该例会的 hours；不参会 → 0。最终 totalHours = 打卡+补报 + ∑参会例会 hours。

**前端**：
- 管理员侧栏新增"例会设置"子菜单 → `adminMeetingsView` 容器 + `loadAdminMeetings(deltaMonth)` 函数（可前后翻月，表格编辑 + 保存）
- 成员"工时申报"页表单新增"📅 本月例会参会确认"区块（grid 卡片勾选 + 实时汇总参会工时）
- 管理员"查看明细" modal（`showAdminMemberDetail`）新增紫色"📅 本月例会参会"区块，显示每次例会的参会状态 chip

**修改时注意**：
- `meetingsAttended` 在 `calculateMemberWorkTime` 里读一次、在返回 `meetings` 列表里读一次——共享 `meetingsAttendedForTotal` 别重新读两次
- POST 清洗时只接受本月例会列表里出现过的 week（防前端塞无效 week）

## 管理员查看成员明细（排查统计异常）

管理员端 `loadAdminWorktime` 表格新增"🔍 查看明细"按钮，每行一个，点击调 `showAdminMemberDetail(name)` 打开 modal，显示该成员当月每日详情（打卡时段 + 补报内容 + 状态 + 工时）。便于排查"工时偏高"等问题。

前端无新接口，复用 `/api/worktime-claim/my-data?name=xxx`（已包含 daily/monthSummary）。modal 在 `index.html` 的 `#adminMemberDetailModal`。

## 时间字段规范（2026-07-02 避免少加 8h）

**展示给用户看的时间字段一定要存 Beijing 本地时间字符串**，不要用 `new Date().toISOString()`（那是 UTC，会少 8 小时）。

后端：
- **存** 用 `getBeijingDateTimeString(date)`（`server.js:509`），返回 `"YYYY-MM-DD HH:MM:SS"`
- **读时** 用 `getBeijingDateString()`（"YYYY-MM-DD"）和 `getBeijingTimeHHMM()`（"HH:MM"）
- 不要再用 `.toISOString()` 做持久化展示字段

前端：
- **展示** 用户可见的时间字段统一调 `formatSubmittedAt(t)`（`index.html:3794`）：自动识别 Beijing 字符串直接截取，识别 UTC ISO 则 +8h 转 Beijing 后再展示
- 新代码直接拿后端 Beijing 字符串用，无须前端再转

**改动时注意**：
- 旧数据用了 UTC ISO，前端 `formatSubmittedAt` 已兼容
- 不要把现有 UTC ISO 字段再覆盖新逻辑（白名单内的字段才走 getBeijingDateTimeString）—— 目前已修：`workTimeClaim.submissions[name].submittedAt` 和补签退 `reviewedAt`（前端 helper 兼容）
- 现在存的是 Beijing 字符串（无 `T`/`Z`），存进去就别再覆回 `.toISOString()`

**前端 `timeStrToMinutes` 也走 Beijing**（`index.html:3831`）：原来的 regex 优先匹配，把 ISO 串里的 UTC "08:58" 当成小时分钟返回，差 8h。ISO 串必须先 parse UTC Date +8h 再取小时分钟。该函数被 19 处调用，包括 `loadAdminCheckins` 的工时配对、`loadCheckinStatus` 的今日签退判定——一处修，全局生效。

## v5.0 邮件模块（2026-07-02 上线）

业务规则：**邮件作为系统通知的统一通道**，密码重置 / 排班开启 / 申报开启 / 月度总结 4 个自动触发点都自动发邮件；月度总结邮件含荣誉称号列表。管理员可在「邮件配置」页测试连通 + 查看发送日志。

**SMTP 配置**：163 邮箱 SMTP（`smtp.163.com:465` SSL），授权码写在 `server.js` 顶部常量（`SMTP_PASS`），优先读环境变量 `SMTP_PASS/SMTP_USER/SMTP_HOST/SMTP_PORT/SMTP_SECURE/SMTP_FROM_NAME`，默认值是 dev 本地配置。

**触发场景**：
| 场景 | API | 触发时机 |
|---|---|---|
| 修改密码 | `/api/admin/reset-password` | 管理员重置后发 |
| 排班开启 | `/api/admin/schedule-confirm` | 归档时发全员 |
| 申报开启 | `/api/admin/worktime-claim/toggle` | isOpen=true 时发全员 |
| 月度总结 | `/api/admin/email/monthly-summary` | 管理员手动触发（`name='all'` 一键全发）|

**数据模型**：
- `store.memberEmails: { name: email }`（所有 21 位成员已 seed，参考 `backend/data/store.json`）
- `store.memberProfiles: { name: { bankAccount, department, studentId, dorm, phone } }`（独立维护的成员个人信息）
- `store.emailLogs: [{ at, to, subject, status, error?, messageId? }]`（最近 200 条滚动）

**前后端 API**：
- `GET /api/member/email?name=xx` / `PUT /api/member/email { name, email }` — 邮箱读写（成员改自己 / 管理员代改）
- `GET /api/member/profile?name=xx` / `PUT /api/member/profile { name, profile }` — 个人信息读写
- `GET /api/member/achievements?name=xx` — 荣誉墙数据
- `GET /api/admin/email/members` — 所有成员邮箱映射
- `GET /api/admin/email/logs` — 最近 100 条发送日志
- `POST /api/admin/email/test { to }` — 测试邮件发送
- `POST /api/admin/email/monthly-summary { year, month, name? }` — 月度总结（名称或 'all'）

**前端**：
- 成员侧栏新增「📋 我的信息」子页面（loadMyProfile + saveMyProfile）— **新成员首次必须完善**银行账号 / 学号 / 联系电话 / 邮箱，缺项时顶部黄色 banner 提醒
- 成员侧栏新增「🏅 我的荣誉」子页面（loadMyAchievements）— 按月聚合所有获得的荣誉
- 成员工时申报页：`个人信息确认` 区块标注"已从『我的信息』自动填入"，缺项时顶部补 banner
- 管理员侧栏新增「📧 邮件配置」子页面 — SMTP 配置展示 + 测试按钮 + 成员邮箱表（每行可编辑）+ 日志
- 管理员工时申报管理：新增顶部紫色「📧 月度总结邮件」区块（一键全发），每行也有单发按钮

**业务规则：成员首次使用**
- 进入系统后第一步引导去「📋 我的信息」填完所有必填项（银行账号 / 学号 / 联系电话 / 邮箱）
- 缺任何一项时工时申报页顶部会显示 banner 提醒
- 保存后工时申报自动填入，无需月度手填

**修改时注意**：
- 授权码默认写在 server.js 顶部常量里，仅本地开发用；生产部署请改用环境变量
- SMTP_PASS 默认值是调试用，上线前一定要换成环境变量
- 所有 sendEmail 调用都用 fire-and-forget `.catch()`，不阻塞 HTTP 响应
- 月度总结邮件模板有完整 HTML + 纯文本回退版本

## 荣誉称号算法（v5.0，8 个）

`computeMemberMonthlyAchievements(store, name, year, month)` 计算一个成员在某月获得的称号列表（**可叠加**）：

| ID | 显示 | 判定 |
|---|---|---|
| `full_attend` | 🏆 本月全勤达人 | 当月所有排班都完成（≥3 天） |
| `meeting_full` | 🌟 例会全勤 | 本月所有例会都参会 |
| `learner` | 📚 学习标兵 | 本月例会参会 ≥ 1.5h |
| `late_shift` | 🌙 深夜守护者 | 本月完成 ≥ 2 个 pm2 班次 |
| `early_bird` | 🐦 早起鸟 | 本月完成 ≥ 1 个 am1/am2 班次 |
| `hard_worker` | 💪 勤奋之星 | 本月有 ≥ 1 天工时 ≥ 3h |
| `milestone_100/200/500/1000` | 🥇 累计X小时 | 跨月总工时达到里程碑 |
| `double_perfect` | 🌈 双满贯 | 当月既全勤又例会全勤 |

**累计工时来源**：当前仅累加 `workTimeClaim.submissions[name].totalHours` + `overtimes[name].hours`，没有打卡历史的累加（v2 待做）

## 调试快捷方式

- 后端改完需要重启 server（`node server.js`，端口 3000）。前端 SPA 无需重启，浏览器刷新即可
- 本地种子数据脚本参考对话历史（不要把测试脚本留在仓库里）
- Playwright MCP 可用：`mavis mcp call playwright browser_navigate` 等；工具调用用 `--file` 传 JSON 参数
