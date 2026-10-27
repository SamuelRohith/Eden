import { approvedCaption } from './producer.js';
const $=id=>document.getElementById(id);
export function spokenCopy(result) {
  return String(result.spokenText||result.script||result.claims.map(c=>c.text).join(' '))
    .replace(/\d+(?:\.\d+)?[′']\s*\([^)]*(?:match time|minute)[^)]*\):\s*/gi,'')
    .replace(/\[Event actor:[^\]]*\]/gi,'')
    .replace(/\b\d+(?:\.\d+)?%\s+estimated scoring chance\.?/gi,'')
    .replace(/\s+/g,' ').trim();
}
const labels={azure_openai:'Microsoft Foundry',ollama:'Local Qwen3',event_summary:'Match summary',match_analysis:'Match analysis'};

export class MatchIntelligence {
  constructor() {
    this.match=null;this.events=[];this.id=null;this.busy=false;this.syncing=false;this.timer=null;this.audio=null;
    $('askForm').addEventListener('submit',e=>{e.preventDefault();const question=$('askQuestion').value.trim();if(question)this.generate('question',null,question);});
    $('tellStory').addEventListener('click',()=>this.generate('commentary'));
    $('makeRecap').addEventListener('click',()=>this.generate('recap'));
    $('checkServices').addEventListener('click',()=>this.checkServices());
    $('autoStories').addEventListener('change',()=>{if(!$('autoStories').checked){clearTimeout(this.autoTimer);this.pending=null;}});
    this.reviewSection=document.createElement('section');this.reviewSection.className='ai-review-section';
    this.reviewSection.innerHTML='<div class="section-heading"><h3>Explain this moment</h3><button id="explainMoment" class="button button-secondary" type="button">Ask Eden ↗</button></div><p class="panel-description">Use the buildup recorded up to this event.</p><div id="reviewStory" aria-live="polite"></div>';
    $('reviewDialog').append(this.reviewSection);
    $('explainMoment').addEventListener('click',()=>this.generate('review',this.reviewEvent?.id));
    this.checkServices();
  }
  async post(path,body) {
    const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Eden could not finish that request.');return data;
  }
  start(match) {
    clearInterval(this.timer);clearTimeout(this.autoTimer);this.stopSpeech();
    this.audience=match.config.audience||'broadcaster';
    $('intelligenceTitle').textContent=this.audience==='fan'?'Your match, explained':'Broadcast analysis';
    $('intelligenceDescription').textContent=this.audience==='fan'?'Follow your team and understand the big moments in everyday language.':'Explore the buildup, follow your team, and hear broadcast-ready match analysis.';
    this.match=match;this.id=crypto.randomUUID();this.events=[];this.reviewEvent=null;this.reviewStories=new Map();this.pending=null;
    $('storyFeed').replaceChildren();$('reviewStory').replaceChildren();
    $('askStatus').textContent='Match memory is ready. Ask about the action as it unfolds.';
    const select=$('favoriteTeam');select.replaceChildren(new Option('Both teams',''));
    match.teams.forEach((t,i)=>select.add(new Option(t.name,String(i))));
    this.timer=setInterval(()=>this.sync(),2000);
    // An earlier request can finish after a rematch; response guards use the match ID.
    this.setBusy(false);
  }
  payload() {
    const s=this.match;if(!s)return null;
    const possession=s.getPossession();
    return {id:this.id,elapsed:s.elapsed,finished:s.finished,scenario:s.config.scenario,
      teams:s.teams.map((t,i)=>({...Object.fromEntries(['name','formation','score','passes','shots','fouls','tackles','yellows','reds','corners'].map(k=>[k,t[k]])),possession:possession[i]})),
      events:this.events};
  }
  record(event,match) {
    if(match!==this.match)return;
    const ball=event.review?.snapshot?.ball||match.ball;
    const loss=event.type==='throwin'||event.type==='tackle'?event.review?.playerId?.split('-').map(Number):null;
    this.events.push({id:event.id,type:event.type,text:event.text,elapsed:event.elapsed,team:event.team,player:event.player,
      lostTeam:event.lostTeam??loss?.[0],lostPlayer:event.lostPlayer??loss?.[1],
      offender:event.offender,offenderTeam:event.type==='foul'?1-event.team:undefined,
      receiver:event.receiver,score:event.score,pressure:event.review?.pressure,ball:{x:ball.x,y:ball.y}});
    if(event.type==='fulltime'){clearInterval(this.timer);this.sync();}
    if($('autoStories').checked&&(event.stop||['halftime','fulltime'].includes(event.type))) {
      clearTimeout(this.autoTimer);const id=this.id;
      this.autoTimer=setTimeout(()=>{
        if(this.id!==id)return;
        const request={mode:event.type==='fulltime'?'recap':'commentary',eventId:event.type==='fulltime'?null:event.id};
        if(this.busy)this.pending=request;else this.generate(request.mode,request.eventId);
      },700);
    }
  }
  async sync() {
    if(!this.match||this.syncing)return;this.syncing=true;
    try{await this.post('/api/matches/sync',this.payload());}catch{/* Full snapshots also accompany story requests; a missed background sync loses no events. */}
    finally{this.syncing=false;}
  }
  reviewKey(eventId){return [eventId,this.audience,$('storyLanguage').value,$('favoriteTeam').value].join(':');}
  review(event) {
    this.reviewEvent=event;const saved=this.reviewStories.get(this.reviewKey(event.id));
    $('reviewStory').replaceChildren(...(saved?[this.renderStory(saved)]:[]));
  }
  setBusy(value) {
    this.busy=value;
    ['askSubmit','tellStory','makeRecap','explainMoment'].forEach(id=>$(id).disabled=value);
  }
  async generate(mode,eventId=null,question='') {
    if(!this.match||this.busy)return;
    this.setBusy(true);const id=this.id;const reviewKey=this.reviewKey(eventId);
    $('askStatus').textContent=$('storyLanguage').value!=='en'?'Translating, checking match evidence and preparing your reply…':mode==='question'?'Finding a direct answer…':'Drafting and editing a short story…';
    if(mode==='review')$('reviewStory').textContent='Reading the recorded buildup…';
    const favorite=$('favoriteTeam').value;
    try {
      const result=await this.post('/api/story',{match:this.payload(),mode,eventId,question,
        audience:this.audience,language:$('storyLanguage').value,favoriteTeam:favorite===''?null:Number(favorite)});
      if(this.id!==id)return;
      const card=this.renderStory(result,question);
      if(mode==='review')this.reviewStories.set(reviewKey,result);
      $('storyFeed').prepend(card);
      // Put the new answer in view even after a producer reviewed an older card.
      $('storyFeed').scrollTop=0;
      while($('storyFeed').childElementCount>12)$('storyFeed').lastChild.remove();
      if(mode==='review'&&this.reviewEvent?.id===eventId)$('reviewStory').replaceChildren(this.renderStory(result));
      $('askStatus').textContent=`${mode==='question'?'Answer':'Story'} ready · ${(result.latencyMs/1000).toFixed(1)}s`;
    }catch(error){
      if(this.id!==id)return;
      $('askStatus').textContent=error.message;
      if(mode==='review')$('reviewStory').textContent=error.message;
    }finally{
      if(this.id===id){
        this.setBusy(false);
        if(this.pending&&$('autoStories').checked){const next=this.pending;this.pending=null;this.generate(next.mode,next.eventId);}
      }
    }
  }
  renderStory(result,question='') {
    const article=document.createElement('article');article.className='story-card';article.dir=result.language==='ar'?'rtl':'ltr';article.lang=result.language||'en';
    if(question){const q=document.createElement('p');q.className='story-question';q.textContent=question;article.append(q);}
    const meta=document.createElement('div');meta.className='story-meta';meta.textContent=`${labels[result.provider]||result.provider} · ${Math.floor(result.asOf)}′`;
    const title=document.createElement('h3');title.textContent=result.mode==='question'?({en:'Answer',ar:'الإجابة',es:'Respuesta'}[result.language]||'Answer'):result.headline;
    article.append(meta,title);
    if(result.translationNotice){const notice=document.createElement('p');notice.className='translation-notice';notice.textContent=result.translationNotice;article.append(notice);}
    const copy=spokenCopy(result);
    const paragraph=document.createElement('p');paragraph.className='story-copy'+(result.mode==='question'?' direct-answer':'');paragraph.textContent=copy;article.append(paragraph);
    const actions=document.createElement('div');actions.className='story-copy-actions';
    const speak=document.createElement('button');speak.className='button button-secondary';speak.type='button';speak.textContent={en:'Listen ▶',ar:'استمع ▶',es:'Escuchar ▶'}[result.language]||'Listen ▶';
    speak.addEventListener('click',()=>this.speak(copy,result.language||'en',speak));actions.append(speak);article.append(actions);

    if(result.audience==='broadcaster'&&result.mode!=='question') {
      const words={en:{draft:'Draft · producer review',approved:'Approved for export',rejected:'Draft rejected',approve:'Approve',reject:'Reject',download:'Export script'},ar:{draft:'مسودة للمراجعة',approved:'تم الاعتماد للتصدير',rejected:'تم رفض المسودة',approve:'اعتماد',reject:'رفض',download:'تصدير النص'},es:{draft:'Borrador · revisión del productor',approved:'Aprobado para exportar',rejected:'Borrador rechazado',approve:'Aprobar',reject:'Rechazar',download:'Exportar guion'}}[result.language]||{draft:'Draft',approved:'Approved',rejected:'Rejected',approve:'Approve',reject:'Reject',download:'Export script'};
      const decision={status:'draft'},review=document.createElement('div');review.className='producer-review';
      const badge=document.createElement('span');badge.className='producer-state';badge.setAttribute('role','status');badge.textContent=words.draft;
      const approve=document.createElement('button'),reject=document.createElement('button'),download=document.createElement('button');
      for(const b of [approve,reject,download]){b.type='button';b.className='button button-secondary';}
      approve.textContent=words.approve;reject.textContent=words.reject;download.textContent=words.download;download.disabled=true;
      const decide=status=>{decision.status=status;decision.reviewedAt=new Date().toISOString();badge.textContent=words[status];review.dataset.status=status;download.disabled=status!=='approved';};
      approve.addEventListener('click',()=>decide('approved'));reject.addEventListener('click',()=>decide('rejected'));
      download.addEventListener('click',()=>{const data=approvedCaption(result,decision),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='eden-approved-script.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
      review.append(badge,approve,reject,download);article.append(review);
    }

    // Keep evidence, totals, definitions and implementation details available
    // without making them the answer or reading them aloud to the broadcaster.
    const detail=document.createElement('details');detail.className='story-details';
    const summary=document.createElement('summary');summary.textContent='Evidence & details';detail.append(summary);
    if(result.answerDefinition){const definition=document.createElement('p');definition.textContent=result.answerDefinition;detail.append(definition);}
    const sources=new Map(result.evidence.map(e=>[e.id,e]));
    const ids=new Set(result.claims.flatMap(c=>c.eventIds));
    for(const id of [...ids])for(const related of sources.get(id)?.eventIds?.slice(-6)||[])if(sources.has(related))ids.add(related);
    const refs=document.createElement('div');refs.className='story-references';
    for(const id of ids) {
      const evidence=sources.get(id);if(!evidence)continue;
      const source=document.createElement('details'),label=document.createElement('summary'),text=document.createElement('p');
      label.textContent=id==='stats'?'Match figures':id==='answer-facts'?'How this was calculated':id==='player-facts'?'Player contributions':id==='match-arc'?'Whole-match storyline':id==='scenario'?'Fictional match setting':id.startsWith('pattern-')?'Detected pattern':`${Math.floor(evidence.elapsed)}′ supporting event`;
      if(id==='stats') {
        try {const totals=JSON.parse(evidence.text);text.textContent=totals.teams.map(t=>`${t.name}: ${t.score} goals, ${t.shots} shots, ${t.passes} completed passes.`).join(' ');}
        catch{text.textContent=evidence.text;}
      }else if(id==='player-facts') {
        try{text.textContent=JSON.parse(evidence.text).map(p=>`#${p.player} of ${p.team}: ${p.goals} goals, ${p.dribbles} recorded dribbles, ${p.losses} possession losses, ${p.fouls} fouls.`).join(' ');}catch{text.textContent=evidence.text;}
      }else text.textContent=evidence.displayText||evidence.text;
      source.append(label,text);refs.append(source);
      if(id.startsWith('event-')) {
        const jump=document.createElement('button');jump.type='button';jump.className='evidence-jump';jump.textContent='View event ↗';
        jump.addEventListener('click',()=>{
          const entry=document.querySelector(`[data-event-id="${id}"]`);
          if(entry){if($('reviewDialog').open)$('reviewDialog').close();entry.scrollIntoView({behavior:'smooth',block:'center'});entry.tabIndex=0;entry.focus({preventScroll:true});}
        });source.append(jump);
      }
    }
    detail.append(refs);
    if(result.interpretedQuestion){const interpreted=document.createElement('p');interpreted.dir='ltr';interpreted.textContent='Question interpreted in English: '+result.interpretedQuestion;detail.append(interpreted);}
    if(result.englishScript){const original=document.createElement('p');original.className='story-original';original.dir='ltr';original.textContent='Checked English original: '+result.englishScript;detail.append(original);}
    const generation=document.createElement('p');generation.className='story-note';
    generation.textContent=[`${result.runtime} · ${(result.latencyMs/1000).toFixed(1)}s`,...result.notes,
      result.validation==='calculated-match-analysis'?'Calculated from recorded incidents.':result.validation==='recorded-evidence-only'?'Short summary from recorded facts.':'Evidence checks reduce common errors; interpretations still need review.'].join(' ');
    detail.append(generation);article.append(detail);
    return article;
  }
  stopSpeech(){this.audio?.pause();this.audio=null;if('speechSynthesis'in window)window.speechSynthesis.cancel();}
  async speak(text,language,button) {
    text=spokenCopy({script:text}).replace(/#(\d+)/g,({en:'number ',ar:'رقم ',es:'número '}[language]||'number ')+'$1');
    if(button.dataset.playing==='true'){this.stopSpeech();button.dataset.playing='false';button.textContent='Listen ▶';return;}
    this.stopSpeech();button.disabled=true;button.textContent='Preparing audio…';const id=this.id;
    try {
      const data=await this.post('/api/speech',{text:text.slice(0,3000),language});if(this.id!==id)return;
      if(data.provider==='azure_speech') {
        this.audio=new Audio(`data:${data.mime};base64,${data.audio}`);await this.audio.play();
        button.textContent='Stop audio ■';button.dataset.playing='true';
        this.audio.onended=()=>{button.textContent='Listen ▶';button.dataset.playing='false';};
      }else{
        // BACKUP FOR TESTING PURPOSES AND SMOOTH EXECUTION:
        // Device speech is used only when the backend explicitly selects the backup.
        if(!('speechSynthesis'in window))throw new Error('Your browser has no speech support.');
        const voice=new SpeechSynthesisUtterance(text);voice.lang={en:'en-US',ar:'ar-SA',es:'es-ES'}[language]||'en-US';
        const selectedVoice=window.speechSynthesis.getVoices().find(v=>v.lang.toLowerCase().startsWith(language));if(selectedVoice)voice.voice=selectedVoice;
        voice.onend=voice.onerror=()=>{button.textContent='Listen ▶';button.dataset.playing='false';};
        window.speechSynthesis.speak(voice);button.textContent='Stop device voice ■';button.dataset.playing='true';
        $('askStatus').textContent=data.reason;
      }
    }catch(error){button.textContent='Retry audio';$('askStatus').textContent=error.message;}
    finally{button.disabled=false;}
  }
  async checkServices() {
    $('serviceStatus').textContent='Checking…';
    try {
      const r=await fetch('/api/health');if(!r.ok)throw new Error();const data=await r.json();
      $('serviceStatus').textContent=data.config.configured.ai&&data.config.ai!=='ollama'?'Microsoft AI configured':data.ollama.modelInstalled?'Local AI ready':data.ollama.reachable?'Qwen model missing':'Start Ollama for AI';
      $('serviceStatus').title=`${data.config.cloudEnabled?'Cloud enabled':'Cloud disabled'} · ${data.metrics.requests} stories · ${data.metrics.fallbacks} fallback responses · Match memory: ${data.retrieval?.status||'keyword'} ${data.retrieval?.documents||0} passages`;
    }catch{$('serviceStatus').textContent='Restart the Eden server';}
  }
}
