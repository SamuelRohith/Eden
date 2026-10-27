import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { resolve,sep } from 'node:path';
import { config } from '../server/config.mjs';
import { MatchMemory,makeContext } from '../server/memory.mjs';
import { createAPI } from '../server/api.mjs';
import { createProviders } from '../server/providers.mjs';
import { SemanticIndex } from '../server/semantic.mjs';

// Actual BGE vectors and actual persistent Chroma, without a running web server.
// Its isolated database is created inside .data and removed after both workers exit.
await import('node:fs/promises').then(fs=>fs.mkdir(resolve('.data'),{recursive:true}));
const path=await mkdtemp(resolve('.data/rag-check-'));
const c={...config,semantic:{...config.semantic,enabled:true,path}};
const memory=new MatchMemory();
const events=[
  {id:'event-1',elapsed:2,type:'turnover',team:1,player:6,text:'Blue recover possession after Red lose the ball in midfield.'},
  {id:'event-2',elapsed:3,type:'pass',team:1,player:6,receiver:10,text:'#6 of Blue sends a forward pass to #10.'},
  {id:'event-3',elapsed:4,type:'shot',team:1,player:10,text:'#10 of Blue shoots after the possession recovery.'},
  {id:'event-4',elapsed:5,type:'foul',team:0,player:9,offender:4,text:'Foul! #4 of Blue trips #9 of Red.'},
  {id:'event-5',elapsed:20,type:'goal',team:0,player:9,text:'#9 of Red scores.'},
  {id:'event-6',elapsed:20,type:'red',team:1,player:4,text:'#4 of Blue is sent off after the goal.'},
];
const match=memory.sync({id:'semantic-check',elapsed:90,finished:true,teams:[{name:'Red'},{name:'Blue'}],events});
let index=new SemanticIndex(c);
try {
  await index.index(match);
  const first=index.status().embeddedThisSession;
  await index.index(match);assert.equal(index.status().embeddedThisSession,first,'Unchanged passages were re-embedded');
  const r=await index.retrieve(match,'attacks immediately after winning possession',90,{mode:'question'});
  assert.equal(r.provider,'chroma');assert.equal(index.status().dimensions,384);assert.equal(index.status().metric,'cosine');
  assert(r.ids.includes('event-1'));assert(r.ids.includes('event-3'));
  assert(r.hits[0].eventIds.some(id=>['event-1','event-3'].includes(id)),'Relevant possession should lead the semantic ranking');
  const early=await index.retrieve(match,'red cards and goals',20,{eventId:'event-5',mode:'review'});
  assert(!early.ids.includes('event-6'),'Same-clock future event leaked');
  assert(early.hits.every(h=>!h.eventIds.includes('event-6')),'Chroma returned a future passage');
  const offender=await index.retrieve(match,'Blue player #4 foul',5,{});
  assert(offender.ids.includes('event-4'),'Offender-team filter lost the foul recorded under the victim team');
  const other=memory.sync({id:'other-match',elapsed:90,teams:[{name:'Red'},{name:'Blue'}],events:[{id:'event-1',elapsed:2,type:'goal',team:0,player:9,text:'#9 scores for Red in a different match.'}]});
  await index.index(other);
  const isolated=await index.retrieve(match,'goals',90);assert(isolated.hits.every(h=>h.id.startsWith(match.id+'_')));
  const context=makeContext(match,{mode:'recap'},r.ids);assert.equal(context.stats[0].score,1);assert(context.arc.some(c=>c.eventIds.includes('event-5')));
  if(process.argv.includes('--story')) {
    const providers=createProviders({...c,cloud:false,retrieval:'chroma'},fetch,undefined,index);
    const api=createAPI({...c,cloud:false},providers);
    const answer=await api.handle('/api/story','POST',{match:{id:match.id,elapsed:match.elapsed,teams:match.teams,events:[...match.events.values()]},mode:'review',eventId:'event-3',question:'Explain the Blue attack after regaining possession.'});
    assert.equal(answer.status,200);assert.equal(answer.json.retrieval,'chroma');assert.equal(answer.json.provider,'ollama','Qwen did not produce an accepted reply');
    assert.equal(answer.json.asOf,4);console.log(JSON.stringify({endToEnd:'PASS',retrieval:answer.json.retrieval,provider:answer.json.provider,runtime:answer.json.runtime,script:answer.json.script}));
  }
  index.close();index=new SemanticIndex(c);await index.ready();
  const persisted=await index.request('query',{query:'attacks after regaining the ball',scope:{matchId:match.id,cutoff:90,lastOrder:999},topK:6});
  assert(persisted.hits.length);assert.equal(persisted.embeddedThisSession,0,'Persistence check should not re-embed documents');
  console.log(JSON.stringify({provider:r.provider,dimensions:384,metric:'cosine',matchedEvents:r.ids,topPassage:r.hits[0],persistence:'PASS',idempotence:'PASS',timeIsolation:'PASS',matchIsolation:'PASS'}));
} finally {
  index.close();
  // The worker closes its embedded database before Windows can remove the files.
  await new Promise(resolve=>setTimeout(resolve,1000));
  if(!resolve(path).startsWith(resolve('.data')+sep))throw new Error('Refusing cleanup outside the local data directory');
  await rm(path,{recursive:true,force:true,maxRetries:5,retryDelay:500});
}
