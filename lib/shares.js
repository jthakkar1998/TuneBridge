'use strict';
const fs=require('node:fs/promises');const path=require('node:path');const crypto=require('node:crypto');
const {cleanTrack}=require('./music');
const FILE=path.join(__dirname,'../data/shares.json');
function validateShare(obj){
 if(!obj||!['spotify','apple_music'].includes(obj.source)||typeof obj.title!=='string'||!Array.isArray(obj.tracks)||!obj.tracks.length||obj.tracks.length>300)throw Object.assign(new Error('Playlist must contain 1–300 songs.'),{status:400});
 const tracks=obj.tracks.map(cleanTrack);if(tracks.some(x=>!x))throw Object.assign(new Error('Every playlist entry needs a title and artist.'),{status:400});
 const title=obj.title.trim().slice(0,100);if(!title)throw Object.assign(new Error('Playlist title is required.'),{status:400});
 return {title,source:obj.source,sourceUrl:typeof obj.sourceUrl==='string'&&obj.sourceUrl.length<1000?obj.sourceUrl:'',description:String(obj.description||'').slice(0,260),tracks};
}
async function supabase(pathname,options,env){
 const url=new URL(pathname,env.SUPABASE_URL);
 const res=await fetch(url,{...options,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json',...(options?.headers||{})},signal:AbortSignal.timeout(12000)});
 const raw=await res.text();let data;try{data=raw?JSON.parse(raw):null}catch{data=null;}
 if(!res.ok)throw Object.assign(new Error(`Share storage returned ${res.status}. Check the Supabase SQL setup.`),{status:502});return data;
}
async function verifyUser(bearer,env){
 if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return true;
 if(!bearer||!bearer.startsWith('Bearer '))return false;
 const response=await fetch(new URL('/auth/v1/user',env.SUPABASE_URL),{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:bearer},signal:AbortSignal.timeout(9000)});
 return response.ok;
}
const hasSupabase=env=>Boolean(env.SUPABASE_URL&&env.SUPABASE_SERVICE_ROLE_KEY);
async function saveShare(obj,env=process.env){
 const safe=validateShare(obj), id=crypto.randomBytes(9).toString('base64url');
 const row={id,...safe,created_at:new Date().toISOString()};
 if(hasSupabase(env)){await supabase('/rest/v1/tunebridge_shares',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(row)},env);}
 else if(!process.env.VERCEL){
   let db={};try{db=JSON.parse(await fs.readFile(FILE,'utf8'));}catch{}
   db[id]=row;await fs.writeFile(FILE,JSON.stringify(db,null,2));
 }else throw Object.assign(new Error('Shared playlist storage requires Supabase when deployed.'),{status:503});
 return {id};
}
async function getShare(id,env=process.env){
 if(!/^[\w-]{12}$/.test(id||''))return null;
 if(hasSupabase(env)){const q=`/rest/v1/tunebridge_shares?id=eq.${encodeURIComponent(id)}&select=id,title,source,sourceUrl,description,tracks,created_at&limit=1`;const result=await supabase(q,{},env);return result?.[0]||null;}
 try{const db=JSON.parse(await fs.readFile(FILE,'utf8'));return db[id]||null;}catch{return null;}
}
module.exports={validateShare,saveShare,getShare,verifyUser,hasSupabase};
