'use strict';
const admin=require('firebase-admin');
const {clean,calculateScores,weekKey,leaderboardRows,addToAggregate}=require('./_rank_rules.js');
const DB_URL='https://kingshot-cards-default-rtdb.europe-west1.firebasedatabase.app';
function getAdmin(){if(!admin.apps.length){const raw=process.env.FIREBASE_SERVICE_ACCOUNT_JSON;if(!raw)throw Error('FIREBASE_SERVICE_ACCOUNT_JSON non configurée');admin.initializeApp({credential:admin.credential.cert(JSON.parse(raw)),databaseURL:DB_URL})}return admin}
const respond=(statusCode,data)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(data)});
exports.handler=async event=>{
 if(event.httpMethod!=='POST')return respond(405,{error:'Méthode non autorisée'});
 try{const fb=getAdmin(),data=JSON.parse(event.body||'{}'),action=data?.action,db=fb.database();
 if(action==='leaderboard'){
  if(!['players','states'].includes(data.kind)||!['week','life',undefined].includes(data.period))return respond(400,{error:'Classement invalide'});
  const period=data.period==='week'?'week':'life',base=period==='week'?'rankAggregatesWeekly/'+weekKey():'rankAggregates';
  const [stats,profiles]=await Promise.all([db.ref(base+'/'+data.kind).get(),data.kind==='players'?db.ref('rankProfiles').get():Promise.resolve(null)]);
  return respond(200,{rows:leaderboardRows(stats.val(),profiles?.val(),data.kind),period});
 }
 const raw=(event.headers.authorization||event.headers.Authorization||'').replace(/^Bearer\s+/i,'');if(!raw)return respond(401,{error:'Authentification nécessaire'});
 const verified=await fb.auth().verifyIdToken(raw);if(verified.firebase?.sign_in_provider!=='google.com')return respond(403,{error:'Compte Google obligatoire'});
 const uid=verified.uid;
 if(action==='me')return respond(200,{profile:(await db.ref('rankProfiles/'+uid).get()).val()||null});
 if(action==='profile')return respond(403,{error:'Profil verrouillé : utilisez l’association Google et ID Kingshot'});
 if(action!=='record')return respond(400,{error:'Action inconnue'});
 const room=clean(data.room,6),round=data.round;
 if(!/^[A-HJ-NP-Z2-9]{6}$/.test(room)||!Number.isInteger(round)||round<1||round>10000)return respond(400,{error:'Identifiant de partie invalide'});
 const roomData=(await db.ref('rooms/'+room).get()).val();if(!roomData||![roomData.host,roomData.guest].includes(uid))return respond(403,{error:'Joueur non participant'});
 const g=roomData.game;if(!g||g.ended!==true||g.phase!=='playing'||(g.round||1)!==round||!g.board||!Number.isInteger(g.moves)||g.moves<2)return respond(409,{error:'Partie non terminée normalement'});
 const key=room+'_'+round;
 const [hp,gp]=await Promise.all([db.ref('rankProfiles/'+roomData.host).get(),db.ref('rankProfiles/'+roomData.guest).get()]);const h=hp.val(),v=gp.val();
 if(!h?.declaredKingshotId||!v?.declaredKingshotId||!h?.state||!v?.state)return respond(409,{error:'Duel classé : deux profils Kingshot associés sont nécessaires'});
 const scores=calculateScores(g.board);if(!scores)return respond(409,{error:'Plateau ou carte non reconnu'});
 const {B:scoreB,R:scoreR}=scores,winner=scoreB>scoreR?'B':scoreR>scoreB?'R':'draw';
 const claim=await db.ref('rankResults/'+key).transaction(old=>old===null?{room,round,host:roomData.host,guest:roomData.guest,hostState:h.state,guestState:v.state,scoreB,scoreR,winner,at:Date.now()}:undefined,undefined,false);
 const record=claim.snapshot.val();if(!record)return respond(500,{error:'Résultat non enregistré'});if(record.host!==roomData.host||record.guest!==roomData.guest)return respond(409,{error:'Résultat incohérent'});
 const aggregate=await db.ref('rankAggregates').transaction(old=>{const a=old||{};if(a.matches?.[key])return;addToAggregate(a,record,key);return a},undefined,false);
 const weekly=await db.ref('rankAggregatesWeekly/'+weekKey(record.at)).transaction(old=>{const a=old||{};if(a.matches?.[key])return;addToAggregate(a,record,key);return a},undefined,false);
 return respond(200,{ok:true,recorded:aggregate.committed||!!aggregate.snapshot.child('matches/'+key).val(),weeklyRecorded:weekly.committed||!!weekly.snapshot.child('matches/'+key).val(),scoreB,scoreR});
 }catch(e){console.error('kingshot-results',e);return respond(500,{error:'Erreur serveur : vérifier la configuration et les journaux Netlify'})}
};
