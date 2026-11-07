// KardShot — étape 1 : vérifier l'accès Firebase en lecture seule.
// Aucun tirage ni écriture dans la collection à ce stade.
const DATABASE_URL = 'https://kingshot-cards-default-rtdb.europe-west1.firebasedatabase.app';
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}
});
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = value => b64url(new TextEncoder().encode(JSON.stringify(value)));
async function accessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const head = enc({alg:'RS256',typ:'JWT'});
  const body = enc({iss:serviceAccount.client_email,sub:serviceAccount.client_email,
    aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600,
    scope:'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email'});
  const message = `${head}.${body}`;
  const pem = serviceAccount.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const binary = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', binary, {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const sig = b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(message)));
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${message}.${sig}`})
  });
  if (!response.ok) throw new Error(`OAuth HTTP ${response.status}`);
  const data = await response.json();
  if (!data.access_token) throw new Error('OAuth token absent');
  return data.access_token;
}
// Validation cryptographique d'un jeton Firebase Google avant toute autorisation de test.
const decodePart = part => JSON.parse(new TextDecoder().decode(Uint8Array.from(
  atob(part.replace(/-/g,'+').replace(/_/g,'/') + '='.repeat((4-part.length%4)%4)), c=>c.charCodeAt(0))));
async function verifiedUid(request) {
  const match = /^Bearer\s+([^\s]+)$/i.exec(request.headers.get('authorization')||'');
  if (!match) return null;
  const parts=match[1].split('.'); if(parts.length!==3) return null;
  const [h,p,s]=parts; let header,claims;
  try {header=decodePart(h);claims=decodePart(p)}catch{return null}
  const now=Math.floor(Date.now()/1000);
  if(header.alg!=='RS256'||!header.kid||claims.aud!=='kingshot-cards'||
     claims.iss!=='https://securetoken.google.com/kingshot-cards'||
     !claims.sub||!Number.isInteger(claims.exp)||claims.exp<=now||
     !Number.isInteger(claims.iat)||claims.iat>now||
     claims.firebase?.sign_in_provider!=='google.com')return null;
  const r=await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  if(!r.ok)throw Error('Certificats Google indisponibles');
  const jwk=(await r.json()).keys.find(k=>k.kid===header.kid);if(!jwk)return null;
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  const sig=Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
  return await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,sig,new TextEncoder().encode(h+'.'+p))?claims.sub:null;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET') return json({error:'method_not_allowed'},405);
    if (url.pathname === '/') return json({service:'KardShot Boosters',status:'configured',firebaseTest:'/firebase-test',structureTest:'/structure-test',boosterStatus:'/booster-status',eligibility:'/booster-eligibility'});
    if (!['/firebase-test','/structure-test','/booster-status','/booster-eligibility'].includes(url.pathname))return json({error:'not_found'},404);
    const secret = env.FIREBASE_SERVICE_ACCOUNT;
    if (!secret) return json({service:'KardShot Boosters',firebase:'missing_secret'},503);
    try {
      const account = JSON.parse(secret);
      if (!account.client_email || !account.private_key) throw new Error('Invalid service account');
      const oauth = await accessToken(account);
      if (url.pathname === '/booster-status' || url.pathname === '/booster-eligibility') {
        const [ranksResponse, profilesResponse] = await Promise.all([
          fetch(`${DATABASE_URL}/rankAggregates/players.json`,{headers:{Authorization:'Bearer '+oauth}}),
          fetch(`${DATABASE_URL}/rankProfiles.json`,{headers:{Authorization:'Bearer '+oauth}})
        ]);
        if (!ranksResponse.ok || !profilesResponse.ok) return json({error:'firebase_read_failed'},503);
        const ranks=(await ranksResponse.json())||{}, profiles=(await profilesResponse.json())||{};
        const count=Object.entries(ranks).filter(([uid,stats])=>{
          const p=profiles[uid];return p?.declaredKingshotId&&p?.state&&stats&&
          Number(stats.wins||0)+Number(stats.losses||0)+Number(stats.draws||0)>0;
        }).length;
        const unlocked=count>=100;
        if(url.pathname==='/booster-status')return json({service:'KardShot Boosters',rankedPlayers:count,threshold:100,unlocked,mode:'read_only'});
        const uid=await verifiedUid(request);
        if(!uid)return json({error:'Connexion Google vérifiée requise'},401);
        const profile=profiles[uid];
        const ranked=!!(profile?.declaredKingshotId&&profile?.state&&ranks[uid]&&
          Number(ranks[uid].wins||0)+Number(ranks[uid].losses||0)+Number(ranks[uid].draws||0)>0);
        // Variable secrète TEST_BOOSTER_UID: UID Firebase exact du seul testeur autorisé.
        const testAccess=!!env.TEST_BOOSTER_UID&&uid===env.TEST_BOOSTER_UID;
        return json({service:'KardShot Boosters',ranked,rankedPlayers:count,threshold:100,
          globallyUnlocked:unlocked,testAccess,eligible:ranked&&(unlocked||testAccess),
          mode:'eligibility_only',cardsGranted:0});
      }
      if(url.pathname==='/structure-test'){
        const paths=['playerCards','playerBoosters','playerDecks','leaderboard','rankings','players','users'];
        const results={};for(const path of paths){const r=await fetch(`${DATABASE_URL}/${path}.json?shallow=true`,{headers:{Authorization:'Bearer '+oauth}});
          results[path]=!r.ok?'http_'+r.status:(await r.json())===null?'absent':'present';}
        return json({service:'KardShot Boosters',mode:'read_only',paths:results});
      }
      const r=await fetch(`${DATABASE_URL}/.json?shallow=true`,{headers:{Authorization:'Bearer '+oauth}});
      return json({service:'KardShot Boosters',firebase:r.ok?'oauth_ok':'database_http_error',httpStatus:r.status});
    }catch(e){return json({service:'KardShot Boosters',error:'connection_error',detail:String(e.message).slice(0,120)},503)}
  }
};
