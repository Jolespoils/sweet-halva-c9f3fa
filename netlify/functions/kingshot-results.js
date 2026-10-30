'use strict';
const admin=require('firebase-admin');
const DB_URL='https://kingshot-cards-default-rtdb.europe-west1.firebasedatabase.app';
function getAdmin(){
 if(!admin.apps.length){const raw=process.env.FIREBASE_SERVICE_ACCOUNT_JSON;if(!raw)throw Error('FIREBASE_SERVICE_ACCOUNT_JSON non configurée');
 const service=JSON.parse(raw);admin.initializeApp({credential:admin.credential.cert(service),databaseURL:DB_URL});}
 return admin;
}
const respond=(statusCode,data)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(data)});
function clean(s,max){return String(s||'').trim().slice(0,max)}
function validState(s){return /^\d{1,6}$/.test(s)}
function validScore(s){return Number.isInteger(s)&&s>=0&&s<=10000}
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
exports.handler=async event=>{
 if(event.httpMethod!=='POST')return respond(405,{error:'Méthode non autorisée'});
 try{
  const fb=getAdmin();const token=(event.headers.authorization||event.headers.Authorization||'').replace(/^Bearer\s+/i,'');
  let data;try{data=JSON.parse(event.body||'{}')}catch{return respond(400,{error:'JSON invalide'})}
  const db=fb.database();const action=data.action;
  if(action==='leaderboard'){
   if(!['players','states'].includes(data.kind))return respond(400,{error:'Classement invalide'});
   const snap=await db.ref(data.kind==='players'?'rankAggregates/players':'rankAggregates/states').get();const stats=snap.val()||{};
   const profiles=data.kind==='players'?(await db.ref('rankProfiles').get()).val()||{}:{};
   const rows=Object.entries(stats).map(([id,s])=>({...formatStat(s),name:profiles[id]?.name||'Joueur',state:data.kind==='states'?id:(profiles[id]?.state||'—'),id}));
   rows.sort((a,b)=>b.wins-a.wins||a.losses-b.losses||a.id.localeCompare(b.id));
   return respond(200,{rows:rows.slice(0,100)});
  }
  if(!token)return respond(401,{error:'Authentification nécessaire'});
  const verified=await fb.auth().verifyIdToken(token);const uid=verified.uid;
  if(action==='me'){const profile=(await db.ref('rankProfiles/'+uid).get()).val();return respond(200,{profile:profile||null})}
  if(action==='profile'){return respond(403,{error:'Profil verrouillé : utilisez l’association Google et ID Kingshot'}); /* ancien formulaire désactivé */
   const name=clean(data.name,30),state=clean(data.state,6);
   if(name.length<2||!validState(state))return respond(400,{error:'Pseudo (2 caractères minimum) et État numérique obligatoires'});
   const p=db.ref('rankProfiles/'+uid);
   const previous=(await p.get()).val();
   await p.set({name,state,updatedAt:fb.database.ServerValue.TIMESTAMP});
   return respond(200,{ok:true,profile:{name,state}});
  }
  if(action==='leaderboard'){
   if(!['players','states'].includes(data.kind))return respond(400,{error:'Classement invalide'});
   const snap=await db.ref(data.kind==='players'?'rankAggregates/players':'rankAggregates/states').get();const stats=snap.val()||{};
   const profiles=data.kind==='players'?(await db.ref('rankProfiles').get()).val()||{}:{};
   const rows=Object.entries(stats).map(([id,s])=>({...formatStat(s),name:profiles[id]?.name||'Joueur',state:data.kind==='states'?id:(profiles[id]?.state||'—'),id}));
   rows.sort((a,b)=>b.wins-a.wins||a.losses-b.losses||a.id.localeCompare(b.id));
   return respond(200,{rows:rows.slice(0,100)});
  }
  if(action==='record'){
   const room=clean(data.room,6),round=data.round;
   if(!/^[A-HJ-NP-Z2-9]{6}$/.test(room)||!Number.isInteger(round)||round<1||round>10000)return respond(400,{error:'Identifiant de partie invalide'});
   const roomData=(await db.ref('rooms/'+room).get()).val();
   if(!roomData||![roomData.host,roomData.guest].includes(uid))return respond(403,{error:'Joueur non participant'});
   const g=roomData.game;
   if(!g||g.ended!==true||g.phase!=='playing'||(g.round||1)!==round||!Array.isArray(g.board)||g.board.length!==15||!Number.isInteger(g.moves)||g.moves<2)return respond(409,{error:'Partie non terminée normalement'});
   const key=room+'_'+round;
   const [hostP,guestP]=await Promise.all([db.ref('rankProfiles/'+roomData.host).get(),db.ref('rankProfiles/'+roomData.guest).get()]);
   const h=hostP.val(),v=guestP.val();if(!h?.declaredKingshotId||!v?.declaredKingshotId)return respond(409,{error:'Duel amical : deux comptes Google avec ID Kingshot associé sont nécessaires'});if(!h?.state||!v?.state)return respond(409,{error:'Profils des deux joueurs nécessaires'});
   const scores=calculateScores(g.board);
   if(!scores)return respond(409,{error:'Plateau invalide'});
   const {B:scoreB,R:scoreR}=scores;
   const winner=scoreB>scoreR?'B':scoreR>scoreB?'R':'draw';
   const resultRef=db.ref('rankResults/'+key);
   const claim=await resultRef.transaction(old=>old===null?{room,round,host:roomData.host,guest:roomData.guest,hostState:h.state,guestState:v.state,scoreB,scoreR,winner,at:Date.now()}:undefined,undefined,false);
   const record=claim.snapshot.val();if(!record)return respond(500,{error:'Résultat non enregistré'});
   if(record.host!==roomData.host||record.guest!==roomData.guest)return respond(409,{error:'Résultat incohérent'});
   const aggregate=await db.ref('rankAggregates').transaction(old=>{
    const a=old||{matches:{},players:{},states:{}};
    if(a.matches?.[key])return;
    a.matches=a.matches||{};a.players=a.players||{};a.states=a.states||{};
    a.matches[key]=true;
    a.players[record.host]=add(a.players[record.host],recordFor(record.winner,'B'));
    a.players[record.guest]=add(a.players[record.guest],recordFor(record.winner,'R'));
    if(record.hostState!==record.guestState){
      a.states[record.hostState]=add(a.states[record.hostState],recordFor(record.winner,'B'));
      a.states[record.guestState]=add(a.states[record.guestState],recordFor(record.winner,'R'));
    }
    return a;
   },undefined,false);
   return respond(200,{ok:true,recorded:aggregate.committed||!!aggregate.snapshot.child('matches/'+key).val(),scoreB,scoreR});
  }
  return respond(400,{error:'Action inconnue'});
 }catch(e){console.error('kingshot-results',e);return respond(500,{error:'Erreur serveur : vérifie la configuration Netlify'})}
};
