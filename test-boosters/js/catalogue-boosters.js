/* KardShot - catalogue externe, étape 3. Aucun achat, aucune attribution de cartes. */
(async function(){
  try {
    const [c,b]=await Promise.all(['data/cartes.json','data/boosters.json'].map(async path=>{
      const response=await fetch(path,{cache:'no-store'});
      if(!response.ok)throw Error(path+' : HTTP '+response.status);
      return response.json();
    }));
    const cards=c.cartes;
    const pack=b.boosters.find(x=>x.id==='booster100');
    if(!Array.isArray(cards)||cards.length!==46||!pack||pack.quantite!==16)throw Error('Catalogue ou booster non conforme');
    const ids=new Set(cards.map(x=>x.numero));
    if(ids.size!==46||pack.numerosAutorises.length!==46||pack.numerosAutorises.some(id=>!ids.has(id)))throw Error('Numéros de cartes incohérents');
    window.KardShotBoosterCatalogue=Object.freeze({cartes:cards,booster100:pack});
    console.info('[KardShot] Catalogue externe chargé : 46 cartes, booster de 16. Aucune attribution activée.');
  }catch(error){console.error('[KardShot] Chargement catalogue externe impossible :',error);}
})();
