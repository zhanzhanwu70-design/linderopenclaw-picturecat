# HEARTBEAT.md - picturecat

## Task System（CEO 模式）

CEO = **roaringmoon**，統一發放任務、標記 done。

### 每次 Heartbeat 執行流程

#### Step 0: 自動歸檔 done 的 task
```bash
python3 ~/.openclaw/task-queue/heartbeat_check.py --agent picturecat --archive-done --human
```

#### Step 1: 檢查 demands（是否有自己的待處理項目）
```bash
flock ~/.openclaw/task-queue/.lock -c "cat ~/.openclaw/task-queue/demands.json" > /tmp/demands_read.json
```

檢查：`demands[] | select(.from=="picturecat" and .status=="pending")`

**如果有需要回覆的 demand 審核結果：**
- CEO 已核准：收到 task_id，等待執行
- CEO 已否決：讀取理由，回應或調整

#### Step 2: 檢查被指名的 pending task
```bash
flock ~/.openclaw/task-queue/.lock -c "cat ~/.openclaw/task-queue/task_queue.json" > /tmp/task_queue_read.json
```

找到：`status=pending AND to=picturecat` 的 task

#### Step 3: 開始執行 → 更新為 running
```bash
flock ~/.openclaw/task-queue/.lock -c "python3 << 'EOF'
import json
with open('/tmp/task_queue_read.json') as f:
    d = json.load(f)
for t in d['tasks']:
    if t['id'] == '<task_id>':
        t['status'] = 'running'
        t['started_at'] = $(date +%s)
        t['run_count'] = t.get('run_count', 0) + 1
with open('~/.openclaw/task-queue/task_queue.json', 'w') as f:
    json.dump(d, f, indent=2)
EOF"
```

#### Step 4: 執行任務（研究、寫作、分析等）

#### Step 5: 過程中主動回報進度給 CEO（roaringmoon）
```bash
# 使用 sessions_send 發送進度更新給 CEO
# RoaringMoon channel: 1482561255955763293
sessions_send sessionKey: "agent:roaringmoon:discord:channel:1482561255955763293" message: "<task_id> 進度更新：目前完成...，遇到...，下一步..."
```

#### Step 6: 任務完成 → 標記等待 CEO 檢視
```bash
flock ~/.openclaw/task-queue/.lock -c "python3 << 'EOF'
import json
with open('/tmp/task_queue_read.json') as f:
    d = json.load(f)
for t in d['tasks']:
    if t['id'] == '<task_id>':
        t['status'] = 'completed'
        t['completed_at'] = $(date +%s)
        t['needs_ceo_review'] = True
        t['result'] = '<任務摘要>'
with open('~/.openclaw/task-queue/task_queue.json', 'w') as f:
    json.dump(d, f, indent=2)
EOF"
```

#### Step 7: 通知 CEO 檢視
```bash
# 發送最終結果給 CEO 的 mailbox
# RoaringMoon channel: 1482561255955763293
sessions_send sessionKey: "agent:roaringmoon:discord:channel:1482561255955763293" message: "✅ <task_id> 已完成，需要 CEO 檢視。摘要：<result>"
```

---

## Demand Submission（提交需求給 CEO）

當你需要 CEO 處理新任務但沒有被指派時：

### 提交新需求
```bash
# 生成新 demand
NEW_DEMAND_ID="DEM_$(date +%Y%m%d_%H%M%S)_001"

flock ~/.openclaw/task-queue/.lock -c "python3 << 'EOF'
import json, subprocess, time
result = subprocess.run(['cat', '/tmp/demands_read.json'], capture_output=True, text=True)
d = json.loads(result.stdout)
new_demand = {
    "id": '$NEW_DEMAND_ID',
    "from": "picturecat",
    "to": "ceo",
    "what": "<要做什麼>",
    "why": "<為什麼需要>",
    "priority": "medium",
    "status": "pending",
    "created_at": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
}
d['demands'].append(new_demand)
with open('/home/node/.openclaw/task-queue/demands.json', 'w') as f:
    json.dump(d, f, indent=2)
EOF"

# 通知 CEO
sessions_send sessionKey: "agent:roaringmoon:discord:channel:1482561255955763293" message: "📋 picturecat 提交了新需求：$NEW_DEMAND_ID
What: <要做什麼>
Why: <為什麼需要>
Priority: medium"
```

### 沒有任務也沒有 demands 時
回覆：`HEARTBEAT_OK`

---

## Agent Channel IDs（from openclaw.json）
```
roaringmoon: 1482561255955763293
charizard:  1482097593784733839（主要）, 1482374570278129724（monitor）
mrmime:    1482069603512221927
rowlet:    1482363974119854234
gengar:    1484513576482902158
celesteela: 1482607890098421842
picturecat: 1481665581189959872
greninja:  1382962403720827011
flaaffy:   1494534371292614729
```
