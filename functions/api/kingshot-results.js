import {json,db,atomic,token,error} from './_lib.js';
function recordFor(winner,side){return {wins:winner===side?1:0,losses:winner!==side&&winner!=='draw'?1:0,draws:winner==='draw'?1:0}}
function add(old,delta){return {wins:(old?.wins||0)+delta.wins,losses:(old?.losses||0)+delta.losses,draws:(old?.draws||0)+delta.draws}}
function formatStat(s){const wins=s?.wins||0,losses=s?.losses||0,draws=s?.draws||0,n=wins+losses+draws;return {wins,losses,draws,rate:n?(100*wins/n).toFixed(1)+'%':'0%'}}
// Catalogue des bonus de cartes, extrait du moteur V205. Les scores sont recalculés côté serveur.
const CARD_BONUSES={"Edwin":{"plus":0,"buff":[]},"Olive":{"plus":1,"buff":[[1,0]]},"Forrest":{"plus":0,"buff":[]},"Seth":{"plus":0,"buff":[]},"Loup gris":{"plus":0,"buff":[]},"Lynx":{"plus":0,"buff":[]},"Bison":{"plus":0,"buff":[]},"Guépard":{"plus":0,"buff":[]},"Élan":{"plus":0,"buff":[]},"Ours grizzly":{"plus":0,"buff":[]},"Lion":{"plus":0,"buff":[]},"Rhinocéros géant":{"plus":0,"buff":[]},"Bison puissant":{"plus":0,"buff":[]},"Grand élan":{"plus":0,"buff":[]},"Panthère noire alpha":{"plus":0,"buff":[]},"Lion blanc royal":{"plus":0,"buff":[]},"Yeonwoo":{"plus":2,"buff":[[1,1]]},"Amane":{"plus":2,"buff":[[0,1]]},"Chenko":{"plus":1,"buff":[[0,1]]},"Quinn":{"plus":0,"buff":[]},"Howard":{"plus":0,"buff":[]},"Gordon":{"plus":2,"buff":[[0,1]]},"Fahd":{"plus":0,"buff":[]},"Diana":{"plus":0,"buff":[]},"Jabel":{"plus":0,"buff":[]},"Saul":{"plus":0,"buff":[]},"Zoe":{"plus":0,"buff":[]},"Amadeus":{"plus":0,"buff":[]},"Petra":{"plus":3,"buff":[[0,1]]},"Triton":{"plus":0,"buff":[]}};
function calculateScores(board){
 if(!Array.isArray(board)||board.length!==15)return null;
 const totals={B:0,R:0};
 for(let row=0;row<3;row++){
  const points={B:0,R:0};
  for(let x=0;x<5;x++){
   const i=row*5+x,v=board[i];if(v==null)continue;
   if(typeof v!=='object'||!['B','R'].includes(v.s)||!Number.isInteger(v.lv)||v.lv<0||v.lv>100|| (v.n&&!CARD_BONUSES[v.n]))return null;
   if(!v.n)continue;
   if(!Number.isInteger(v.base)||v.base<0||v.base>100)return null;
   let bonus=0;
   for(let j=0;j<15;j++){
    const a=board[j];if(!a?.n||a.s!==v.s||j===i)continue;
    const card=CARD_BONUSES[a.n];if(!card)return null;
    if(card.plus&&card.buff.some(([y,dx])=>{const r=Math.floor(j/5)+y,c=j%5+(a.s==='R'?-dx:dx);return r>=0&&r<3&&c>=0&&c<5&&r*5+c===i}))bonus+=card.plus;
   }
   points[v.s]+=v.base+bonus;
  }
  if(points.B>points.R)totals.B+=points.B;
  else if(points.R>points.B)totals.R+=points.R;
 }
 return totals;
}

export async function onRequestPost({request,env}){try{
 const data=await request.json(),action=data.action;
 if(action==='leaderboard'){
  if(!['players','states'].includes(data.kind))return json({error:'Classement invalide'},400);
  const stats=(await db(env,data.kind==='players'?'rankAggregates/players':'rankAggregates/states')).value||{};
  const profiles=data.kind==='players'?(await db(env,'rankProfiles')).value||{}:{};
  const rows=Object.entries(stats).map(([id,s])=>({...formatStat(s),name:profiles[id]?.name||'Joueur',state:data.kind==='states'?id:(profiles[id]?.state||'—'),id}));
  rows.sort((a,b)=>b.wins-a.wins||a.losses-b.losses||a.id.localeCompare(b.id));return json({rows:rows.slice(0,100)});
 }
 const uid=await token(request);
 if(action==='me')return json({profile:(await db(env,'rankProfiles/'+uid)).value||null});
 if(action==='profile')return json({error:'Profil verrouillé : utilisez l’association Google et ID Kingshot'},403);
 if(action!=='record')return json({error:'Action inconnue'},400);
 const room=clean(data.room,6),round=data.round;
 if(!/^[A-HJ-NP-Z2-9]{6}$/.test(room)||!Number.isInteger(round)||round<1||round>10000)return json({error:'Identifiant de partie invalide'},400);
 const roomData=(await db(env,'rooms/'+room)).value;
 if(!roomData||![roomData.host,roomData.guest].includes(uid))return json({error:'Joueur non participant'},403);
 const g=roomData.game;
 if(!g||g.ended!==true||g.phase!=='playing'||(g.round||1)!==round||!Array.isArray(g.board)||g.board.length!==15||!Number.isInteger(g.moves)||g.moves<2)return json({error:'Partie non terminée normalement'},409);
 const key=room+'_'+round;
 const [h,v]=await Promise.all([db(env,'rankProfiles/'+roomData.host),db(env,'rankProfiles/'+roomData.guest)]).then(x=>x.map(y=>y.value));
 if(!h?.declaredKingshotId||!v?.declaredKingshotId)return json({error:'Duel amical : deux comptes Google avec ID Kingshot associé sont nécessaires'},409);
 if(!h?.state||!v?.state)return json({error:'Profils des deux joueurs nécessaires'},409);
 const scores=calculateScores(g.board);if(!scores)return json({error:'Plateau invalide'},409);
 const {B:scoreB,R:scoreR}=scores,winner=scoreB>scoreR?'B':scoreR>scoreB?'R':'draw';
 const claim=await atomic(env,'rankResults/'+key,old=>old===null?{room,round,host:roomData.host,guest:roomData.guest,hostState:h.state,guestState:v.state,scoreB,scoreR,winner,at:Date.now()}:undefined);
 const record=claim.value;if(!record)return json({error:'Résultat non enregistré'},500);
 if(record.host!==roomData.host||record.guest!==roomData.guest)return json({error:'Résultat incohérent'},409);
 const aggregate=await atomic(env,'rankAggregates',old=>{
  const a=old||{matches:{},players:{},states:{}};
  if(a.matches?.[key])return undefined;
  a.matches||={};a.players||={};a.states||={};a.matches[key]=true;
  a.players[record.host]=add(a.players[record.host],recordFor(record.winner,'B'));
  a.players[record.guest]=add(a.players[record.guest],recordFor(record.winner,'R'));
  if(record.hostState!==record.guestState){a.states[record.hostState]=add(a.states[record.hostState],recordFor(record.winner,'B'));a.states[record.guestState]=add(a.states[record.guestState],recordFor(record.winner,'R'));}
  return a;
 });
 return json({ok:true,recorded:aggregate.committed||!!aggregate.value?.matches?.[key],scoreB,scoreR});
 }catch(e){return error(e)}}
