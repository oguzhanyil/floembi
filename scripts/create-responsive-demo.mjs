// Aynı ürün yerleşim yardımcılarıyla F07B'den yeni F08 dosyası üretir; kaynağa bağlanmaz.
import { build } from 'vite';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const [sourceArg, targetArg] = process.argv.slice(2);
if (!sourceArg || !targetArg) throw new Error('Kullanım: node scripts/create-responsive-demo.mjs kaynak.floem yeni-hedef.floem');
const source = resolve(sourceArg), target = resolve(targetArg);
await access(source);
if (source.toLowerCase() === target.toLowerCase() || existsSync(target) || !target.endsWith('.floem')) throw new Error('Önceki dosyayı koruyun; .floem uzantılı yeni hedef seçin.');
const work = await mkdtemp(join(tmpdir(), 'floem-responsive-demo-'));
const python = [join(root, '.venv/Scripts/python.exe'), join(root, '.venv/bin/python')].find(existsSync) ?? 'python';
const runPython = (code, ...args) => {
  const r = spawnSync(python, ['-c', code, ...args], { cwd: root, windowsHide: true, encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  if (r.status !== 0) throw new Error(r.stderr || r.error?.message || 'Yerel dosya işlemi başarısız.');
};
try {
  const reportPath = join(work, 'report.json');
  runPython(`import sys,json
from pathlib import Path
from floem_bi.document.document import Document
d=Document.open(Path(sys.argv[1])/'read',Path(sys.argv[2]))
try: Path(sys.argv[3]).write_text(json.dumps(d.content.report,ensure_ascii=False),encoding='utf-8')
finally: d.close()`, work, source, reportPath);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  if (!report.pages.some((p) => p.id === 'f05-atolye') || !report.pages.some((p) => p.id === 'f07b-kullanim')) throw new Error('Kaynak F07B atölyesini içermeli.');
  await build({ configFile: false, logLevel: 'warn', build: { outDir: join(work,'js'), emptyOutDir: false,
    lib: { entry: join(root,'packages/report/src/pageLayouts.ts'), formats: ['es'], fileName: () => 'layouts.mjs' } } });
  const { createPageLayout } = await import(pathToFileURL(join(work,'js/layouts.mjs')).href);
  for (const page of report.pages.filter((p) => ['f05-atolye','f07b-kullanim'].includes(p.id))) {
    page.layouts = ['laptop','tablet','phone'].map((preset) => createPageLayout(page,preset));
    Object.assign(page,{ displayOption:'FitToPage', backgroundTransparency:0, outspaceColor:'#c7d2e0', outspaceTransparency:35 });
    for (const layout of page.layouts) for (const v of page.visuals.filter((v) => v.type === 'text')) {
      const delta = layout.overrides[v.id] ??= {};
      delta.format = { ...delta.format, fontSize: Math.max(12, Math.min(Number(v.format.fontSize) || 14, layout.id === 'phone' ? 26 : 32)), textOverflow:'grow' };
    }
  }
  const first = report.pages.find((p) => p.id === 'f05-atolye');
  first.name = 'Ekran Düzenleri';
  first.visuals.find((v) => v.id === 'f05-heading').format.text = 'Her ekranda aynı rapor';
  first.visuals.find((v) => v.id === 'f05-intro').format.text = 'Ana / Laptop / Tablet / Telefon · Ortak ölçüler ve eylemler · Düzenlere özel yerleşim';
  first.visuals.find((v) => v.id === 'f05-help').format.text = 'DENEYİN\nGörselleştirmeler → Ekran düzenleri → Telefon. Nesneleri taşıyın veya kapsayıcı akışını değiştirin; Ana düzene dönün ve özgün yerleşimi kontrol edin.\nYayımlanan raporda düzen, rapor alanının genişliğine göre seçilir. Alttaki Düzen menüsünden elle de seçim yapabilirsiniz. Diğer sayfaya geçiş ve tablo aç/kapat düğmeleri ortak kalır.';
  await writeFile(reportPath,JSON.stringify(report));
  runPython(`import sys,json
from pathlib import Path
from floem_bi.document.document import Document
d=Document.open(Path(sys.argv[1])/'write',Path(sys.argv[2]))
try:
 d.set_report(json.loads(Path(sys.argv[3]).read_text(encoding='utf-8')))
 target=Path(sys.argv[4])
 if target.exists(): raise ValueError('Hedef zaten var')
 d.save(target)
finally: d.close()`,work,source,reportPath,target);
  console.log('F08 örneği yeni dosyaya kaydedildi; iki sayfada üçer düzen, ortak veri ve bileşenler korunuyor.');
} finally {
  const rel = relative(resolve(tmpdir()),work);
  if (rel.startsWith('floem-responsive-demo-') && !rel.includes('..') && !isAbsolute(rel)) await rm(work,{recursive:true,force:true});
}
