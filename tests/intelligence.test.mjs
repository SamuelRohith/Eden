import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../server/config.mjs';
import { MatchMemory, makeContext } from '../server/memory.mjs';
import { createProviders } from '../server/providers.mjs';
import { checkStory, tellStory } from '../server/story.mjs';
import { createAPI } from '../server/api.mjs';
import { cleanCopy } from '../server/copy.mjs';
import { spokenCopy } from '../dist/intelligence.js';

const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
const settings=overrides=>({...config,semantic:{...config.semantic,enabled:false},ai:'auto',retrieval:'auto',speech:'auto',fallback:true,runtime:'framework',model:'qwen3:1.7b',context:4096,azure:{...config.azure,endpoint:'https://model.openai.azure.com',deployment:'test-model',key:'TEST-ONLY',
  search:'https://search.search.windows.net',index:'eden-events',searchKey:'TEST-ONLY',speechRegion:'eastus',speechKey:'TEST-ONLY',insights:''},...overrides});
const fixture=()=>({id:'test-match',elapsed:20,finished:false,teams:[{name:'Red',formation:'4-3-3'},{name:'Blue',formation:'4-4-2'}],events:[
  {id:'event-1',elapsed:5,type:'pass',team:0,player:7,receiver:9,text:'#7 of Red passes to #9.'},
  {id:'event-2',elapsed:6,type:'shot',team:0,player:9,text:'#9 of Red shoots.'},
  {id:'event-3',elapsed:7,type:'goal',team:0,player:9,text:'#9 of Red scores.'},
  {id:'event-4',elapsed:7,type:'kickoff',team:1,text:'Blue restart after the goal.'},
  {id:'event-5',elapsed:18,type:'goal',team:1,player:10,text:'#10 of Blue scores.'},
]});
const context=()=>{const memory=new MatchMemory();return makeContext(memory.sync(fixture()),{eventId:'event-3',mode:'review'});};
const valid=JSON.stringify({headline:'Red finish the move',claims:[{text:'#9 of Red scores.',eventIds:['event-3']}]});

test('Old reviews exclude later events, same-clock restarts, and future score totals',()=>{
  const c=context();assert.equal(c.asOf,7);assert.deepEqual(c.stats.map(t=>t.score),[1,0]);
  assert(!c.evidence.some(e=>['event-4','event-5'].includes(e.id)));
  assert.equal(c.eventCount,3);
});
test('Memory is idempotent, ignores stale syncs, and isolates matches',()=>{
  const m=new MatchMemory();const f=fixture();m.sync(f);m.sync(f);assert.equal(m.get(f.id).events.size,5);
  m.sync({...f,elapsed:3,events:[]});assert.equal(m.get(f.id).elapsed,20);
  const other=m.sync({...f,id:'other-match',events:[]});assert.equal(other.events.size,0);
});
test('Evidence checker rejects fabricated source IDs and unsupported numbers',()=>{
  assert.throws(()=>checkStory(JSON.stringify({headline:'Story',claims:[{text:'Red maintained control throughout the match.',eventIds:['event-1']}]}),context()));
  assert.throws(()=>checkStory(JSON.stringify({headline:'Story',claims:[{text:'Red struggled to find a foothold with limited possession.',eventIds:['event-1']}]}),context()));
  assert.throws(()=>checkStory(JSON.stringify({headline:'Goal',claims:[{text:'Red scored a goal.',eventIds:['event-1']}]}),context()));
  const shotContext=context();shotContext.evidence.find(e=>e.id==='event-2').text='#9 attempts a shot. Estimated scoring chance.';
  assert.throws(()=>checkStory(JSON.stringify({headline:'Goal',claims:[{text:'Red scored.',eventIds:['event-2']}]}),shotContext));
  assert.throws(()=>checkStory(JSON.stringify({headline:'Goal',claims:[{text:'A goalkeeper save led to the goal.',eventIds:['event-1','event-3']}]}),context()));
  assert.throws(()=>checkStory(JSON.stringify({headline:'Goal',claims:[{text:'A goal.',eventIds:['event-999']}]}),context()));
  assert.throws(()=>checkStory(JSON.stringify({headline:'Goal',claims:[{text:'#9 scored 42 goals.',eventIds:['event-3']}]}),context()));
  assert.equal(checkStory(valid,context()).claims.length,1);
});
test('Cloud-disabled mode makes no Microsoft calls even with credentials supplied',async()=>{
  const calls=[];const p=createProviders(settings({cloud:false,runtime:'direct'}),async(url,init)=>{calls.push(url);assert.equal(JSON.parse(init.body).model,'qwen3:1.7b');return json({message:{content:valid}});});
  const result=await p.generate('instructions','JSON prompt');assert.equal(result.provider,'ollama');
  assert(calls.every(u=>u.startsWith(config.ollama)));
});
test('Microsoft HTTP failure falls back through framework failure to direct Qwen',async()=>{
  const calls=[];const p=createProviders(settings({cloud:true,runtime:'framework'}),async(url,init)=>{
    calls.push(url);if(url.includes('azure.com'))return new Response('service unavailable',{status:503});
    const body=JSON.parse(init.body);assert.equal(body.think,false);assert.equal(body.options.num_ctx,4096);return json({message:{content:valid}});
  },async()=>{throw new Error('Worker unavailable');});
  const result=await p.generate('system','JSON prompt');assert.equal(result.provider,'ollama');
  assert.equal(calls.length,2);assert.equal(result.notes.length,2);assert.match(result.runtime,/backup/);
});
test('Microsoft successful model call uses v1 API, deployment name and server key',async()=>{
  const p=createProviders(settings({cloud:true}),async(url,init)=>{
    assert.equal(url,'https://model.openai.azure.com/openai/v1/chat/completions');
    assert.equal(init.headers['api-key'],'TEST-ONLY');assert.equal(JSON.parse(init.body).model,'test-model');
    return json({choices:[{message:{content:valid}}]});
  });const result=await p.generate('system','JSON prompt');assert.equal(result.provider,'azure_openai');
});
test('Unsupported Microsoft answer triggers local Qwen, not unsupported publication',async()=>{
  const providers={generate:async(_s,_p,local)=>local?{raw:valid,provider:'ollama',runtime:'test',notes:[]}:
    {raw:'{"headline":"Goal","claims":[{"text":"#9 scored 42 goals","eventIds":["event-3"]}]}',provider:'azure_openai',runtime:'test',notes:[]}};
  const result=await tellStory(providers,context());assert.equal(result.provider,'ollama');assert.match(result.notes[0],/failed evidence/);
});
test('All-model failure is visibly deterministic rather than mislabeled AI',async()=>{
  const result=await tellStory({generate:async()=>{throw new Error('Offline');}},context());
  assert.equal(result.provider,'event_summary');assert.match(result.script,/#9.*scored/);
  assert(!/match time|Event actor|estimated scoring chance/.test(result.spokenText));
});
test('Full-time recaps always lead with the calculated score, including offline fallback',async()=>{
  const memory=new MatchMemory();const m=memory.sync({...fixture(),finished:true});const c=makeContext(m,{mode:'recap',language:'en'});
  const result=await tellStory({generate:async()=>{throw new Error('Offline');}},c);
  assert.equal(result.claims[0].text,'Full time: Red 1–1 Blue.');assert.deepEqual(result.claims[0].eventIds,['stats']);
});
test('Disabling fallback preserves errors',async()=>{
  const p=createProviders(settings({cloud:true,fallback:false}),async()=>new Response('',{status:429}));
  await assert.rejects(()=>p.generate('system','JSON prompt'));
  await assert.rejects(()=>tellStory({generate:async()=>{throw new Error('Offline');}},context(),false));
});
test('Azure retrieval indexes events then filters searches by match and time',async()=>{
  const seen=[];const p=createProviders(settings({cloud:true}),async(url,init)=>{
    const b=JSON.parse(init.body);seen.push(b);
    if(url.includes('/docs/index')){assert(b.value.every(e=>e.elapsed<=7));return json({value:[{status:true}]});}
    assert.equal(b.filter,"matchId eq 'test-match' and elapsed le 7");return json({value:[{eventId:'event-3'}]});
  });
  const m=new MatchMemory().sync(fixture());const result=await p.retrieve(m,'goal',7);
  assert.equal(result.provider,'azure_search');assert.deepEqual(result.ids,['event-3']);assert.equal(seen.length,2);
});
test('Failed or partially failed search indexing uses local retrieval',async()=>{
  const p=createProviders(settings({cloud:true}),async()=>json({value:[{status:false}]}));
  const result=await p.retrieve(new MatchMemory().sync(fixture()),'goal',7);assert.equal(result.provider,'local');
});
test('Azure Speech escapes input markup and failure selects device speech',async()=>{
  const p=createProviders(settings({cloud:true}),async(url,init)=>{
    assert.match(url,/eastus\.tts\.speech\.microsoft\.com/);assert.match(init.body,/&lt;goal&gt; &amp; score/);
    return new Response(new Uint8Array([1,2,3]),{status:200});
  });assert.equal((await p.speech('<goal> & score','en')).provider,'azure_speech');
  const offline=createProviders(settings({cloud:true}),async()=>new Response('',{status:403}));
  assert.equal((await offline.speech('Goal','en')).provider,'browser');
});
test('API accepts a complete snapshot, exposes evidence, rejects invalid modes',async()=>{
  const providers={health:async()=>({reachable:true,modelInstalled:true}),retrieve:async()=>({provider:'local',ids:[],notes:[]}),
    generate:async()=>({raw:valid,provider:'ollama',runtime:'test',notes:[]})};
  const api=createAPI(settings({cloud:false}),providers);
  const result=await api.handle('/api/story','POST',{match:fixture(),eventId:'event-3',mode:'review'});
  assert.equal(result.status,200);assert.equal(result.json.asOf,7);assert.equal(result.json.provider,'ollama');
  assert.equal((await api.handle('/api/story','POST',{match:fixture(),mode:'bad'})).status,400);
});

const mistakeFixture=()=>({id:'mistake-match',elapsed:40,teams:[{name:'Northgate FC'},{name:'Harbor United'}],events:[
  {id:'event-1',elapsed:2,type:'turnover',team:1,player:4,lostTeam:0,lostPlayer:9,text:'#4 of Harbor United intercepts the pass from #9.'},
  {id:'event-2',elapsed:3,type:'tackle',team:1,player:2,lostTeam:0,lostPlayer:9,text:'#2 wins the ball directly from #9.'},
  {id:'event-3',elapsed:4,type:'yellow',team:0,player:9,text:'#9 receives a yellow card.'},
  {id:'event-4',elapsed:4,type:'foul',team:1,player:7,offenderTeam:0,offender:9,text:'Foul! #9 of Northgate FC fouls #7 of Harbor United.'},
  {id:'event-5',elapsed:6,type:'shot',team:0,player:11,text:'#11 attempts a shot.'},
  ...Array.from({length:20},(_,i)=>({id:`event-${i+6}`,elapsed:10+i,type:'pass',team:0,player:6,receiver:7,text:'#6 of Northgate FC passes to #7.'})),
]});
test('Most-mistakes question uses all events and does not blame the tackler or double-count cards',async()=>{
  const c=makeContext(new MatchMemory().sync(mistakeFixture()),{mode:'question',question:'which player made the most mistakes so far?'});
  assert.equal(c.answer.leaders[0].player,9);assert.equal(c.answer.leaders[0].value,3);
  assert.equal(c.answer.status,'supported');assert.match(c.answer.detail,/Missed shots and cards are not counted again/);
  const r=await tellStory({generate:async()=>{throw new Error('Offline');}},c);
  assert.equal(r.provider,'match_analysis');assert.match(r.script,/#9 of Northgate FC/);assert.match(r.script,/3/);
  assert(!r.script.includes('passes to #7'));assert.equal(r.claims[0].eventIds[0],'answer-facts');
});
test('Mistake ties, missing attribution and earlier review cutoffs are explicit',()=>{
  const f=mistakeFixture();
  const c=makeContext(new MatchMemory().sync(f),{mode:'question',eventId:'event-1',question:'who made the most mistakes?'});
  assert.equal(c.answer.leaders[0].value,1);
  const tied={...f,events:[...f.events,{id:'event-26',elapsed:32,type:'tackle',team:1,player:2,lostTeam:0,lostPlayer:8,text:'#2 wins the ball directly from #8.'},{id:'event-27',elapsed:33,type:'foul',team:1,player:7,offenderTeam:0,offender:8,text:'Foul! #8 fouls #7.'},{id:'event-28',elapsed:34,type:'turnover',team:1,player:4,lostTeam:0,lostPlayer:8,text:'Pass intercepted.'}]};
  const tie=makeContext(new MatchMemory().sync(tied),{mode:'question',question:'most mistakes?'});assert.match(tie.answer.lead,/tied/);
  const unknown=makeContext(new MatchMemory().sync({...f,events:[{id:'event-1',elapsed:2,type:'turnover',team:1,player:4,text:'#4 intercepts the pass.'}]}),{mode:'question',question:'who made the most mistakes?'});
  assert.equal(unknown.answer.status,'insufficient');assert.match(unknown.answer.lead,/can't rank/);
});
test('Question fallback acknowledges missing evidence instead of substituting recent events',async()=>{
  const c=makeContext(new MatchMemory().sync(fixture()),{mode:'question',question:'Why did they change their manager?'});
  const r=await tellStory({generate:async()=>{throw new Error('Offline');}},c);
  assert.match(r.script,/couldn't produce a reliable answer/);assert(!r.script.includes('#9 of Red scores'));
});
test('Raw timestamps, actor metadata and scoring estimates never reach speech copy',()=>{
  const raw='8′ (match time 8.2, minute 9): #9 of Northgate FC attempts a shot after a driving dribble. 15% estimated scoring chance. [Event actor: #9 of Northgate FC.]';
  assert.equal(cleanCopy(raw),'#9 of Northgate FC attempts a shot after a driving dribble.');
  assert.equal(spokenCopy({claims:[{text:raw}]}),'#9 of Northgate FC attempts a shot after a driving dribble.');
});
test('A copy-editor failure retains supported sentences instead of triggering event fallback',async()=>{
  let calls=0;
  const p={generate:async()=>{if(calls++)throw new Error('Editor unavailable');return {raw:valid,provider:'ollama',runtime:'test',notes:[]};}};
  const r=await tellStory(p,context());assert.equal(r.provider,'ollama');assert.equal(r.script,'#9 of Red scores.');assert.equal(calls,2);
});
test('A bad extra sentence is withheld without discarding the useful draft',async()=>{
  const partial=JSON.stringify({headline:'Story',claims:[{text:'#9 of Red scores.',eventIds:['event-3']},{text:'A goalkeeper save led to it.',eventIds:['event-1']}]});
  const p={generate:async()=>({raw:partial,provider:'ollama',runtime:'test',notes:[]})};
  const r=await tellStory(p,context());assert.equal(r.provider,'ollama');assert.equal(r.claims.length,1);assert(!r.script.includes('goalkeeper'));
});
test('A short edit cannot drop the outcome and leave only an unrelated buildup action',async()=>{
  const onlyPass=JSON.stringify({headline:'Story',claims:[{text:'#7 of Red passes to #9.',eventIds:['event-1']}]});
  const r=await tellStory({generate:async()=>({raw:onlyPass,provider:'ollama',runtime:'test',notes:[]})},context());
  assert.match(r.script,/#9.*scored/);assert.match(r.script,/#7/);assert(r.claims.some(c=>c.eventIds.includes('event-3')));
});

// Regression: comparison must aggregate the entire match, not only retrieved events.
test('Which team dribbled more counts early carries and handles ties and zero totals',async()=>{
  const f=fixture();f.elapsed=90;f.finished=true;
  f.events=[...Array.from({length:18},(_,i)=>({id:`event-${i+1}`,elapsed:i+1,type:'dribble',team:i<12?0:1,player:9,text:`#9 carries the ball forward.`})),{id:'event-19',elapsed:90,type:'fulltime',text:'Full time.'}];
  const c=makeContext(new MatchMemory().sync(f),{mode:'question',question:'Which team dribbled more?'});
  assert.match(c.answer.lead,/Red.*12/);assert.match(c.answer.lead,/Blue: 6/);
  const r=await tellStory({generate:async()=>{throw Error('offline');}},c);assert.match(r.script,/Red: 12; Blue: 6/);
  f.events=[];const zero=makeContext(new MatchMemory().sync(f),{mode:'question',question:'Which team dribbled more?'});
  assert.match(zero.answer.lead,/tied/);assert.match(zero.answer.lead,/0 each/);
});

test('Whole-match broadcaster stories preserve the opener, equaliser and player contributions',async()=>{
 const f=fixture();f.elapsed=90;f.finished=true;f.scenario={league:'Eden Continental League',stakes:'title'};
 f.events.push({id:'event-6',type:'dribble',elapsed:30,team:0,player:7,text:'#7 of Red carries the ball forward.'},{id:'event-7',type:'fulltime',elapsed:90,text:'Full time.'});
 const match=new MatchMemory().sync(f),offline={generate:async()=>{throw Error('offline');}};
 for(const mode of ['commentary','recap']) {
  const c=makeContext(match,{mode});assert.equal(c.audience,'broadcaster');
  const r=await tellStory(offline,c);assert.match(r.script,/breakthrough/);assert.match(r.script,/answered/);assert.match(r.script,/dribbles/);
  assert.match(r.script,/fictional Eden Continental League title-race/);
 }
 const earlier=makeContext(match,{mode:'review',eventId:'event-3'});assert(!earlier.arc.some(c=>/Blue.*answered/.test(c.text)));
});

test('A model focusing only on the final goal cannot erase the opening goal from the story',async()=>{
  const f=fixture();f.elapsed=90;f.finished=true;
  const c=makeContext(new MatchMemory().sync(f),{mode:'commentary',audience:'broadcaster'});
  const lastOnly=JSON.stringify({headline:'Story',claims:[{text:'#10 of Blue scores.',eventIds:['event-5']}]});
  const r=await tellStory({generate:async()=>({raw:lastOnly,provider:'ollama',runtime:'test',notes:[]})},c);
  assert.match(r.script,/#9/);assert.match(r.script,/#10/);assert.match(r.script,/level/);
});

test('Scheduled demo foul is resolved at the ball carrier through contact across seeded matches',async()=>{
  const {MatchSimulator}=await import('../dist/simulator.js');
  for(let seed=1;seed<=40;seed++) {
    let sim;let fouls=0;
    sim=new MatchSimulator({seed,teams:[{name:'Red',formation:'4-3-3'},{name:'Blue',formation:'4-4-2'}]},e=>{
      if(e.type==='foul') {
        fouls++;const victim=sim.players.find(p=>p.team===e.team&&p.number===e.player);
        const defender=sim.players.find(p=>p.team===1-e.team&&p.number===e.offender);
        assert(Math.hypot(victim.x-defender.x,victim.y-defender.y)<=1.81);
        assert(Math.hypot(victim.x-sim.ball.x,victim.y-sim.ball.y)<2);
      }
    });
    sim.start();let steps=0;
    while(!sim.finished&&steps++<10000){if(sim.paused)sim.resume();sim.advance(.1);}
    assert(sim.finished,`seed ${seed} stalled`);assert(fouls>=1,`seed ${seed} had no foul`);
  }
});

test('Small-model storytelling cannot invent player positions or quick breaks',()=>{
  const c=makeContext(new MatchMemory().sync(fixture()),{mode:'recap'});
  for(const text of ['The striker #9 of Red scored.','#9 of Red scored after a quick break.'])assert.throws(()=>checkStory(JSON.stringify({headline:'Story',claims:[{text,eventIds:['event-3']}]}),c));
});

test('Known English comparisons answer immediately without a model call',async()=>{
 const c=makeContext(new MatchMemory().sync(fixture()),{mode:'question',question:'Which team scored more?'});
 const r=await tellStory({generate:()=>{throw Error('A known count must not call the model');}},c,false);
 assert.equal(r.provider,'match_analysis');assert.match(r.script,/tied/);
 assert.match(r.notes[0],/complete recorded history/);
});

test('A distant foul cannot become the invented buildup to an equaliser',()=>{
 const f=fixture();f.events.push({id:'event-6',type:'foul',elapsed:19,team:0,player:7,offender:4,text:'Foul! #4 of Blue trips #7 of Red.'});
 const c=makeContext(new MatchMemory().sync(f),{mode:'recap'});
 assert.throws(()=>checkStory(JSON.stringify({headline:'Story',claims:[{text:'Blue equalized with #10 scoring after a foul on #7.',eventIds:['match-arc','event-5','event-6']}]}),c),/buildup/);
});
