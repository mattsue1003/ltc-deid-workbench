#!/usr/bin/env python3
"""打包：docs/index.html（網站版，程式庫放 lib/ 依需要載入）＋ docs/offline.html（單一檔離線版，全部內嵌）
先執行：mkdir -p build/x && cd build && npm pack tesseract.js@5.1.1 tesseract.js-core@5.1.1 pdfjs-dist@3.11.174 jszip@3.10.1 @tesseract.js-data/chi_tra@1.0.0
再把各 tgz 解到 build/x/<檔名去掉.tgz>/"""
import base64, json, os, re, shutil
from pathlib import Path

ROOT = Path(__file__).parent
X = ROOT / 'build' / 'x'
DIST = ROOT / 'docs'
SRC = ROOT / 'src'

def rd(p, mode='r'):
    return open(p, mode, encoding=None if 'b' in mode else 'utf8').read()

def js_str(s):
    j = json.dumps(s, ensure_ascii=False)
    return j.replace('</', '<\\/').replace('<!--', '<\\!--').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')

tess_worker = rd(X / 'tesseract.js-5.1.1/package/dist/worker.min.js')
bug = 'return"string"==typeof t?t:t.data}'
assert bug in tess_worker, 'tesseract worker patch point not found'
tess_worker = tess_worker.replace(bug, 'return"string"==typeof t?t:t.code}')

cmaps = {}
for f in sorted((X / 'pdfjs-dist-3.11.174/package/cmaps').glob('*.bcmap')):
    cmaps[f.stem] = base64.b64encode(f.read_bytes()).decode()

libs = {
    'jszip': rd(X / 'jszip-3.10.1/package/dist/jszip.min.js'),
    'docxview': rd(X / 'docx-preview-0.3.7/package/dist/docx-preview.min.js'),
    'pdf': rd(X / 'pdfjs-dist-3.11.174/package/build/pdf.min.js'),
    'pdfworker': 'window.__LIBDATA=window.__LIBDATA||{};__LIBDATA.pdfworker=' + js_str(rd(X / 'pdfjs-dist-3.11.174/package/build/pdf.worker.min.js')) + ';',
    'cmaps': 'window.__LIBDATA=window.__LIBDATA||{};__LIBDATA.cmaps=' + json.dumps(cmaps) + ';',
    'tess': rd(X / 'tesseract.js-5.1.1/package/dist/tesseract.min.js'),
    'tessworker': 'window.__LIBDATA=window.__LIBDATA||{};__LIBDATA.tessworker=' + js_str(tess_worker) + ';',
    'tesscore': 'window.__LIBDATA=window.__LIBDATA||{};__LIBDATA.tesscore=' + js_str(rd(X / 'tesseract.js-core-5.1.1/package/tesseract-core-simd-lstm.wasm.js')) + ';',
    'tesslang': 'window.__LIBDATA=window.__LIBDATA||{};__LIBDATA.tesslang="' + base64.b64encode(rd(X / 'tesseract.js-data-chi_tra-1.0.0/package/4.0.0_best_int/chi_tra.traineddata.gz', 'rb')).decode() + '";',
}
files = {'jszip': 'jszip.min.js', 'docxview': 'docx-preview.js', 'pdf': 'pdf.min.js', 'pdfworker': 'pdf-worker.js', 'cmaps': 'cmaps.js', 'tess': 'tesseract.min.js',
         'tessworker': 'tess-worker.js', 'tesscore': 'tess-core.js', 'tesslang': 'tess-chi_tra.js'}

for k, v in libs.items():
    for bad in ('</script', '<!--', '<script'):
        assert bad not in v.lower(), f'{k} contains {bad}'

tpl = rd(SRC / 'index.html')
page = (tpl.replace('/*CSS*/', rd(SRC / 'app.css'))
           .replace('/*ENGINE*/', rd(SRC / 'engine.js'))
           .replace('/*APP*/', rd(SRC / 'app.js'))
           .replace('__APP_VER__', __import__('datetime').date.today().isoformat()))

if DIST.exists():
    for p in DIST.iterdir():
        if p.name in ('.git', 'CNAME', 'README.md') or p.name == 'lib': continue
        shutil.rmtree(p) if p.is_dir() else p.unlink()
DIST.mkdir(exist_ok=True)
(DIST / 'lib').mkdir(exist_ok=True)
for k, fn in files.items():
    (DIST / 'lib' / fn).write_text(libs[k], encoding='utf8')
(DIST / 'index.html').write_text(page.replace('<!--LIBS-->', ''), encoding='utf8')
inline = '\n'.join(f'<script type="text/plain" id="lib-{k}">{v}</script>' for k, v in libs.items())
(DIST / 'offline.html').write_text(page.replace('<!--LIBS-->', inline), encoding='utf8')
(DIST / '.nojekyll').write_text('')
for p in sorted(DIST.rglob('*')):
    if p.is_file(): print(f'{p.stat().st_size/1e6:8.2f} MB  {p.relative_to(DIST)}')
