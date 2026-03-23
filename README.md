# B2B SEO 與網頁樣式檢查工具 (智能偵測版)

這是一款專為 B2B 企業網站開發的智能審計工具，旨在幫助 SEO 執行人員與設計師快速找出網頁中的結構性問題。

## 🌟 核心特色

### 1. 智能網站發現 (Smart Site Discovery)
- **路徑聚類分析**：自動識別網站中的「產品區」、「部落格區」與「一般頁面」。
- **樹狀結構識別**：主動偵測頁面中的分類導航與動態列表，並標註為 🌳 系統架構。

### 2. 結構感知計分機制 (Structure-Aware Scoring)
- **權責劃分**：自動區分「人為編輯內容」與「系統生成框架」。
- **免扣分機制**：針對 Odoo/ICB 的產品網格 (`.o_wsale_`) 或動態組件 (`dynamic_snippet`)，若其 HTML 結構有瑕疵（如標題層級不當），系統會將其標記為免扣分，並提示工程師優化。
- **SEO 重點稽核**：強制檢查 Title, Meta Description 與 H1，確保基礎 SEO 完整度。

### 3. 全方位審計項目
- **標題結構**：檢查 H1-H6 是否缺漏、跳耀或空白。
- **樣式規範**：偵測不當的內聯字體大小 (Inline font-size)、字體家族設定與過時標籤 (`<font>`)。
- **B2B 外銷加強**：圖片 Alt 屬性檢查、HTML 語系 (lang) 設定。

## 🛠 技術架構
- **Frontend**: React + Vite + TypeScript (現代化響應式介面)
- **Backend**: Node.js + Express (高效爬蟲代理)
- **Parser**: Cheerio (快速 HTML 解析)

## 🚀 快速部署 (Render)

1. 將專案推送到您的 GitHub。
2. 在 [Render](https://render.com/) 建立新的 **Web Service**。
3. 連結專案並設定：
   - **Build Command**: `npm run build`
   - **Start Command**: `npm start`
4. 部署完成後即可獲得專屬公開網址。

## 👨‍💻 開發者
專為提升 B2B 網站轉化率與 SEO 表現而生。
