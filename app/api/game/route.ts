import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';

export const dynamic = 'force-dynamic';
type Card = {id:string;owner_id:string;name:string;image_key:string;element:string;rarity:string;score:number;hp:number;atk:number;def:number;moves_json:string;published:number;created_at:number};
type Room = {code:string;host_id:string;guest_id:string|null;host_card_id:string;guest_card_id:string|null;status:string;state_json:string|null;version:number;updated_at:number;created_at:number};
type Unit = {name:string;cardId:string;element:string;maxHp:number;hp:number;atk:number;def:number;guard:boolean;cd:number;moves:{name:string;power:number;kind:string}[]};
type State = {p1:Unit;p2:Unit;turn:'p1'|'p2';winner:'p1'|'p2'|null;round:number;logs:string[]};
const result=(x:unknown,status=200)=>Response.json(x,{status,headers:{'Cache-Control':'no-store'}});
const fail=(s:string,status=400)=>result({error:s},status);
const database=()=>{if(!env.DB)throw Error('Database unavailable');return env.DB;};
const objects=()=>{if(!env.BUCKET)throw Error('Storage unavailable');return env.BUCKET;};
const integer=(value:unknown,min:number,max:number)=>Math.max(min,Math.min(max,Math.round(Number(value)||0)));
const name=(value:unknown)=>typeof value==='string'?[...value.trim()].slice(0,24).join(''):'';
const validId=(value:unknown)=>typeof value==='string'&&/^[a-zA-Z0-9_-]{8,64}$/.test(value);
const urlFor=(id:string)=>`/api/game?op=art&id=${encodeURIComponent(id)}`;
const elementName=(s:string)=>({normal:'ノーマル',fire:'炎',water:'水',forest:'森',thunder:'雷',dark:'闇',light:'光'} as Record<string,string>)[s]||'ノーマル';
const now=()=>Date.now();
const readCard=async(id:string)=>validId(id)?(await database().prepare('SELECT * FROM drawmon_cards WHERE id=?').bind(id).first<Card>()):null;
const readRoom=async(code:string)=>/^[A-Z0-9]{6}$/.test(code)?(await database().prepare('SELECT * FROM drawmon_rooms WHERE code=?').bind(code).first<Room>()):null;
function cardOutput(c:Card){let moves:unknown=[];try{moves=JSON.parse(c.moves_json);}catch{}return{id:c.id,name:c.name,element:c.element,rarity:c.rarity,score:c.score,hp:c.hp,atk:c.atk,def:c.def,moves,published:!!c.published,createdAt:c.created_at,image:urlFor(c.id)};}
function fighter(c:Card):Unit{return{name:c.name,cardId:c.id,element:c.element,maxHp:c.hp,hp:c.hp,atk:c.atk,def:c.def,guard:false,cd:0,moves:JSON.parse(c.moves_json)};}
function moves(raw:unknown,element:string){
  const fallback=[{name:elementName(element)+'の一撃',power:1,kind:'attack'},{name:elementName(element)+'バースト',power:1.48,kind:'special'},{name:'まもる＆回復',power:0,kind:'guard'}];
  if(!Array.isArray(raw)||raw.length!==3)return fallback;
  return fallback.map((m,i)=>({...m,name:name(raw[i]?.name)||m.name}));
}
async function roomOutput(code:string,userId:string){
  const room=await readRoom(code);if(!room)return fail('部屋が見つかりません',404);
  if(room.host_id!==userId&&room.guest_id!==userId)return fail('この部屋に参加していません',403);
  const side=room.host_id===userId?'p1':'p2';return result({code:room.code,status:room.status,side,
    state:room.state_json?JSON.parse(room.state_json):null,version:room.version,updatedAt:room.updated_at});
}

export async function GET(request:Request){
  try{
    const params=new URL(request.url).searchParams,op=params.get('op')||'',user=await getChatGPTUser();
    if(op==='me')return result({loggedIn:!!user,name:user?.fullName||'トレーナー'});
    if(op==='gallery'){
      const rows=await database().prepare('SELECT * FROM drawmon_cards WHERE published=1 ORDER BY created_at DESC LIMIT 80').all<Card>();
      return result({cards:(rows.results||[]).map(cardOutput)});
    }
    if(op==='art'){
      const id=params.get('id')||'',card=await readCard(id);if(!card)return fail('画像が見つかりません',404);
      let allowed=!!card.published||user?.userId===card.owner_id;
      if(!allowed&&user){const member=await database().prepare(`SELECT code FROM drawmon_rooms WHERE
        (host_card_id=? OR guest_card_id=?) AND (host_id=? OR guest_id=?) LIMIT 1`).bind(id,id,user.userId,user.userId).first();allowed=!!member;}
      if(!allowed)return fail('画像を表示できません',403);
      const object=await objects().get(card.image_key);if(!object)return fail('画像がありません',404);
      const ext=card.image_key.endsWith('.png')?'png':card.image_key.endsWith('.jpeg')?'jpeg':'webp';
      return new Response(object.body,{headers:{'Content-Type':'image/'+ext,'Cache-Control':'private, max-age=180'}});
    }
    if(!user)return fail('ChatGPTへのログインが必要です',401);
    if(op==='cards'){
      const rows=await database().prepare('SELECT * FROM drawmon_cards WHERE owner_id=? ORDER BY created_at DESC LIMIT 120').bind(user.userId).all<Card>();
      return result({cards:(rows.results||[]).map(cardOutput)});
    }
    if(op==='room')return roomOutput((params.get('code')||'').toUpperCase(),user.userId);
    return fail('不明な操作です',404);
  }catch(error){console.error('Game GET error',error);return fail('サーバーエラー',500);}
}

async function save(input:Record<string,unknown>,userId:string){
  const c=(input.card||{}) as Record<string,unknown>;
  if(!validId(c.id))return fail('カードIDが正しくありません');
  const id=c.id as string,display=name(c.name),element=String(c.element||''),rarity=String(c.rarity||'');
  if(!display||!['normal','fire','water','forest','thunder','dark','light'].includes(element)||!['common','rare','epic','legend'].includes(rarity))return fail('カード情報が正しくありません');
  const old=await readCard(id);
  if(old&&old.owner_id!==userId)return fail('他人のカードは上書きできません',403);
  if(!old){const count=await database().prepare('SELECT COUNT(*) AS n FROM drawmon_cards WHERE owner_id=?').bind(userId).first<{n:number}>();if((count?.n||0)>=100)return fail('保存上限は100枚です');}
  let imageKey=old?.image_key||`cards/${userId}/${id}.webp`;
  if(typeof c.image==='string'&&c.image.startsWith('data:image/')){
    const match=c.image.match(/^data:image\/(webp|png|jpeg);base64,([\w+/=]+)$/);
    if(!match||match[2].length>240000)return fail('画像データが大きいか正しくありません');
    const binary=atob(match[2]),bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    if(bytes.length>180000)return fail('画像は180KB以内にしてください');
    imageKey=`cards/${userId}/${id}.${match[1]}`;
    await objects().put(imageKey,bytes,{httpMetadata:{contentType:`image/${match[1]}`}});
  }else if(!old)return fail('画像がありません');
  const list=moves(c.moves,element),createdAt=old?.created_at||integer(c.createdAt,1,now());
  await database().prepare(`INSERT INTO drawmon_cards(id,owner_id,name,image_key,element,rarity,score,hp,atk,def,moves_json,published,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,0,?) ON CONFLICT(id) DO UPDATE SET
    name=excluded.name,image_key=excluded.image_key,element=excluded.element,rarity=excluded.rarity,
    score=excluded.score,hp=excluded.hp,atk=excluded.atk,def=excluded.def,moves_json=excluded.moves_json`)
    .bind(id,userId,display,imageKey,element,rarity,integer(c.score,1,100),integer(c.hp,80,260),integer(c.atk,20,130),integer(c.def,15,115),JSON.stringify(list),createdAt).run();
  return result({saved:true,id,image:urlFor(id)});
}

async function publish(input:Record<string,unknown>,userId:string){
  const id=String(input.id||''),card=await readCard(id);
  if(!card||card.owner_id!==userId)return fail('自分の保存済みカードだけ公開できます',403);
  const flag=input.published===true?1:0;
  await database().prepare('UPDATE drawmon_cards SET published=? WHERE id=? AND owner_id=?').bind(flag,id,userId).run();
  return result({ok:true,published:!!flag});
}

async function createRoom(input:Record<string,unknown>,userId:string){
  const card=await readCard(String(input.cardId||''));if(!card||card.owner_id!==userId)return fail('クラウドに保存したカードを選んでください',403);
  for(let i=0;i<4;i++){
    const code=crypto.randomUUID().replace(/-/g,'').slice(0,6).toUpperCase();
    const res=await database().prepare("INSERT OR IGNORE INTO drawmon_rooms(code,host_id,host_card_id,status,created_at,updated_at) VALUES(?,?,?,'waiting',?,?)").bind(code,userId,card.id,now(),now()).run();
    if(res.meta.changes)return result({code,status:'waiting'});
  }
  return fail('部屋を作れませんでした',503);
}

async function joinRoom(input:Record<string,unknown>,userId:string){
  const code=String(input.code||'').trim().toUpperCase(),room=await readRoom(code);
  if(!room)return fail('部屋が見つかりません',404);
  if(room.host_id===userId)return fail('自分の部屋には参加できません');
  if(room.status!=='waiting'||now()-room.created_at>24*3600*1000)return fail('募集は終了しました');
  const mine=await readCard(String(input.cardId||'')),host=await readCard(room.host_card_id);
  if(!mine||mine.owner_id!==userId||!host)return fail('クラウドに保存した自分のカードを選んでください');
  const state:State={p1:fighter(host),p2:fighter(mine),turn:'p1',winner:null,round:1,logs:[`${host.name} VS ${mine.name}！`,'対戦開始！ ホストの先攻です。']};
  const res=await database().prepare(`UPDATE drawmon_rooms SET guest_id=?,guest_card_id=?,status='playing',state_json=?,version=version+1,updated_at=?
    WHERE code=? AND status='waiting' AND guest_id IS NULL`).bind(userId,mine.id,JSON.stringify(state),now(),code).run();
  if(!res.meta.changes)return fail('先にほかの人が参加しました',409);
  return result({joined:true,code});
}

function action(state:State,side:'p1'|'p2',skill:number){
  const actor=state[side],other=state[side==='p1'?'p2':'p1'];
  if(skill===1&&actor.cd>0)return '必殺技はクールダウン中です';
  if(actor.cd>0&&skill!==1)actor.cd--;
  const move=actor.moves[skill];
  if(skill===2){actor.guard=true;const heal=Math.min(actor.maxHp-actor.hp,Math.round(actor.maxHp*.09));actor.hp+=heal;state.logs.push(`${actor.name} は「${move.name}」でHPを${heal}回復！`);}
  else {
    const strong:Record<string,string>={fire:'forest',forest:'water',water:'fire',thunder:'water',dark:'light',light:'dark'};
    const factor=strong[actor.element]===other.element?1.35:strong[other.element]===actor.element?0.78:1;
    const base=Math.max(5,(actor.atk*.42+8)*move.power*factor-other.def*.115);
    const damage=Math.max(5,Math.round(base*(other.guard?.48:1)));other.hp=Math.max(0,other.hp-damage);other.guard=false;
    if(skill===1)actor.cd=2;
    state.logs.push(`${actor.name} の「${move.name}」！ ${damage}ダメージ！${factor>1?' 効果ばつぐん！':''}`);
  }
  if(other.hp<=0){state.winner=side;state.logs.push(`${actor.name} の勝利！`);}else state.turn=side==='p1'?'p2':'p1';
  state.round++;state.logs=state.logs.slice(-14);return null;
}

async function play(input:Record<string,unknown>,userId:string){
  const code=String(input.code||'').toUpperCase(),room=await readRoom(code);
  if(!room||room.status!=='playing'||!room.state_json)return fail('進行中の部屋がありません',404);
  const side=room.host_id===userId?'p1':room.guest_id===userId?'p2':null;
  if(!side)return fail('この部屋には参加していません',403);
  const state=JSON.parse(room.state_json) as State;if(state.turn!==side)return fail('相手の手番です',409);
  const skill=Number(input.skill);if(!Number.isInteger(skill)||skill<0||skill>2)return fail('技を選んでください');
  const error=action(state,side,skill);if(error)return fail(error,409);
  const status=state.winner?'finished':'playing';
  const updated=await database().prepare(`UPDATE drawmon_rooms SET state_json=?,status=?,version=version+1,updated_at=?
    WHERE code=? AND version=? AND status='playing'`).bind(JSON.stringify(state),status,now(),code,room.version).run();
  if(!updated.meta.changes)return fail('手番が更新されました。再読み込みしてください',409);
  return result({ok:true,state,status,side});
}

export async function POST(request:Request){
  try{
    const user=await getChatGPTUser();if(!user)return fail('ChatGPTへのログインが必要です',401);
    const input=await request.json() as Record<string,unknown>;
    switch(input.op){
      case 'save':return save(input,user.userId);
      case 'publish':return publish(input,user.userId);
      case 'createRoom':return createRoom(input,user.userId);
      case 'joinRoom':return joinRoom(input,user.userId);
      case 'action':return play(input,user.userId);
      default:return fail('不明な操作です',404);
    }
  }catch(error){console.error('Game POST error',error);return fail('サーバーエラー',500);}
}
