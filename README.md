# 長照識別化｜個案資料工作台

給長照人員的個案資料去識別化工具。Word、Excel、CSV、PDF、掃描檔／照片、貼上的文字，**全部在使用者自己的瀏覽器裡處理**，不上傳、不經過 AI、不儲存。

- 網站版：https://mattsue1003.github.io/ltc-deid-workbench/
- 離線版（單一 HTML 檔，可放內網或單機使用）：https://mattsue1003.github.io/ltc-deid-workbench/offline.html

## 隱私設計

- 頁面內建 Content-Security-Policy：`connect-src data:`，瀏覽器會擋下任何對外連線（`data:` 不經網路）；網頁上的「連線測試」按鈕可以當場驗證。
- 沒有伺服器端程式、沒有統計追蹤、沒有外部字型或 CDN；所有程式庫（pdf.js、Tesseract.js 中文辨識、JSZip）都放在同一網站或內嵌在離線版裡。
- 不使用 localStorage／IndexedDB（OCR 快取設為 `none`），關掉分頁資料就消失。
- 輸出時一併清除：Word／Excel 的作者、修訂者、註解作者、文件縮圖；文件內圖片預設換成灰色方塊；PDF 黑框版重新繪製成圖片，不留原文字層；照片重新繪製，去除 GPS 等 EXIF。

## 會處理的個資

姓名（代號化，同一人全文一致：個案A、家屬B、人員C、看護D）、稱謂（王伯伯→A伯伯）、身分證／居留證、電話、Email／LINE ID、病歷號／案號／健保卡號、出生日期（→年齡層，90 歲以上合併）、服務日期（→第 N 天）、地址（保留縣市＋鄉鎮市區）、醫院與機構名稱。Excel 可指定整欄的個資類型。

自動偵測一定會有遺漏，介面要求使用者逐項檢查後才能下載；可填「本案人名清單」、選取文字補遮、在黑框版拖曳補遮簽名或照片。

## 開發

原始碼在 `src/`（`engine.js` 偵測規則、`app.js` 介面與檔案處理）。`python3 build.py` 產生 `docs/`（GitHub Pages）。

教材設計｜愛迪樂 鍾孟修 職能治療師
