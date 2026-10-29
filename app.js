/* TuneBridge v4 - receive-first music inbox; OAuth PKCE stays in the browser. */
(() => {
'use strict';
const $=id=>document.getElementById(id);
const cfg=window.TUNEBRIDGE_CONFIG||{};
const Q=new URLSearchParams(location.search);
const SERVICE={spotify:'Spotify',apple_music:'Apple Music'};
const KEY='tunebridge:service';
const SPOTIFY_STORAGE='tunebridge:spotify';
const SONG_DEMO='https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT';
const SONG_DEMO_APPLE='https://music.apple.com/us/song/1559885421';
const spotifyScopes='playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public';
let preference=localStorage.getItem(KEY)||'';
let mode='song', current=null, matches=null, chosen=new Set(), previewIsDemo=false;
let spotifyAuth=null,appleMusic=null,supabase=null,user=null, busy=false,toastTimeout=null;
let publicProviderAvailable=false;
const state={};
function icon(name){return `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;}
function escapeHTML(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function isMusicUrl(text){try{const u=new URL(text);if(u.protocol!=='https:')return null;let m;if(u.hostname==='open.spotify.com'){m=u.pathname.match(/^\/(?:intl-[a-z]{2}\/)?(track|playlist)\/([\w]{22})\/?$/);if(m)return {service:'spotify',type:m[1]==='track'?'song':'playlist',id:m[2]};}
if(['music.apple.com','geo.music.apple.com'].includes(u.hostname)){const p=u.pathname.split('/').filter(Boolean);let i=p.indexOf('playlist');if(i>=0&&p[i+2])return {service:'apple_music',type:'playlist',id:p[i+2]};const id=u.searchParams.get('i')||(p.includes('song')?p.at(-1):null);if(id&&/^\d+$/.test(id))return {service:'apple_music',type:'song',id};} }catch{}return null;}
function savePref(p){preference=p;localStorage.setItem(KEY,p);updatePrefUI();if(supabase&&user) supabase.from('tunebridge_profiles').upsert({id:user.id,preferred_service:p,updated_at:new Date().toISOString()}).then(({error})=>{if(error)console.warn('Preference sync unavailable:',error.message)});}
function updatePrefUI(){const label=$('profile-label');if(label)label.textContent=preference?`${SERVICE[preference]} is my app`:'Choose your music app';document.querySelectorAll('.service-option').forEach(b=>b.classList.toggle('selected',b.dataset.service===preference));const out=$('destination-label');if(out)out.textContent=preference?`Opening in ${SERVICE[preference]}`:'Choose a destination';const chip=$('recipient-status');if(chip)chip.textContent=preference?`${SERVICE[preference]} selected`:'Choose your music service';updateConnections();}
function modal(id,show){$(id).hidden=!show;document.body.classList.toggle('modal-open',show);}
function toast(text){$('toast-text').textContent=text;$('toast').classList.add('visible');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>$('toast').classList.remove('visible'),3500);}
function error(id,text){const e=$(id);e.textContent=text||'';e.hidden=!text;}
function success(text){$('result-success').textContent=text||'';$('result-success').hidden=!text;}
function showPreview(){const el=$('preview-section');el.hidden=false;setTimeout(()=>el.scrollIntoView({behavior:'smooth',block:'start'}),30);}
function clearPreview(){current=null;matches=null;chosen.clear();previewIsDemo=false;$('preview-section').hidden=true;$('shared-url-box').hidden=true;error('result-error','');success('');}
function setBusy(flag,message){busy=flag;$('convert-button').disabled=flag;$('convert-label').textContent=flag?(message||'Working on it…'):'Open my music';$('primary-result-action').disabled=flag;}
function setMode(next){mode=next;document.querySelectorAll('.type-tab').forEach(b=>{const yes=b.dataset.mode===next;b.classList.toggle('active',yes);b.setAttribute('aria-selected',String(yes));});$('input-label').textContent='Paste a music link';$('input-hint').textContent="Copy a normal Spotify or Apple Music link from your texts. We'll detect songs and playlists automatically.";$('music-input').placeholder='Spotify or Apple Music song / playlist URL';clearPreview();setBusy(false);}
async function request(url,options={}){let r;try{r=await fetch(url,{...options,headers:{Accept:'application/json',...(options.headers||{})}});}catch{throw Error('Network error. Check your connection and try again.');}const data=await r.json().catch(()=>({}));if(!r.ok){const e=Error(data.error||`Request failed (${r.status})`);e.code=data.code||'';e.status=r.status;throw e;}return data;}
function platformLink(text,service){const v=String(text||'');return isMusicUrl(v)?.service===service?v:null;}
function shareURL(params){const u=new URL(location.pathname,location.origin);Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));return u.toString();}
async function copy(text){try{await navigator.clipboard.writeText(text);toast('Copied to clipboard');}catch{const field=document.createElement('textarea');field.value=text;field.style.position='fixed';field.style.opacity='0';document.body.append(field);field.select();document.execCommand('copy');field.remove();toast('Copied to clipboard');}}
async function share(text){if(navigator.share){try{await navigator.share({url:text,title:'TuneBridge'});return;}catch(e){if(e.name==='AbortError')return;}}await copy(text);}
function renderArt(src){const box=$('summary-art');box.replaceChildren();if(src&&/^https:\/\//i.test(src)){const img=document.createElement('img');img.alt='Music cover art';img.loading='lazy';img.referrerPolicy='no-referrer';img.src=src;img.onerror=()=>{box.replaceChildren();box.innerHTML=icon('music')};box.append(img);}else box.innerHTML=icon('music');}
function setSummary({title,artist,source,image,count}){$('summary-title').textContent=title;$('summary-subtitle').textContent=artist||(count?`${count} songs · ready to explore`:'Song link');$('summary-source').textContent=SERVICE[source]||'TUNEBRIDGE';renderArt(image);}
function renderSong(data,inputURL){
 const platforms={...(data.platforms||{})};
 if(data.sourcePlatform&&!platforms[data.sourcePlatform])platforms[data.sourcePlatform]=inputURL;
 current={type:'song',platforms,data,inputURL};
 const target=preference|| (data.sourcePlatform==='spotify'?'apple_music':'spotify');
 const targetUrl=platformLink(platforms[target],target);
 $('preview-kicker').textContent=data.demo?'EXAMPLE SONG · DEMONSTRATION':'SONG FOUND';
 $('preview-heading').textContent=targetUrl?`Ready for ${SERVICE[target]}.`:'Here’s what we found.';
 setSummary({title:data.title||'Shared song',artist:data.artist||'Open in your music app',source:data.sourcePlatform||isMusicUrl(inputURL)?.service,image:data.image||data.image_url});
 $('song-view').hidden=false;$('playlist-view').hidden=true;
 $('song-description').textContent=targetUrl?`We found the ${SERVICE[target]} version. Tap to listen.`:`We couldn't find a ${SERVICE[target]} version. Check the links below.`;
 const links=$('song-platform-links');links.replaceChildren();
 for(const service of ['spotify','apple_music']){
  const a=document.createElement('a');a.className='platform-link'+(!platforms[service]?' platform-unavailable':'');
  if(platforms[service]){a.href=platforms[service];a.target='_blank';a.rel='noopener noreferrer';}else a.tabIndex=-1;
  a.innerHTML=`<span class="small-dot ${service==='spotify'?'spotify-dot':'apple-dot'}"></span><span>${SERVICE[service]}</span><strong>${platforms[service]?'Open →':'Not available'}</strong>`;links.append(a);
 }
 $('shared-url-box').hidden=true;
 if(targetUrl){setPrimary(`Open in ${SERVICE[target]}`,()=>window.location.assign(targetUrl));setSecondary('Copy song link',()=>copy(targetUrl));}
 else {setPrimary('Change music preference',()=>modal('pref-modal',true));hideSecondary();}
 $('preview-footnote').textContent=data.demo?'Example only. Configure MusicLink to convert arbitrary songs.':'Opening the installed app depends on your phone and browser. Use the Open button if it does not launch automatically.';
 showPreview();
 return targetUrl;
}
function setPrimary(label,fn){const b=$('primary-result-action');b.querySelector('span').textContent=label;state.primary=fn;b.hidden=false;}
function setSecondary(label,fn){const b=$('secondary-result-action');b.hidden=false;b.textContent=label;state.secondary=fn;}
function hideSecondary(){$('secondary-result-action').hidden=true;state.secondary=null;}
function tracksList(tracks,matching){const list=$('track-list');list.replaceChildren();tracks.forEach((t,i)=>{const m=matching?.[i];const li=document.createElement('li');li.className='track-item';const review=m?.status==='review',unmatched=m?.status==='unmatched';const checked=m&&(m.status==='matched'||(review&&chosen.has(i)));
li.innerHTML=`<span class="track-index">${String(i+1).padStart(2,'0')}</span><span class="track-body"><strong>${escapeHTML(t.name)}</strong><small>${escapeHTML(t.artist)}</small>${review?`<span class="track-note">Review match: ${escapeHTML(m.matchedName||'')} · ${escapeHTML(m.matchedArtist||'')}</span>`:''}</span>${matching?`<span class="track-status ${unmatched?'bad':review?'review':'good'}">${unmatched?'Not found':review?'Review':'Matched'}</span>`:''}`;
if(t.artwork&&/^https:\/\//i.test(t.artwork)){const thumb=document.createElement('span');thumb.className='track-thumb';const img=document.createElement('img');img.src=t.artwork;img.alt='';img.loading='lazy';img.onerror=()=>thumb.remove();thumb.append(img);li.insertBefore(thumb,li.children[1]);}
if(review){const cb=document.createElement('input');cb.type='checkbox';cb.className='track-checkbox';cb.title='Include this approximate match';cb.checked=checked;cb.addEventListener('change',()=>{if(cb.checked)chosen.add(i);else chosen.delete(i);updateMatchCounts();});li.append(cb);}list.append(li);});}
function dest(){if(preference)return preference;if(current?.source)return current.source==='spotify'?'apple_music':'spotify';return 'apple_music';}
function renderPlaylist(data,demo){current={type:'playlist',...data};matches=null;chosen.clear();previewIsDemo=demo;
$('preview-kicker').textContent=demo?'INTERACTIVE PLAYLIST PREVIEW':'PLAYLIST READY TO IMPORT';$('preview-heading').textContent=demo?'Preview the possibilities.':'A whole playlist, bridged.';setSummary({title:data.title,artist:data.description||`${data.tracks.length} songs · ${SERVICE[data.source]||''}`,source:data.source,image:data.image,count:data.tracks.length});$('song-view').hidden=true;$('playlist-view').hidden=false;$('playlist-count').textContent=`${data.tracks.length} songs`;$('playlist-match-status').textContent=demo?'Sample playlist':'Not matched yet';$('playlist-warning').hidden=!demo&&!data.truncated;$('playlist-warning').textContent=demo?'Preview only — these tracks have not been matched or imported. Connect an account and provide a real playlist URL for a live transfer.':'This source playlist was truncated at 300 songs for this version. Only displayed tracks can be shared or imported.';$('match-summary').hidden=true;tracksList(data.tracks);$('shared-url-box').hidden=true;hideSecondary();
if(!demo&&dest()===data.source){setPrimary(`Open in ${SERVICE[dest()]}`,()=>window.location.assign(data.sourceUrl));setSecondary('Make a second copy',()=>matchDestination());}else{setPrimary(demo?'See sample song matches':'Find matching songs',demo?()=>previewSampleMatches():()=>matchDestination());if(!demo)hideSecondary();}$('preview-footnote').textContent=demo?'Sample data only. No external playlist was read.':'You decide when to create the playlist in your library. Nothing is imported automatically.';showPreview();}
function updateMatchCounts(){if(!matches)return;const selected=matches.filter((m,i)=>m.id&&(m.status==='matched'||(m.status==='review'&&chosen.has(i)))).length;const missed=matches.filter(m=>m.status==='unmatched').length;const review=matches.filter(m=>m.status==='review').length;$('playlist-match-status').textContent=`${selected} selected · ${missed} unmatched`;$('match-summary').hidden=false;$('match-summary').textContent=`${selected} songs ready to import${review?` · ${review} approximate match${review===1?'':'es'} to review`:''}${missed?` · ${missed} unavailable`:''}`;if(previewIsDemo){setPrimary('Try with a real playlist',()=>{clearPreview();$('music-input').focus();$('workspace').scrollIntoView({behavior:'smooth',block:'start'});});$('playlist-match-status').textContent=`Illustration · ${selected} selected`;return;}
setPrimary(`Create ${selected} in ${SERVICE[state.destination]||'my music app'}`,()=>createPlaylist());$('primary-result-action').disabled=selected===0;}
function previewSampleMatches(){
 if(!previewIsDemo||!current)return;
 state.destination=dest();
 const demoResults=current.tracks.map((t,i)=>({
  name:t.name,artist:t.artist,
  status:i===4?'unmatched':i===2?'review':'matched',
  id:i===4?null:`sample-${i+1}`,
  matchedName:i===2?'Pink + White (alternate edition)':t.name,
  matchedArtist:t.artist,
  confidence:i===4?0:i===2?.58:.96
 }));
 matches=demoResults;chosen.clear();tracksList(current.tracks,matches);updateMatchCounts();
 $('preview-heading').textContent='Every track, accounted for.';
 $('playlist-warning').hidden=false;
 $('playlist-warning').textContent='Illustrative song matches only. No Spotify or Apple Music catalog was searched. The sample cannot create a playlist.';
 $('preview-footnote').textContent='See how a live import will display exact matches, a track requiring your review, and unavailable music. Tap Try with a real playlist to connect your account.';
 toast('Example matching preview ready');
}
async function matchDestination(){if(!current||current.type!=='playlist'||busy)return;state.destination=dest();if(state.destination===current.source){ // matching in same service still imports by searching; no opaque ids stored
}
try{setBusy(true,'Finding matching tracks…');error('result-error','');success('');const headers={};if(state.destination==='spotify')headers.Authorization=`Bearer ${await ensureSpotify()}`;else await requireAppleDeveloper();
const input=current.tracks;let result=[];for(let k=0;k<input.length;k+=20){const part=await request(`/api/${state.destination==='spotify'?'spotify':'apple'}/match`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({tracks:input.slice(k,k+20),storefront:'us'})});result=result.concat(part.matches||[]);$('playlist-match-status').textContent=`Checked ${Math.min(k+20,input.length)} / ${input.length}`;}
matches=result;chosen.clear();tracksList(current.tracks,matches);updateMatchCounts();$('preview-footnote').textContent='Exact matches are selected automatically. Check approximate matches individually before importing.';toast('Matching complete');
}catch(e){error('result-error',e.message);}finally{setBusy(false);if(matches)updateMatchCounts();}}
async function createPlaylist(){if(!matches||busy||!current)return;const service=state.destination;const ids=matches.filter((m,i)=>m.id&&(m.status==='matched'||(m.status==='review'&&chosen.has(i)))).map(m=>m.id);if(!ids.length)return error('result-error','No tracks selected to import.');
const title=current.title||'From TuneBridge';if(!confirm(`Create “${title}” with ${ids.length} matched songs in your ${SERVICE[service]} library?`))return;
try{setBusy(true,'Creating your playlist…');error('result-error','');const headers={'Content-Type':'application/json'};if(service==='spotify')headers.Authorization=`Bearer ${await ensureSpotify()}`;else headers['Music-User-Token']=await ensureAppleUser();
const data=await request(`/api/${service==='spotify'?'spotify':'apple'}/create`,{method:'POST',headers,body:JSON.stringify({title,ids})});success(`Created “${title}” with ${ids.length} tracks in ${SERVICE[service]}.`);if(data.url&&platformLink(data.url,service)===null&&service==='spotify')throw Error('Spotify returned an unrecognized link.');if(data.url)setPrimary(`Open in ${SERVICE[service]}`,()=>window.location.assign(data.url));else setPrimary('Open Apple Music library',()=>window.location.assign('https://music.apple.com/library/playlists'));
hideSecondary();$('preview-footnote').textContent=service==='apple_music'?'Apple Music does not guarantee a public share URL for API-created playlists. Open the Music app to view or share your new playlist.':'Your new Spotify playlist is private by default. You can share it in Spotify after changing its visibility.';
}catch(e){error('result-error',e.message);}finally{setBusy(false);}}
async function publishPlaylist(){if(!current||current.type!=='playlist'||previewIsDemo)return;try{if(cfg.supabaseUrl&&!user){modal('auth-modal',true);return error('result-error','Sign in to TuneBridge first to publish a playlist link.');}setBusy(true,'Creating share link…');error('result-error','');const headers={'Content-Type':'application/json'};const access=await getTuneBridgeAccess();if(access)headers.Authorization=`Bearer ${access}`;
const saved=await request('/api/shares',{method:'POST',headers,body:JSON.stringify({title:current.title,description:current.description,source:current.source,sourceUrl:current.sourceUrl,tracks:current.tracks})});const link=shareURL({playlist:saved.id});$('share-url-input').value=link;$('shared-url-box').hidden=false;setSecondary('Share this link',()=>share(link));toast('Share link created');
}catch(e){error('result-error',e.message);}finally{setBusy(false);}}
async function convertSong(raw,incoming=false){try{setBusy(true,'Finding both versions…');error('form-error','');error('result-error','');const data=await request(`/api/resolve?url=${encodeURIComponent(raw)}`);const target=renderSong(data,raw);if((incoming||!data.demo)&&preference&&target){$('preview-footnote').textContent=`Opening in ${SERVICE[preference]}… If your browser doesn't open it, tap the button above.`;setTimeout(()=>{if(document.visibilityState==='visible')window.location.assign(target);},500);}return data;}catch(e){error(incoming?'result-error':'form-error',e.message);if(incoming){$('preview-section').hidden=false;$('preview-heading').textContent='We couldn’t find a match.';}}finally{setBusy(false);}}
async function readPlaylist(raw){
 const parsed=isMusicUrl(raw);
 if(!parsed||parsed.type!=='playlist')throw Error('Paste a valid Spotify or Apple Music playlist URL.');
 // Already on the recipient's platform: no read or library copy required.
 if(parsed.service===preference)return {title:`Shared ${SERVICE[preference]} playlist`,source:parsed.service,sourceUrl:raw,tracks:[],samePlatform:true};
 if(parsed.service==='spotify'){
  // The only zero-sender-effort option is an approved public metadata provider.
  try{return await request(`/api/public/playlist?url=${encodeURIComponent(raw)}`);}
  catch(providerErr){
   if(getStoredSpotifyAuth()?.refresh_token||readSpotifyAuth()){
    try{return await request(`/api/spotify/playlist?url=${encodeURIComponent(raw)}`,{headers:{Authorization:`Bearer ${await ensureSpotify()}`}});}
    catch(e){if(e.status===403)throw Error('Spotify restricts this playlist to its owner or collaborators. A configured, approved public-playlist provider is required to import a friend’s link.');throw e;}
   }
   if(providerErr.code==='PUBLIC_PROVIDER_NOT_CONFIGURED')throw Error('Reading playlists sent by friends needs a public-playlist data provider. MusicAPI is supported as an optional integration but is not configured. See the README for provider pricing and access restrictions.');
   throw providerErr;
  }
 }
 // Official Apple catalog reads work without connecting the source user's account.
 try{await requireAppleDeveloper();const headers={};if(parsed.id.startsWith('p.'))headers['Music-User-Token']=await ensureAppleUser();return await request(`/api/apple/playlist?url=${encodeURIComponent(raw)}`,{headers});}
 catch(e){if(e.status===503&&publicProviderAvailable)return request(`/api/public/playlist?url=${encodeURIComponent(raw)}`);throw e;}
}
async function begin(raw){
 try{if(new URL(raw).hostname==='spotify.link'){const expanded=await request(`/api/expand?url=${encodeURIComponent(raw)}`);raw=expanded.url;$('music-input').value=raw;}}catch(e){if(raw.startsWith('https://spotify.link/'))return error('form-error',e.message);}
 const info=isMusicUrl(raw);
 if(!info)return error('form-error','Paste a valid Spotify or Apple Music song or playlist link.');
 if(!preference){state.pendingLink=raw;modal('pref-modal',true);return;}
 if(info.type!==mode)setMode(info.type);
 $('music-input').value=raw;error('form-error','');
 if(info.service===preference){window.location.assign(raw);return;}
 if(info.type==='song')return convertSong(raw);
 let data=null;try{setBusy(true,'Reading the playlist…');data=await readPlaylist(raw);if(data.samePlatform){window.location.assign(raw);return;}renderPlaylist(data,false);}
 catch(e){error('form-error',e.message);}finally{setBusy(false);}
 if(data?.tracks?.length&&dest()!==data.source)await matchDestination();
}
function b64url(buffer){return btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function randomString(){return b64url(crypto.getRandomValues(new Uint8Array(40)));}
async function sha256(str){return b64url(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(str)));}
function spotifyRedirect(){return `${location.origin}${location.pathname}`;}
function getStoredSpotifyAuth(){try{return JSON.parse(localStorage.getItem(SPOTIFY_STORAGE)||'null');}catch{return null;}}
function readSpotifyAuth(){const x=getStoredSpotifyAuth();return x?.access_token&&x.expires_at>Date.now()+20000?x:null;}
async function ensureSpotify(){spotifyAuth=readSpotifyAuth();if(spotifyAuth)return spotifyAuth.access_token;
const old=getStoredSpotifyAuth();if(old?.refresh_token&&cfg.spotifyClientId){try{const x=new URLSearchParams({client_id:cfg.spotifyClientId,grant_type:'refresh_token',refresh_token:old.refresh_token});const r=await fetch('https://accounts.spotify.com/api/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:x});const data=await r.json();if(r.ok){spotifyAuth={...old,...data,expires_at:Date.now()+data.expires_in*1000};localStorage.setItem(SPOTIFY_STORAGE,JSON.stringify(spotifyAuth));updateConnections();return spotifyAuth.access_token;}}catch{} }
if(!cfg.spotifyClientId)throw Error('Spotify login is not configured yet. Add your Spotify Client ID in config.js.');
const verifier=randomString(),nonce=randomString();sessionStorage.setItem('tunebridge:spotify_oauth',JSON.stringify({verifier,nonce,from:mode,link:$('music-input').value,playlist:Q.get('playlist')}));
const u=new URL('https://accounts.spotify.com/authorize');Object.entries({client_id:cfg.spotifyClientId,response_type:'code',redirect_uri:spotifyRedirect(),code_challenge_method:'S256',code_challenge:await sha256(verifier),state:nonce,scope:spotifyScopes}).forEach(([key,value])=>u.searchParams.set(key,value));window.location.assign(u.toString());throw Error('Redirecting to Spotify for authorization…');}
async function finishSpotifyCallback(){if(!Q.has('code')&&!Q.has('error'))return false;const from=sessionStorage.getItem('tunebridge:spotify_oauth');sessionStorage.removeItem('tunebridge:spotify_oauth');history.replaceState(null,'',location.pathname);if(Q.has('error'))throw Error(`Spotify authorization was cancelled: ${Q.get('error')}`);
const info=from?JSON.parse(from):null;if(!info||Q.get('state')!==info.nonce)throw Error('Spotify security check failed. Please try signing in again.');const body=new URLSearchParams({client_id:cfg.spotifyClientId,grant_type:'authorization_code',code:Q.get('code'),redirect_uri:spotifyRedirect(),code_verifier:info.verifier});const r=await fetch('https://accounts.spotify.com/api/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});const j=await r.json();if(!r.ok)throw Error('Spotify sign-in failed. Check your redirect URI configuration.');spotifyAuth={...j,expires_at:Date.now()+j.expires_in*1000};localStorage.setItem(SPOTIFY_STORAGE,JSON.stringify(spotifyAuth));updateConnections();toast('Spotify connected');if(info.playlist){await loadIncomingPlaylist(info.playlist);}else if(info.link){setMode(info.from||'playlist');$('music-input').value=info.link;await begin(info.link);}return true;}
async function requireAppleDeveloper(){const response=await request('/api/apple/token');return response.token;}
async function ensureAppleMusic(){if(appleMusic)return appleMusic;const token=await requireAppleDeveloper();if(!window.MusicKit){await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://js-cdn.music.apple.com/musickit/v3/musickit.js';s.onload=resolve;s.onerror=()=>reject(Error('Could not load Apple MusicKit.'));document.head.append(s);});}
await new Promise(resolve=>{if(window.MusicKit?.configure)resolve();else document.addEventListener('musickitloaded',resolve,{once:true});});await window.MusicKit.configure({developerToken:token,app:{name:'TuneBridge',build:'2.0.0'}});appleMusic=window.MusicKit.getInstance();return appleMusic;}
async function ensureAppleUser(){const kit=await ensureAppleMusic();const token=kit.musicUserToken||(await kit.authorize());if(!token)throw Error('Apple Music authorization did not succeed.');localStorage.setItem('tunebridge:apple-authorized','yes');updateConnections();return token;}
function updateConnections(){
 const sp=$('spotify-connection'),ap=$('apple-connection');
 if(sp)sp.textContent=readSpotifyAuth()||getStoredSpotifyAuth()?.refresh_token?'Connected on this device':'Not connected';
 if(ap)ap.textContent=appleMusic?.musicUserToken?'Connected':localStorage.getItem('tunebridge:apple-authorized')?'Previously authorized — verify to import':'Not connected';
 const button=$('connect-spotify');if(button)button.textContent=sp?.textContent?.startsWith('Connected')?'Reconnect Spotify':'Connect Spotify';
}
async function getTuneBridgeAccess(){if(!supabase)return null;const {data}=await supabase.auth.getSession();return data.session?.access_token||null;}
async function initSupabase(){if(!cfg.supabaseUrl||!cfg.supabaseAnonKey)return;try{await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';s.onload=resolve;s.onerror=reject;document.head.append(s);});supabase=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);const res=await supabase.auth.getUser();user=res.data?.user||null;updateAccount();if(user){const p=await supabase.from('tunebridge_profiles').select('preferred_service').eq('id',user.id).maybeSingle();if(p.data?.preferred_service&&!preference)savePref(p.data.preferred_service);}
supabase.auth.onAuthStateChange((_event,session)=>{user=session?.user||null;updateAccount();});}catch(e){console.warn('Supabase unavailable:',e);}}
function updateAccount(){$('account-status').textContent=user?user.email||'Signed in':'Saved on this device';$('account-button').textContent=user?'Sign out':'Sign in to sync';}
async function login(email){if(!supabase)throw Error('Email sign-in is optional and not configured. Add your Supabase URL and anon key to config.js.');const {error:e}=await supabase.auth.signInWithOtp({email,options:{emailRedirectTo:spotifyRedirect()}});if(e)throw Error(e.message);$('auth-info').textContent='Check your inbox for the sign-in link.';}
async function loadIncomingPlaylist(id){if(!/^[\w-]{12}$/.test(id||''))return error('form-error','That playlist share link is invalid.');setMode('playlist');try{setBusy(true,'Opening shared playlist…');const data=await request(`/api/shares?id=${encodeURIComponent(id)}`);renderPlaylist(data,false);if(!preference)modal('pref-modal',true);}catch(e){error('form-error',e.message);$('workspace').scrollIntoView({behavior:'smooth'});}finally{setBusy(false);}}
async function incomingSong(raw){setMode('song');$('music-input').value=raw;if(!isMusicUrl(raw))return error('form-error','This shared song link is invalid.');if(!preference)modal('pref-modal',true);await convertSong(raw,true);}
async function onReady(){updatePrefUI();document.querySelectorAll('.type-tab').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));
$('convert-form').addEventListener('submit',e=>{e.preventDefault();if(!busy)begin($('music-input').value.trim());});
$('music-input').addEventListener('input',e=>{const info=isMusicUrl(e.target.value.trim());if(info&&info.type!==mode)setMode(info.type);});$('paste-button').addEventListener('click',async()=>{try{$('music-input').value=await navigator.clipboard.readText();toast('Link pasted');}catch{toast('Paste your link into the text field');}});
$('demo-song').addEventListener('click',()=>{const link=preference==='spotify'?SONG_DEMO_APPLE:SONG_DEMO;setMode('song');$('music-input').value=link;begin(link);});$('demo-playlist').addEventListener('click',async()=>{setMode('playlist');try{const sample=await request('/api/demo');renderPlaylist(sample,true);}catch(e){error('form-error',e.message);}});
$('close-preview').addEventListener('click',clearPreview);$('primary-result-action').addEventListener('click',()=>state.primary?.());$('secondary-result-action').addEventListener('click',()=>state.secondary?.());$('copy-link').addEventListener('click',()=>copy($('share-url-input').value));
$('profile-button').addEventListener('click',()=>modal('pref-modal',true));$('pref-close').addEventListener('click',()=>modal('pref-modal',false));$('auth-close').addEventListener('click',()=>modal('auth-modal',false));
document.querySelectorAll('.service-option').forEach(b=>b.addEventListener('click',()=>{state.pendingPref=b.dataset.service;document.querySelectorAll('.service-option').forEach(o=>o.classList.toggle('selected',o.dataset.service===b.dataset.service));}));
$('pref-save').addEventListener('click',()=>{savePref(state.pendingPref||preference||'apple_music');modal('pref-modal',false);toast(`Your music app: ${SERVICE[preference]}`);if(state.pendingLink){const pending=state.pendingLink;state.pendingLink=null;begin(pending);}else if(current?.type==='song'&&platformLink(current.platforms[preference],preference))renderSong(current.data,current.inputURL);});
$('account-button').addEventListener('click',async()=>{if(user&&supabase){await supabase.auth.signOut();updateAccount();toast('Signed out');return;}modal('pref-modal',false);modal('auth-modal',true);});
$('auth-form').addEventListener('submit',async e=>{e.preventDefault();try{$('auth-submit').disabled=true;await login($('auth-email').value.trim());}catch(err){$('auth-info').textContent=err.message;}finally{$('auth-submit').disabled=false;}});
$('back-to-top').addEventListener('click',()=>$('workspace').scrollIntoView({behavior:'smooth'}));
$('connect-spotify').addEventListener('click',async()=>{try{await ensureSpotify();toast('Spotify is connected');updateConnections();}catch(e){if(!e.message.includes('Redirecting'))toast(e.message);}});
$('connect-apple').addEventListener('click',async()=>{try{await ensureAppleUser();toast('Apple Music is connected');}catch(e){toast(e.message);}});
$('disconnect-spotify').addEventListener('click',()=>{localStorage.removeItem(SPOTIFY_STORAGE);spotifyAuth=null;updateConnections();toast('Spotify disconnected from this browser');});
document.querySelectorAll('.modal-backdrop').forEach(b=>b.addEventListener('click',e=>{if(e.target===b)modal(b.id,false);}));document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.modal-backdrop').forEach(b=>b.hidden=true);});
await initSupabase();try{const st=await request('/api/status');publicProviderAvailable=!!st.publicPlaylistProviderConfigured;}catch{}updateConnections();try{if(await finishSpotifyCallback())return;}catch(e){error('form-error',e.message);}
if(Q.get('playlist'))await loadIncomingPlaylist(Q.get('playlist'));else if(Q.get('song'))await incomingSong(Q.get('song'));else if(!preference)modal('pref-modal',true);
}
document.addEventListener('DOMContentLoaded',()=>{onReady().catch(e=>{console.error(e);error('form-error','The app could not finish loading. Reload this page.');});});
})();
