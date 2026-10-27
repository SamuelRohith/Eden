import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../server/config.mjs';
import { createAPI } from '../server/api.mjs';
import { MatchMemory,makeContext } from '../server/memory.mjs';
import { englishQuestion,localizeStory,normalizeDigits } from '../server/language.mjs';
import { tellStory,promptFor } from '../server/story.mjs';
import { createProviders } from '../server/providers.mjs';
import { matchArc } from '../server/insights.mjs';

const match=()=>({id:'languages',elapsed:90,finished:true,teams:[{name:'Northgate FC'},{name:'Harbor United'}],events:[
 {id:'event-1',type:'goal',elapsed:12,team:0,player:9,text:'#9 of Northgate FC scored.'},
 {id:'event-2',type:'dribble',elapsed:14,team:0,player:9,text:'#9 of Northgate FC carries the ball forward.'},
 {id:'event-3',type:'goal',elapsed:78,team:1,player:10,text:'#10 of Harbor United scored.'},
]});
const settings={...config,cloud:false,semantic:{...config.semantic,enabled:false}};
const raw=claims=>JSON.stringify({headline:'Translation',claims});
const english={headline:'Answer',provider:'ollama',runtime:'test',notes:[],claims:[{text:'#9 of Northgate FC scored.',eventIds:['event-1']}],script:'#9 of Northgate FC scored.'};
const ctx=()=>makeContext(new MatchMemory().sync(match()),{mode:'question'});

test('A consolation goal cannot be described as extending a lead',()=>{
 const events=[{id:'a',type:'goal',team:0,player:9,elapsed:10},{id:'b',type:'goal',team:0,player:9,elapsed:20},{id:'c',type:'goal',team:1,player:7,elapsed:55}];
 const arc=matchArc(events,match().teams,{players:[]});
 assert.match(arc[2].text,/pulled a goal back/);assert(!arc[2].text.includes('lead'));
});

test('Spanish questions reach retrieval in English, with translated answers and unchanged sources',async()=>{
 let query;let translations=0;
 const providers={retrieve:async(_m,q)=>{query=q;return {provider:'chroma',ids:['event-1'],notes:[]};},generate:async(system,prompt)=>{
   if(system.includes("Eden's translator")) {
     const data=JSON.parse(prompt);translations++;
     return {raw:raw(data.claims.map(c=>({...c,text:data.target==='Spanish'?'#9 de Northgate FC marcó.':data.claims[0].eventIds.length?'#9 of Northgate FC scored.':'How did Northgate FC score?'}))),provider:'ollama',runtime:'test',notes:[]};
   }
   return {...english,raw:raw(english.claims)};
 }};
 const r=await createAPI(settings,providers).handle('/api/story','POST',{match:match(),mode:'question',language:'es',question:'¿Cómo marcó Northgate FC?'});
 assert.equal(r.status,200);assert.equal(query,'How did Northgate FC score?');assert.equal(r.json.language,'es');assert.match(r.json.script,/marcó/);
 assert.equal(r.json.englishScript,english.script);assert.deepEqual(r.json.claims[0].eventIds,['event-1']);assert.equal(translations,3);
});

test('Arabic digits and player identities survive question translation',async()=>{
 const p={generate:async()=>({raw:raw([{text:'Did player #9 score?',eventIds:[]}]),notes:[]})};
 assert.equal(normalizeDigits('٩ و ۱۰'),'9 و 10');
 assert.equal((await englishQuestion(p,'هل سجل اللاعب رقم ٩؟','ar',[])).question,'Did player #9 score?');
 await assert.rejects(()=>englishQuestion({generate:async()=>({raw:raw([{text:'Did player #8 score?',eventIds:[]}])})},'هل سجل اللاعب رقم ٩؟','ar',[]),e=>e.status===422);
});

test('Failed query translation stops before English-only embedding retrieval',async()=>{
 let retrieved=0;const api=createAPI(settings,{generate:async()=>{throw Error('Offline');},retrieve:()=>{retrieved++;}});
 const r=await api.handle('/api/story','POST',{match:match(),mode:'question',language:'ar',question:'لماذا؟'});
 assert.equal(r.status,422);assert.equal(retrieved,0);assert.match(r.json.error,/تعذرت/);
});

test('Arabic output is displayed only after a source-preserving back-translation',async()=>{
 const p={generate:async(_s,prompt)=>{const input=JSON.parse(prompt);return {raw:raw([{text:input.target==='Arabic'?'سجل #9 من Northgate FC.':english.script,eventIds:['event-1']}]),provider:'ollama',notes:[]};}};
 const result=await localizeStory(p,english,ctx(),'ar');assert.equal(result.language,'ar');assert.match(result.script,/سجل/);assert.equal(result.englishScript,english.script);
});

test('Changed numbers, source IDs or invented actions cannot become translated facts',async()=>{
 for(const bad of [
   {text:'#10 de Northgate FC marcó.',eventIds:['event-1']},
   {text:'#9 de Northgate FC marcó.',eventIds:['event-999']},
 ]) {
   const r=await localizeStory({generate:async()=>({raw:raw([bad]),provider:'ollama',notes:[]})},english,ctx(),'es');
   assert.equal(r.language,'en');assert(r.translationNotice);assert.equal(r.script,english.script);
 }
 let calls=0;const p={generate:async()=>({raw:raw([{text:calls++?'The goalkeeper saved #9 of Northgate FC.':'#9 de Northgate FC marcó.',eventIds:['event-1']}]),provider:'ollama',notes:[]})};
 assert.equal((await localizeStory(p,english,ctx(),'es')).language,'en');
});

test('Fan and broadcaster get different grounded stories and instructions',async()=>{
 const m=new MatchMemory().sync(match()),offline={generate:async()=>{throw Error('Offline');}};
 const fan=makeContext(m,{mode:'recap',audience:'fan'}),broadcast=makeContext(m,{mode:'recap',audience:'broadcaster'});
 const f=await tellStory(offline,fan),b=await tellStory(offline,broadcast);
 assert.match(f.script,/struck first/);assert(!f.script.includes('recorded dribbles'));assert.match(b.script,/breakthrough/);assert.match(b.script,/dribbles/);
 assert(f.script.length<b.script.length);assert.match(promptFor(fan),/short, friendly/);assert.match(promptFor(broadcast),/supported player contributions/);
 assert.deepEqual(f.claims[0].text,b.claims[0].text);
});

test('Azure Speech selects Arabic and Spanish regional voices',async()=>{
 const c={...settings,cloud:true,speech:'azure_speech',azure:{...config.azure,speechRegion:'eastus',speechKey:'TEST',voice:''}};
 for(const [language,locale,voice] of [['ar','ar-SA','Zariyah'],['es','es-ES','Elvira']]) {
   const p=createProviders(c,async(_url,init)=>{assert(init.body.includes(`xml:lang="${locale}"`));assert(init.body.includes(voice));return new Response(new Uint8Array([1,2,3]));});
   assert.equal((await p.speech('Test',language)).provider,'azure_speech');p.close();
 }
});

test('Football metrics survive query translation instead of silently becoming tackles',async()=>{
 let supplied;
 const provider={generate:async(_s,p)=>{supplied=JSON.parse(p).claims[0].text;return {raw:raw([{text:'Which team made more tackles?',eventIds:[]}])};}};
 await assert.rejects(()=>englishQuestion(provider,'¿Qué equipo hizo más regates?','es',[]),e=>e.status===422);
 assert.match(supplied,/DRIBBLES/);
 provider.generate=async()=>({raw:raw([{text:'Which team made more dribbles?',eventIds:[]}]),notes:[]});
 assert.match((await englishQuestion(provider,'أي فريق قام بمراوغات أكثر؟','ar',[])).question,/dribbles/);
});

test('Translated count questions retain exact totals without model-written numbers',async()=>{
 let calls=0;const m=match();m.events.push({id:'event-4',type:'dribble',elapsed:30,team:0,player:7,text:'#7 of Northgate FC carries the ball forward.'},{id:'event-5',type:'dribble',elapsed:50,team:1,player:10,text:'#10 of Harbor United carries the ball forward.'});
 const api=createAPI(settings,{generate:async()=>{calls++;return {raw:raw([{text:'Which team made more dribbles?',eventIds:[]}]),notes:[]};},retrieve:async()=>{throw Error('Counts must not use semantic search');}});
 const r=await api.handle('/api/story','POST',{match:m,mode:'question',language:'es',question:'¿Qué equipo hizo más regates?'});
 assert.equal(r.status,200);assert.equal(calls,1);assert.equal(r.json.translationProvider,'verified_phrases');assert.match(r.json.script,/Northgate FC: 2; Harbor United: 1/);api.close();
});

test('Failed narrative translation uses a labelled, grounded localized recap',async()=>{
 const context=makeContext(new MatchMemory().sync(match()),{mode:'recap',audience:'broadcaster'});
 const offline={generate:async()=>{throw Error('Offline');}};
 const story=await tellStory(offline,context),result=await localizeStory(offline,story,context,'es');
 assert.equal(result.language,'es');assert.equal(result.translationProvider,'verified_phrases');assert.equal(result.provider,'event_summary');
 assert.match(result.script,/Northgate FC 1–1 Harbor United/);assert.match(result.script,/1 regate\./);assert(result.notes.some(n=>n.includes('Model translation failed')));
});
