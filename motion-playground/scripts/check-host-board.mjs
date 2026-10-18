import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// 启动开发服务器后：node scripts/check-host-board.mjs http://127.0.0.1:5177
const base = process.argv[2] ?? 'http://127.0.0.1:5177';
const shots = mkdtempSync(path.join(tmpdir(), 'host-board-check-'));
const browser = await puppeteer.launch({headless:true});
try {
 const page = await browser.newPage();
 const errors=[];page.on('pageerror',e=>{errors.push(String(e));console.log('PAGE ERROR',String(e));});page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text())});
 await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});
 const doc={version:1,breath:true,cards:[{id:'host',kind:'host-card-glass-board',start:2,end:8.6,params:{studio:true}}]};
 await page.goto(base+'/?export=1&doc='+encodeURIComponent(JSON.stringify(doc)));
 await page.waitForFunction(()=>window.__setExportT);
 const seek=async t=>{await page.evaluate(t=>window.__setExportT(t),t);await new Promise(r=>setTimeout(r,70));};
 await seek(7.1);
 await page.screenshot({path:path.join(shots,'dark.png')});
 const check=await page.evaluate(async()=>{
  const {hostBoardSteps,hostBoardTiming,hostBoardLayout}=await import('/src/effects/hud/HostCardGlassBoard.tsx');
  const vals=[];
  for(const n of [2,3,4]) for(const dur of [1,3,6.6,12]) for(const speed of [0.5,1,2]) {
   const r=hostBoardTiming([1.6,2.5,3.4,4.3],n,4.1,dur,speed);
   vals.push(r.connectors.every((t,i)=>t+1e-8>=r.tiles[i+1]+0.5*r.fit/speed));
   vals.push(r.result+0.45*r.fit/speed<=r.exitAt+1e-8);
  }
  const host=document.querySelector('.hcg-host').getBoundingClientRect(),board=document.querySelector('.hcg-board').getBoundingClientRect();
  return {valid:vals.every(Boolean),steps:hostBoardSteps([{icon:'a',label:'b',sub:'c'}]).length,
   noOverlap:host.right<board.left,staticBreath:!document.querySelector('.hcg[data-br-root]'),
   portrait:hostBoardLayout(1080,1920),nan:document.querySelector('.hcg').innerHTML.includes('NaN')};
 });
 assert(check.valid);assert.equal(check.steps,2);assert(check.noOverlap);assert(check.staticBreath);assert(!check.nan);
 const snapshot=()=>page.$eval('.hcg',el=>el.outerHTML);
 const at51=await snapshot();await seek(7.4);assert.equal(await snapshot(),at51,'settled scene must be still');
 await seek(3.7);await seek(7.1);assert.equal(await snapshot(),at51,'reverse seek must be deterministic');
 await seek(4.8);assert.equal(await page.$eval('.hcg-connector i',el=>el.style.transform),'scaleX(0)');
 await seek(8.35);assert((await page.$eval('.hcg-content',el=>+el.style.opacity))<1);
 await seek(8.6);assert.equal(await page.$('.hcg'),null);
 const light={...doc,cards:[{...doc.cards[0],params:{theme:'light',studio:true,title:'从想法到作品的完整工作流',steps:[{icon:'1',label:'构思',sub:'IDEA'},{icon:'2',label:'文稿',sub:'SCRIPT'},{icon:'3',label:'配音',sub:'VOICE'},{icon:'4',label:'成片',sub:'RENDER'}]}}]};
 await page.goto(base+'/?export=1&doc='+encodeURIComponent(JSON.stringify(light)));await page.waitForFunction(()=>window.__setExportT);await seek(7.4);
 await page.screenshot({path:path.join(shots,'light-four.png')});
 assert(await page.evaluate(()=>[...document.querySelectorAll('.hcg-tile')].every(el=>el.offsetLeft>=0&&el.offsetLeft+el.offsetWidth<=514)));
 // 背景必须独立于内容：旧 studio:false + 人物素材也要遮挡原片，缩小/移动/退场不露边。
 const hostSrc = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="250" height="444"><rect width="250" height="444" fill="#5279a2"/><circle cx="125" cy="110" r="50" fill="#fff"/></svg>');
 for (const source of ['hostSrc', 'cam']) {
  const scene={version:1,...(source==='cam'?{cam:hostSrc}:{}),cards:[{id:'background',kind:'host-card-glass-board',start:0,end:6.6,params:{studio:false,scale:0.7,offsetX:150,offsetY:60,...(source==='hostSrc'?{hostSrc}:{})}}]};
  await page.goto(base+'/?export=1&doc='+encodeURIComponent(JSON.stringify(scene)));
  await page.waitForFunction(()=>window.__setExportT);
  const hostRect=()=>page.$eval('.hcg-host',el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};});
  const motionRects=[];
  for (const t of [0,0.3,0.65,1.2,4.8,5.9,6.55]) {
   await seek(t);
   await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.querySelectorAll('.hcg img')].map(im=>im.decode()));
    const stage=document.querySelector('.stage');let under=document.getElementById('test-underlay');
    if(!under){under=document.createElement('div');under.id='test-underlay';under.style.cssText='position:absolute;inset:0';stage.prepend(under);}
    under.style.background='#ff00ff';
   });
   const first=await page.screenshot({omitBackground:true});
   await page.$eval('#test-underlay',el=>el.style.background='#00ff00');
   const second=await page.screenshot({omitBackground:true});
   // 分数坐标圆角边缘在 Chrome 重栅格时偶有 1/255 色阶舍入，按像素比较。
   const covered=first.equals(second) || await page.evaluate(async ([a,b])=>{
    const pixels=async s=>{const im=new Image();im.src='data:image/png;base64,'+s;await im.decode();
     const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);return ctx.getImageData(0,0,c.width,c.height).data;};
    const x=await pixels(a),y=await pixels(b);return x.every((v,i)=>Math.abs(v-y[i])<=1);
   },[first.toString('base64'),second.toString('base64')]);
   assert(covered,`${source}: original footage must be fully covered at ${t}s`);
   const bg=await page.$eval('.hcg-studio',el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,opacity:getComputedStyle(el).opacity};});
   assert.deepEqual(bg,{x:-4,y:-4,w:1928,h:1088,opacity:'1'});
   motionRects.push(await hostRect());
   if(t===0 || t===6.55) {
    assert.deepEqual(await hostRect(),{x:0,y:0,w:1920,h:1080},'full-screen endpoints ignore card scale and offset');
    assert.equal(await page.$eval('.hcg-host',el=>getComputedStyle(el).borderRadius),'0px');
    assert.equal(await page.$eval('.hcg-content',el=>+el.style.opacity),t===0?1:0);
   }
   if(source==='hostSrc' && [0,0.3,0.65,4.8,5.9,6.55].includes(t)) await page.screenshot({path:path.join(shots,`motion-${t}.png`)});
   if(t===4.8 && source==='hostSrc') await page.screenshot({path:path.join(shots,'scene-background.png')});
  }
  assert(motionRects[0].w>motionRects[1].w && motionRects[1].w>motionRects[2].w && motionRects[2].w>motionRects[3].w,'camera shrinks continuously');
  assert.deepEqual(motionRects[3],motionRects[4],'camera holds still');
  assert(motionRects[5].w>motionRects[4].w && motionRects[6].w>motionRects[5].w,'camera expands on exit');
  await seek(0.65);const early=await snapshot();await seek(6.55);await seek(0.65);
  assert.equal(await snapshot(),early,'camera and board are deterministic on reverse seek');
 }
 const transparent={version:1,cards:[{id:'transparent',kind:'host-card-glass-board',start:0,end:6.6,params:{studio:false}}]};
 await page.goto(base+'/?export=1&doc='+encodeURIComponent(JSON.stringify(transparent)));await page.waitForFunction(()=>window.__setExportT);await seek(4.8);
 assert.equal(await page.$('.hcg-studio'),null,'explicit transparent mode without host stays compatible');
 assert.equal(errors.length,0,errors.join('\n'));
 console.log(JSON.stringify({status:'passed',checks:check,errors,screenshots:shots}));
} finally {await browser.close();}
