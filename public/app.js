(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const canvas = $('draw-canvas');
  const ctx = canvas.getContext('2d', {willReadFrequently:true});
  const COLORS = ['#292c45','#ffffff','#f46e83','#fbb75c','#f9d75e','#85d87d','#4dcbbb','#6da5f2','#b78bff','#ec8bd1','#9b6e54','#989ba8'];
  const ELEMENTS = {
    fire:{name:'炎',icon:'🔥',color:'#f58168',strong:['forest']},
    water:{name:'水',icon:'💧',color:'#72a6ff',strong:['fire']},
    forest:{name:'森',icon:'🌿',color:'#80c777',strong:['water']},
    thunder:{name:'雷',icon:'⚡',color:'#ffd16e',strong:['water']},
    dark:{name:'闇',icon:'🌙',color:'#ba91e8',strong:['light']},
    light:{name:'光',icon:'✨',color:'#f9d88c',strong:['dark']}
  };
  const RARITY = {common:{name:'ノーマル',icon:'◆',rank:0},rare:{name:'レア',icon:'✦',rank:1},epic:{name:'エピック',icon:'✦✦',rank:2},legend:{name:'レジェンド',icon:'✦✦✦',rank:3}};
  const STORAGE_KEY = 'drawmon-cards-v1';
  const WINS_KEY = 'drawmon-wins-v1';
  let cards = safeRead(STORAGE_KEY, []);
  if (!Array.isArray(cards)) cards = [];
  let migratedOldIds=false;
  for(const card of cards)if(typeof card.id!=='string'||!/^[a-zA-Z0-9_-]{8,64}$/.test(card.id)){card.id=newId();migratedOldIds=true;}
  if(migratedOldIds)try{localStorage.setItem(STORAGE_KEY,JSON.stringify(cards));}catch{}
  let wins = Number(safeRead(WINS_KEY,0)) || 0;
  let brush = 8, color = COLORS[0], drawing = false, erased = false, strokes = 0;
  let undoStack = [], draft = null, selectedId = null, match = null, busy = false;
  let toastTimer = null, modelPromise = null;
  let onlineSelectedId = null, onlineCode = '', onlineSide = '', onlineVersion = -1, onlineBusy = false, onlinePolling = null;
  const emojis = ['🐱','🐺','🐉','🐙','🦋','🦊','🐦','🐸','🦄','🐻','🦇'];

  function safeRead(key,fallback){try{const value=localStorage.getItem(key);return value===null?fallback:JSON.parse(value);}catch{return fallback;}}
  function newId(){return typeof crypto.randomUUID==='function'?crypto.randomUUID():String(Date.now())+'-'+Math.random().toString(36).slice(2);}
  function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function clamp(n,min,max){return Math.max(min,Math.min(max,n));}
  function toast(msg){const e=$('toast');e.textContent=msg;e.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.classList.remove('show'),3500);}
  async function api(op, data){
    const request=data===undefined?{method:'GET'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,...data})};
    const response=await fetch('/api/game'+(data===undefined?'?op='+encodeURIComponent(op):''),request);
    const body=await response.json();if(!response.ok)throw new Error(body.error||'通信に失敗しました');return body;
  }
  function setPage(page){
    for(const e of document.querySelectorAll('.page'))e.classList.toggle('active',e.id==='page-'+page);
    for(const e of document.querySelectorAll('.nav-item'))e.classList.toggle('active',e.dataset.page===page);
    if(page==='collection')renderCollection();
    if(page==='battle')renderBattleSetup();
    if(page==='gallery')renderGallery();
    if(page==='online')renderOnlinePicker();
    window.scrollTo({top:0,behavior:'smooth'});
  }
  document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>setPage(b.dataset.page)));
  document.querySelectorAll('[data-jump]').forEach(b=>b.addEventListener('click',()=>setPage(b.dataset.jump)));
  document.querySelector('.brand').addEventListener('click',e=>{e.preventDefault();setPage('create')});
  function updateCounters(){$('nav-count').textContent=cards.length;$('collection-count').textContent=cards.length;$('win-count').textContent=wins+' WIN';$('battle-wins').textContent=wins;}

  function setupDrawing(){
    ctx.lineWidth=brush;ctx.lineCap='round';ctx.lineJoin='round';
    $('palette').innerHTML='<span class="color-label">COLOR</span>'+COLORS.map((c,i)=>`<button class="color-swatch ${i===0?'selected':''}" style="--swatch:${c}" data-color="${c}" aria-label="${c} の色" title="${c}"></button>`).join('');
    $('palette').addEventListener('click',e=>{const b=e.target.closest('[data-color]');if(!b)return;color=b.dataset.color;erased=false;setActiveTool();document.querySelectorAll('.color-swatch').forEach(x=>x.classList.toggle('selected',x===b));});
    $('pen-tool').addEventListener('click',()=>{erased=false;setActiveTool();});
    $('eraser-tool').addEventListener('click',()=>{erased=true;setActiveTool();});
    $('brush-size').addEventListener('input',e=>{brush=Number(e.target.value);$('brush-label').textContent=brush+'px';});
    $('clear-btn').addEventListener('click',()=>{if(!hasInk())return;undoStack.push(canvas.toDataURL());ctx.clearRect(0,0,canvas.width,canvas.height);strokes=0;updateHint();toast('キャンバスをクリアしました');});
    $('undo-btn').addEventListener('click',()=>{
      if(!undoStack.length){toast('これ以上戻せません');return;}
      const url=undoStack.pop(),img=new Image();img.onload=()=>{ctx.globalCompositeOperation='source-over';ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0);updateHint();};img.src=url;
    });
    canvas.addEventListener('pointerdown',e=>{
      if(e.button!==0 && e.pointerType==='mouse')return;
      e.preventDefault();undoStack.push(canvas.toDataURL());if(undoStack.length>12)undoStack.shift();
      drawing=true;canvas.setPointerCapture(e.pointerId);const p=point(e);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x+.1,p.y+.1);setStroke();ctx.stroke();strokes++;updateHint();
    });
    canvas.addEventListener('pointermove',e=>{if(!drawing)return;e.preventDefault();const p=point(e);setStroke();ctx.lineTo(p.x,p.y);ctx.stroke();});
    for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,()=>{if(drawing){drawing=false;ctx.beginPath();updateHint();}});
    $('analyze-btn').addEventListener('click',analyzeDrawing);
  }
  function point(e){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height};}
  function setStroke(){ctx.globalCompositeOperation=erased?'destination-out':'source-over';ctx.strokeStyle=color;ctx.lineWidth=brush;ctx.lineCap='round';ctx.lineJoin='round';}
  function setActiveTool(){$('pen-tool').classList.toggle('selected',!erased);$('eraser-tool').classList.toggle('selected',erased);}
  function hasInk(){const d=ctx.getImageData(0,0,canvas.width,canvas.height).data;for(let i=3;i<d.length;i+=4)if(d[i]>30)return true;return false;}
  function updateHint(){$('canvas-hint').classList.toggle('hidden',hasInk());}
  function analyzePixels(){
    const {width:w,height:h}=canvas,data=ctx.getImageData(0,0,w,h).data;
    let count=0,sumR=0,sumG=0,sumB=0,sumS=0,minX=w,maxX=0,minY=h,maxY=0,edges=0;
    const bins=new Set(),sides=new Array(12).fill(0);
    let hash=2166136261;
    for(let y=0;y<h;y+=2)for(let x=0;x<w;x+=2){
      const i=(y*w+x)*4,a=data[i+3];if(a<35)continue;
      const r=data[i],g=data[i+1],b=data[i+2];count++;sumR+=r;sumG+=g;sumB+=b;
      sumS+=(Math.max(r,g,b)-Math.min(r,g,b))/255;
      bins.add(`${r>>5}-${g>>5}-${b>>5}`);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      sides[Math.min(11,Math.floor(x/(w/12)))]++;
      if(x>1&&data[i-5]<35)edges++;
      if(y>1&&data[i-(w*4*2)+3]<35)edges++;
      hash=Math.imul(hash^((r+g*3+b*7+x+y)&255),16777619);
    }
    if(count<160)return null;
    const symmetry=1-Math.min(1,sides.reduce((v,n,i)=>v+Math.abs(n-sides[11-i]),0)/(2*count));
    const coverage=count/((w*h)/4);
    const variation=bins.size;
    const saturation=sumS/count;
    const r=sumR/count,g=sumG/count,b=sumB/count;
    let element='dark';
    const max=Math.max(r,g,b),min=Math.min(r,g,b),range=max-min;
    let hue=0;
    if(range>8){if(max===r)hue=((g-b)/range+6)%6;else if(max===g)hue=(b-r)/range+2;else hue=(r-g)/range+4;hue*=60;}
    if(saturation<.15){element=(r+g+b)/3>170?'light':'dark';}
    else if(hue<17||hue>=344)element='fire';
    else if(hue<48)element='fire';
    else if(hue<76)element='thunder';
    else if(hue<170)element='forest';
    else if(hue<252)element='water';
    else if(hue<335)element='dark';
    else element='fire';
    return {count,coverage,variation,symmetry,edges,saturation,element,hash:hash>>>0,bounds:[minX,minY,maxX,maxY]};
  }
  function drawAnalysisCanvas(){
    const c=document.createElement('canvas');c.width=224;c.height=224;
    const p=c.getContext('2d');p.fillStyle='#ffffff';p.fillRect(0,0,224,224);
    const scale=Math.min(210/canvas.width,210/canvas.height),w=canvas.width*scale,h=canvas.height*scale;
    p.drawImage(canvas,(224-w)/2,(224-h)/2,w,h);return c;
  }
  function loadScript(src){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.async=true;const timer=setTimeout(()=>{s.remove();reject(new Error('AI load timeout'));},16000);s.onload=()=>{clearTimeout(timer);resolve();};s.onerror=()=>{clearTimeout(timer);reject(new Error('AI script unavailable'));};document.head.appendChild(s);});}
  async function getRecognition(){
    if(!modelPromise)modelPromise=(async()=>{
      await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js');
      await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js');
      return await window.mobilenet.load({version:2,alpha:1});
    })();
    return modelPromise;
  }
  function recognitionName(label){
    const s=(label||'').toLowerCase();
    for(const [key,jp] of [['cat','ネコ'],['dog','イヌ'],['wolf','オオカミ'],['fox','キツネ'],['bird','トリ'],['eagle','ワシ'],['owl','フクロウ'],['fish','サカナ'],['shark','サメ'],['snake','ヘビ'],['dragon','ドラゴン'],['frog','カエル'],['turtle','カメ'],['bear','クマ'],['butterfly','チョウ'],['spider','クモ'],['rabbit','ウサギ'],['horse','ウマ'],['lion','ライオン'],['tiger','トラ'],['robot','ロボ'],['star','スター'],['flower','フラワー']])if(s.includes(key))return jp;
    return '';
  }
  function cardImage(){const c=document.createElement('canvas');c.width=240;c.height=168;const p=c.getContext('2d');p.fillStyle='#fdfbff';p.fillRect(0,0,c.width,c.height);p.drawImage(canvas,0,0,c.width,c.height);return c.toDataURL('image/webp',.79);}
  function generatedMoves(element,features){
    const variants={
      fire:[['火炎の爪','フレイムブレイク'],['紅蓮の牙','メテオフレア']],
      water:[['水流の刃','タイダルウェーブ'],['アクアショット','深海の渦']],
      forest:[['リーフカッター','大樹の怒り'],['蔦のムチ','森羅の嵐']],
      thunder:[['スパークアロー','サンダーストーム'],['稲妻の爪','雷帝の一撃']],
      dark:[['影の一閃','ダークノヴァ'],['夜の爪','黒月の衝撃']],
      light:[['光の矢','ホーリーバースト'],['星のきらめき','スターダスト']]
    };
    const pair=variants[element][(features.hash>>>8)%2];
    return [{name:pair[0],power:1,kind:'attack',desc:'通常攻撃'},
      {name:pair[1],power:1.48,kind:'special',desc:'高威力・2ターンの待機時間'},
      {name:features.symmetry>.55?'ミラーバリア':'生命の祈り',power:0,kind:'guard',desc:'防御とHP回復'}];
  }
  async function analyzeDrawing(){
    const chosenName=$('monster-name').value.trim();
    if(!chosenName){toast('カード化する前に名前を決めてね！');$('monster-name').focus();return;}
    const f=analyzePixels();if(!f){toast('もう少し絵を描いてから評価しよう！');return;}
    const button=$('analyze-btn');button.disabled=true;button.innerHTML='✧ AIが絵を調べています…';
    let label='',confidence=0,aiUsed=false;
    try{
      const m=await getRecognition();const predictions=await m.classify(drawAnalysisCanvas(),3);
      if(predictions.length){label=predictions[0].className;confidence=predictions[0].probability;aiUsed=true;}
    }catch(e){console.warn('AIモデルは利用不可。色と形によるローカル分析に切り替えます。',e);}
    const rand=n=>((f.hash>>>((n%4)*8))&255)/255;
    const visualScore=clamp(Math.round(38+Math.min(25,f.coverage*160)+Math.min(12,f.variation*.28)+f.symmetry*9+Math.min(8,strokes*.7)+Math.min(6,f.edges/1700)+(aiUsed?confidence*5:0)),38,98);
    const rarity=visualScore>=91?'legend':visualScore>=77?'epic':visualScore>=61?'rare':'common';
    draft={id:null,name:chosenName.slice(0,24),element:f.element,score:visualScore,rarity,hp:Math.round(94+visualScore*.86+rand(1)*20),atk:Math.round(27+visualScore*.65+rand(2)*14),def:Math.round(22+visualScore*.57+rand(3)*14),moves:generatedMoves(f.element,f),image:cardImage(),createdAt:Date.now(),aiUsed,label,confidence,published:false};
    renderPreview();button.disabled=false;button.innerHTML='<span>✦</span> AIで評価してカード化 <span class="button-arrow">↗</span>';toast('カードが完成したよ！');
    if(window.innerWidth<760)$('preview-result').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function cardTemplate(card,preview=false){
    const element=ELEMENTS[card.element]||ELEMENTS.dark,rarity=RARITY[card.rarity]||RARITY.common;
    const moves=Array.isArray(card.moves)?card.moves:[];
    return `<div class="monster-card ${escapeHtml(card.rarity)} ${preview?'preview-mon':''}"><div class="card-head"><div class="card-name" title="${escapeHtml(card.name)}">${escapeHtml(card.name)}</div><div class="card-type">${element.icon} ${element.name}</div></div><div class="card-art"><img src="${card.image}" alt="${escapeHtml(card.name)} の描いた絵"><span class="art-bubble">ORIGINAL ART</span></div><div class="card-rarity"><span class="rarity-label">${rarity.icon} ${rarity.name.toUpperCase()}</span><span class="card-score">★ AI SCORE ${card.score}</span></div><div class="card-divider"></div><div class="stats-row"><div class="stat-pill"><small>♥ HP</small>${card.hp}</div><div class="stat-pill"><small>⚔ ATK</small>${card.atk}</div><div class="stat-pill"><small>◆ DEF</small>${card.def}</div></div>${moves.length?`<div class="card-moves">${moves.map((m,i)=>`<span>${i===1?'💥':i===2?'🛡':'⚔'} ${escapeHtml(m.name)}</span>`).join('')}</div>`:''}<div class="card-bottom"><span>DRAWMON ORIGINAL</span><span>#${card.id?card.id.slice(0,6).toUpperCase():'NEW'}</span></div></div>`;
  }
  function renderPreview(){
    $('preview-placeholder').classList.add('hidden');$('preview-result').classList.remove('hidden');
    const status=draft.aiUsed?`画像認識AIの推測: <strong>${escapeHtml(draft.label.split(',')[0])}</strong>（信頼度 ${Math.round(draft.confidence*100)}%）`:'画像認識AIに接続できなかったため、色・形・密度・対称性で評価しました。';
    $('preview-result').innerHTML=`<div class="generation-label"><span>✦ NEW CREATURE GENERATED</span><div class="preview-scoring">SCORE <strong>${draft.score}</strong>/100</div></div>${cardTemplate(draft,true)}<div class="generation-info"><b>🧠 評価レポート</b><p>${status}</p><p>${ELEMENTS[draft.element].icon} ${ELEMENTS[draft.element].name}属性・${RARITY[draft.rarity].name}判定。攻撃技も自動生成されました。</p></div><button id="save-card" class="primary-button save-button">📚 コレクションに保存する</button>`;
    $('save-card').addEventListener('click',saveDraft);
  }
  function saveDraft(){
    if(!draft)return;
    const card={...draft,id:newId()};
    const newCards=[card,...cards];
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(newCards));cards=newCards;draft=null;updateCounters();toast('カードを保存したよ！');setPage('collection');api('save',{card}).then(()=>{$('cloud-status').textContent='☁ 新しいカードをクラウドにも保存しました。';}).catch(()=>{$('cloud-status').textContent='端末内に保存済み。クラウド保存は「セーブ」を押してください。';});}
    catch{toast('保存容量がいっぱいです。古いカードを削除してください。');}
  }
  function renderCollection(){
    const sort=$('sort-cards').value;
    const sorted=[...cards].sort((a,b)=>sort==='score'?b.score-a.score:sort==='rarity'?RARITY[b.rarity].rank-RARITY[a.rarity].rank:b.createdAt-a.createdAt);
    $('collection-grid').innerHTML=sorted.map(c=>`<div class="collect-item">${cardTemplate(c)}<div class="card-actions"><button data-fight="${c.id}">⚔ バトル</button><button data-publish="${c.id}" title="ほかの人のギャラリーに表示">${c.published?'🔒 非公開に':'🌍 公開'}</button><button data-remove="${c.id}" class="remove-card" aria-label="${escapeHtml(c.name)} を削除">✕</button></div></div>`).join('');
    $('collection-empty').classList.toggle('hidden',cards.length!==0);updateCounters();
  }
  $('sort-cards').addEventListener('change',renderCollection);
  $('collection-grid').addEventListener('click',async e=>{
    const fight=e.target.closest('[data-fight]'),remove=e.target.closest('[data-remove]'),pub=e.target.closest('[data-publish]');
    if(fight){selectedId=fight.dataset.fight;setPage('battle');}
    if(pub){
      const card=cards.find(c=>c.id===pub.dataset.publish);if(!card)return;
      if(!card.published&&!confirm(`「${card.name}」の絵・名前・能力を公開ギャラリーに掲載しますか？`))return;
      pub.disabled=true;
      try{await api('save',{card});const r=await api('publish',{id:card.id,published:!card.published});card.published=r.published;localStorage.setItem(STORAGE_KEY,JSON.stringify(cards));renderCollection();toast(r.published?'カードを公開しました！':'カードを非公開にしました');}
      catch(error){pub.disabled=false;toast(error.message);}
    }
    if(remove){const card=cards.find(c=>c.id===remove.dataset.remove);if(!card||!confirm(`「${card.name}」を削除しますか？ この操作は元に戻せません。`))return;cards=cards.filter(c=>c.id!==card.id);localStorage.setItem(STORAGE_KEY,JSON.stringify(cards));if(selectedId===card.id)selectedId=null;renderCollection();toast('カードを削除しました');}
  });

  $('cloud-save').addEventListener('click',async()=>{
    const b=$('cloud-save');b.disabled=true;$('cloud-status').textContent='クラウドにセーブしています…';
    let saved=0;try{for(const card of cards){await api('save',{card});saved++;}$('cloud-status').textContent=`☁ ${saved}枚のカードをクラウドに保存しました。`;toast('クラウドセーブ完了！');}
    catch(error){$('cloud-status').textContent=`${saved}枚保存後にエラー: ${error.message}`;toast('クラウド保存に失敗しました');}finally{b.disabled=false;}
  });
  $('cloud-load').addEventListener('click',async()=>{
    const b=$('cloud-load');b.disabled=true;
    try{const response=await api('cards'),byId=new Map(cards.map(c=>[c.id,c]));for(const card of response.cards)byId.set(card.id,{...byId.get(card.id),...card});cards=[...byId.values()];localStorage.setItem(STORAGE_KEY,JSON.stringify(cards));renderCollection();$('cloud-status').textContent=`☁ クラウドから${response.cards.length}枚をロードしました。端末限定カードは残しています。`;toast('ロード完了！');}
    catch(error){toast(error.message);}finally{b.disabled=false;}
  });

  async function renderGallery(){
    $('gallery-grid').innerHTML='<p class="dim">公開カードを読み込み中…</p>';$('gallery-empty').classList.add('hidden');
    try{const response=await api('gallery');$('gallery-grid').innerHTML=response.cards.map(c=>`<div class="collect-item">${cardTemplate(c)}<p class="gallery-caption">✦ 公開されたオリジナルカード</p></div>`).join('');$('gallery-empty').classList.toggle('hidden',response.cards.length!==0);}
    catch(error){$('gallery-grid').textContent='ギャラリーを取得できませんでした: '+error.message;}
  }
  $('refresh-gallery').addEventListener('click',renderGallery);

  const RIVALS=[
    {name:'フレイムフォックス',element:'fire',symbol:'🦊'},
    {name:'アクアクラゲ',element:'water',symbol:'🐙'},
    {name:'モリノクマ',element:'forest',symbol:'🐻'},
    {name:'ボルトバード',element:'thunder',symbol:'🐦'},
    {name:'シャドウバット',element:'dark',symbol:'🦇'},
    {name:'ライトキャット',element:'light',symbol:'🐱'}
  ];
  function renderBattleSetup(){
    if(match&&!match.ended){$('battle-setup').classList.add('hidden');$('battle-field').classList.remove('hidden');renderMatch();return;}
    $('battle-setup').classList.remove('hidden');$('battle-field').classList.add('hidden');
    $('battle-choices').innerHTML=cards.length?cards.map(c=>`<button class="battle-choice ${c.id===selectedId?'chosen':''}" data-pick="${c.id}"><img src="${c.image}" alt="${escapeHtml(c.name)}"><b>${escapeHtml(c.name)}</b><small>${ELEMENTS[c.element].icon} ${ELEMENTS[c.element].name} ・ ★ ${c.score}</small></button>`).join(''):`<div class="state-empty" style="grid-column:1/-1;padding:35px"><div>🎨</div><h2>まだカードがありません</h2><p>まずはモンスターを描こう！</p><button class="primary-button" data-jump-battle>お絵描きへ →</button></div>`;
    $('battle-choices').querySelector('[data-jump-battle]')?.addEventListener('click',()=>setPage('create'));
    $('selected-info').textContent=selectedId&&cards.some(c=>c.id===selectedId)?'選択中: '+cards.find(c=>c.id===selectedId).name:'カードを選択してください';
    $('start-battle').disabled=!cards.some(c=>c.id===selectedId);
  }
  $('battle-choices').addEventListener('click',e=>{const b=e.target.closest('[data-pick]');if(!b)return;selectedId=b.dataset.pick;renderBattleSetup();});
  $('start-battle').addEventListener('click',startBattle);
  function startBattle(){
    const card=cards.find(c=>c.id===selectedId);if(!card)return;
    const rival=RIVALS[Math.floor(Math.random()*RIVALS.length)],factor=card.score/70;
    const foe={...rival,hp:Math.round(113+factor*42),atk:Math.round(32+factor*35),def:Math.round(28+factor*27)};
    match={player:{...card,currentHp:card.hp,guard:false,cd:0},enemy:{...foe,currentHp:foe.hp,guard:false,cd:0},logs:[`野生の ${foe.name} が現れた！`,`いけっ！ ${card.name}！`],ended:false,round:1};
    busy=false;$('battle-setup').classList.add('hidden');$('battle-field').classList.remove('hidden');renderMatch();
  }
  function statusHtml(mon){return `<div class="name-row"><b>${escapeHtml(mon.name)}</b><span>${ELEMENTS[mon.element].icon} ${ELEMENTS[mon.element].name}</span></div><div class="hp-track"><div class="hp-fill ${mon.currentHp/mon.hp<.3?'low':''}" style="width:${clamp(mon.currentHp/mon.hp*100,0,100)}%"></div></div><span class="hp-numbers">HP ${Math.max(0,mon.currentHp)} / ${mon.hp}</span>`;}
  function log(s){match.logs.push(s);if(match.logs.length>18)match.logs.shift();}
  function skillNames(mon){return Array.isArray(mon.moves)&&mon.moves.length===3?mon.moves.map(m=>m.name):[ELEMENTS[mon.element].name+'の一撃','必殺 '+ELEMENTS[mon.element].name+'バースト','まもる＆回復'];}
  function renderMatch(){
    if(!match)return;
    const p=match.player,e=match.enemy;
    $('player-monster').innerHTML=`<img src="${p.image}" alt="${escapeHtml(p.name)}">`;
    $('enemy-monster').innerHTML=`<span aria-label="${escapeHtml(e.name)}">${e.symbol}</span>`;
    $('player-status').innerHTML=statusHtml(p);$('enemy-status').innerHTML=statusHtml(e);
    $('battle-log').innerHTML=match.logs.map(s=>`<p>› ${escapeHtml(s)}</p>`).join('');$('battle-log').scrollTop=$('battle-log').scrollHeight;
    $('skill-buttons').innerHTML=skillNames(p).map((name,i)=>`<button class="skill-button" data-skill="${i}" ${busy||match.ended||(i===1&&p.cd>0)?'disabled':''}><b>${i===0?'⚔':i===1?'💥':'🛡'} ${name}</b><small>${i===0?'通常攻撃・安定したダメージ':i===1?p.cd>0?'クールダウン 残り'+p.cd+'ターン':'大ダメージ・使用後2ターン待機':'防御＆HPを少し回復'}</small></button>`).join('');
    $('battle-end').classList.toggle('hidden',!match.ended);
  }
  function damage(attacker,defender,mult){
    let type=1;if(ELEMENTS[attacker.element].strong.includes(defender.element))type=1.35;
    if(ELEMENTS[defender.element].strong.includes(attacker.element))type=.78;
    const raw=(attacker.atk*.42+8)*mult*type-defender.def*.115;
    const final=Math.max(5,Math.round(raw*(.87+Math.random()*.26)*(defender.guard?.48:1)));
    defender.guard=false;defender.currentHp=Math.max(0,defender.currentHp-final);
    return {final,type};
  }
  function perform(actor,defender,skill){
    const names=skillNames(actor);if(skill===2){actor.guard=true;const heal=Math.min(actor.hp-actor.currentHp,Math.round(actor.hp*.09));actor.currentHp+=heal;log(`${actor.name} は身を守った！ HPを ${heal} 回復。`);return;}
    const r=damage(actor,defender,skill===1?1.48:1);
    if(skill===1)actor.cd=3;
    log(`${actor.name} の「${names[skill]}」！ ${r.final} ダメージ！${r.type>1?' 効果ばつぐん！':r.type<1?' 効果はいまひとつ…':''}`);
  }
  function finishBattle(won){match.ended=true;busy=false;if(won){wins++;localStorage.setItem(WINS_KEY,JSON.stringify(wins));updateCounters();}renderMatch();$('battle-end').innerHTML=`<div class="battle-result"><h2>${won?'🏆 勝利！':'💫 敗北…'}</h2><p>${won?'相棒との絆で勝ち取った勝利！':'技の使い方を変えて、もう一度挑戦しよう！'}</p><button id="battle-again" class="primary-button">↻ 別の相手と戦う</button></div>`;$('battle-end').classList.remove('hidden');$('battle-again').addEventListener('click',()=>{match=null;renderBattleSetup()});}
  const delay=t=>new Promise(resolve=>setTimeout(resolve,t));
  $('skill-buttons').addEventListener('click',async e=>{
    const b=e.target.closest('[data-skill]');if(!b||busy||!match||match.ended)return;
    const skill=Number(b.dataset.skill),p=match.player,o=match.enemy;if(skill===1&&p.cd>0)return;
    busy=true;if(p.cd>0)p.cd--;perform(p,o,skill);renderMatch();
    if(o.currentHp<=0){log(`${o.name} を倒した！`);finishBattle(true);return;}
    await delay(650);
    if(!match||match.ended)return;
    if(o.cd>0)o.cd--;
    const needGuard=o.currentHp/o.hp<.3&&!o.guard&&Math.random()<.35;
    const enemySkill=needGuard?2:(o.cd===0&&Math.random()<.38?1:0);
    perform(o,p,enemySkill);renderMatch();
    if(p.currentHp<=0){log(`${p.name} は戦えなくなった…`);finishBattle(false);return;}
    match.round++;busy=false;renderMatch();
  });
  $('leave-battle').addEventListener('click',()=>{if(match&&!match.ended&&!confirm('バトルを終了しますか？'))return;match=null;busy=false;renderBattleSetup();});

  function renderOnlinePicker(){
    if(onlineCode)return;
    onlineSelectedId=cards.some(c=>c.id===onlineSelectedId)?onlineSelectedId:(cards.some(c=>c.id===selectedId)?selectedId:cards[0]?.id||null);
    $('online-card-picker').innerHTML=cards.length?cards.map(c=>`<button class="battle-choice ${c.id===onlineSelectedId?'chosen':''}" data-online-pick="${c.id}"><img src="${c.image}" alt="${escapeHtml(c.name)}"><b>${escapeHtml(c.name)}</b><small>${ELEMENTS[c.element].icon} ${ELEMENTS[c.element].name} ・ ★${c.score}</small></button>`).join(''):'<p class="dim">まずお絵描きでカードを作ってください。</p>';
    $('create-room').disabled=!onlineSelectedId;$('join-room').disabled=!onlineSelectedId;
  }
  $('online-card-picker').addEventListener('click',e=>{const b=e.target.closest('[data-online-pick]');if(!b)return;onlineSelectedId=b.dataset.onlinePick;renderOnlinePicker();});
  async function withOnlineCard(action){
    const card=cards.find(c=>c.id===onlineSelectedId);if(!card){toast('カードを選んでください');return;}
    try{await api('save',{card});await action(card);}catch(error){toast(error.message);}
  }
  $('create-room').addEventListener('click',()=>withOnlineCard(async card=>{
    $('create-room').disabled=true;
    try{const res=await api('createRoom',{cardId:card.id});enterRoom(res.code);toast('部屋ができました！ コードを友達に送ろう');}
    finally{$('create-room').disabled=false;}
  }));
  $('join-room').addEventListener('click',()=>withOnlineCard(async card=>{
    const code=$('join-code').value.trim().toUpperCase();
    if(!/^[A-Z0-9]{6}$/.test(code)){toast('6文字の部屋コードを入力してください');return;}
    const res=await api('joinRoom',{code,cardId:card.id});enterRoom(res.code);toast('部屋に参加しました！');
  }));
  function enterRoom(code){
    onlineCode=code;onlineVersion=-1;onlineBusy=false;
    $('online-lobby').classList.add('hidden');$('online-room').classList.remove('hidden');$('room-code').textContent=code;
    clearInterval(onlinePolling);pollRoom();onlinePolling=setInterval(pollRoom,2200);
  }
  async function pollRoom(){
    if(!onlineCode)return;
    try{
      const res=await fetch('/api/game?op=room&code='+encodeURIComponent(onlineCode),{cache:'no-store'});
      const room=await res.json();if(!res.ok)throw Error(room.error||'部屋を取得できません');
      onlineSide=room.side;
      if(onlineVersion===room.version)return;
      onlineVersion=room.version;
      if(room.status==='waiting'){$('room-waiting').classList.remove('hidden');$('online-match').classList.add('hidden');return;}
      $('room-waiting').classList.add('hidden');$('online-match').classList.remove('hidden');renderOnlineMatch(room);
    }catch(error){console.warn('Room polling:',error);}
  }
  function renderOnlineMatch(room){
    const s=room.state;if(!s)return;
    const side=room.side,me=s[side],other=s[side==='p1'?'p2':'p1'];
    function fighterHtml(u){const info={...u,currentHp:u.hp,hp:u.maxHp};return `<div class="online-portrait"><img src="/api/game?op=art&id=${encodeURIComponent(u.cardId)}" alt="${escapeHtml(u.name)}"></div><div class="fighter-status">${statusHtml(info)}</div>`;}
    $('online-player').innerHTML=fighterHtml(me);$('online-enemy').innerHTML=fighterHtml(other);
    $('online-logs').innerHTML=s.logs.map(l=>`<p>› ${escapeHtml(l)}</p>`).join('');$('online-logs').scrollTop=$('online-logs').scrollHeight;
    if(room.status==='finished'){
      $('online-turn').textContent=s.winner===side?'🏆 あなたの勝利！':'対戦終了';
      $('online-skills').innerHTML=`<div class="battle-result">${s.winner===side?'勝利！ おめでとう！':'対戦が終了しました'}　<button class="small-button" id="back-to-lobby">ロビーへ</button></div>`;
      $('back-to-lobby').addEventListener('click',leaveOnlineRoom);return;
    }
    const myTurn=s.turn===side;
    $('online-turn').textContent=myTurn?'あなたの番！ 技を選ぼう':'相手の操作を待っています…';
    $('online-skills').innerHTML=me.moves.map((m,i)=>`<button class="skill-button" data-online-skill="${i}" ${!myTurn||onlineBusy||(i===1&&me.cd>0)?'disabled':''}><b>${i===0?'⚔':i===1?'💥':'🛡'} ${escapeHtml(m.name)}</b><small>${i===0?'通常攻撃':i===1?me.cd>0?'あと'+me.cd+'ターン':'必殺技':'防御＋回復'}</small></button>`).join('');
  }
  $('online-skills').addEventListener('click',async e=>{
    const b=e.target.closest('[data-online-skill]');if(!b||onlineBusy||!onlineCode)return;
    onlineBusy=true;for(const el of $('online-skills').querySelectorAll('button'))el.disabled=true;
    try{await api('action',{code:onlineCode,skill:Number(b.dataset.onlineSkill)});onlineVersion=-1;await pollRoom();}
    catch(error){toast(error.message);onlineVersion=-1;await pollRoom();}
    finally{onlineBusy=false;}
  });
  function leaveOnlineRoom(){clearInterval(onlinePolling);onlinePolling=null;onlineCode='';onlineVersion=-1;onlineBusy=false;$('online-room').classList.add('hidden');$('online-lobby').classList.remove('hidden');renderOnlinePicker();}
  $('quit-room').addEventListener('click',leaveOnlineRoom);
  $('copy-room').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(onlineCode);toast('部屋コードをコピーしました！');}catch{toast('部屋コード: '+onlineCode);}});

  setupDrawing();updateCounters();renderCollection();renderBattleSetup();
})();
