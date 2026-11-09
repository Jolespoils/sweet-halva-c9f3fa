import {json,db,atomic,token,error} from './_lib.js';
import {clean,calculateScores,weekKey,addToAggregate} from './_rank_rules.js';
import {rankingRows,weeklyAwards} from './_rank_v418.js';

// Settles all closed weeks on a request. Firebase transaction on the lifetime
// aggregate ensures each weekly award is credited exactly once.
async function settleClosedWeeks(env){
 const all=(await db(env,'rankAggregatesWeekly')).value||{};
 const current=weekKey();
 for(const [week,weekly] of Object.entries(all).sort(([a],[b])=>a.localeCompare(b))){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(week)||week>=current)continue;
  const awards=weeklyAwards(weekly?.players||{});
  await atomic(env,'rankAggregates',old=>{
   const a=old||{};
   a.weeklySettlements||={};
   if(a.weeklySettlements[week])return undefined;
   a.players||={};
   for(const [uid,amount] of Object.entries(awards)){
    const p=a.players[uid]||{};
    a.players[uid]={...p,bonusPoints:(p.bonusPoints||0)+amount};
   }
   a.weeklySettlements[week]={at:Date.now(),awards};
   return a;
  });
 }
}

export async function onRequestPost({request,env}){try{
 const data=await request.json(),action=data?.action;
 if(action==='leaderboard'){
  if(!['players','states'].includes(data.kind)||!['week','life',undefined].includes(data.period))return json({error:'Classement invalide'},400);
  await settleClosedWeeks(env);
  const period=data.period==='week'?'week':'life';
  const base=period==='week'?'rankAggregatesWeekly/'+weekKey():'rankAggregates';
  const stats=(await db(env,base+'/'+data.kind)).value||{};
  const profiles=data.kind==='players'?(await db(env,'rankProfiles')).value||{}:{};
  return json({rows:rankingRows(stats,profiles,data.kind).slice(0,100),period});
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
 if(!g||g.ended!==true||g.phase!=='playing'||(g.round||1)!==round||!g.board||!Number.isInteger(g.moves)||g.moves<2)return json({error:'Partie non terminée normalement'},409);
 const key=room+'_'+round;
 const [h,v]=await Promise.all([db(env,'rankProfiles/'+roomData.host),db(env,'rankProfiles/'+roomData.guest)]).then(x=>x.map(y=>y.value));
 if(!h?.declaredKingshotId||!v?.declaredKingshotId||!h?.state||!v?.state)return json({error:'Duel classé : deux profils Kingshot associés sont nécessaires'},409);
 const scores=calculateScores(g.board);if(!scores)return json({error:'Plateau ou carte non reconnu'},409);
 const {B:scoreB,R:scoreR}=scores,winner=scoreB>scoreR?'B':scoreR>scoreB?'R':'draw';
 const claim=await atomic(env,'rankResults/'+key,old=>old===null?{room,round,host:roomData.host,guest:roomData.guest,hostState:h.state,guestState:v.state,scoreB,scoreR,winner,at:Date.now()}:undefined);
 const record=claim.value;if(!record)return json({error:'Résultat non enregistré'},500);
 if(record.host!==roomData.host||record.guest!==roomData.guest)return json({error:'Résultat incohérent'},409);
 const aggregate=await atomic(env,'rankAggregates',old=>{const a=old||{};if(a.matches?.[key])return undefined;addToAggregate(a,record,key);return a});
 const weekly=await atomic(env,'rankAggregatesWeekly/'+weekKey(record.at),old=>{const a=old||{};if(a.matches?.[key])return undefined;addToAggregate(a,record,key);return a});
 await settleClosedWeeks(env);
 return json({ok:true,recorded:aggregate.committed||!!aggregate.value?.matches?.[key],weeklyRecorded:weekly.committed||!!weekly.value?.matches?.[key],scoreB,scoreR});
 }catch(e){return error(e)}}
