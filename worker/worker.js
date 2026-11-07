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
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET') return json({error:'method_not_allowed'},405);
    if (url.pathname === '/') return json({service:'KardShot Boosters',status:'configured',firebaseTest:'/firebase-test',structureTest:'/structure-test',boosterStatus:'/booster-status'});
    if (url.pathname !== '/firebase-test' && url.pathname !== '/structure-test' && url.pathname !== '/booster-status') return json({error:'not_found'},404);
    const secret = env.FIREBASE_SERVICE_ACCOUNT;
    if (!secret) return json({service:'KardShot Boosters',firebase:'missing_secret'},503);
    try {
      const account = JSON.parse(secret);
      if (!account.client_email || !account.private_key) throw new Error('Invalid service account');
      const token = await accessToken(account);
      if (url.pathname === '/booster-status') {
        const [ranksResponse, profilesResponse] = await Promise.all([
          fetch(`${DATABASE_URL}/rankAggregates/players.json?access_token=${encodeURIComponent(token)}`),
          fetch(`${DATABASE_URL}/rankProfiles.json?access_token=${encodeURIComponent(token)}`)
        ]);
        if (!ranksResponse.ok || !profilesResponse.ok) return json({error:'firebase_read_failed'},503);
        const ranks = (await ranksResponse.json()) || {};
        const profiles = (await profilesResponse.json()) || {};
        const count = Object.entries(ranks).filter(([uid, stats]) => {
          const p = profiles[uid];
          return p && p.declaredKingshotId && p.state && stats &&
            (Number(stats.wins || 0) + Number(stats.losses || 0) + Number(stats.draws || 0) > 0);
        }).length;
        return json({service:'KardShot Boosters',rankedPlayers:count,threshold:100,unlocked:count>=100,mode:'read_only'});
      }
      if (url.pathname === '/structure-test') {
        const paths = ['playerCards', 'playerBoosters', 'playerDecks', 'leaderboard', 'rankings', 'players', 'users'];
        const results = {};
        for (const path of paths) {
          const res = await fetch(`${DATABASE_URL}/${path}.json?shallow=true&access_token=${encodeURIComponent(token)}`);
          if (!res.ok) { results[path] = `http_${res.status}`; continue; }
          const value = await res.json();
          results[path] = value === null ? 'absent' : 'present';
        }
        return json({service:'KardShot Boosters',mode:'read_only',paths:results});
      }
      // Lecture superficielle de la racine : aucun contenu de la base n’est renvoyé au navigateur.
      const response = await fetch(`${DATABASE_URL}/.json?shallow=true&access_token=${encodeURIComponent(token)}`);
      // Ce test vérifie l’authentification et la lecture, pas encore l’écriture.
      return json({service:'KardShot Boosters',firebase:response.ok?'oauth_ok':'database_http_error',httpStatus:response.status});
    } catch (error) {
      return json({service:'KardShot Boosters',firebase:'connection_error',detail:String(error.message).slice(0,120)},503);
    }
  }
};
