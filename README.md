# NYC Spider

Three.js 開放世界蜘蛛人原型。角色、動畫、車輛與街道道具全部由 `blender/` 內的 Python 腳本在 Blender (bpy) 中程序化產生，匯出為 glTF (`public/models/*.glb`)。城市外牆、街道、屋頂的 PBR 貼圖由 `tools/gen_textures.py` 產生（流程依 [xikhar/atlas](https://github.com/xikhar/atlas) 的 `pbr-texture-gen`，MIT；`tools/atlas/pbr_maps.py` 為原檔）。

**線上遊玩：https://icomppower.github.io/NYCSpider/** （推送到預設分支即由 GitHub Actions 自動部署；手機可用觸控操作）

## 遊戲目標

**信號塔**：四個區（中城、熨斗區、格林威治村、金融區）各有一棟最高樓頂著藍色光柱。登上樓頂站穩 1.6 秒即啟動（+300 XP），左上角「目標」面板與畫面上的菱形標記會指向最近的未啟動信號塔。

**俯衝**：從高處自由落下（下墜速度 > 13 m/s、離地 > 24 m）自動進入俯衝姿勢（`Dive` 動畫，身體朝下、鏡頭俯視、FOV 拉寬），可用方向鍵滑翔；按 Shift 射蛛絲改為擺盪。

阻止 8 起街頭犯罪即勝利；蜘蛛人倒下或 3 起犯罪逃走即失敗。跟著紅色光柱與小地圖紅點前往現場。5 秒未受傷會回血。流程在 `src/game/run.js`，觸控操作在 `src/ui/touch.js`（左半邊搖桿、右半邊視角、右下動作鈕）。`?play=1` 跳過標題、`?touch` 在桌機強制觸控介面。

詳細進度見 Notion：[NYC Spider — 開發進度](https://app.notion.com/p/3e71f269eaea81809203d4470d7d24b5)

## 開發

```bash
npm install
npm run dev          # http://localhost:5173  (?debug 顯示除錯資訊, ?q=low 低畫質)
npm run assets       # 重新以 Blender 產生所有 glb（需要 `pip install bpy==4.5.4` 或 blender 執行檔）
npm run record -- <scenario>   # 以固定 30fps 錄製 tools/scenarios/<scenario>.js，輸出 recordings/*.mp4
python3 tools/gen_textures.py  # 重新產生 public/textures/*（basecolor / normal / ORM）
node tools/shots.mjs <名稱>     # 固定視角截圖（dive / plaza / street / skyline）供外觀比對
```

錄影與截圖建議對 `npx vite build && npx vite preview --port 4173` 的正式版執行（加 `--url http://localhost:4173`），避免開發伺服器熱重載中斷錄製。

### 換成 AI 生成的貼圖

`public/textures/<name>_basecolor.jpg` 可直接替換成影像模型產生的無縫貼圖（例如用 atlas 的 `codex-imagegen-backend` + `pbr-texture-gen`），程式不需修改。每張外牆貼圖涵蓋 8 開間 × 8 層（開間/樓高見 `src/world/materials.js` 的 `FACADE_SETS`）。替換後以 `tools/atlas/pbr_maps.py` 重新推導 normal / ORM。

## 操作

| 按鍵 | 動作 |
| --- | --- |
| WASD | 移動（C 慢走） |
| Space | 跳躍 / 擺盪中放開並加速 |
| Shift | 地面跑酷衝刺、空中發射蛛絲擺盪 |
| 滑鼠左鍵 / J | 攻擊連段 |
| 右鍵 / R | 上勾拳挑空（自動跟跳進入空中連段） |
| E | 蛛絲拉扯準星內的敵人（空中使用會把敵人拉上來） |
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

## 新機制

- **蛛絲拉扯**（`src/combat/combat.js` `startPull`）：自動鎖定畫面中央 26 m 內、視線無遮蔽的歹徒；地面版以弧線拉到面前並造成硬直，空中版把敵人拉到身旁浮空，可直接接空中連段。共生體戰衣拉扯更快並附加傷害。
- **空中連段**：上勾拳挑空後自動跟跳；AirPunch → AirKick → AirSpin → AirSlam，出招期間玩家懸停、被挑空的敵人重力降低；終結技砸地產生衝擊波擊倒周圍敵人。
- **隨機街頭犯罪**（`src/events/crimes.js`）：搶劫、商店搶案、幫派火拼、劫車四種，每 25–50 秒於玩家附近人行道生成；紅色光柱、小地圖脈衝標記、方向/距離面板引導；擊倒所有歹徒（會被蛛絲包成繭）即完成並獲得 XP，受害者揮手後離開；120 秒未處理則犯人逃走。

## 城市（第三版）

- 規模：12 × 16 街區的曼哈頓格網（約 1.05 × 1.74 km），北邊延伸上城、東西兩側河岸步道＋河流、對岸天際線延伸到霧中；南端為港口。
- `src/world/layout.js` 的 `tallness()` 高度場：南端金融區與北端中城兩個高峰，靠河遞減。依高度決定街區類型：超高層（200–400 m 玻璃塔＋退台＋天線）、高樓（玻璃塔、裝飾藝術退台塔、石灰岩大樓）、戰前公寓（紅磚／黃磚／白磚／石灰岩，含簷口、退台、水塔、逃生梯）、褐石排屋。
- 「百老匯」斜向大道（`DIAG`）切過格網，被切到的街區變成三角廣場，有三種設計輪替：放射狀步道＋噴泉、林蔭草地、露天咖啡座廣場；另有一座華盛頓廣場式公園。
- 外牆為 PBR 材質（basecolor + normal + ORM），每棟樓以頂點色微調色調避免重複感；屋頂有樓梯間、冷卻塔、冷氣、天窗、水塔、天線（Blender `props.glb`）。
- 算繪（依 atlas `threejs-pipeline`）：物理天空＋同一天空的 PMREM 環境光、單一太陽光的自適應陰影範圍（街上銳利、高空時放大到 ±700 m）、地平線霧帶、ACES 色調映射、對數深度緩衝。
- 效能：道具依 160 m 區塊分組 InstancedMesh，可視錐剔除＋依道具類型的距離剔除；車流在玩家附近生成並回收。
- 街道家具（路燈、紅綠燈、消防栓、垃圾桶、郵筒、報箱、長椅、行道樹、水塔、冷氣、天線、尖塔、逃生梯、看板）全部來自 Blender 產生的 `props.glb`，以 InstancedMesh 大量擺放。
- `src/world/traffic.js`：右側通行雙車道、全城兩相位紅綠燈（燈頭實際變色）、跟車距離、為玩家/路人煞車、路口直行/左轉/右轉（貝茲曲線轉彎）；轎車、計程車、跑車、廂型車、公車皆為 Blender 模型的 instancing。
- `src/world/pedestrians.js`：玩家附近的行人沿街區人行道行走，附近發生戰鬥時會逃跑。
- 擺盪：按住 Shift 會在前擺頂點自動放開並接續下一條蛛絲（連續擺盪），擺盪支點拉回行進路線上方，避免被側邊大樓拉去撞牆。
