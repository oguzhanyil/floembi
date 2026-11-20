import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
export async function testInspector({ call, evaluate, waitFor, input }) {
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
  await evaluate('window.setTestMode("inspector")');
  await waitFor('document.querySelector(".inspector-launch") && document.querySelector("[data-visual-id=error] .v-error")');
  const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const finding = (code, id) => `.design-inspector article[data-code="${code}"]${id ? `[data-object-id="${id}"]` : ""}`;
  const exists = (code, id) => `document.querySelector(${JSON.stringify(finding(code, id))})`;
  const queryCount = await evaluate('window.auditQueryCount');
  await click('.inspector-launch');
  await waitFor(`${exists('TEXT_OVERFLOW', 'overflow')} && ${exists('QUERY_ERROR', 'error')} && ${exists('RESULT_TRUNCATED', 'truncated')}`);
  assert.equal(await evaluate(`${exists('RENDERED_SMALL_FONT', 'clean')} !== null`), false, 'Tuvalin küçük yakınlaştırması normal metni küçük yazı saymamalı');
  assert.equal(await evaluate(`${exists('RESULT_TRUNCATED', 'paged')} !== null`), false, 'Sayfalama kesilme değildir');
  assert(await evaluate(`${exists('PAGED_SCOPE', 'paged')} !== null`));
  assert(await evaluate(`${exists('EMPTY_RESULT', 'empty')} !== null`));
  assert.equal(await evaluate('window.auditQueryCount'), queryCount, 'Denetçi yeni sorgu çalıştırmamalı');
  assert.equal(await evaluate('window.auditSaveCount || 0'), 0);
  // Tuvalin gerçek boyutuyla da ölçüm sonucu aynı kalır.
  await click('.design-inspector header button');
  await click('.canvas-zoom button[title="Gerçek boyut (Ctrl+0)"]');
  await click('.inspector-launch'); await waitFor(exists('TEXT_OVERFLOW', 'overflow'));
  assert.equal(await evaluate(`${exists('RENDERED_SMALL_FONT', 'clean')} !== null`), false);
  await input('[aria-label="Denetimde ara"]', 'UNIT_MISMATCH');
  await waitFor(`document.querySelectorAll('.design-inspector article').length === 1`);
  assert(await evaluate(`${exists('UNIT_MISMATCH', 'units')} !== null`));
  await input('[aria-label="Denetimde ara"]', '');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 2, mobile: false });
  await waitFor(exists('TEXT_OVERFLOW', 'overflow'));
  assert.equal(await evaluate(`${exists('RENDERED_SMALL_FONT', 'clean')} !== null`), false, 'DPR yazı boyutunu değiştirmemeli');
  if (process.env.FLOEM_UI_ARTIFACT_DIR) {
    const shot = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(resolve(process.env.FLOEM_UI_ARTIFACT_DIR), 'f13-denetci.png'), Buffer.from(shot.data, 'base64'));
  }
  // Rapor çıktısı yalnız bulgu metadatasıdır; satırlar ve ham hatalar dışarı çıkmaz.
  await evaluate(`window.auditBlob = null;window.auditOriginalCreate=URL.createObjectURL;URL.createObjectURL=(blob)=>{window.auditBlob=blob;return window.auditOriginalCreate(blob)}`);
  await evaluate(`Array.from(document.querySelectorAll('.design-inspector button')).find(b=>b.textContent==='JSON indir').click()`);
  const exported = await evaluate('window.auditBlob.text()');
  const json = JSON.parse(exported);
  assert(json.findings.length > 8); assert(!exported.includes('private-row-data')); assert(!exported.includes('raw-private-error'));
  await evaluate('URL.createObjectURL=window.auditOriginalCreate');
  // Canlı durumlar veri sürümüyle yenilenir; sıfır değer artık boş sayılmaz.
  await evaluate('window.auditHealthy=true;window.refreshAuditData()');
  await waitFor(`!${exists('QUERY_ERROR', 'error')} && !${exists('EMPTY_RESULT', 'empty')} && !${exists('RESULT_TRUNCATED', 'truncated')}`);
  // Aynı DOM üzerinde metin kısalınca ölçüm uyarısı kalkar; tasarım kaydı yoktur.
  await evaluate(`document.querySelector('[data-visual-id=overflow] .v-text').textContent='Kısa'`);
  await waitFor(`!${exists('TEXT_OVERFLOW', 'overflow')}`);
  // Telefon bulgusu, kendi sayfa ve düzenini açar; nesneyi seçer.
  await click(`${finding('SMALL_FONT', 'phone-text')} button`);
  await waitFor(`!document.querySelector('.design-inspector') && document.querySelector('.report-view[data-layout-id=phone]') && document.querySelector('[data-visual-id=phone-text].selected')`);
  assert.equal(await evaluate('window.auditSaveCount || 0'), 0);
  assert(await evaluate(`document.querySelector('[aria-label="Geri al"]').disabled`));
  await click('.inspector-launch'); await waitFor('document.querySelector(".design-inspector[open]")');
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await waitFor('!document.querySelector(".design-inspector")');
  assert.equal(await evaluate('window.auditSaveCount || 0'), 0);
  // Çok bulgulu raporda DOM listesi sınırlıdır; dar ekranda panel yatay taşmaz.
  await evaluate(`window.setAuditReport({version:1,pages:[{id:'many',name:'Çok nesne',width:1280,height:18000,visuals:Array.from({length:135},(_,i)=>({id:'n'+i,type:'text',x:10,y:i*100,w:300,h:50,group:[],values:[],filters:[],format:{showTitle:false,fontSize:9,text:'Örnek'}}))}]})`);
  await waitFor(`document.querySelector('[data-visual-id=n134]')`);
  await click('.inspector-launch');
  await waitFor(`document.querySelectorAll('.design-inspector article').length === 100`);
  await click('.inspector-more');
  await waitFor(`document.querySelectorAll('.design-inspector article').length === 135`);
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await waitFor(`document.querySelector('.design-inspector').getBoundingClientRect().width < 390`);
  assert(await evaluate(`(()=>{const d=document.querySelector('.design-inspector');const r=document.querySelector('.inspector-results');return d.scrollWidth<=d.clientWidth+1 && r.clientHeight>=80 && r.scrollHeight>r.clientHeight})()`));
  assert.equal(await evaluate('window.auditSaveCount || 0'), 0);
  await click('.design-inspector header button');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
  // Yerel şablon kimliği sayfadaki nesneyle aynı olsa da bulgu tekrarlayıcıya aittir.
  await evaluate(`(()=>{
    const n=(id,type,props={})=>({id,type,x:10,y:10,w:300,h:80,group:[],values:[],filters:[],format:{showTitle:false,text:'Açıklama'},...props});
    window.setAuditReport({version:1,components:[{id:'row',version:1,name:'Satır',description:'',rootId:'root',slots:[],visuals:[
      n('root','container',{x:0,y:0,w:500,h:100,container:{mode:'free'}}),
      n('clean','text',{parentId:'root',bindings:{color:{source:{kind:'row',field:{table:'T',column:'Ad'}}}}})
    ]}],pages:[{id:'collision',name:'Şablon kimliği',width:1280,height:900,visuals:[n('clean','text'),
      n('list','repeater',{y:160,w:700,h:500,group:[{table:'T',column:'Ad'}],repeater:{definitionId:'row',version:1,bindings:{},itemHeight:110}})
    ]}]});
  })()`);
  await waitFor(`document.querySelector('[data-visual-id=list] .v-runtime-error')`);
  await click('.inspector-launch');
  await waitFor(exists('QUERY_ERROR', 'list'));
  assert.equal(await evaluate(`${exists('QUERY_ERROR', 'clean')} !== null`), false);
  await click('.design-inspector header button');
  console.log('PASS: F13 canlı taşma/DPR, sorgu durumu ve kapsamı, gizli içeriksiz JSON, salt okunur denetim ve telefon nesnesine yönlendirme');
}
