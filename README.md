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
