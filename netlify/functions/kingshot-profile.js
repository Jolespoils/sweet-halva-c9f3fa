
exports.handler = async (event) => {
  const id = (event.queryStringParameters || {}).id || '';
  if (!/^\d{1,15}$/.test(id)) return reply(400,{ok:false,error:'ID invalide'});
  const key = process.env.MIGHTPULSE_API_KEY;
  if (!key) return reply(503,{ok:false,error:'Clé API non configurée pour les fonctions'});
  try {
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(),95000);
    let response;
    try {response = await fetch(`https://api.mightpulse.com/v1/players/${id}?include=base`,{headers:{'Authorization':`Bearer ${key}`,'Accept':'application/json'},signal:controller.signal});}
    finally {clearTimeout(timer);}
    if(!response.ok) return reply(response.status,{ok:false,error:response.status===404?'Joueur introuvable':response.status===401?'Clé API refusée':`MightPulse : HTTP ${response.status}`});
    const data=await response.json(); const p=data.player || {};
    return reply(200,{ok:true,governor_id:p.governor_id??data.governor_id??id,nick_name:p.nick_name??null,kid:p.kid??null,avatar_url:p.avatar_url??null});
  }catch(err){return reply(502,{ok:false,error:err.name==='AbortError'?'Délai de réponse dépassé':'Connexion MightPulse impossible'});}
};
function reply(statusCode,data){return {statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(data)}};
