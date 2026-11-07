// KardShot Boosters — lecture Firebase + préparation sécurisée des récompenses.
// Aucun octroi de cartes tant que les identifiants du catalogue ne sont pas validés.
const DATABASE_URL='https://kingshot-cards-default-rtdb.europe-west1.firebasedatabase.app';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const b64url=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const enc=value=>b64url(new TextEncoder().encode(JSON.stringify(value)));
async function accessToken(serviceAccount){
 const now=Math.floor(Date.now()/1000),head=enc({alg:'RS256',typ:'JWT'}),body=enc({iss:serviceAccount.client_email,sub:serviceAccount.client_email,aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600,scope:'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email'}),message=`${head}.${body}`;
 const pem=serviceAccount.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'');
 const key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(pem),c=>c.charCodeAt(0)),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
 const sig=b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(message)));
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${message}.${sig}`})});
 if(!r.ok)throw Error(`OAuth HTTP ${r.status}`);const data=await r.json();if(!data.access_token)throw Error('OAuth token absent');return data.access_token;
}
const decodePart=part=>JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-part.length%4)%4)),c=>c.charCodeAt(0))));
async function verifiedUid(request){
 const match=/^Bearer\s+([^\s]+)$/i.exec(request.headers.get('authorization')||'');if(!match)return null;
 const parts=match[1].split('.');if(parts.length!==3)return null;const [h,p,s]=parts;let header,claims;
 try{header=decodePart(h);claims=decodePart(p)}catch{return null}
 const now=Math.floor(Date.now()/1000);
 if(header.alg!=='RS256'||!header.kid||claims.aud!=='kingshot-cards'||claims.iss!=='https://securetoken.google.com/kingshot-cards'||!claims.sub||!Number.isInteger(claims.exp)||claims.exp<=now||!Number.isInteger(claims.iat)||claims.iat>now||claims.firebase?.sign_in_provider!=='google.com')return null;
 const r=await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');if(!r.ok)throw Error('Certificats Google indisponibles');
 const jwk=(await r.json()).keys.find(k=>k.kid===header.kid);if(!jwk)return null;
 const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 const sig=Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
 return await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,sig,new TextEncoder().encode(h+'.'+p))?claims.sub:null;
}
async function readDb(path,oauth,shallow=false){
 const r=await fetch(`${DATABASE_URL}/${path}.json${shallow?'?shallow=true':''}`,{headers:{Authorization:'Bearer '+oauth}});
 if(!r.ok)throw Error(`Firebase HTTP ${r.status}`);return await r.json();
}
function isRanked(uid,ranks,profiles){const p=profiles[uid],s=ranks[uid];return !!(p?.declaredKingshotId&&p?.state&&s&&Number(s.wins||0)+Number(s.losses||0)+Number(s.draws||0)>0)}

const POOL=Array.from({length:46},(_,i)=>String(i+1).padStart(4,'0'));
async function firebase(env,oauth,path,method='GET',body,etag){
 const headers={Authorization:'Bearer '+oauth};
 if(etag===true)headers['X-Firebase-ETag']='true';
 if(typeof etag==='string')headers['if-match']=etag;
 if(body!==undefined)headers['content-type']='application/json';
 const r=await fetch(`${DATABASE_URL}/${path}.json`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 if(r.status===412)return {conflict:true};
 if(!r.ok)throw Error(`Firebase HTTP ${r.status}`);
 return {value:await r.json(),etag:r.headers.get('etag')};
}
async function transaction(env,oauth,path,change){
 for(let i=0;i<12;i++){
  const prev=await firebase(env,oauth,path,'GET',undefined,true);
  const next=change(prev.value);
  if(next===undefined)return {changed:false,value:prev.value};
  const r=await firebase(env,oauth,path,'PUT',next,prev.etag||'null_etag');
  if(!r.conflict)return {changed:true,value:next};
 }
 throw Error('Conflit Firebase, réessayer');
}
function draw16(){
 const pool=[...POOL];
 for(let i=0;i<16;i++){
  const rand=new Uint32Array(1);crypto.getRandomValues(rand);
  const j=i+(rand[0]%(pool.length-i));
  [pool[i],pool[j]]=[pool[j],pool[i]];
 }
 return pool.slice(0,16);
}
export default {async fetch(request,env){
 const url=new URL(request.url);
 const allowed=['/','/firebase-test','/structure-test','/booster-status','/booster-eligibility','/booster-claim'];
 if(!allowed.includes(url.pathname))return json({error:'not_found'},404);
 if(request.method!==(url.pathname==='/booster-claim'?'POST':'GET'))return json({error:'method_not_allowed'},405);
 if(url.pathname==='/')return json({service:'KardShot Boosters',status:'configured',threshold:100});
 if(!env.FIREBASE_SERVICE_ACCOUNT)return json({error:'missing_secret'},503);
 try{
  const account=JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  if(!account.client_email||!account.private_key)throw Error('Invalid service account');
  const personal=['/booster-eligibility','/booster-claim'].includes(url.pathname);
  const uid=personal?await verifiedUid(request):null;
  if(personal&&!uid)return json({error:'Connexion Google vérifiée requise'},401);
  const oauth=await accessToken(account);
  if(url.pathname==='/firebase-test'){
   const r=await fetch(`${DATABASE_URL}/.json?shallow=true`,{headers:{Authorization:'Bearer '+oauth}});
   return json({service:'KardShot Boosters',firebase:r.ok?'oauth_ok':'database_http_error',httpStatus:r.status});
  }
  if(url.pathname==='/structure-test'){
   const paths=['playerCards','playerBoosters','playerDecks','leaderboard','rankings','players','users'],results={};
   for(const path of paths){try{results[path]=(await readDb(path,oauth,true))===null?'absent':'present'}catch(e){results[path]=e.message}}
   return json({service:'KardShot Boosters',mode:'read_only',paths:results});
  }
  const [ranks,profiles]=await Promise.all([readDb('rankAggregates/players',oauth),readDb('rankProfiles',oauth)]);
  const rankMap=ranks||{},profileMap=profiles||{};
  const count=Object.keys(rankMap).filter(id=>isRanked(id,rankMap,profileMap)).length;
  const unlocked=count>=100;
  if(url.pathname==='/booster-status')return json({service:'KardShot Boosters',rankedPlayers:count,threshold:100,unlocked,mode:'active'});
  const ranked=isRanked(uid,rankMap,profileMap);
  const testAccess=!!env.TEST_BOOSTER_UID&&uid===env.TEST_BOOSTER_UID;
  const eligible=ranked&&(unlocked||testAccess);
  const rewardPath=`playerBoosters/${uid}/booster100`;
  if(url.pathname==='/booster-eligibility'){
   const reward=(await firebase(env,oauth,rewardPath)).value;
   return json({service:'KardShot Boosters',ranked,rankedPlayers:count,threshold:100,globallyUnlocked:unlocked,testAccess,eligible,claimed:!!reward,cards:reward?.cards||[]});
  }
  if(!eligible)return json({error:'booster_locked',rankedPlayers:count,threshold:100},403);
  // L'attribution est réservée au serveur. L'ETag protège des demandes simultanées.
  const reward=await transaction(env,oauth,rewardPath,old=>old===null?{
   cards:draw16(),at:Date.now(),kind:'booster100',test:!unlocked
  }:undefined);
  const cards=reward.value?.cards;
  if(!Array.isArray(cards)||cards.length!==16||new Set(cards).size!==16||cards.some(c=>!POOL.includes(c)))throw Error('Récompense incohérente');
  // Une seconde transaction rend l'ajout idempotent, y compris après une coupure réseau.
  const inventory=await transaction(env,oauth,`playerCards/${uid}`,old=>{
   const data=old&&typeof old==='object'?{...old}:{};
   if(data.appliedBoosters?.booster100)return undefined;
   const counts={...(data.cards||{})};
   for(const card of cards)counts[card]=(Number(counts[card])||0)+1;
   data.cards=counts;
   data.appliedBoosters={...(data.appliedBoosters||{}),booster100:true};
   return data;
  });
  return json({ok:true,booster:'booster100',cards,alreadyClaimed:!reward.changed,inventoryUpdated:inventory.changed,test:!!reward.value.test});
 }catch(e){return json({service:'KardShot Boosters',error:'server_error',detail:String(e.message).slice(0,120)},503)}
}};
   
