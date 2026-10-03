function decodeHtml(s=''){
  return s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
}
async function fetchJson(url,headers={}){
  const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':'Mozilla/5.0 MangaOS-Chapter-Importer/5.0',...headers},cache:'no-store'});
  const text=await r.text();let data=null;try{data=JSON.parse(text)}catch{}
  return {ok:r.ok,status:r.status,data};
}
async function getRemangaChapter(id){
  const urls=[`https://api.remanga.org/api/titles/chapters/${id}/`,`https://api.remanga.org/api/v2/titles/chapters/${id}/`];
  let last=null;
  for(const url of urls){const r=await fetchJson(url,{Referer:'https://remanga.org/'});last=r;if(r.ok&&r.data?.content)return r.data.content;if(r.status!==404)break;}
  throw new Error('ReManga chapter API returned HTTP '+(last?.status||'unknown'));
}
function remangaUrls(content){
  const raw=Array.isArray(content?.pages)?content.pages:[],out=[];
  for(const p of raw){
    if(p?.link){out.push({url:p.link,order:Number(p.page??p.number??out.length)});continue;}
    const imgs=Array.isArray(p?.images)?p.images:[];
    for(let j=0;j<imgs.length;j++)if(imgs[j]?.link)out.push({url:imgs[j].link,order:Number(p.number??out.length),sub:j});
  }
  out.sort((a,b)=>(a.order-b.order)||((a.sub||0)-(b.sub||0)));return out.map(x=>x.url);
}
async function getWeebCentralUrls(id){
  const r=await fetch(`https://weebcentral.com/chapters/${id}/images?reading_style=long_strip`,{headers:{Accept:'text/html,*/*','User-Agent':'Mozilla/5.0 MangaOS-Chapter-Importer/5.0',Referer:`https://weebcentral.com/chapters/${id}`,'HX-Request':'true'},cache:'no-store'});
  if(!r.ok)throw new Error('WeebCentral images endpoint returned HTTP '+r.status);
  const html=await r.text(),urls=[];
  for(const m of html.matchAll(/<img\b[^>]*>/gi)){
    const tag=m[0],alt=tag.match(/\balt=["']([^"']*)["']/i)?.[1]||'',src=tag.match(/\b(?:data-src|src)=["']([^"']+)["']/i)?.[1];
    if(src && (/^Page\b/i.test(alt)||/\.(?:jpe?g|png|webp|avif)(?:\?|$)/i.test(src))){const u=decodeHtml(src);if(!urls.includes(u))urls.push(u);}
  }
  return urls;
}
async function sendImage(res,url,headers={}){
  const r=await fetch(url,{headers:{Accept:'image/*','User-Agent':'Mozilla/5.0 MangaOS-Chapter-Importer/5.0',...headers},cache:'no-store'});
  if(!r.ok)return res.status(502).json({error:'Image server returned HTTP '+r.status});
  const type=r.headers.get('content-type')||'';
  if(!type.startsWith('image/'))return res.status(502).json({error:'Response is not an image.'});
  const buf=Buffer.from(await r.arrayBuffer());if(!buf.length)return res.status(502).json({error:'Empty image.'});
  res.setHeader('Content-Type',type);res.setHeader('Content-Length',String(buf.length));res.setHeader('Cache-Control','private, max-age=300');return res.status(200).send(buf);
}

export default async function handler(req,res){
try{
 const provider=String(req.query.provider||'mangadex').toLowerCase(),sourceId=String(req.query.sourceId||req.query.chapterId||''),index=Number(req.query.index);
 if(!Number.isInteger(index)||index<0)return res.status(400).json({error:'Invalid page index.'});

 if(provider==='mangadex'){
   if(!/^[0-9a-f-]{36}$/i.test(sourceId))return res.status(400).json({error:'Invalid MangaDex chapter id.'});
   const mR=await fetch('https://api.mangadex.org/at-home/server/'+sourceId,{headers:{Accept:'application/json'}});
   if(!mR.ok)return res.status(502).json({error:'MangaDex metadata failed.'});
   const m=await mR.json(),files=m?.chapter?.data||[];if(index>=files.length)return res.status(404).json({error:'Page out of range.'});
   const name=files[index],url=m.baseUrl+'/data/'+m.chapter.hash+'/'+encodeURIComponent(name).replace(/%2F/g,'/');
   return sendImage(res,url);
 }

 if(provider==='remanga'){
   if(!/^\d+$/.test(sourceId))return res.status(400).json({error:'Invalid ReManga chapter id.'});
   const content=await getRemangaChapter(sourceId),urls=remangaUrls(content);if(index>=urls.length)return res.status(404).json({error:'Page out of range.'});
   return sendImage(res,urls[index],{Referer:'https://remanga.org/'});
 }

 if(provider==='weebcentral'){
   if(!/^[0-9A-Z]+$/i.test(sourceId))return res.status(400).json({error:'Invalid WeebCentral chapter id.'});
   const urls=await getWeebCentralUrls(sourceId);if(index>=urls.length)return res.status(404).json({error:'Page out of range.'});
   return sendImage(res,urls[index],{Referer:`https://weebcentral.com/chapters/${sourceId}`});
 }

 return res.status(400).json({error:'Unsupported provider.'});
}catch(e){return res.status(500).json({error:e?.message||String(e)})}
}
