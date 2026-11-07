// KardShot Pages Function: relais de même origine vers le Worker sécurisé.
const WORKER='https://kardshot-boosters.putod-sebastien.workers.dev';
export async function onRequest({request}) {
  const u=new URL(request.url),route=u.searchParams.get('route');
  if(!['/booster-eligibility','/booster-claim'].includes(route))return new Response(JSON.stringify({error:'route_invalide'}),{status:400,headers:{'content-type':'application/json'}});
  const method=route==='/booster-claim'?'POST':'GET';
  if(request.method!==method)return new Response('Méthode interdite',{status:405});
  const authorization=request.headers.get('authorization');
  if(!authorization?.startsWith('Bearer '))return new Response('Authentification requise',{status:401});
  const upstream=await fetch(WORKER+route,{method,headers:{authorization,...(method==='POST'?{'content-type':'application/json'}:{})},...(method==='POST'?{body:'{}'}:{})});
  return new Response(upstream.body,{status:upstream.status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
}
