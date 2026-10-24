/* 長照去識別化｜個案資料工作台 — 介面與檔案處理（全部在瀏覽器內） */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const escH = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const S_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const CAT_ORDER = ['field', 'name', 'idno', 'phone', 'email', 'number', 'birth', 'date', 'address', 'org', 'custom'];

  // ───────── 程式庫（同網站或內嵌，不連外） ─────────
  window.__LIBDATA = window.__LIBDATA || {};
  const LIBS = { jszip: 'lib/jszip.min.js', pdf: 'lib/pdf.min.js', pdfworker: 'lib/pdf-worker.js', cmaps: 'lib/cmaps.js', tess: 'lib/tesseract.min.js', tessworker: 'lib/tess-worker.js', tesscore: 'lib/tess-core.js', tesslang: 'lib/tess-chi_tra.js' };
  const libP = {};
  function loadLib(name) {
    if (libP[name]) return libP[name];
    return (libP[name] = new Promise((res, rej) => {
      const s = document.createElement('script');
      const inline = document.getElementById('lib-' + name);
      if (inline) { s.textContent = inline.textContent; document.head.appendChild(s); inline.remove(); res(); return; }
      s.src = LIBS[name]; s.onload = () => res(); s.onerror = () => { libP[name] = null; rej(new Error('無法載入元件 ' + name + '（若是直接打開檔案，請改用「離線版」單一檔案）')); };
      document.head.appendChild(s);
    }));
  }
  const b64bytes = b64 => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  const blobURL = (txt, type) => URL.createObjectURL(new Blob([txt], { type: type || 'text/javascript' }));

  // ───────── 狀態 ─────────
  const S = { doc: null, res: null, over: new Map(), view: 'orig', mode: null, tab: 'list', sheet: 0, reviewed: false, urls: [] };

  // ───────── 小工具 ─────────
  let toastEl = null, toastT = 0;
  function toast(msg, opt) {
    opt = typeof opt === 'number' ? { ms: opt } : (opt || {});
    if (toastEl) toastEl.remove(); clearTimeout(toastT);
    const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status');
    const sp = document.createElement('span'); sp.textContent = msg; t.appendChild(sp);
    if (opt.undo) { const b = document.createElement('button'); b.type = 'button'; b.textContent = '復原'; b.onclick = () => { t.remove(); opt.undo(); }; t.appendChild(b); }
    document.body.appendChild(t); toastEl = t;
    toastT = setTimeout(() => t.remove(), opt.ms || (opt.undo ? 5000 : 2600));
  }
  function progress(title, frac, note) {
    const p = $('#prog');
    if (title === false) { p.classList.add('hidden'); return; }
    p.classList.remove('hidden'); $('#progT').textContent = title;
    $('#progB').style.width = Math.round((frac || 0) * 100) + '%'; $('#progN').textContent = note || '';
  }
  const tick = () => new Promise(r => setTimeout(r, 0));
  const errText = e => (e && e.message) || (e && e.type ? '瀏覽器事件錯誤（' + e.type + '）' : String(e));
  function download(blob, name) {
    const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000);
  }
  const extOf = n => (n.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
  const baseOf = n => n.replace(/\.[^.]+$/, '');

  // ───────── 設定 ─────────
  function readSettings() {
    const lines = id => $(id).value.split('\n').map(s => s.trim()).filter(Boolean);
    const ROLES = ['個案', '家屬', '看護', '人員'];
    const names = lines('#sNames').map(l => {
      const m = /^(.+?)[\s=＝,，、]+(個案|家屬|看護|人員)$/.exec(l);
      return m ? { name: m[1].trim(), role: m[2] } : { name: l, role: null };
    }).filter(n => n.name.length >= 2);
    const custom = lines('#sCustom').map(l => { const k = l.search(/[=＝]/); return k > 0 ? { word: l.slice(0, k).trim(), rep: l.slice(k + 1).trim() || '【已遮蔽】' } : { word: l, rep: '【已遮蔽】' }; });
    const ref = $('#sRef').value ? new Date($('#sRef').value + 'T00:00:00') : new Date();
    return { names, custom, allow: lines('#sAllow'), ageBand: +$('#sAge').value, dateMode: $('#sDate').value, refDate: ref, addrLevel: $('#sAddr').value, ROLES };
  }

  // ───────── 分析 ─────────
  function isOn(id) {
    if (S.over.has(id)) return S.over.get(id);
    const e = S.res && S.res.entities.get(id);
    return !!e && e.conf === 'high';
  }
  function analyze() {
    if (!S.doc) return;
    const opt = readSettings();
    if (S.doc.extraNames) opt.names = opt.names.concat(S.doc.extraNames());
    opt.ocr = !!(S.doc.pages && S.doc.pages.some(p => p.ocr));
    S.opt = opt;
    S.res = Deid.analyze(S.doc.segments, opt);
    // 掃描頁的「表單欄位」遮蓋，以欄位名稱為一項
    if (S.doc.pages && S.mode !== 'text') {
      for (const pg of S.doc.pages) for (const f of (pg.fields || [])) {
        const id = 'field:' + f.lab; let en = S.res.entities.get(id);
        if (!en) { en = { id, cat: 'field', label: '表單欄位', color: 'custom', original: `「${f.lab}」欄的填寫區`, rep: '整塊遮蓋', conf: 'high', count: 0, variants: new Set() }; S.res.entities.set(id, en); }
        en.count++;
      }
    }
    renderAll();
  }
  let anaT = 0;
  const analyzeSoon = () => { clearTimeout(anaT); anaT = setTimeout(analyze, 350); };

  // ───────── 讀檔 ─────────
  async function openFile(file) {
    clearAll(true);
    // 換新檔案時清空上一份的名單，避免不同個案混用
    ['#sNames', '#sCustom', '#sAllow'].forEach(id => { $(id).value = ''; });
    const ext = extOf(file.name);
    try {
      let doc;
      if (ext === 'docx') doc = await Docx.load(file);
      else if (ext === 'xlsx' || ext === 'xlsm') doc = await Xlsx.load(file);
      else if (ext === 'csv') doc = await Csv.load(file);
      else if (ext === 'txt') doc = Txt.fromText(await decodeText(await file.arrayBuffer()), file.name);
      else if (ext === 'pdf') doc = await Pdf.load(file);
      else if (/^(jpe?g|png|webp|heic|heif|bmp|gif|tiff?)$/.test(ext) || /^image\//.test(file.type)) doc = await Img.load(file);
      else if (ext === 'doc' || ext === 'xls') throw new Error('舊版 .' + ext + ' 格式請先用 Office「另存新檔」成 .' + ext + 'x 再上傳。');
      else throw new Error('不支援這種檔案格式：.' + ext);
      startDoc(doc);
    } catch (e) {
      progress(false); console.error(e);
      alert('讀取失敗：' + errText(e));
    }
  }
  function startDoc(doc) {
    S.doc = doc; S.sel = null; S.over = new Map(); S.view = 'orig'; S.sheet = 0; S.log = []; S.downloaded = false; S.reviewed = false; S.openGrp = null;
    S.mode = doc.modes ? doc.modes[0].v : null;
    $('#start').classList.add('hidden'); $('#work').classList.remove('hidden');
    $('#kindChip').textContent = doc.kindLabel;
    $('#fname').textContent = doc.name;
    progress(false);
    analyze();
    window.scrollTo(0, 0);
  }
  async function decodeText(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); }
    catch (e) { return new TextDecoder('big5').decode(buf); }
  }

  // ───────── XML 文字節點對應 ─────────
  // group = { nodes:[Text 元素], seg }；依替換區間改寫各節點內容
  function applyToNodes(nodes, text, reps) {
    let off = 0;
    const bounds = nodes.map(n => { const s = off; off += n.textContent.length; return [s, off]; });
    nodes.forEach((n, k) => {
      const [ns, ne] = bounds[k];
      let out = '', p = ns;
      for (const r of reps) {
        if (r.e <= ns || r.s >= ne) { if (r.s === ne && false) out += ''; continue; }
        const a = Math.max(r.s, ns), b = Math.min(r.e, ne);
        out += text.slice(p, a);
        if (r.s >= ns && r.s < ne) out += r.rep;
        p = b;
      }
      out += text.slice(p, ne);
      if (out !== n.textContent) { n.textContent = out; if (n.localName === 't') n.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve'); }
    });
  }
  const parseXml = s => new DOMParser().parseFromString(s, 'application/xml');
  const serXml = d => new XMLSerializer().serializeToString(d);
  function closestNS(n, ns, local) { for (let p = n.parentNode; p; p = p.parentNode) if (p.namespaceURI === ns && p.localName === local) return p; return null; }

  // 圖片換灰色方塊
  async function grayImage(path) {
    const ext = extOf(path);
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const g = c.getContext('2d'); g.fillStyle = '#9aa5a8'; g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#ffffff'; g.lineWidth = 3; g.beginPath(); g.moveTo(8, 8); g.lineTo(56, 56); g.moveTo(56, 8); g.lineTo(8, 56); g.stroke();
    const type = /jpe?g/.test(ext) ? 'image/jpeg' : 'image/png';
    const b = await new Promise(r => c.toBlob(r, type, 0.9));
    return new Uint8Array(await b.arrayBuffer());
  }
  // Office 共通：清除作者等中繼資料
  async function scrubOffice(zip, isOn, warnings) {
    const core = zip.file('docProps/core.xml');
    if (core) {
      const d = parseXml(await core.async('string'));
      ['creator', 'lastModifiedBy', 'title', 'subject', 'keywords', 'description', 'category', 'contentStatus', 'identifier'].forEach(tag => {
        [...d.getElementsByTagName('*')].filter(e => e.localName === tag).forEach(e => { e.textContent = ''; });
      });
      zip.file('docProps/core.xml', serXml(d));
    }
    const app = zip.file('docProps/app.xml');
    if (app) {
      const d = parseXml(await app.async('string'));
      [...d.getElementsByTagName('*')].filter(e => ['Company', 'Manager', 'HyperlinkBase'].includes(e.localName)).forEach(e => { e.textContent = ''; });
      zip.file('docProps/app.xml', serXml(d));
    }
    const custom = zip.file('docProps/custom.xml');
    if (custom) {
      const d = parseXml(await custom.async('string'));
      [...d.getElementsByTagName('*')].filter(e => e.localName === 'property').forEach(p => { [...p.childNodes].forEach(c => { if (c.nodeType === 1) c.textContent = ''; }); });
      zip.file('docProps/custom.xml', serXml(d));
    }
    // 縮圖（常含第一頁畫面）
    for (const p of Object.keys(zip.files)) if (/^docProps\/thumbnail\./i.test(p)) zip.file(p, await grayImage(p));
    if ($('#sImg').value === 'gray') {
      for (const p of Object.keys(zip.files)) if (/^(word|xl)\/media\//.test(p) && !zip.files[p].dir) zip.file(p, await grayImage(p));
    }
  }

  // ═════════ Word ═════════
  const Docx = {
    async load(file) {
      await loadLib('jszip');
      progress('讀取 Word…', 0.3);
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const parts = Object.keys(zip.files).filter(p => /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments(Extended)?)\.xml$/.test(p))
        .sort((a, b) => (a === 'word/document.xml' ? -1 : b === 'word/document.xml' ? 1 : a.localeCompare(b)));
      const xmls = {}, groups = [], segments = [], paras = [];
      let imgs = 0, tracked = 0, comments = 0;
      for (const p of parts) {
        const d = parseXml(await zip.file(p).async('string'));
        xmls[p] = d;
        for (const para of d.getElementsByTagNameNS(W_NS, 'p')) {
          const nodes = [...para.getElementsByTagNameNS(W_NS, 't'), ...para.getElementsByTagNameNS(W_NS, 'delText')]
            .filter(n => closestNS(n, W_NS, 'p') === para);
          // 依文件順序排序
          nodes.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
          const text = nodes.map(n => n.textContent).join('');
          if (!text) continue;
          groups.push({ part: p, nodes, seg: segments.length });
          paras.push({ part: p, seg: segments.length });
          segments.push(text);
        }
        tracked += d.getElementsByTagNameNS(W_NS, 'ins').length + d.getElementsByTagNameNS(W_NS, 'del').length;
        if (/comments\.xml$/.test(p)) comments += d.getElementsByTagNameNS(W_NS, 'comment').length;
      }
      imgs = Object.keys(zip.files).filter(p => /^word\/media\//.test(p)).length;
      const warns = [];
      if (imgs) warns.push({ t: `文件內有 ${imgs} 張圖片（可能是照片、簽名或證件）。預設會換成灰色方塊，可在「設定」更改。` });
      if (tracked) warns.push({ t: `文件含「追蹤修訂」紀錄 ${tracked} 處，刪除過的文字也會一起處理；審閱者姓名會改成「審閱者」。建議原檔先「接受所有修訂」。` });
      if (comments) warns.push({ t: `文件含 ${comments} 則註解，內容會一起處理，作者姓名會移除。` });
      const PART_LABEL = p => /header/.test(p) ? '頁首' : /footer/.test(p) ? '頁尾' : /footnotes/.test(p) ? '註腳' : /endnotes/.test(p) ? '章節附註' : /comments/.test(p) ? '註解' : '';
      return {
        kind: 'docx', kindLabel: 'Word', name: file.name, segments, warns,
        renderPreview(view) {
          let h = '', last = '';
          for (const pr of paras) {
            const lab = PART_LABEL(pr.part);
            if (lab && pr.part !== last) h += `<div class="part">${lab}</div>`;
            last = pr.part;
            h += `<p class="para">${segHTML(pr.seg, view)}</p>`;
          }
          return h || '<p class="note">這份文件沒有文字內容。</p>';
        },
        outputs: [{ v: 'docx', label: 'Word（保留原排版）' }, { v: 'txt', label: '純文字 .txt' }],
        async export(fmt) {
          if (fmt === 'txt') return textExport(this, 'txt');
          const f = await Docx.load(file);   // 用乾淨的副本改，可重複下載
          const zip = f._zip;
          for (const g of f._groups) applyToNodes(g.nodes, segments[g.seg], Deid.resolve(segments[g.seg], S.res.spans[g.seg], isOn));
          for (const p of f._parts) {
            const d = f._xmls[p];
            // 修訂與註解作者
            for (const el of d.getElementsByTagName('*')) {
              if (el.hasAttributeNS(W_NS, 'author')) el.setAttributeNS(W_NS, 'w:author', '審閱者');
              if (el.hasAttributeNS(W_NS, 'initials')) el.setAttributeNS(W_NS, 'w:initials', '');
            }
            zip.file(p, serXml(d));
          }
          const pp = zip.file('word/people.xml');
          if (pp) { const d = parseXml(await pp.async('string')); for (const el of d.getElementsByTagName('*')) { if (el.hasAttributeNS(W_NS, 'author')) el.setAttributeNS(W_NS, 'w:author', '審閱者'); [...el.attributes].forEach(a => { if (/userId|providerId/.test(a.localName)) a.value = ''; }); } zip.file('word/people.xml', serXml(d)); }
          for (const p of Object.keys(zip.files).filter(p => /^word\/_rels\/.*\.rels$/.test(p))) {
            let s = await zip.file(p).async('string');
            s = s.replace(/Target="mailto:[^"]*"/g, 'Target="mailto:"').replace(/Target="tel:[^"]*"/g, 'Target="tel:"');
            zip.file(p, s);
          }
          await scrubOffice(zip, isOn);
          return { blob: await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), ext: 'docx' };
        },
        _zip: zip, _parts: parts, _groups: groups, _xmls: xmls
      };
    }
  };

  // ═════════ Excel（直接改 XML，保留格式） ═════════
  const ROLE_OPTS = [['', '（不是個資）'], ['name-個案', '姓名（個案）'], ['name-家屬', '姓名（家屬）'], ['name-人員', '姓名（人員）'], ['name-看護', '姓名（看護）'], ['age', '年齡→年齡層'], ['idno', '身分證號'], ['phone', '電話'],
    ['number', '編號／病歷號'], ['birth', '出生日期→年齡層'], ['date', '日期→第N天'], ['address', '地址'], ['drop', '整欄清空']];
  function guessRole(h) {
    h = (h || '').replace(/\s/g, '');
    if (!h) return '';
    if (/(身分證|身份證|統一證號|居留證)/.test(h)) return 'idno';
    if (/(電話|手機|聯絡方式|TEL|Phone)/i.test(h)) return 'phone';
    if (/(出生|生日|DOB)/i.test(h)) return 'birth';
    if (/^(年齡|歲數|年紀|實歲|足歲)$/.test(h)) return 'age';
    if (/(地址|住址|戶籍|居住地)/.test(h)) return 'address';
    if (/(病歷|案號|卡號|證號|手冊|個案編號|ID)/i.test(h)) return 'number';
    if (/(照顧者|家屬|聯絡人|代理人|監護人|配偶|子女)/.test(h)) return 'name-家屬';
    if (/(看護|外看|移工)/.test(h)) return 'name-看護';
    if (/(個管|居服員|照服員|督導|評估人員|訪視人員|服務人員|負責人員|治療師|護理師|社工|填表|承辦|記錄者|紀錄者|人員$)/.test(h)) return 'name-人員';
    if (/^(個案)?(姓名|名字|案主|個案|服務對象|長者|長者姓名|個案姓名|案主姓名|住民|住民姓名|學員姓名)$/.test(h)) return 'name-個案';
    if (/(日期|時間)/.test(h)) return 'date';
    return '';
  }
  const colIdx = ref => { const m = /^([A-Z]+)/.exec(ref); let n = 0; for (const c of m[1]) n = n * 26 + c.charCodeAt(0) - 64; return n - 1; };
  const colName = i => { let s = ''; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
  function serialDate(v, d1904) { const n = +v; if (!isFinite(n) || n < 1) return null; const base = d1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30); return new Date(base + Math.round(n) * 86400000); }

  function gridCommon(doc) {
    // doc.sheets[k] = {name, rows:[[cell]], header:rowIndex, roles:{col:role}}；cell = {seg?, raw?}
    doc.extraNames = () => {
      const out = [];
      doc.sheets.forEach(sh => Object.entries(sh.roles).forEach(([c, r]) => {
        if (!r.startsWith('name-')) return;
        sh.rows.forEach((row, ri) => {
          if (ri <= sh.header) return;
          // 「吳林玉英（配偶）」「王小明、李美華」→ 拿掉括號，逐一加入
          cellText(row[c]).replace(/[（(][^）)]*[）)]/g, ' ').split(/[、,，/／;；\s]+/).map(x => x.trim()).filter(Boolean)
            .forEach(v => { if (v.length >= 2 && v.length <= 12) out.push({ name: v, role: r.slice(5) }); });
        });
      }));
      return out;
    };
    function cellText(cell) { if (!cell) return ''; return cell.seg != null ? doc.segments[cell.seg] : (cell.raw || ''); }
    doc.cellText = cellText;
    doc.roleRep = (sh, ci, cell) => {
      const role = sh.roles[ci]; if (!role || role.startsWith('name-')) return null;
      const v = cellText(cell).trim(); if (!v) return null;
      if (role === 'drop') return '';
      if (role === 'idno') return '【身分證號】';
      if (role === 'phone') return '【電話】';
      if (role === 'number') return /^\d{1,4}$/.test(v) ? null : '【編號】';   // 1、2、3 這種流水號不是個資
      if (role === 'age') { const n = Math.floor(+v); if (!isFinite(n) || n <= 0) return null; if (n >= 90) return '【90歲以上】'; const lo = Math.floor(n / S.opt.ageBand) * S.opt.ageBand; return `【${lo}–${lo + S.opt.ageBand - 1}歲】`; }
      if (role === 'address') {
        const r = Deid.analyze([v], Object.assign({}, S.opt, { names: [], custom: [] }));
        const a = (r.spans[0] || []).find(sp => sp.id.startsWith('address'));
        if (a) return v.slice(0, a.s) + a.rep + v.slice(a.e);
        return '【地址】';
      }
      const dt = (cell.num && /^\d+(\.\d+)?$/.test(v)) ? serialDate(v, doc.d1904) : Deid.parseDate(v);
      if (role === 'birth') return dt ? Deid.ageBand(dt, new Date(Date.UTC(S.opt.refDate.getFullYear(), S.opt.refDate.getMonth(), S.opt.refDate.getDate())), S.opt.ageBand) : '【出生日期】';
      if (role === 'date') {
        if (!dt) return '【日期】';
        if (S.opt.dateMode === 'keep') return null;
        if (S.opt.dateMode === 'yearmonth') return `${dt.getUTCFullYear()}年${dt.getUTCMonth() + 1}月`;
        return `第${Math.round((dt - doc.day0()) / Deid.DAY) + 1}天`;
      }
      return null;
    };
    doc.day0 = () => {
      let d = S.res && S.res.day0;
      doc.sheets.forEach(sh => Object.entries(sh.roles).forEach(([c, r]) => {
        if (r !== 'date') return;
        sh.rows.forEach((row, ri) => { if (ri <= sh.header || !row[c]) return; const v = cellText(row[c]).trim(); const dt = row[c].num && /^\d+(\.\d+)?$/.test(v) ? serialDate(v, doc.d1904) : Deid.parseDate(v); if (dt && (!d || dt < d)) d = dt; });
      }));
      return d || new Date();
    };
    doc.renderPreview = (view) => {
      const shs = doc.sheets;
      let h = '';
      if (shs.length > 1) h += '<div class="sheettabs">' + shs.map((sh, k) => `<button type="button" class="btn small ${k === S.sheet ? 'primary' : ''}" data-sheet="${k}">${escH(sh.name)}</button>`).join('') + '</div>';
      const sh = shs[S.sheet] || shs[0];
      if (!sh) return '<p class="note">沒有工作表。</p>';
      const ncol = Math.min(40, sh.rows.reduce((m, r) => Math.max(m, r.length), 0));
      const maxR = Math.min(sh.rows.length, 300);
      h += '<div style="overflow:auto"><table class="tbl"><thead><tr><th class="rn"></th>';
      for (let c = 0; c < ncol; c++) {
        h += `<th>${colName(c)}<br><select data-role="${c}" data-col="${colName(c)}" class="${sh.roles[c] ? 'set' : ''}" aria-label="${colName(c)} 欄的個資類型">` + ROLE_OPTS.map(([v, l]) => `<option value="${v}" ${sh.roles[c] === v ? 'selected' : ''}>${l}</option>`).join('') + '</select></th>';
      }
      h += '</tr></thead><tbody>';
      for (let r = 0; r < maxR; r++) {
        const row = sh.rows[r] || [];
        h += `<tr class="${r === sh.header ? 'hdrrow' : ''}"><th class="rn">${r + 1}</th>`;
        for (let c = 0; c < ncol; c++) {
          const cell = row[c];
          const role = r > sh.header ? sh.roles[c] : '';
          let inner = '';
          if (cell) {
            const rr = role ? doc.roleRep(sh, c, cell) : null;
            if (rr != null) inner = view === 'after' ? `<span class="rp k-custom">${escH(rr) || '（清空）'}</span>` : `<mark class="m k-custom on">${escH(cellText(cell))}</mark>`;
            else inner = cell.seg != null ? segHTML(cell.seg, view) : escH(cell.raw || '');
          }
          h += `<td class="${role ? 'role' : ''}">${inner}</td>`;
        }
        h += '</tr>';
      }
      h += '</tbody></table></div>';
      if (sh.rows.length > maxR) h += `<p class="note">僅預覽前 ${maxR} 列（共 ${sh.rows.length} 列），下載的檔案會處理全部。</p>`;
      h = `<p class="note" style="margin:0 0 10px">第 ${sh.header + 1} 列視為標題列。系統已依欄名自動判斷（藍色選單）；不對的話直接改選。姓名欄的名字，在全檔其他地方也會一起替換。</p>` + h;
      return h;
    };
    doc.sheets.forEach(sh => {
      // 標題列：前 10 列中第一個有 2 格以上文字的列
      sh.header = 0;
      for (let r = 0; r < Math.min(10, sh.rows.length); r++) { const n = (sh.rows[r] || []).filter(c => c && cellText(c).trim()).length; if (n >= 2) { sh.header = r; break; } }
      sh.roles = {};
      (sh.rows[sh.header] || []).forEach((c, ci) => { const g = guessRole(cellText(c)); if (g) sh.roles[ci] = g; });
    });
  }

  const Xlsx = {
    async load(file) {
      await loadLib('jszip');
      progress('讀取 Excel…', 0.3);
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const segments = [], groups = [];
      const ssPath = 'xl/sharedStrings.xml';
      let ssDoc = null; const ssSeg = [];
      if (zip.file(ssPath)) {
        ssDoc = parseXml(await zip.file(ssPath).async('string'));
        for (const si of ssDoc.getElementsByTagNameNS(S_NS, 'si')) {
          const nodes = [...si.getElementsByTagNameNS(S_NS, 't')].filter(t => !closestNS(t, S_NS, 'rPh'));
          const text = nodes.map(n => n.textContent).join('');
          ssSeg.push(segments.length); groups.push({ nodes, seg: segments.length }); segments.push(text);
        }
      }
      const wb = parseXml(await zip.file('xl/workbook.xml').async('string'));
      const d1904 = [...wb.getElementsByTagNameNS(S_NS, 'workbookPr')].some(e => /^(1|true)$/.test(e.getAttribute('date1904') || ''));
      const rels = parseXml(await zip.file('xl/_rels/workbook.xml.rels').async('string'));
      const relMap = {}; for (const r of rels.getElementsByTagName('Relationship')) relMap[r.getAttribute('Id')] = r.getAttribute('Target');
      const sheets = [];
      for (const sEl of wb.getElementsByTagNameNS(S_NS, 'sheet')) {
        const rid = sEl.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
        let tgt = relMap[rid]; if (!tgt) continue;
        const path = tgt.startsWith('/') ? tgt.slice(1) : 'xl/' + tgt.replace(/^\.\//, '');
        if (!zip.file(path)) continue;
        const d = parseXml(await zip.file(path).async('string'));
        const rows = [];
        for (const c of d.getElementsByTagNameNS(S_NS, 'c')) {
          const ref = c.getAttribute('r'); if (!ref) continue;
          const ri = +ref.replace(/^[A-Z]+/, '') - 1, ci = colIdx(ref);
          const t = c.getAttribute('t');
          const v = c.getElementsByTagNameNS(S_NS, 'v')[0];
          let cell = null;
          if (t === 's' && v) cell = { seg: ssSeg[+v.textContent], el: c };
          else if (t === 'inlineStr') { const nodes = [...c.getElementsByTagNameNS(S_NS, 't')]; const text = nodes.map(n => n.textContent).join(''); groups.push({ nodes, seg: segments.length }); cell = { seg: segments.length, el: c }; segments.push(text); }
          else if (t === 'str' && v) { groups.push({ nodes: [v], seg: segments.length }); cell = { seg: segments.length, el: c }; segments.push(v.textContent); }
          else if (v) cell = { raw: v.textContent, num: !t || t === 'n', el: c };
          else if (c.getElementsByTagNameNS(S_NS, 'f').length) cell = { raw: '', num: true, el: c };
          if (!cell) continue;
          (rows[ri] = rows[ri] || [])[ci] = cell;
        }
        for (let i = 0; i < rows.length; i++) rows[i] = rows[i] || [];
        sheets.push({ name: sEl.getAttribute('name'), path, xml: d, rows });
      }
      // 註解
      const cmtDocs = {};
      for (const p of Object.keys(zip.files).filter(p => /^xl\/(comments\d*|threadedComments\/threadedComment\d*)\.xml$/.test(p))) {
        const d = parseXml(await zip.file(p).async('string')); cmtDocs[p] = d;
        for (const el of d.getElementsByTagName('*')) {
          if (el.localName === 'comment' || el.localName === 'threadedComment') {
            const nodes = [...el.getElementsByTagName('*')].filter(n => n.localName === 't' || (n.localName === 'text' && el.localName === 'threadedComment'));
            const text = nodes.map(n => n.textContent).join('');
            if (text) { groups.push({ nodes, seg: segments.length }); segments.push(text); }
          }
        }
      }
      const warns = [];
      if (Object.keys(zip.files).some(p => /^xl\/pivotCache\//.test(p))) warns.push({ bad: true, t: '這個檔案含「樞紐分析」快取，裡面可能保有原始資料的副本。建議在 Excel 先刪除樞紐分析表，或輸出成 CSV。' });
      if (Object.keys(zip.files).some(p => /^xl\/externalLinks\//.test(p))) warns.push({ t: '檔案有連結到其他活頁簿，連結的暫存值可能含個資，建議先「中斷連結」。' });
      const media = Object.keys(zip.files).filter(p => /^xl\/media\//.test(p)).length;
      if (media) warns.push({ t: `檔案內有 ${media} 張圖片，預設會換成灰色方塊。` });
      const doc = {
        kind: 'xlsx', kindLabel: 'Excel', name: file.name, segments, sheets, d1904, warns,
        outputs: [{ v: 'xlsx', label: 'Excel（保留格式）' }, { v: 'csv', label: 'CSV（目前工作表）' }],
        async export(fmt) {
          if (fmt === 'csv') return csvExport(doc, doc.sheets[S.sheet] || doc.sheets[0]);
          const z = await JSZip.loadAsync(await file.arrayBuffer());
          const fresh = await Xlsx.load(file);   // 用乾淨的副本改，避免重複套用
          fresh.sheets.forEach((sh, k) => { sh.roles = doc.sheets[k].roles; sh.header = doc.sheets[k].header; });
          for (const g of fresh._groups) applyToNodes(g.nodes, segments[g.seg], Deid.resolve(segments[g.seg], S.res.spans[g.seg], isOn));
          if (fresh._ssDoc) z.file(ssPath, serXml(fresh._ssDoc));
          let droppedF = false;
          for (const sh of fresh.sheets) {
            // 公式若引用了被替換的欄（例如年齡＝DATEDIF(出生日期)），改成保留計算結果，避免變成 #VALUE!
            const repCols = new Set(Object.entries(sh.roles).filter(([, r]) => r && !r.startsWith('name-')).map(([c]) => colName(+c)));
            const touches = txt => {
              const refs = (txt.match(/(?<![A-Z$])\$?([A-Z]{1,3})\$?\d+/g) || []).map(r => r.replace(/[$\d]/g, ''));
              return /(?<![A-Z$])\$?[A-Z]{1,3}:\$?[A-Z]{1,3}(?!\d)/.test(txt) || refs.some(r => repCols.has(r));
            };
            if (repCols.size) {
              const fs = [...sh.xml.getElementsByTagNameNS(S_NS, 'f')];
              const badShared = new Set(fs.filter(f => f.getAttribute('t') === 'shared' && f.textContent && touches(f.textContent)).map(f => f.getAttribute('si')));
              for (const f of fs) {
                const sharedBad = f.getAttribute('t') === 'shared' && badShared.has(f.getAttribute('si'));
                if (sharedBad || (f.textContent && touches(f.textContent))) { f.parentNode.removeChild(f); droppedF = true; }
              }
            }
            sh.rows.forEach((row, ri) => {
              if (ri <= sh.header) return;
              row.forEach((cell, ci) => {
                if (!cell) return;
                const rep = doc.roleRep(sh, ci, cell);
                if (rep == null) return;
                const c = cell.el;
                [...c.childNodes].forEach(n => c.removeChild(n));
                c.setAttribute('t', 'inlineStr');
                const is = c.ownerDocument.createElementNS(S_NS, 'is'); const t = c.ownerDocument.createElementNS(S_NS, 't');
                t.textContent = rep; is.appendChild(t); c.appendChild(is);
              });
            });
            z.file(sh.path, serXml(sh.xml));
          }
          if (droppedF && z.file('xl/calcChain.xml')) {
            // 公式移除後，計算鏈要一起刪掉，否則 Excel 開檔會要求修復
            z.remove('xl/calcChain.xml');
            z.file('[Content_Types].xml', (await z.file('[Content_Types].xml').async('string')).replace(/<Override[^>]*calcChain[^>]*\/>/g, ''));
            z.file('xl/_rels/workbook.xml.rels', (await z.file('xl/_rels/workbook.xml.rels').async('string')).replace(/<Relationship[^>]*calcChain[^>]*\/>/g, ''));
          }
          for (const [p, d] of Object.entries(fresh._cmt)) {
            for (const el of d.getElementsByTagName('*')) if (el.localName === 'author') el.textContent = '審閱者';
            z.file(p, serXml(d));
          }
          for (const p of Object.keys(z.files).filter(p => /^xl\/persons\/person\d*\.xml$/.test(p))) {
            const d = parseXml(await z.file(p).async('string'));
            for (const el of d.getElementsByTagName('*')) if (el.localName === 'person') { el.setAttribute('displayName', '審閱者'); if (el.hasAttribute('userId')) el.setAttribute('userId', ''); }
            z.file(p, serXml(d));
          }
          await scrubOffice(z, isOn);
          return { blob: await z.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), ext: 'xlsx' };
        },
        _groups: groups, _ssDoc: ssDoc, _cmt: cmtDocs
      };
      gridCommon(doc);
      // 工作表名稱含個資提醒
      const sn = Deid.analyze(sheets.map(s => s.name), {});
      if (sn.spans.some(l => l.length)) warns.push({ t: '有工作表名稱看起來含個資（例如姓名），請在下載後於 Excel 手動改名。' });
      return doc;
    }
  };

  // ═════════ CSV ═════════
  function parseCSV(text) {
    const rows = []; let row = [], f = '', q = false;
    const delim = (text.split('\n')[0].match(/\t/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? '\t' : ',';
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === delim) { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return { rows, delim };
  }
  function csvExport(doc, sh) {
    const q = v => /[",\n\r\t]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    const out = sh.rows.map((row, ri) => row.map((cell, ci) => {
      if (!cell) return '';
      if (ri > sh.header) { const rr = doc.roleRep(sh, ci, cell); if (rr != null) return q(rr); }
      return q(cell.seg != null ? Deid.render(doc.segments[cell.seg], S.res.spans[cell.seg], isOn) : (cell.raw || ''));
    }).join(',')).join('\r\n');
    return { blob: new Blob(['﻿' + out], { type: 'text/csv;charset=utf-8' }), ext: 'csv' };
  }
  const Csv = {
    async load(file) {
      const text = await decodeText(await file.arrayBuffer());
      const { rows } = parseCSV(text);
      const segments = [];
      const grid = rows.map(r => r.map(v => { const k = segments.length; segments.push(v); return { seg: k }; }));
      const doc = { kind: 'csv', kindLabel: 'CSV', name: file.name, segments, sheets: [{ name: 'CSV', rows: grid }], warns: [],
        outputs: [{ v: 'csv', label: 'CSV（UTF-8，Excel 可開）' }], async export() { return csvExport(doc, doc.sheets[0]); } };
      gridCommon(doc);
      return doc;
    }
  };

  // ═════════ 純文字 ═════════
  function textExport(doc, fmt) {
    const segIdx = doc.pages ? doc.pages.map(pg => pg.seg) : doc.segments.map((_, i) => i);   // 掃描頁的第二次辨識不輸出
    const lines = segIdx.map(i => Deid.render(doc.segments[i], S.res.spans[i], isOn));
    let text;
    if (doc.pageOf) { text = ''; let last = -1; lines.forEach((l, i) => { const p = doc.pageOf[segIdx[i]]; if (p !== last && doc.pageCount > 1) { text += (last >= 0 ? '\n' : '') + `── 第 ${p + 1} 頁 ──\n`; last = p; } text += l + '\n'; }); }
    else text = lines.join('\n');
    if (fmt === 'docx') return docxFromText(text).then(blob => ({ blob, ext: 'docx' }));
    return { blob: new Blob(['﻿' + text.replace(/\n/g, '\r\n')], { type: 'text/plain;charset=utf-8' }), ext: 'txt', text };
  }
  async function docxFromText(text) {
    await loadLib('jszip');
    const z = new JSZip();
    const x = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    const paras = text.split('\n').map(l => `<w:p><w:r><w:rPr><w:rFonts w:ascii="Microsoft JhengHei" w:eastAsia="Microsoft JhengHei" w:hAnsi="Microsoft JhengHei"/></w:rPr><w:t xml:space="preserve">${x(l)}</w:t></w:r></w:p>`).join('');
    z.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W_NS}"><w:body>${paras}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`);
    return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }
  const Txt = {
    fromText(text, name) {
      const segments = text.replace(/\r\n?/g, '\n').split('\n');
      return { kind: 'txt', kindLabel: name ? '文字檔' : '貼上的文字', name: name || '貼上的文字', segments, warns: [],
        renderPreview(view) { return segments.map((_, i) => `<p class="para">${segHTML(i, view) || '&nbsp;'}</p>`).join(''); },
        outputs: [{ v: 'txt', label: '純文字 .txt' }, { v: 'docx', label: 'Word .docx' }],
        async export(fmt) { return textExport(this, fmt); } };
    }
  };

  // ═════════ OCR ═════════
  let tessWorker = null;
  async function getOCR(onp) {
    if (tessWorker) { tessWorker._onp = onp; return tessWorker; }
    onp && onp('載入文字辨識元件（第一次需要幾秒）…', 0.05);
    await loadLib('tess'); await loadLib('tessworker'); await loadLib('tesscore'); await loadLib('tesslang');
    onp && onp('啟動中文文字辨識…', 0.15);
    const wURL = blobURL(__LIBDATA.tessworker), cURL = blobURL(__LIBDATA.tesscore) + '#tesseract-core.js';
    S.urls.push(wURL);
    const ref = {};
    const w = await Tesseract.createWorker([{ code: 'chi_tra', data: b64bytes(__LIBDATA.tesslang) }], 1, {
      workerPath: wURL, corePath: cURL, workerBlobURL: false, cacheMethod: 'none', gzip: true,
      logger: m => { if (ref.w && ref.w._onp && m.status === 'recognizing text') ref.w._onp(null, m.progress); }
    });
    ref.w = w; w._onp = onp; tessWorker = w;
    return w;
  }
  // 由 OCR 結果建立文字與每字的框
  function ocrToChars(data, sc) {
    sc = sc || 1;
    let text = ''; const boxes = [];
    const isW = c => /[A-Za-z0-9@._\-]/.test(c);
    for (const b of data.blocks || []) for (const p of b.paragraphs) for (const l of p.lines) {
      let prev = '';
      for (const w of l.words) {
        const syms = w.symbols && w.symbols.length ? w.symbols : [{ text: w.text, bbox: w.bbox }];
        for (let k = 0; k < syms.length; k++) {
          const sy = syms[k]; const ch = sy.text || '';
          if (k === 0 && prev && isW(prev) && isW(ch[0] || '')) { text += ' '; boxes.push(null); }
          const bb = sy.bbox; text += ch; for (let u = 0; u < ch.length; u++) boxes.push({ x: bb.x0 / sc, y: bb.y0 / sc, w: (bb.x1 - bb.x0) / sc, h: (bb.y1 - bb.y0) / sc });
          prev = ch.slice(-1);
        }
      }
      text += '\n'; boxes.push(null);
    }
    return { text, boxes };
  }

  // 表單欄位：找到印刷的欄位名稱，就把右邊的填寫區整塊遮住（手寫看不懂也遮得到）
  const FIELD_PII = ['個案姓名', '長者姓名', '姓名', '出生年月日', '出生日期', '生日', '身分證字號', '身份證字號', '身分證', '身份證', '聯絡電話', '行動電話', '電話', '手機',
    '戶籍地址', '居住地址', '通訊地址', '地址', '住址', '主要照顧者', '照顧者', '緊急聯絡人', '聯絡人', '病歷號', '案號', '家屬簽名', '個案簽名', '簽名', '簽章', '訪視人員', '評估人員', '評估者', '填表人', '個管師', '單位負責人', '負責人'];
  const FIELD_STOP = ['性別', '年齡', '日期', '關係', '診斷', '等級', '身高', '體重', '血型', '婚姻', '教育', '宗教', '語言', '職業', '備註', '時間', '項目', '類別', '頻率'];
  function findFields(text, boxes, pxW, mask) {
    // 先找出所有欄位名稱的位置（一行可能有好幾個）
    const labs = [], all = [...FIELD_PII, ...FIELD_STOP].sort((a, b) => b.length - a.length);
    let ls = 0;
    for (const line of text.split('\n')) {
      // 「電　　話」這種拆開排版的欄位名稱：去掉空白比對，再對回原位置
      const pos = []; let cl = '';
      for (let u = 0; u < line.length; u++) if (!/\s/.test(line[u])) { pos.push(u); cl += line[u]; }
      const used = new Array(cl.length).fill(false);
      for (const lab of all) {
        let k = -1;
        while ((k = cl.indexOf(lab, k + 1)) >= 0) {
          if (used.slice(k, k + lab.length).some(Boolean)) continue;
          for (let u = k; u < k + lab.length; u++) used[u] = true;
          // 只認表單上的欄位名稱：前面不是中文字（行首、框線、括號），或後面接冒號；句子裡的「個管師」不算
          const before = cl.slice(0, k).slice(-1), after = cl[k + lab.length] || '';
          if (/[\u4e00-\u9fff，。、；,;]/.test(before) && !/[:：]/.test(after)) continue;
          const bx = boxes.slice(ls + pos[k], ls + pos[k + lab.length - 1] + 1).filter(Boolean);
          if (!bx.length) continue;
          const x0 = Math.min(...bx.map(b => b.x)), x1 = Math.max(...bx.map(b => b.x + b.w)), y0 = Math.min(...bx.map(b => b.y)), y1 = Math.max(...bx.map(b => b.y + b.h));
          labs.push({ lab, pii: FIELD_PII.includes(lab), x0, x1, y0, y1, cy: (y0 + y1) / 2, h: y1 - y0 });
        }
      }
      ls += line.length + 1;
    }
    // 每個個資欄位：從欄位名稱右邊，遮到同一列下一個欄位名稱為止
    const out = [];
    for (const L of labs) {
      if (!L.pii) continue;
      const h = Math.max(L.h, 8);
      const right = labs.filter(o => o !== L && o.x0 > L.x1 && Math.abs(o.cy - L.cy) < h * 0.9).sort((a, b) => a.x0 - b.x0)[0];
      const x0 = L.x1 + h * 0.2;
      const x1 = right ? right.x0 - h * 0.3 : Math.min(pxW - 2, L.x1 + pxW * 0.55);
      const tall = /簽名|簽章/.test(L.lab) ? 1.8 : 1.0;   // 手寫簽名通常比欄位名稱大很多
      if (x1 - x0 > h) {
        const box = { x: x0, y: L.cy - h * tall, w: x1 - x0, h: h * tall * 2, lab: L.lab, open: !right };
        out.push((mask && snapToCell(box, L, mask)) || box);
      }
    }
    return out;
  }
  // 表格格線：深色（排除藍色手寫）像素的遮罩
  function darkMask(c) {
    const W = c.width, H = c.height, d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    const m = new Uint8Array(W * H);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) m[j] = (Math.min(d[i], d[i + 1], d[i + 2]) < 120 && d[i + 2] - Math.max(d[i], d[i + 1]) < 40) ? 1 : 0;
    return { m, W, H };
  }
  // 把欄位遮蓋對齊到右邊那一格的格線（找不到格線就維持原本估算的範圍）
  function snapToCell(box, L, { m, W, H }) {
    const h = Math.max(L.h, 8), cy = Math.round(L.cy);
    const vline = (x, y0, y1) => { let n = 0, k = 0; for (let y = Math.max(0, y0); y < Math.min(H, y1); y++, k++) if (m[y * W + x] || m[y * W + x - 1] || m[y * W + x + 1]) n++; return k > 0 && n / k > 0.9; };
    const hline = (y, x0, x1) => { let n = 0, k = 0; for (let x = Math.max(0, x0); x < Math.min(W, x1); x++, k++) if (m[y * W + x] || m[(y - 1) * W + x] || m[(y + 1) * W + x]) n++; return k > 0 && n / k > 0.6; };
    // 格線會貫穿整列；字的直筆畫只有一個字高 → 檢查 1.5 個字高的範圍
    const ya = Math.round(cy - h * 0.75), yb = Math.round(cy + h * 0.75);
    // 左邊格線（欄位名稱那格的右框）
    let xl = -1;
    for (let x = Math.round(L.x1 - h * 0.3); x < Math.min(W - 2, L.x1 + h * 6); x++) if (vline(x, ya, yb)) { xl = x; while (xl + 1 < W - 1 && vline(xl + 1, ya, yb)) xl++; break; }
    if (xl < 0) return null;
    // 右邊格線
    let xr = -1;
    const lim = box.open ? W - 2 : Math.min(W - 2, box.x + box.w + h);   // 同列右邊沒有別的欄位 → 一路找到格子右框
    for (let x = xl + Math.round(h * 0.6); x < lim; x++) if (vline(x, ya, yb)) { xr = x; break; }
    if (xr < 0) xr = Math.round(Math.min(W - 2, box.x + box.w));
    // 上下格線
    const xa = xl + 2, xb = xr - 2;
    let yt = -1, ybt = -1;
    for (let y = cy - 2; y > Math.max(1, cy - h * 4); y--) if (hline(y, xa, xb)) { yt = y; break; }
    for (let y = cy + 2; y < Math.min(H - 2, cy + h * 4); y++) if (hline(y, xa, xb)) { ybt = y; break; }
    if (yt < 0) yt = Math.round(box.y); if (ybt < 0) ybt = Math.round(box.y + box.h);
    const pad = 3;
    if (xr - xl < h || ybt - yt < h * 0.6) return null;
    return { x: xl + pad, y: yt + pad, w: xr - xl - pad * 2, h: ybt - yt - pad * 2, lab: box.lab, snapped: true };
  }
  function snapSpanBox(b, { m, W, H }) {
    const h = Math.max(8, b.h / 1.36), cy = Math.round(b.y + b.h / 2);   // b.h 已含上下留白
    const ya = Math.round(cy - h * 0.75), yb = Math.round(cy + h * 0.75);
    const vline = x => { let n = 0, k = 0; for (let y = Math.max(0, ya); y < Math.min(H, yb); y++, k++) if (m[y * W + x] || m[y * W + x - 1] || m[y * W + x + 1]) n++; return k > 0 && n / k > 0.9; };
    let xl = -1, xr = -1;
    for (let x = Math.round(b.x + h * 0.3); x > Math.max(1, b.x - h * 8); x--) if (vline(x)) { xl = x; break; }
    for (let x = Math.round(b.x + b.w - h * 0.3); x < W - 2; x++) if (vline(x)) { xr = x; break; }   // 寬格子：一路找到右框（沒有上下框線的一般文字不會被對齊）
    if (xl < 0 || xr < 0 || xr - xl < b.w * 0.6) return null;
    const hline = y => { let n = 0, k = 0; for (let x = xl + 2; x < xr - 2; x++, k++) if (m[y * W + x] || m[(y - 1) * W + x] || m[(y + 1) * W + x]) n++; return k > 0 && n / k > 0.6; };
    let yt = -1, ybt = -1;
    for (let y = cy - 2; y > Math.max(1, cy - h * 3); y--) if (hline(y)) { yt = y; break; }
    for (let y = cy + 2; y < Math.min(H - 2, cy + h * 3); y++) if (hline(y)) { ybt = y; break; }
    if (yt < 0 || ybt < 0 || ybt - yt > h * 5 || xr - xl > W * 0.85) return null;
    return { x: xl + 3, y: yt + 3, w: xr - xl - 6, h: ybt - yt - 6 };
  }
  // 兩次辨識得到同一格時只留一個
  function dedupeBoxes(list) {
    const out = [];
    for (const b of list) if (!out.some(o => Math.abs(o.x - b.x) < 6 && Math.abs(o.y - b.y) < 6 && Math.abs(o.w - b.w) < 12 && Math.abs(o.h - b.h) < 12)) out.push(b);
    return out;
  }
  // 擦掉表格框線再辨識：框線緊貼文字時，OCR 會把線當成字（實測證明書類表格 42 → 84 分）
  function removeLines(c, mask) {
    const { m, W, H } = mask;
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const g = out.getContext('2d', { willReadFrequently: true }); g.drawImage(c, 0, 0);
    const im = g.getImageData(0, 0, W, H), d = im.data;
    const L = Math.round(Math.min(W, H) / 15), er = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) { let run = 0; for (let x = 0; x <= W; x++) { if (x < W && m[y * W + x]) run++; else { if (run >= L) for (let k = x - run; k < x; k++) for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy >= 0 && yy < H) er[yy * W + k] = 1; } run = 0; } } }
    for (let x = 0; x < W; x++) { let run = 0; for (let y = 0; y <= H; y++) { if (y < H && m[y * W + x]) run++; else { if (run >= L) for (let k = y - run; k < y; k++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx >= 0 && xx < W) er[k * W + xx] = 1; } run = 0; } } }
    for (let j = 0; j < W * H; j++) if (er[j]) d[j * 4] = d[j * 4 + 1] = d[j * 4 + 2] = 255;
    g.putImageData(im, 0, 0);
    return out;
  }
  async function runOCR(c, onp) {
    const w = await getOCR(onp);
    w._onp = onp;
    const mask = darkMask(c);
    // 小圖放大到長邊約 2200 像素再辨識（實測 1.5 倍最好；放更大反而變差）
    const long = Math.max(c.width, c.height), sc = Math.max(1, Math.min(1.6, 2200 / long));
    const scaled = cv => { if (sc <= 1.05) return cv; const o = document.createElement('canvas'); o.width = Math.round(cv.width * sc); o.height = Math.round(cv.height * sc); const g = o.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(cv, 0, 0, o.width, o.height); return o; };
    const runs = [];
    const run = async (cv, psm) => {
      await w.setParameters({ tessedit_pageseg_mode: psm });
      const r = await w.recognize(cv, {}, { blocks: true, text: false });
      runs.push(Object.assign(ocrToChars(r.data, cv.width / c.width), { conf: r.data.confidence || 0 }));
    };
    // 1) 擦掉表格框線後，PSM 3（一般文件）＋ PSM 11（表單）各辨識一次（掃描表格實測 42 → 84 分）
    const clean = scaled(removeLines(c, mask));
    await run(clean, '3'); await run(clean, '11');
    clean.width = clean.height = 1;
    // 2) 分數還是不高（常見於手寫、斜拍照片）→ 再用原圖辨識一次；擦線對照片有時反而有害
    if (Math.max(...runs.map(r => r.conf)) < 75) { const raw = scaled(c); await run(raw, '11'); if (raw !== c) raw.width = raw.height = 1; }
    runs.sort((a, b) => b.conf - a.conf);
    const [main, ...alts] = runs;
    const fields = dedupeBoxes(runs.flatMap(r => findFields(r.text, r.boxes, c.width, mask)));
    return { text: main.text, boxes: main.boxes, conf: main.conf, alts, fields, mask };
  }

  if (/[?&]debug\b/.test(location.search)) window.__dbg = { getOCR, ocrToChars, findFields, darkMask, snapToCell, removeLines, runOCR };

  // ═════════ PDF ═════════
  class CMapFactory {
    constructor() {}
    async fetch({ name }) {
      await loadLib('cmaps');
      const b = __LIBDATA.cmaps && __LIBDATA.cmaps[name];
      if (!b) throw new Error('缺少字型對照表 ' + name);
      return { cMapData: b64bytes(b), compressionType: 1 };
    }
  }
  let pdfReady = null;
  async function getPdfjs() {
    if (pdfReady) return pdfReady;
    return (pdfReady = (async () => {
      await loadLib('pdf'); await loadLib('pdfworker');
      const u = blobURL(__LIBDATA.pdfworker); S.urls.push(u);
      pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(u);
      return pdfjsLib;
    })());
  }
  const canvasToBlob = (c, type, q) => new Promise(r => c.toBlob(r, type || 'image/jpeg', q || 0.88));

  // 視覺型文件（PDF／圖片）共通
  function visualDoc(base) {
    const doc = Object.assign({ segments: [], pageOf: [], warns: [] }, base);
    // 每頁一段文字（含換行）
    doc.pages.forEach((pg, k) => { pg.seg = doc.segments.length; doc.segments.push(pg.text); doc.pageOf.push(k); });
    // 第二次辨識的結果：不顯示在文字版，只用來多抓黑框
    doc.pages.forEach((pg, k) => { pg.altSegs = (pg.alts || []).map(a => { const si = doc.segments.length; doc.segments.push(a.text); doc.pageOf.push(k); return si; }); });
    doc.pageCount = doc.pages.length;
    doc.modes = [{ v: 'visual', label: '黑框版' }, { v: 'text', label: '文字版' }];
    doc.renderPreview = (view) => {
      if (S.mode === 'text') {
        return doc.pages.map((pg, k) => `<div class="pagehd">第 ${k + 1} 頁${pg.ocr ? '（文字辨識）' : ''}</div><div class="pagetxt">${segHTML(pg.seg, view) || '<span class="note">（這頁沒有辨識到文字）</span>'}</div>`).join('');
      }
      let h = '';
      doc.pages.forEach((pg, k) => {
        h += `<div class="vwrap"><div class="vpage" data-page="${k}" style="aspect-ratio:${pg.pxW}/${pg.pxH};width:${Math.min(900, pg.pxW)}px"><span class="lbl">第 ${k + 1} 頁${pg.ocr ? '・文字辨識' : ''}</span><img alt="" src="${pg.url}">`;
        for (const b of pageBoxes(pg, view)) {
          const sel = S.sel && S.sel.page === k && S.sel.key === b.key;
          const pos = `left:${b.x / pg.pxW * 100}%;top:${b.y / pg.pxH * 100}%;width:${b.w / pg.pxW * 100}%;height:${b.h / pg.pxH * 100}%`;
          h += `<div class="box ${b.manual ? 'manual ' : ''}${b.on ? 'on' : 'off'}${sel ? ' sel' : ''}" data-key="${b.key}" title="${escH(sel ? '' : b.title + '（點一下選取，可調整大小）')}" style="${pos}">` +
            (sel ? '<i class="hd" data-h="nw"></i><i class="hd" data-h="ne"></i><i class="hd" data-h="sw"></i><i class="hd" data-h="se"></i>' : '') + '</div>';
          if (sel) h += `<div class="boxbar" style="left:${b.x / pg.pxW * 100}%;top:${b.y / pg.pxH * 100}%">` +
            `<button type="button" data-act="toggle">${b.on ? '取消遮蓋' : '恢復遮蓋'}</button>` +
            (b.adjusted ? '<button type="button" data-act="reset">還原大小</button>' : '') +
            (b.manual ? '<button type="button" data-act="del">刪除</button>' : '') + '<button type="button" data-act="close" aria-label="完成">完成</button></div>';
        }
        h += '</div></div>';
      });
      return h;
    };
    doc.outputs = null; // 依 mode 決定
    doc.export = async function (fmt) {
      if (S.mode === 'text') return textExport(doc, fmt);
      const outs = [];
      for (let k = 0; k < doc.pages.length; k++) {
        const pg = doc.pages[k];
        progress('產生黑框檔案…', k / doc.pages.length, `第 ${k + 1} / ${doc.pages.length} 頁`);
        await tick();
        const img = await loadImg(pg.url);
        const c = document.createElement('canvas'); c.width = pg.pxW; c.height = pg.pxH;
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0);
        g.fillStyle = '#000';
        for (const b of pageBoxes(pg, 'orig')) if (b.manual || b.on) g.fillRect(b.x, b.y, b.w, b.h);
        outs.push({ c, pg });
      }
      progress(false);
      if (fmt === 'pdf') {
        const pages = [];
        for (const { c, pg } of outs) pages.push({ jpeg: new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', 0.9)).arrayBuffer()), pxW: c.width, pxH: c.height, ptW: pg.ptW, ptH: pg.ptH });
        return { blob: new Blob([makePdf(pages)], { type: 'application/pdf' }), ext: 'pdf' };
      }
      const type = fmt === 'png' ? 'image/png' : 'image/jpeg';
      if (outs.length === 1) return { blob: await canvasToBlob(outs[0].c, type, 0.92), ext: fmt === 'png' ? 'png' : 'jpg' };
      // 多頁圖片 → 打包 zip
      await loadLib('jszip'); const z = new JSZip();
      for (let k = 0; k < outs.length; k++) z.file(`第${k + 1}頁.${fmt === 'png' ? 'png' : 'jpg'}`, await canvasToBlob(outs[k].c, type, 0.92));
      return { blob: await z.generateAsync({ type: 'blob' }), ext: 'zip' };
    };
    return doc;
  }
  const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('頁面圖片讀取失敗，請按「重新開始」後重新上傳檔案')); i.src = src; });
  // 依標記算出各頁黑框
  function pageBoxes(pg, view) {
    const out = [];
    const srcs = [[pg.seg, pg.boxes]];
    (pg.altSegs || []).forEach((si, k) => srcs.push([si, pg.alts[k].boxes]));
    for (const [seg, bxs] of srcs) {
    const spans = (S.res && S.res.spans[seg]) || [];
    const text = S.doc.segments[seg];
    for (const r of spans) {
      const en = S.res.entities.get(r.id); if (!en) continue;
      const on = isOn(r.id);
      const from = r.s + (r.keepLen || 0);
      // 依行合併
      let cur = null;
      for (let i = from; i < r.e; i++) {
        const b = bxs[i]; if (!b) { if (cur) { out.push(cur); cur = null; } continue; }
        if (cur && Math.abs(b.y - cur.y) < Math.max(b.h, cur.h) * 0.6 && b.x >= cur.x - b.h) { const x2 = Math.max(cur.x + cur.w, b.x + b.w), y2 = Math.max(cur.y + cur.h, b.y + b.h); cur.x = Math.min(cur.x, b.x); cur.y = Math.min(cur.y, b.y); cur.w = x2 - cur.x; cur.h = y2 - cur.y; }
        else { if (cur) out.push(cur); cur = { x: b.x, y: b.y, w: b.w, h: b.h, id: r.id, on, color: en.color, title: `${en.label}：${text.slice(r.s, r.e)} → ${r.rep}` }; }
      }
      if (cur) out.push(cur);
    }
    }
    out.forEach(b => { const px = Math.max(2, b.h * (pg.ocr ? 0.4 : 0.18)), py = Math.max(2, b.h * (pg.ocr ? 0.18 : 0.12)); b.x -= px; b.y -= py; b.w += 2 * px; b.h += 2 * py; });
    // 掃描頁：文字黑框若在表格格子裡，對齊到整格（比較整齊，也不會露出半個字）
    if (pg.mask) {
      pg.snapCache = pg.snapCache || new Map();
      for (const b of out) {
        const key = [b.x, b.y, b.w, b.h].map(Math.round).join(',');
        if (!pg.snapCache.has(key)) pg.snapCache.set(key, snapSpanBox(b, pg.mask));
        const r = pg.snapCache.get(key);
        if (r) Object.assign(b, r);
      }
    }
    (pg.fields || []).forEach(f => { const id = 'field:' + f.lab; out.push({ x: f.x, y: f.y, w: f.w, h: f.h, id, on: isOn(id), color: 'custom', title: `「${f.lab}」欄位的填寫區` }); });
    // 同一位置的黑框（文字、多次辨識、欄位遮蓋）合併成一塊，避免「取消了一個，下面還有一個」
    const area = r => r.w * r.h;
    const ov = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    let regs = out.map(b => ({ x: b.x, y: b.y, w: b.w, h: b.h, ids: new Set([b.id]), titles: new Set([b.title]), color: b.color }));
    for (let merged = true; merged;) {
      merged = false;
      for (let i = 0; i < regs.length && !merged; i++) for (let j = i + 1; j < regs.length; j++) {
        const A = regs[i], B = regs[j];
        if (ov(A, B) > Math.min(area(A), area(B)) * 0.25) {
          const x = Math.min(A.x, B.x), y = Math.min(A.y, B.y), x2 = Math.max(A.x + A.w, B.x + B.w), y2 = Math.max(A.y + A.h, B.y + B.h);
          Object.assign(A, { x, y, w: x2 - x, h: y2 - y }); B.ids.forEach(v => A.ids.add(v)); B.titles.forEach(v => A.titles.add(v));
          if (A.color !== B.color) A.color = 'custom';
          regs.splice(j, 1); merged = true; break;
        }
      }
    }
    pg.regionOn = pg.regionOn || {}; pg.adjust = pg.adjust || {};
    regs = regs.map(r => {
      const key = 'r' + [r.x, r.y, r.w, r.h].map(Math.round).join('_');
      const on = key in pg.regionOn ? pg.regionOn[key] : [...r.ids].some(isOn);
      const adj = pg.adjust[key];
      return Object.assign(r, { key, on, adjusted: !!adj, ids: [...r.ids], title: [...r.titles].join('\n') }, adj || {});
    });
    out.length = 0; out.push(...regs);
    (pg.manual || []).forEach((m, mi) => out.push({ x: m.x, y: m.y, w: m.w, h: m.h, manual: true, mi, on: true, key: 'm' + mi, title: '手動加上的黑框', color: 'custom' }));
    return out;
  }

  let mctx = null;
  function charW(ch) {
    if (!mctx) { mctx = document.createElement('canvas').getContext('2d'); mctx.font = '100px "PingFang TC","Microsoft JhengHei","Noto Sans TC",sans-serif'; }
    return mctx.measureText(ch).width || 50;
  }
  const Pdf = {
    async load(file, forceOCR) {
      progress('讀取 PDF…', 0.02);
      const lib = await getPdfjs();
      const data = new Uint8Array(await file.arrayBuffer());
      const pdf = await lib.getDocument({ data, isEvalSupported: false, CMapReaderFactory: CMapFactory, cMapUrl: 'cmaps/', cMapPacked: true, useSystemFonts: true, disableAutoFetch: true, enableXfa: false }).promise;
      const pages = []; let ocrN = 0, minConf = 100;
      const n = pdf.numPages;
      if (n > 60 && !confirm(`這份 PDF 有 ${n} 頁，處理可能需要較久時間、佔用較多記憶體。要繼續嗎？`)) throw new Error('已取消');
      for (let k = 1; k <= n; k++) {
        progress('讀取 PDF…', (k - 1) / n, `第 ${k} / ${n} 頁`);
        const page = await pdf.getPage(k);
        const vp0 = page.getViewport({ scale: 1 });
        const scale = Math.min(2.5, 2400 / Math.max(vp0.width, vp0.height) * 1.0 + 0.0001, 2.2);
        const vp = page.getViewport({ scale });
        const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        // 不依賴 requestAnimationFrame（分頁在背景時會暫停）
        const raf = window.requestAnimationFrame; window.requestAnimationFrame = cb => setTimeout(cb, 0);
        try { await page.render({ canvasContext: g, viewport: vp }).promise; } finally { window.requestAnimationFrame = raf; }
        let text = '', boxes = [], ocr = false, fields = [], alts = [], pmask = null;
        if (!forceOCR) {
          const tc = await page.getTextContent();
          let lastY = null, lastEnd = null;
          for (const it of tc.items) {
            if (!('str' in it)) continue;
            const tx = lib.Util.transform(vp.transform, it.transform);
            const fh = Math.hypot(tx[2], tx[3]) || 10;
            const x0 = tx[4], yb = tx[5];
            const wpx = it.width * scale;
            if (lastY != null && Math.abs(yb - lastY) > fh * 0.5 && !text.endsWith('\n')) { text += '\n'; boxes.push(null); }
            else if (lastEnd != null && x0 - lastEnd > fh * 0.25 && /[A-Za-z0-9]$/.test(text) && /^[A-Za-z0-9]/.test(it.str)) { text += ' '; boxes.push(null); }
            // 依字寬比例分配（全形約為半形兩倍）
            const ws = [...it.str].map(charW); const tot = ws.reduce((a, b) => a + b, 0) || 1;
            let acc = 0;
            [...it.str].forEach((ch, i) => { text += ch; const bx = { x: x0 + wpx * acc / tot, y: yb - fh * 0.88, w: Math.max(1, wpx * ws[i] / tot), h: fh * 1.12 }; for (let u = 0; u < ch.length; u++) boxes.push(bx); acc += ws[i]; });
            lastY = yb; lastEnd = x0 + wpx;
            if (it.hasEOL) { text += '\n'; boxes.push(null); lastY = null; lastEnd = null; }
          }
        }
        if (text.replace(/\s/g, '').length < 15) {
          // 掃描頁 → 文字辨識
          const o = await runOCR(c, (t, f) => progress(t || `文字辨識 第 ${k} / ${n} 頁…`, ((k - 1) + (f || 0)) / n, '中文辨識在本機進行，需要一點時間'));
          ({ text, boxes } = o); alts = o.alts; pmask = o.mask; ocr = true; ocrN++; fields = o.fields; minConf = Math.min(minConf, o.conf);
        }
        const blob = await canvasToBlob(c, 'image/jpeg', 0.9);
        const url = URL.createObjectURL(blob); S.urls.push(url);
        pages.push({ text, boxes, ocr, fields, alts, mask: pmask, url, pxW: c.width, pxH: c.height, ptW: vp0.width, ptH: vp0.height, manual: [] });
        c.width = c.height = 1; page.cleanup();
      }
      await pdf.destroy();
      const doc = visualDoc({ kind: 'pdf', kindLabel: 'PDF', name: file.name, pages, file });
      if (ocrN) doc.warns.push(minConf < 70
        ? { bad: true, t: `有 ${ocrN} 頁是掃描影像，而且辨識品質偏低（${Math.round(minConf)} 分）。自動遮蓋可能漏掉很多，請在黑框版逐一檢查，把姓名、電話、地址、簽名等欄位用拖曳方式補遮。` }
        : { t: `有 ${ocrN} 頁是掃描影像，已用文字辨識（OCR）讀取，並依「姓名、電話、地址、簽名」等欄位名稱把填寫區整塊遮住。辨識仍可能有遺漏，請仔細檢查黑框版。` });
      doc.warns.push({ t: '黑框版會把每一頁轉成圖片，原本的文字層不會保留（避免黑框底下還能複製出原文）。', soft: true });
      doc.allOCR = !!forceOCR;
      return doc;
    }
  };

  const Img = {
    async load(file) {
      progress('讀取圖片…', 0.02);
      let bmp;
      try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
      catch (e) { throw new Error('這個瀏覽器無法開啟此圖片格式' + (/heic|heif/i.test(file.name) ? '（HEIC 請用 Safari 開啟，或先轉成 JPG）' : '')); }
      const max = 3000, sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
      const o = await runOCR(c, (t, f) => progress(t || '文字辨識中…', 0.15 + 0.85 * (f || 0), '中文辨識在本機進行，需要一點時間'));
      const { text, boxes, fields, alts, mask } = o;
      const blob = await canvasToBlob(c, 'image/png'); const url = URL.createObjectURL(blob); S.urls.push(url);
      const pages = [{ text, boxes, ocr: true, fields, alts, mask, url, pxW: c.width, pxH: c.height, ptW: c.width * 0.75, ptH: c.height * 0.75, manual: [] }];
      const doc = visualDoc({ kind: 'image', kindLabel: '圖片', name: file.name, pages, isPng: /png/i.test(file.type) });
      doc.warns.push(o.conf < 70
        ? { bad: true, t: `這張圖片的文字辨識品質偏低（${Math.round(o.conf)} 分，常見於手寫或斜拍）。自動遮蓋可能漏掉很多：請在黑框版逐一檢查，把姓名、電話、地址、簽名等用拖曳方式補遮。` }
        : { t: '圖片已用文字辨識（OCR）讀取，並依欄位名稱把填寫區整塊遮住；仍可能有遺漏，請仔細檢查，並用拖曳方式補遮簽名、照片、手寫字。' });
      doc.warns.push({ t: '輸出的圖片會重新繪製，原圖的拍攝地點（GPS）等隱藏資訊會一併移除。', soft: true });
      return doc;
    }
  };

  // ═════════ 簡易 PDF 產生器（每頁一張 JPEG） ═════════
  function makePdf(pages) {
    const enc = new TextEncoder();
    const chunks = []; let len = 0; const offs = [];
    const put = x => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); len += b.length; };
    const N = 2 + pages.length * 3;
    put('%PDF-1.4\n'); put(new Uint8Array([37, 226, 227, 207, 211, 10]));
    const obj = (i, body) => { offs[i] = len; put(`${i} 0 obj\n`); if (Array.isArray(body)) body.forEach(put); else put(body); put('\nendobj\n'); };
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, k) => `${3 + k * 3} 0 R`).join(' ')}] >>`);
    pages.forEach((p, k) => {
      const pi = 3 + k * 3, ii = pi + 1, ci = pi + 2;
      const w = p.ptW.toFixed(2), h = p.ptH.toFixed(2);
      obj(pi, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im${k} ${ii} 0 R >> >> /Contents ${ci} 0 R >>`);
      obj(ii, [`<< /Type /XObject /Subtype /Image /Width ${p.pxW} /Height ${p.pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`, p.jpeg, '\nendstream']);
      const cs = `q ${w} 0 0 ${h} 0 0 cm /Im${k} Do Q`;
      obj(ci, `<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`);
    });
    const xref = len;
    let x = `xref\n0 ${N + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= N; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
    put(x + `trailer\n<< /Size ${N + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(len); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  // ═════════ 畫面 ═════════
  function segHTML(si, view) {
    const text = S.doc.segments[si];
    const spans = (S.res && S.res.spans[si]) || [];
    let h = '', p = 0;
    if (view === 'after') {
      for (const r of Deid.resolve(text, spans, isOn)) {
        const en = S.res.entities.get(r.id);
        h += escH(text.slice(p, r.s)) + `<span class="rp k-${en.color}" data-id="${escH(r.id)}" title="${escH(en.label + '：' + text.slice(r.s, r.e))}">${escH(r.rep)}</span>`;
        p = r.e;
      }
      return h + escH(text.slice(p));
    }
    for (const r of spans) {
      const en = S.res.entities.get(r.id); if (!en) continue;
      const on = isOn(r.id);
      h += escH(text.slice(p, r.s)) + `<mark class="m k-${en.color} ${on ? 'on' : 'off'} ${en.conf}" data-id="${escH(r.id)}" title="${escH(en.conf === 'suggest' && !S.over.has(r.id) ? '不確定是不是個資，請在右邊判斷' : en.label + ' → ' + r.rep + (on ? '（點一下取消遮蔽）' : '（點一下遮蔽）'))}">${escH(text.slice(r.s, r.e))}</mark>`;
      p = r.e;
    }
    return h + escH(text.slice(p));
  }

  // ───────── 步驟指示 ─────────
  function pendingList() { return S.res ? [...S.res.entities.values()].filter(e => e.conf === 'suggest' && !S.over.has(e.id)) : []; }
  function setStep() {
    $('#btnClear').classList.toggle('hidden', !S.doc);
    let now = 1, done = 0;
    if (S.doc) { done = 1; now = 2; if (!pendingList().length && S.reviewed) { done = 2; now = 3; } if (S.downloaded) { done = 3; now = 0; } }
    $$('#steps li').forEach(li => { const k = +li.dataset.s; li.classList.toggle('done', k <= done); li.classList.toggle('now', k === now); });
  }

  function renderAll() { renderHowto(); renderWarns(); renderModes(); renderPreview(); renderSide(); }
  function renderSide() { renderSum(); renderRules(); renderList(); renderExport(); setStep(); }
  function renderHowto() {
    const vis = (S.doc.kind === 'pdf' || S.doc.kind === 'image') && S.mode === 'visual';
    const tips = vis
      ? '<span class="tip">👆 <b>點黑框</b>：選取後可拖曳角落調整大小、移動，或取消遮蓋</span><span class="tip">✋ <b>在空白處拖曳</b>：補一個黑框（簽名、照片、印章）</span>'
      : S.doc.sheets
        ? '<span class="tip">👆 <b>點彩色字</b>：取消／恢復</span><span class="tip">📋 <b>欄位上方選單</b>：整欄指定個資類型</span>'
        : '<span class="tip">👆 <b>點彩色字</b>：取消／恢復遮蔽</span><span class="tip">🖱 <b>選取文字</b>：補上漏掉的</span>';
    const legend = ['name', 'idno', 'phone', 'date', 'address', 'org'].map(c => { const i = Deid.CAT_INFO[c]; return `<span class="lg-chip k-${i.color}">${i.label.replace('／居留證', '')}</span>`; }).join('');
    $('#howto').innerHTML = tips + `<span class="legend">${legend}</span>`;
  }
  function renderWarns() {
    $('#warns').innerHTML = (S.doc.warns || []).map(w => `<div class="warn ${w.bad ? 'bad' : w.soft ? 'soft' : ''}">${w.bad ? '⚠️ ' : (w.soft ? 'ℹ️ ' : '⚠️ ')}${escH(w.t)}</div>`).join('') +
      (S.doc.kind === 'pdf' && !S.doc.allOCR ? '<div class="warn soft">ℹ️ 切到「文字版」看看：如果文字是亂碼或缺字、黑框位置跑掉，請 <button type="button" class="linkbtn" id="btnReocr">改用文字辨識（OCR）重讀</button></div>' : '');
  }
  function renderModes() {
    const ms = S.doc.modes;
    $('#modeSeg').innerHTML = ms ? ms.map(m => `<button type="button" data-m="${m.v}" class="${S.mode === m.v ? 'on' : ''}">${m.label}</button>`).join('') : '';
    $('#modeSeg').classList.toggle('hidden', !ms);
    $$('#viewSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === S.view));
  }
  function renderPreview() {
    const pv = $('#preview'); const st = pv.scrollTop;
    pv.innerHTML = S.doc.renderPreview(S.view);
    pv.scrollTop = st;
  }
  // 找出某實體第一次出現的前後文
  function contextOf(id) {
    for (let si = 0; si < S.res.spans.length; si++) for (const sp of S.res.spans[si]) if (sp.id === id) {
      const t = S.doc.segments[si]; const a = Math.max(0, sp.s - 14), b = Math.min(t.length, sp.e + 14);
      return (a > 0 ? '…' : '') + escH(t.slice(a, sp.s)).replace(/\n/g, ' ') + `<mark>${escH(t.slice(sp.s, sp.e))}</mark>` + escH(t.slice(sp.e, b)).replace(/\n/g, ' ') + (b < t.length ? '…' : '');
    }
    return '';
  }
  function renderSum() {
    const ents = [...S.res.entities.values()];
    const on = ents.filter(e => isOn(e.id)).length + (S.doc.pages ? S.doc.pages.reduce((n, p) => n + p.manual.length, 0) : 0);
    const sugg = ents.filter(e => e.conf === 'suggest');
    const pend = pendingList();
    let h = `<div class="sum-top"><span class="num">${on}</span><span class="lbl">處個資會被替換</span></div>`;
    if (sugg.length) {
      const doneN = sugg.length - pend.length;
      h += `<div class="sum-bar ${pend.length ? '' : 'done'}"><i style="width:${Math.round(doneN / sugg.length * 100)}%"></i></div>`;
      h += `<div class="sum-sub">${pend.length ? `還有 <b>${pend.length}</b> 個字不確定是不是個資，請幫忙判斷：` : '不確定的項目都判斷完了。'}</div>`;
    } else if (!ents.length) {
      h += '<p class="note">沒有自動找到個資。請確認文件是否真的沒有，或在下面補上人名。</p>';
    }
    if (pend.length) {
      h += '<div class="qcards">' + pend.map((e, k) => `<div class="qcard" data-q="${escH(e.id)}">
        <div class="qn">需要你判斷 ${k + 1}／${pend.length}</div>
        <div class="q">「<b>${escH(e.original)}</b>」是人名嗎？</div>
        <div class="ctx" data-go="${escH(e.id)}" title="點一下跳到原文位置">${contextOf(e.id)}</div>
        <div class="why">${escH(e.why)}</div>
        <div class="acts"><button type="button" class="btn yes" data-yes="${escH(e.id)}">是，遮蔽它</button><button type="button" class="btn no" data-no="${escH(e.id)}">不是，保留</button></div>
      </div>`).join('') + '</div>';
    } else if (sugg.length || (S.log && S.log.length)) {
      h += '<div class="alldone">✓ 待判斷的項目都處理好了</div>';
    }
    if (S.log && S.log.length) {
      h += '<div class="resolved">' + S.log.slice().reverse().map((l, k) => `<div class="rv"><span class="t">${l.yes ? '✓ 已遮蔽' : '— 保留'}「<b>${escH(l.text)}</b>」${l.yes && l.code ? ` → ${escH(l.code)}` : ''}</span><button type="button" class="linkbtn" data-undo="${S.log.length - 1 - k}">復原</button></div>`).join('') + '</div>';
    }
    $('#sumPane').innerHTML = h;
  }
  // 使用者加入的規則（人名、其他字詞、不遮蔽）以標籤呈現，可直接移除
  function renderRules() {
    const lines = id => $(id).value.split('\n').map(s => s.trim()).filter(Boolean);
    let h = '';
    lines('#sNames').forEach(l => { const m = /^(.+?)[\s=＝,，、]+(個案|家屬|看護|人員)$/.exec(l); h += `<span class="rule k-name">${escH(m ? m[1] : l)}<small>${m ? m[2] : '人名'}</small><button type="button" data-rm="#sNames" data-line="${escH(l)}" aria-label="移除">×</button></span>`; });
    lines('#sCustom').forEach(l => { h += `<span class="rule k-custom">${escH(l.split(/[=＝]/)[0])}<small>其他</small><button type="button" data-rm="#sCustom" data-line="${escH(l)}" aria-label="移除">×</button></span>`; });
    lines('#sAllow').forEach(l => { h += `<span class="rule allow">不遮蔽：${escH(l)}<button type="button" data-rm="#sAllow" data-line="${escH(l)}" aria-label="移除">×</button></span>`; });
    $('#rules').innerHTML = h;
  }
  function renderList() {
    const ents = [...S.res.entities.values()].filter(e => e.conf !== 'suggest' || S.over.has(e.id));
    if (!ents.length) { $('#listPane').innerHTML = '<div class="lhead"><h3>已找到的個資</h3></div><p class="note">目前沒有。</p>'; return; }
    const openSet = S.openGrp || (S.openGrp = new Set(['name']));
    let h = `<div class="lhead"><h3>已找到的個資</h3><span class="n note" style="margin:0">取消勾選＝不遮蔽</span></div>`;
    for (const cat of CAT_ORDER) {
      const list = ents.filter(e => e.cat === cat);
      if (!list.length) continue;
      const info = Deid.CAT_INFO[cat];
      const onN = list.filter(e => isOn(e.id)).length;
      h += `<details class="grp k-${info.color}" data-cat="${cat}" ${openSet.has(cat) ? 'open' : ''}><summary><span class="dot"></span>${info.label}<span class="cnt">${onN}／${list.length}</span></summary>` +
        list.map(e => {
          const o = isOn(e.id);
          return `<label class="ent ${o ? '' : 'off'}" data-id="${escH(e.id)}"><input type="checkbox" ${o ? 'checked' : ''}><span class="o">${escH(e.original)}<span class="arrow">→</span><span class="rep">${escH(e.rep || '（清空）')}</span> <span class="n">${e.count} 處</span></span><button type="button" class="go" data-go="${escH(e.id)}">看位置</button></label>`;
        }).join('') + '</details>';
    }
    $('#listPane').innerHTML = h;
  }
  function outputsFor() {
    if (S.doc.kind === 'pdf' || S.doc.kind === 'image') {
      if (S.mode === 'text') return [{ v: 'txt', label: '純文字 .txt' }, { v: 'docx', label: 'Word .docx' }];
      return S.doc.kind === 'pdf' ? [{ v: 'pdf', label: 'PDF（黑框）' }, { v: 'jpg', label: '圖片 JPG（黑框）' }]
        : [{ v: S.doc.isPng ? 'png' : 'jpg', label: S.doc.isPng ? '圖片 PNG（黑框）' : '圖片 JPG（黑框）' }, { v: 'pdf', label: 'PDF（黑框）' }];
    }
    return S.doc.outputs;
  }
  function safeName() {
    const known = [...S.res.entities.values()].filter(e => e.fullName).map(e => ({ word: e.fullName, rep: e.rep }));
    const r = Deid.analyze([baseOf(S.doc.name)], Object.assign({}, S.opt, { custom: known.concat(S.opt.custom) }));
    let b = Deid.render(baseOf(S.doc.name), r.spans[0], () => true);
    b = b.replace(/[\\/:*?"<>|]/g, '_').trim() || '文件';
    return b + '_去識別化';
  }
  function renderExport() {
    const outs = outputsFor();
    const cur = S.outFmt && outs.some(o => o.v === S.outFmt) ? S.outFmt : outs[0].v; S.outFmt = cur;
    const canCopy = ['txt', 'docx', 'csv', 'xlsx'].includes(S.doc.kind) || S.mode === 'text';
    const pend = pendingList().length;
    const ready = !pend && S.reviewed;
    $('#expPane').innerHTML = `<h3><i>3</i>下載去識別化檔案</h3>
      <div class="fields">
        <label class="f">格式<select id="outFmt">${outs.map(o => `<option value="${o.v}" ${o.v === cur ? 'selected' : ''}>${o.label}</option>`).join('')}</select></label>
        <label class="f">檔名（已去除個資）<input type="text" id="outName" value="${escH(S.outName || safeName())}"></label>
      </div>
      <div class="check">
        <div class="ci ${pend ? 'todo' : 'ok'}" id="ciPend"><span class="ico">${pend ? '!' : '✓'}</span><span>${pend ? `還有 <b>${pend}</b> 項待判斷（上方黃色卡片）` : '待判斷的項目都處理好了'}</span></div>
        <label class="ci" id="ciRev"><input type="checkbox" id="ckRev" ${S.reviewed ? 'checked' : ''}><span>我已從頭到尾看過左邊的標記，了解自動偵測可能有遺漏</span></label>
      </div>
      <div class="dlmsg" id="dlMsg"></div>
      <div class="row"><button class="btn ${ready ? 'primary' : 'waiting'} lg" id="btnDl" type="button" style="flex:2">⬇ 下載</button>${canCopy ? `<button class="btn" id="btnCopy" type="button">複製文字</button>` : ''}</div>`;
  }
  // 下載前檢查：沒完成就說清楚還差什麼
  function gate() {
    const pend = pendingList();
    const msg = $('#dlMsg');
    if (pend.length) {
      msg.textContent = `還有 ${pend.length} 項需要你判斷，請先回答上方的黃色卡片。`;
      const c = $('#sumPane .qcard');
      if (c) { c.scrollIntoView({ block: 'center', behavior: 'smooth' }); c.classList.remove('pulse'); void c.offsetWidth; c.classList.add('pulse'); }
      return false;
    }
    if (!S.reviewed) {
      msg.textContent = '請先勾選「我已從頭到尾看過」，確認後才能下載。';
      const r = $('#ciRev'); r.classList.remove('shake'); void r.offsetWidth; r.classList.add('shake');
      return false;
    }
    msg.textContent = '';
    return true;
  }

  // ───────── 事件 ─────────
  function flashEl(id) {
    const el = $(`#preview [data-id="${CSS.escape(id)}"]`);
    if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); }
    else toast('這一項在目前的檢視中看不到');
  }
  function toggleEnt(id, val, quiet) {
    const was = isOn(id);
    const v = val == null ? !was : val;
    S.over.set(id, v);
    // 黑框版：含這一項的黑框整塊跟著切換
    if (S.doc && S.doc.pages) for (const pg of S.doc.pages) for (const b of pageBoxes(pg)) if (b.ids && b.ids.includes(id)) pg.regionOn[b.key] = v;
    renderPreview(); renderSide();
    if (!quiet) {
      const en = S.res.entities.get(id);
      toast(`${v ? '已遮蔽' : '已取消遮蔽'}「${en.original}」${en.count > 1 ? `（全文 ${en.count} 處）` : ''}`, { undo: () => toggleEnt(id, was, true) });
    }
  }
  function appendLine(id, line) { const ta = $(id); const ls = ta.value.split('\n').map(s => s.trim()).filter(Boolean); if (!ls.includes(line)) ls.push(line); ta.value = ls.join('\n'); }
  function removeLine(id, line) { const ta = $(id); ta.value = ta.value.split('\n').map(s => s.trim()).filter(s => s && s !== line).join('\n'); }
  function codeOf(name) { const e = S.res && S.res.entities.get('name:' + name); return e ? e.rep : ''; }
  function addName(name, role) {
    appendLine('#sNames', name + (role ? ' ' + role : ''));
    analyze();
    const c = codeOf(name);
    toast(`已加入「${name}」${c ? `→ ${c}` : ''}，全文同樣的字都會替換`, { undo: () => { removeLine('#sNames', name + (role ? ' ' + role : '')); analyze(); } });
    return c;
  }
  function addCustom(word) {
    appendLine('#sCustom', word); analyze();
    toast(`已加入「${word}」，全文同樣的字都會遮蔽`, { undo: () => { removeLine('#sCustom', word); analyze(); } });
  }
  function addAllow(word) {
    appendLine('#sAllow', word); analyze();
    toast(`「${word}」不會被遮蔽`, { undo: () => { removeLine('#sAllow', word); analyze(); } });
  }

  $('#fileIn').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) openFile(f); });
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) openFile(f); });
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => { e.preventDefault(); if (e.target.closest && e.target.closest('#drop')) return; const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) openFile(f); });

  $('#btnPaste').addEventListener('click', () => { const t = $('#pasteIn').value; if (!t.trim()) { toast('請先貼上文字'); $('#pasteIn').focus(); return; } startDoc(Txt.fromText(t)); $('#pasteIn').value = ''; });
  $('#btnSample').addEventListener('click', () => {
    $('#pasteIn').value = '個案姓名：王小明，男，民國34年3月5日出生，身分證字號 A123456789。\n住址：基隆市七堵區明德一路123巷4號5樓，聯絡電話 02-2456-7890。\n主要照顧者為案妻李美華（0912-345-678），長子王大同住在新北市汐止區大同路二段100號。\n113/05/12 個管師陳怡君到宅訪視，王伯伯表示右膝疼痛，想去基隆長庚醫院回診。\n外籍看護 Siti 協助沐浴，照服員小美每週一三五到宅服務。小明今日情緒穩定。\n病歷號：0012345678，健保卡號 0000 1234 5678。\n2024年6月3日 轉介居家復能，建議安裝扶手、練習坐到站。';
    $('#btnPaste').focus();
  });

  $('#viewSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.view = b.dataset.v; renderModes(); renderPreview(); });
  $('#modeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.mode = b.dataset.m; S.sel = null; analyze(); });
  ['#sNames', '#sCustom', '#sAllow'].forEach(id => $(id).addEventListener('input', analyzeSoon));
  ['#sAge', '#sRef', '#sDate', '#sAddr'].forEach(id => $(id).addEventListener('change', analyze));

  $('#preview').addEventListener('click', e => {
    const sb = e.target.closest('[data-sheet]'); if (sb) { S.sheet = +sb.dataset.sheet; renderPreview(); renderExport(); return; }
    const bar = e.target.closest('.boxbar button');
    if (bar) { boxAction(bar.dataset.act); return; }
    const mk = e.target.closest('mark.m[data-id], .rp[data-id]');
    if (mk && !(window.getSelection() + '').trim()) {
      const id = mk.dataset.id;
      // 待判斷的字 → 帶到右邊的卡片
      const q = pendingList().some(p => p.id === id) && $(`#sumPane [data-q="${CSS.escape(id)}"]`);
      if (q) { q.scrollIntoView({ block: 'center', behavior: 'smooth' }); q.classList.remove('pulse'); void q.offsetWidth; q.classList.add('pulse'); return; }
      toggleEnt(id); return;
    }
  });
  // 選取的黑框：切換、還原大小、刪除
  function selBox() { if (!S.sel) return null; const pg = S.doc.pages[S.sel.page]; return { pg, b: pageBoxes(pg).find(x => x.key === S.sel.key) }; }
  function boxAction(act) {
    const r = selBox(); if (!r || !r.b) { S.sel = null; renderPreview(); return; }
    const { pg, b } = r;
    if (act === 'toggle') {
      if (b.manual) { act = 'del'; }
      else { const was = b.on; pg.regionOn[b.key] = !was; renderPreview(); renderSide(); toast(was ? '已取消這塊遮蓋' : '已恢復遮蓋', { undo: () => { pg.regionOn[b.key] = was; renderPreview(); renderSide(); } }); return; }
    }
    if (act === 'reset') { const old = pg.adjust[b.key]; delete pg.adjust[b.key]; renderPreview(); toast('已還原成自動判斷的大小', { undo: () => { pg.adjust[b.key] = old; renderPreview(); } }); return; }
    if (act === 'del') { const [rm] = pg.manual.splice(b.mi, 1); S.sel = null; renderPreview(); renderSide(); toast('已刪除手動黑框', { undo: () => { pg.manual.push(rm); renderPreview(); renderSide(); } }); return; }
    if (act === 'close') { S.sel = null; renderPreview(); }
  }
  document.addEventListener('keydown', e => {
    if (!S.sel || /input|textarea|select/i.test((e.target.tagName || ''))) return;
    if (e.key === 'Escape') { S.sel = null; renderPreview(); }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); boxAction('toggle'); }
  });
  $('#warns').addEventListener('click', async e => {
    if (e.target.id !== 'btnReocr') return;
    const f = S.doc.file, keep = ['#sNames', '#sCustom', '#sAllow'].map(id => $(id).value);
    // 新頁面的圖片要保留：先把舊的網址拿開，重讀完只清舊的（原本會把新圖片一起清掉，導致畫面變灰、輸出失敗）
    const oldUrls = S.urls; S.urls = [];
    try {
      const d = await Pdf.load(f, true);
      const newUrls = S.urls; S.urls = oldUrls; clearAll(true); S.urls = newUrls;
      ['#sNames', '#sCustom', '#sAllow'].forEach((id, k) => { $(id).value = keep[k]; });
      startDoc(d);
    }
    catch (err) { S.urls = oldUrls.concat(S.urls); progress(false); alert('重讀失敗：' + errText(err)); }
  });
  $('#preview').addEventListener('change', e => {
    const sel = e.target.closest('select[data-role]'); if (!sel) return;
    const sh = S.doc.sheets[S.sheet]; const c = +sel.dataset.role;
    if (sel.value) sh.roles[c] = sel.value; else delete sh.roles[c];
    analyze();
    toast(sel.value ? `${sel.dataset.col || ''} 欄已設為「${sel.options[sel.selectedIndex].text}」` : '已取消這一欄的設定');
  });

  // 問答卡片、復原、看位置
  $('#sumPane').addEventListener('click', e => {
    const y = e.target.closest('[data-yes]'), n = e.target.closest('[data-no]'), u = e.target.closest('[data-undo]'), g = e.target.closest('[data-go]');
    S.log = S.log || [];
    if (y) {
      const en = S.res.entities.get(y.dataset.yes);
      const role = (/接在「(.+?)」/.exec(en.why) || [])[1] ? labelRole(/接在「(.+?)」/.exec(en.why)[1]) : null;
      if (en.original.length >= 2 && !/^[A-Za-z]/.test(en.original) || /^[A-Za-z]/.test(en.original)) {
        appendLine('#sNames', en.original + (role ? ' ' + role : '')); analyze();
        S.log.push({ text: en.original, yes: true, line: en.original + (role ? ' ' + role : ''), list: '#sNames', code: codeOf(en.original) });
      } else { S.over.set(en.id, true); S.log.push({ text: en.original, yes: true, id: en.id }); }
      renderSide();
      toast(`已遮蔽「${en.original}」${codeOf(en.original) ? ' → ' + codeOf(en.original) : ''}`);
    } else if (n) {
      const en = S.res.entities.get(n.dataset.no);
      appendLine('#sAllow', en.original); analyze();
      S.log.push({ text: en.original, yes: false, line: en.original, list: '#sAllow' });
      renderSide();
      toast(`「${en.original}」保留原樣`);
    } else if (u) {
      const l = S.log.splice(+u.dataset.undo, 1)[0];
      if (l.list) { removeLine(l.list, l.line); analyze(); } else { S.over.delete(l.id); renderPreview(); renderSide(); }
      toast(`已復原「${l.text}」，請重新判斷`);
    } else if (g) flashEl(g.dataset.go);
  });
  $('#addForm').addEventListener('submit', e => {
    e.preventDefault();
    const t = $('#addText').value.trim(), k = $('#addKind').value;
    if (!t) { toast('請先輸入要遮蔽的字'); $('#addText').focus(); return; }
    if (k === 'custom') addCustom(t);
    else if (t.length < 2) { toast('人名至少 2 個字；單一字請選「其他字詞」'); return; }
    else addName(t, k);
    $('#addText').value = ''; $('#addText').focus();
  });
  $('#rules').addEventListener('click', e => {
    const b = e.target.closest('[data-rm]'); if (!b) return;
    removeLine(b.dataset.rm, b.dataset.line); analyze();
    toast(`已移除「${b.dataset.line.split(/[\s=＝]/)[0]}」`, { undo: () => { appendLine(b.dataset.rm, b.dataset.line); analyze(); } });
  });
  $('#listPane').addEventListener('change', e => { const r = e.target.closest('.ent'); if (r && e.target.type === 'checkbox') toggleEnt(r.dataset.id, e.target.checked); });
  $('#listPane').addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) { e.preventDefault(); flashEl(g.dataset.go); } });
  $('#listPane').addEventListener('toggle', e => { const d = e.target.closest('details[data-cat]'); if (!d) return; S.openGrp = S.openGrp || new Set(); d.open ? S.openGrp.add(d.dataset.cat) : S.openGrp.delete(d.dataset.cat); }, true);
  function labelRole(l) { if (/照服員|居服員|個管|督導|社工|護理|醫|治療師|照專/.test(l)) return '人員'; if (/看護|外看|移工|傭/.test(l)) return '看護'; if (/個案|案主|長者|住民|學員/.test(l)) return '個案'; return '家屬'; }

  // 選取文字 → 加入遮蔽
  const pop = $('#selpop');
  document.addEventListener('mouseup', () => setTimeout(showPop, 10));
  document.addEventListener('touchend', () => setTimeout(showPop, 350));
  document.addEventListener('keyup', e => { if (e.shiftKey) showPop(); });
  document.addEventListener('selectionchange', () => { if (!(window.getSelection() + '').trim()) pop.classList.add('hidden'); });
  function showPop() {
    const sel = window.getSelection(); const t = (sel + '').trim();
    if (!t || !S.doc || !sel.rangeCount || !$('#preview').contains(sel.anchorNode) || t.length > 60 || /\n/.test(t)) { pop.classList.add('hidden'); return; }
    const rc = sel.getRangeAt(0).getBoundingClientRect();
    pop.innerHTML = `<div class="sp-t">把「<b>${escH(t)}</b>」當作：</div><div class="sp-g"><button type="button" data-a="name-個案">個案姓名</button><button type="button" data-a="name-家屬">家屬姓名</button><button type="button" data-a="name-人員">工作人員</button><button type="button" data-a="name-看護">看護</button><button type="button" data-a="custom" class="wide" style="background:var(--soft)">其他要遮蔽的字（地名、機構…）</button><button type="button" data-a="allow" class="wide">這不是個資，不要遮蔽</button></div>`;
    pop.dataset.text = t;
    pop.classList.remove('hidden');
    const w = pop.offsetWidth;
    pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, rc.left + rc.width / 2 - w / 2)) + 'px';
    pop.style.top = (rc.bottom + 8 + pop.offsetHeight > innerHeight ? rc.top - pop.offsetHeight - 8 : rc.bottom + 8) + 'px';
  }
  pop.addEventListener('mousedown', e => e.preventDefault());
  pop.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const t = pop.dataset.text; pop.classList.add('hidden'); window.getSelection().removeAllRanges();
    if (b.dataset.a === 'custom') addCustom(t);
    else if (b.dataset.a === 'allow') addAllow(t);
    else if (t.length < 2) toast('人名至少 2 個字；單一字請用「其他要遮蔽的字」');
    else addName(t, b.dataset.a.slice(5));
  });

  // 黑框版：空白處拖曳＝新增；點黑框＝選取；拖曳選取的黑框＝移動；拖曳角落＝調整大小
  let drag = null;
  $('#preview').addEventListener('pointerdown', e => {
    const pgEl = e.target.closest('.vpage'); if (!pgEl || e.button !== 0 || e.target.closest('.boxbar')) return;
    const page = +pgEl.dataset.page, pg = S.doc.pages[page];
    const r = pgEl.getBoundingClientRect(), k = pg.pxW / r.width;
    const px = (e.clientX - r.left) * k, py = (e.clientY - r.top) * k;
    const boxEl = e.target.closest('.box'), hd = e.target.closest('.hd');
    if (boxEl) {
      const key = boxEl.dataset.key;
      if (!(S.sel && S.sel.page === page && S.sel.key === key)) { S.sel = { page, key }; renderPreview(); e.preventDefault(); return; }
      const b = pageBoxes(pg).find(x => x.key === key); if (!b) return;
      drag = { mode: hd ? 'resize' : 'move', h: hd && hd.dataset.h, pgEl, pg, k, r, sx: px, sy: py, b0: { x: b.x, y: b.y, w: b.w, h: b.h }, b, el: boxEl, moved: false };
    } else {
      if (S.sel) { S.sel = null; renderPreview(); }
      const el = document.createElement('div'); el.className = 'box drawing'; pgEl.appendChild(el);
      drag = { mode: 'draw', pgEl, pg, k, r, sx: px, sy: py, el };
    }
    pgEl.setPointerCapture(e.pointerId); e.preventDefault();
  });
  const rectOf = (d, px, py) => {
    const W = d.pg.pxW, H = d.pg.pxH, cl = (v, a, b) => Math.max(a, Math.min(b, v));
    px = cl(px, 0, W); py = cl(py, 0, H);
    if (d.mode === 'draw') return { x: Math.min(px, d.sx), y: Math.min(py, d.sy), w: Math.abs(px - d.sx), h: Math.abs(py - d.sy) };
    const b = d.b0, dx = px - d.sx, dy = py - d.sy;
    if (d.mode === 'move') return { x: cl(b.x + dx, 0, W - b.w), y: cl(b.y + dy, 0, H - b.h), w: b.w, h: b.h };
    let x1 = b.x, y1 = b.y, x2 = b.x + b.w, y2 = b.y + b.h;
    if (d.h.includes('w')) x1 = Math.min(x2 - 8, b.x + dx); if (d.h.includes('e')) x2 = Math.max(x1 + 8, x2 + dx);
    if (d.h.includes('n')) y1 = Math.min(y2 - 8, b.y + dy); if (d.h.includes('s')) y2 = Math.max(y1 + 8, y2 + dy);
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  };
  $('#preview').addEventListener('pointermove', e => {
    if (!drag) return;
    const px = (e.clientX - drag.r.left) * drag.k, py = (e.clientY - drag.r.top) * drag.k;
    if (Math.abs(px - drag.sx) + Math.abs(py - drag.sy) > 3 * drag.k) drag.moved = true;
    const rc = rectOf(drag, px, py), W = drag.pg.pxW, H = drag.pg.pxH;
    Object.assign(drag.el.style, { left: rc.x / W * 100 + '%', top: rc.y / H * 100 + '%', width: rc.w / W * 100 + '%', height: rc.h / H * 100 + '%' });
    if (drag.mode !== 'draw') { const bar = drag.pgEl.querySelector('.boxbar'); if (bar) bar.style.display = 'none'; }
    drag.last = rc;
  });
  $('#preview').addEventListener('pointerup', () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.mode === 'draw') {
      d.el.remove();
      if (!d.last || d.last.w < 6 * d.k || d.last.h < 6 * d.k) return;
      const box = d.last; d.pg.manual.push(box);
      S.sel = { page: +d.pgEl.dataset.page, key: 'm' + (d.pg.manual.length - 1) };
      renderPreview(); renderSide();
      toast('已加上黑框，可拖曳角落調整大小', { undo: () => { d.pg.manual.splice(d.pg.manual.indexOf(box), 1); S.sel = null; renderPreview(); renderSide(); } });
      return;
    }
    if (!d.moved || !d.last) { renderPreview(); return; }
    const before = d.b.manual ? Object.assign({}, d.pg.manual[d.b.mi]) : d.pg.adjust[d.b.key];
    if (d.b.manual) Object.assign(d.pg.manual[d.b.mi], d.last); else d.pg.adjust[d.b.key] = d.last;
    renderPreview();
    toast(d.mode === 'move' ? '已移動黑框' : '已調整黑框大小', { undo: () => { if (d.b.manual) Object.assign(d.pg.manual[d.b.mi], before); else if (before) d.pg.adjust[d.b.key] = before; else delete d.pg.adjust[d.b.key]; renderPreview(); } });
  });

  $('#expPane').addEventListener('change', e => {
    if (e.target.id === 'outFmt') S.outFmt = e.target.value;
    if (e.target.id === 'ckRev') { S.reviewed = e.target.checked; renderExport(); setStep(); }
  });
  $('#expPane').addEventListener('input', e => { if (e.target.id === 'outName') S.outName = e.target.value; });
  $('#expPane').addEventListener('click', async e => {
    const btn = e.target.closest('button'); if (!btn) return;
    if (btn.id === 'btnDl') {
      if (!gate()) return;
      try {
        btn.disabled = true; btn.textContent = '產生檔案中…';
        const r = await S.doc.export(S.outFmt);
        download(r.blob, ($('#outName').value.trim() || '文件_去識別化') + '.' + r.ext);
        S.downloaded = true; setStep();
        toast('✓ 已下載。請存放在機構規定的位置，原始檔不要上傳雲端。', { ms: 5000 });
      } catch (err) { console.error(err); alert('輸出失敗：' + errText(err)); }
      finally { progress(false); renderExport(); }
    }
    if (btn.id === 'btnCopy') {
      if (!gate()) return;
      let text;
      if (S.doc.sheets) text = S.doc.sheets[S.sheet].rows.map((row, ri) => row.map((cell, ci) => { if (!cell) return ''; if (ri > S.doc.sheets[S.sheet].header) { const rr = S.doc.roleRep(S.doc.sheets[S.sheet], ci, cell); if (rr != null) return rr; } return cell.seg != null ? Deid.render(S.doc.segments[cell.seg], S.res.spans[cell.seg], isOn) : (cell.raw || ''); }).join('\t')).join('\n');
      else text = textExport(S.doc, 'txt').text;
      try { await navigator.clipboard.writeText(text); }
      catch (err) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
      toast('✓ 已複製處理後的文字');
    }
  });

  function clearAll(silent) {
    S.urls.forEach(u => URL.revokeObjectURL(u)); S.urls = [];
    S.doc = null; S.res = null; S.over = new Map(); S.outName = null; S.outFmt = null; S.reviewed = false; S.log = []; S.downloaded = false;
    $('#preview').innerHTML = ''; $('#listPane').innerHTML = ''; $('#expPane').innerHTML = ''; $('#warns').innerHTML = ''; $('#sumPane').innerHTML = ''; $('#rules').innerHTML = '';
    if (!silent) {
      ['#sNames', '#sCustom', '#sAllow', '#pasteIn'].forEach(id => { $(id).value = ''; });
      $('#work').classList.add('hidden'); $('#start').classList.remove('hidden'); setStep();
      toast('已清除這個分頁裡的所有資料');
    }
  }
  $('#btnClear').addEventListener('click', () => { if (!S.doc || confirm('要清除目前的檔案、標記與設定，重新開始嗎？')) clearAll(false); });
  window.addEventListener('beforeunload', e => { if (S.doc) { e.preventDefault(); e.returnValue = ''; } });

  // 隱私說明＋連線測試
  $('#btnLock').addEventListener('click', () => { $('#testRes').textContent = ''; $('#dlgLock').showModal(); });
  if (location.protocol === 'file:') $('#btnOffline').classList.add('hidden');
  $('#btnTest').addEventListener('click', async () => {
    const res = $('#testRes'); res.textContent = '測試中…'; res.style.color = '';
    let blocked = false;
    const onV = () => { blocked = true; };
    document.addEventListener('securitypolicyviolation', onV);
    try { await fetch('https://example.com/?test=1', { mode: 'no-cors', cache: 'no-store' }); res.textContent = '⚠️ 連線沒有被擋下，請改用離線版或通知資訊人員。'; res.style.color = 'var(--danger)'; }
    catch (err) { res.textContent = '✅ 已被封鎖：這個網頁無法把資料送到任何外部網站。'; res.style.color = 'var(--ok)'; }
    document.removeEventListener('securitypolicyviolation', onV);
  });
  setStep();
  $('#sRef').value = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
})();
