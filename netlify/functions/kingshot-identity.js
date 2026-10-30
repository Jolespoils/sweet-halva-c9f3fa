 'use strict';
const admin=require('firebase-admin');
const DB_URL='https://kingshot-cards-default-rtdb.europe-west1.firebasedatabase.app';
function getAdmin(){if(!admin.apps.length){const raw=process.env.FIREBASE_SERVICE_ACCOUNT_JSON;if(!raw)throw Error('Configuration serveur absente');admin.initializeApp({credential:admin.credential.cert(JSON.parse(raw)),databaseURL:DB_URL})}return admin}
const response=(statusCode,data)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(data)});
exports.handler=async event=>{
 if(event.httpMethod!=='POST')return response(405,{error:'Méthode non autorisée'});
 try{
 const fb=getAdmin();const token=(event.headers.authorization||event.headers.Authorization||'').replace(/^Bearer\s+/i,'');
 if(!token)return response(401,{error:'Connexion Google obligatoire'});
 const decoded=await fb.auth().verifyIdToken(token);
 if(!decoded.firebase?.sign_in_provider||decoded.firebase.sign_in_provider!=='google.com')return response(403,{error:'Compte Google obligatoire'});
 const uid=decoded.uid,db=fb.database(),body=JSON.parse(event.body||'{}');
 const profileRef=db.ref('rankProfiles/'+uid);
 if(body.action==='me')return response(200,{profile:(await profileRef.get()).val()||null});
 if(body.action!=='claim')return response(400,{error:'Action inconnue'});
 const id=String(body.id||'').trim();if(!/^\d{1,15}$/.test(id))return response(400,{error:'ID Kingshot invalide'});
 const current=(await profileRef.get()).val();if(current?.declaredKingshotId)return response(409,{error:'Ce compte Google possède déjà un ID Kingshot verrouillé'});
 // Server-side lookup; never trust client-provided nickname/state.
 const url='https://sweet-halva-c9f3fa.netlify.app/.netlify/functions/kingshot-profile?id='+encodeURIComponent(id);
 const lookup=await fetch(url,{headers:{'Accept':'application/json'},signal:AbortSignal.timeout(12000)});
 if(!lookup.ok)return response(503,{error:'Impossible de consulter le profil Kingshot'});
 const publicProfile=await lookup.json();
 if(!publicProfile.ok||String(publicProfile.governor_id)!==id||!/^\d{1,6}$/.test(String(publicProfile.kid||'')))return response(400,{error:'Profil Kingshot non confirmé par MightPulse'});
 const newProfile={declaredKingshotId:id,governor_id:id,name:String(publicProfile.nick_name||'Joueur').slice(0,30),nick_name:String(publicProfile.nick_name||'Joueur').slice(0,30),state:String(publicProfile.kid),kid:String(publicProfile.kid),avatar_url:String(publicProfile.avatar_url||'').slice(0,1000),associationType:'declaration',associatedAt:Date.now()};
 // Atomic transaction over the identity registry AND the user profile prevents simultaneous claims.
 const root=db.ref('ksIdentityRegistry');
 let reason='';
 const tx=await root.transaction(old=>{
  const all=old||{ids:{},users:{}};all.ids=all.ids||{};all.users=all.users||{};
  if(all.ids[id]&&all.ids[id]!==uid){reason='ID déjà associé à un autre compte Google';return;}
  if(all.users[uid]&&all.users[uid]!==id){reason='Votre compte Google possède déjà un ID';return;}
  all.ids[id]=uid;all.users[uid]=id;return all;
 },undefined,false);
 if(!tx.committed)return response(409,{error:reason||'Association refusée'});
 // Profile is derived from server lookup, never from the browser.
 await profileRef.set(newProfile);
 return response(200,{ok:true,profile:newProfile});
 }catch(e){console.error('identity',e);return response(500,{error:'Service d’association indisponible'})}
};
