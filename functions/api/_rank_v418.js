// KardShot V418: ranking overlay. Keep _rank_rules.js unchanged (game score engine).
export function rankingRows(stats, profiles, kind){
 return Object.entries(stats||{}).map(([id,s])=>{
  const wins=s?.wins||0,draws=s?.draws||0,losses=s?.losses||0;
  const matches=wins+draws+losses;
  return {id,name:kind==='states'?id:(profiles?.[id]?.name||'Joueur'),state:kind==='states'?id:(profiles?.[id]?.state||'—'),wins,draws,losses,matches,
   points:3*wins+draws+(s?.bonusPoints||0),rate:matches?(100*wins/matches).toFixed(1)+'%':'0%'};
 }).sort((a,b)=>b.points-a.points||b.wins-a.wins||b.draws-a.draws||a.losses-b.losses||b.matches-a.matches||a.name.localeCompare(b.name,'fr')||a.id.localeCompare(b.id));
}
export function weeklyAwards(players){
 const rows=rankingRows(players,{},'players').filter(p=>p.matches>=1);
 return Object.fromEntries(rows.map((p,i)=>{
  const place=i+1;
  const podium=place===1?10:place===2?7:place===3?5:place<=10?3:place<=25?2:place<=50?1:0;
  return [p.id,podium+(p.matches>=5?1:0)];
 }));
}
