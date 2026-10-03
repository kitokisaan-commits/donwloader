function cleanHost(u){ return u.hostname.replace(/^www\./,'').toLowerCase(); }
function extFromUrl(url){
  try{
    const p=new URL(url).pathname;
    const m=p.match(/\.([a-z0-9]{2,5})$/i);
    return (m?.[1]||'jpg').toLowerCase().replace('jpeg','jpg');
  }catch{return 'jpg'}
}
function decodeHtml(s=''){
  return s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
}
function titleFromHtml(html,fallback){
  const og=html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1];
  const t=og || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  return decodeHtml((t||fallback).replace(/\s+/g,' ').trim());
}
async function fetchJson(url,headers={}){
  const r=await fetch(url,{headers:{Accept:'application/json', 'User-Agent':'Mozilla/5.0 MangaOS-Chapter-Importer/5.0',...headers},cache:'no-store'});
  const text=await r.text();
  let data=null; try{data=JSON.parse(text)}catch{}
  return {ok:r.ok,status:r.status,data,text};
}
async function getRemangaChapter(id){
  const urls=[
    `https://api.remanga.org/api/titles/chapters/${id}/`,
    `https://api.remanga.org/api/v2/titles/chapters/${id}/`
  ];
  let last=null;
  for(const url of urls){
    const r=await fetchJson(url,{Referer:'https://remanga.org/'});
    last=r;
    if(r.ok && r.data?.content) return r.data.content;
    if(r.status!==404) break;
  }
  const e=new Error('ReManga chapter API returned HTTP '+(last?.status||'unknown'));
  e.status=last?.status||502; throw e;
}
function remangaPages(content){
  const raw=Array.isArray(content?.pages)?content.pages:[];
  const out=[];
  for(const p of raw){
    // Old API shape: one image object per page.
    if(p?.link){ out.push({url:p.link,order:Number(p.page??p.number??out.length)}); continue; }
    // New API shape: page group with one or more images.
    const imgs=Array.isArray(p?.images)?p.images:[];
    for(let j=0;j<imgs.length;j++) if(imgs[j]?.link) out.push({url:imgs[j].link,order:Number(p.number??out.length),sub:j});
  }
  out.sort((a,b)=>(a.order-b.order)||((a.sub||0)-(b.sub||0)));
  return out;
}
async function getWeebCentralPages(id){
  const endpoint=`https://weebcentral.com/chapters/${id}/images?reading_style=long_strip`;
  const r=await fetch(endpoint,{headers:{
    Accept:'text/html,*/*',
    'User-Agent':'Mozilla/5.0 MangaOS-Chapter-Importer/5.0',
    Referer:`https://weebcentral.com/chapters/${id}`,
    'HX-Request':'true'
  },cache:'no-store'});
  if(!r.ok){const e=new Error('WeebCentral images endpoint returned HTTP '+r.status);e.status=r.status;throw e;}
  const html=await r.text();
  const urls=[];
  for(const m of html.matchAll(/<img\b[^>]*>/gi)){
    const tag=m[0];
    const alt=tag.match(/\balt=["']([^"']*)["']/i)?.[1]||'';
    const src=tag.match(/\b(?:data-src|src)=["']([^"']+)["']/i)?.[1];
    if(!src) continue;
    // This endpoint normally contains only page images; keep Page-tagged images first,
    // and accept image CDN URLs as a fallback for markup changes.
    if(/^Page\b/i.test(alt) || /\.(?:jpe?g|png|webp|avif)(?:\?|$)/i.test(src)){
      const u=decodeHtml(src);
      if(!urls.includes(u)) urls.push(u);
    }
  }
  return urls;
}

export default async function handler(req,res){
res.setHeader('Cache-Control','no-store');
try{
 const raw=String(req.query.url||'').trim();if(!raw)return res.status(400).json({error:'Paste a chapter URL.'});
 let u;try{u=new URL(raw)}catch{return res.status(400).json({error:'Invalid URL.'})}
 const host=cleanHost(u);

 if(host==='remanga.org'){
   const m=u.pathname.match(/\/(\d+)\/?$/);if(!m)return res.status(400).json({error:'This does not look like a ReManga chapter URL.'});
   const id=m[1],content=await getRemangaChapter(id),links=remangaPages(content);
   if(!links.length){
     if(content?.price && !content?.is_bought) return res.status(403).json({error:'This ReManga chapter is not available through public chapter access.'});
     return res.status(404).json({error:'ReManga returned no readable chapter images.'});
   }
   const ch=String(content.chapter??content.index??'').trim();
   const name=String(content.name||'').trim();
   const title=['ReManga',ch?('Ch. '+ch):null,name||null].filter(Boolean).join(' · ');
   return res.json({
     provider:'ReManga direct',providerKey:'remanga',mode:'direct',sourceId:id,sourceUrl:raw,
     title:title||('ReManga chapter '+id),chapter:ch,expectedPages:links.length,
     pages:links.map((p,i)=>({index:i,name:String(i+1).padStart(3,'0')+'.'+extFromUrl(p.url),ext:extFromUrl(p.url)}))
   });
 }

 if(host==='weebcentral.com'){
   const m=u.pathname.match(/\/chapters\/([0-9A-Z]+)/i);if(!m)return res.status(400).json({error:'This does not look like a WeebCentral chapter URL.'});
   const id=m[1],links=await getWeebCentralPages(id);
   if(!links.length)return res.status(404).json({error:'WeebCentral returned no chapter images.'});
   let title='WeebCentral chapter';
   try{
     const pageR=await fetch(`https://weebcentral.com/chapters/${id}`,{headers:{'User-Agent':'Mozilla/5.0 MangaOS-Chapter-Importer/5.0',Accept:'text/html'},cache:'no-store'});
     if(pageR.ok) title=titleFromHtml(await pageR.text(),title);
   }catch{}
   return res.json({
     provider:'WeebCentral direct',providerKey:'weebcentral',mode:'direct',sourceId:id,sourceUrl:raw,
     title,expectedPages:links.length,
     pages:links.map((p,i)=>({index:i,name:String(i+1).padStart(3,'0')+'.'+extFromUrl(p),ext:extFromUrl(p)}))
   });
 }

 if(host==='inkstory.net'){
   if(!/^\/content\//.test(u.pathname))return res.status(400).json({error:'This does not look like an InkStory chapter URL.'});
   const r=await fetch(raw,{headers:{'User-Agent':'Mozilla/5.0 ChapterImporterTest/5.0','Accept':'text/html'}});
   if(!r.ok)return res.status(502).json({error:'InkStory page returned HTTP '+r.status});
   const html=await r.text();
   const title=titleFromHtml(html,'InkStory chapter').replace(/\s*[—|-]\s*InkStory.*$/i,'').trim();
   const text=html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ');
   const counts=[...text.matchAll(/\b(\d{1,4})\s*\/\s*(\d{1,4})\b/g)].map(m=>Number(m[2])).filter(n=>n>0&&n<5000);
   const expected=counts.length?Math.max(...counts):0;
   if(!expected)return res.status(422).json({error:'InkStory chapter opened, but page count could not be determined.'});
   return res.json({provider:'InkStory official download verification',mode:'official-zip',title,expectedPages:expected,sourceUrl:raw});
 }

 const scanlateHosts={
   'mangalib.org':'MangaLib','mangalib.me':'MangaLib','senkuro.com':'Senkuro','mangabuff.ru':'MangaBuff'
 };
 if(scanlateHosts[host]){
   return res.json({provider:'Official ReadManga/GroupLe Scanlate Downloader',mode:'scanlate-official',sourceName:scanlateHosts[host],title:scanlateHosts[host]+' chapter',expectedPages:0,sourceUrl:raw});
 }

 if(/(^|\.)readmanga\./i.test(host)||/(^|\.)mintmanga\./i.test(host)||/(^|\.)selfmanga\./i.test(host)){
   return res.json({provider:'GroupLe / ReadManga official chapter download',mode:'grouple-official',title:'GroupLe / ReadManga chapter',expectedPages:0,sourceUrl:raw});
 }

 if(host==='mangadex.org'){
   const m=u.pathname.match(/\/chapter\/([0-9a-f-]{36})/i);if(!m)return res.status(400).json({error:'Not a MangaDex chapter URL.'});
   const id=m[1];
   const [aR,cR]=await Promise.all([
    fetch('https://api.mangadex.org/at-home/server/'+id,{headers:{Accept:'application/json'}}),
    fetch('https://api.mangadex.org/chapter/'+id,{headers:{Accept:'application/json'}})
   ]);
   if(!aR.ok)return res.status(502).json({error:'MangaDex at-home API: HTTP '+aR.status});
   if(!cR.ok)return res.status(502).json({error:'MangaDex chapter API: HTTP '+cR.status});
   const a=await aR.json(),c=await cR.json(),files=a?.chapter?.data||[],x=c?.data?.attributes||{};
   if(!files.length)return res.status(404).json({error:'No pages returned.'});
   const title=['MangaDex',x.volume?'Vol. '+x.volume:null,x.chapter?'Ch. '+x.chapter:null,x.title||null].filter(Boolean).join(' · ');
   return res.json({provider:'MangaDex public API',providerKey:'mangadex',mode:'direct',sourceId:id,sourceUrl:raw,title:title||id,chapter:x.chapter||'',language:x.translatedLanguage||'',expectedPages:files.length,pages:files.map((n,i)=>({index:i,name:n,ext:(n.split('.').pop()||'jpg').toLowerCase()}))});
 }

 return res.status(400).json({error:'Unsupported source: '+host});
}catch(e){return res.status(e?.status||500).json({error:e?.message||String(e)})}
}
