# NYC Spider

Three.js 開放世界蜘蛛人原型。角色、動畫、車輛與街道道具全部由 `blender/` 內的 Python 腳本在 Blender (bpy) 中程序化產生，匯出為 glTF (`public/models/*.glb`)。

## 開發

```bash
npm install
npm run dev          # http://localhost:5173  (?debug 顯示除錯資訊, ?q=low 低畫質)
npm run assets       # 重新以 Blender 產生所有 glb（需要 `pip install bpy==4.5.4` 或 blender 執行檔）
npm run record -- <scenario>   # 以固定 30fps 錄製 tools/scenarios/<scenario>.js，輸出 recordings/*.mp4
```

## 操作

| 按鍵 | 動作 |
| --- | --- |
| WASD | 移動（C 慢走） |
| Space | 跳躍 / 擺盪中放開並加速 |
| Shift | 地面跑酷衝刺、空中發射蛛絲擺盪 |
| 滑鼠左鍵 / J | 攻擊連段 |
| F | 蛛絲衝刺至準心所指的牆面 |
| Tab | 戰衣選單（經典 / 共生體），選擇後播放換裝過場 |

## 動畫銜接（防滑步）

- `src/player/animator.js`：轉場表（每組 from→to 各自的淡入時間）、Idle/Walk/Run/Sprint 共用步態相位，每個步態只在自己的速度區間內以「量測到的著地速度」做播放速率匹配，相鄰步態只在窄頻帶交叉淡化。
- 載入時自動取樣 glTF 動畫，量測著地腳（牆面爬行為著地手）的移動速度。
- 地面移動改為「先轉身再沿面向移動」；急轉 180° 先煞停再原地轉向。
- 落地依衝擊與水平速度選擇：直接接跑步 / 蹲姿落地 / 翻滾（身體以翻滾速度前進）/ 三點式重落地。
- 戰鬥：遠距目標以真正的跑步步態接近，出招時用 motion warping 只補足剩餘 ≤0.45 m。
- `?anim=legacy` 可切回舊版（固定速率 + 單一交叉淡化）比較；`npm run record -- anim` 會輸出著地腳滑動量（m/s）。

| 量測（anim 情境） | 舊版 | 新版 |
| --- | --- | --- |
| 整體著地腳滑動 | 1.59 m/s | 0.77 m/s |
| 慢走 | 0.58 | 0.21 |
| 跑步 | 1.57 | 0.77 |
| 戰鬥連段 | 1.7–2.5 | 0.26–0.7 |
