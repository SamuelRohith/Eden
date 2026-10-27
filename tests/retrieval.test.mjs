import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../server/config.mjs';
import { MatchMemory,makeContext } from '../server/memory.mjs';
import { buildPassages,queryScope,retrievalQuery } from '../server/passages.mjs';
import { createProviders } from '../server/providers.mjs';
import { createAPI } from '../server/api.mjs';

const fixture=()=>new MatchMemory().sync({id:'rag-test',elapsed:90,finished:true,teams:[{name:'Northgate'},{name:'Harbor'}],events:[
  {id:'event-1',elapsed:1,type:'turnover',team:1,player:6,text:'Harbor regain possession.'},
  {id:'event-2',elapsed:2,type:'pass',team:1,player:6,receiver:10,text:'#6 passes to #10.'},
  {id:'event-3',elapsed:3,type:'shot',team:1,player:10,text:'#10 shoots after the recovery.'},
  {id:'event-4',elapsed:20,type:'goal',team:0,player:9,text:'#9 of Northgate scores.'},
  {id:'event-5',elapsed:20,type:'red',team:1,player:4,text:'#4 of Harbor is sent off.'},
]});
const settings=overrides=>({...config,cloud:false,semantic:{...config.semantic,enabled:true},...overrides});

test('Passages preserve possession connections, identity, stable IDs and content hashes',()=>{
 const m=fixture(),docs=buildPassages(m),sequence=docs.find(d=>d.metadata.kind==='sequence');
 assert(sequence);assert.deepEqual(JSON.parse(sequence.metadata.eventIds),['event-1','event-2','event-3']);
 assert.match(sequence.text,/Harbor regain possession/);assert.equal(sequence.metadata.team,1);assert.equal(sequence.metadata.player_10,true);
 assert.deepEqual(buildPassages(m),docs);
 m.events.set('event-6',{id:'event-6',elapsed:30,type:'pass',team:0,player:7,receiver:9,text:'A later pass.'});
 assert.deepEqual(buildPassages(m).find(d=>d.id===docs[0].id),docs[0]);
});

test('Query scopes use exact team/player filters and a historical event-order boundary',()=>{
 const m=fixture();assert.deepEqual(queryScope(m,'Explain Harbor player #10',20,4),{matchId:'rag-test',cutoff:20,lastOrder:4,team:1,player:10});
 assert.equal(queryScope(m,'Compare Harbor and Northgate',90,5).team,null);
 assert.match(retrievalQuery(m,{mode:'recap'}),/match recap/);
 assert.match(retrievalQuery(m,{eventId:'event-4'}),/Northgate scores/);
});

test('Foul passages identify the offender team independently of the victim jersey',()=>{
 const m=fixture();m.events.set('event-6',{id:'event-6',elapsed:30,type:'foul',team:0,player:4,offender:2,offenderTeam:1,text:'Harbor #2 fouls Northgate #4.'});
 const foul=buildPassages(m).find(d=>d.id.endsWith('_event_event-6'));
 assert.equal(foul.metadata.team_1,true);assert.equal(foul.metadata.team_1_player_2,true);
 assert.equal(foul.metadata.team_0_player_4,true);assert.equal(foul.metadata.team_1_player_4,undefined);
});

test('Semantic hits rehydrate original events and cannot leak same-time future reviews',()=>{
 const m=fixture(),c=makeContext(m,{mode:'review',eventId:'event-4'},['event-1','event-5','event-999']);
 assert(c.evidence.some(e=>e.id==='event-1'));assert(!c.evidence.some(e=>['event-5','event-999'].includes(e.id)));
 assert.equal(c.stats[0].score,1);
});

test('Default local retrieval selects BGE/Chroma and forwards historical scope',async()=>{
 const m=fixture();let seen;
 const semantic={retrieve:async(...args)=>{seen=args;return {provider:'chroma',ids:['event-1'],notes:[]};},status:()=>({status:'ready'}),close:()=>{}};
 const p=createProviders(settings(),async()=>{throw Error('No cloud request allowed');},undefined,semantic);
 const r=await p.retrieve(m,'regaining possession',20,{eventId:'event-4'});
 assert.equal(r.provider,'chroma');assert.equal(seen[2],20);assert.equal(seen[3].eventId,'event-4');
});

test('A failed Microsoft Search uses Chroma, then an unavailable Chroma uses explicit keyword backup',async()=>{
 const cloud=settings({cloud:true,azure:{...config.azure,search:'https://example.search.windows.net',index:'events',searchKey:'TEST'}});
 const semantic={retrieve:async()=>({provider:'chroma',ids:['event-1'],notes:[]}),status:()=>({}),close:()=>{}};
 const p=createProviders(cloud,async()=>new Response('',{status:503}),undefined,semantic);
 assert.equal((await p.retrieve(fixture(),'recover possession',90)).provider,'chroma');
 semantic.retrieve=async()=>{throw Error('Unavailable');};
 const fallback=await p.retrieve(fixture(),'recover possession',90);assert.equal(fallback.provider,'local');assert.match(fallback.notes.join(' '),/BGE\/Chroma unavailable/);
 await assert.rejects(()=>createProviders({...cloud,fallback:false},async()=>new Response('',{status:503}),undefined,semantic).retrieve(fixture(),'q',90));
});

test('Exact counts do not wait for semantic indexing or call Qwen',async()=>{
 let retrieved=0,generated=0;
 const providers={index:()=>new Promise(()=>{}),retrieve:()=>{retrieved++;},generate:()=>{generated++;}};
 const api=createAPI(settings({cloud:false}),providers),m=fixture();
 const snapshot={id:m.id,teams:m.teams,elapsed:m.elapsed,events:[...m.events.values()]};
 const r=await api.handle('/api/story','POST',{match:snapshot,mode:'question',question:'Which team scored more?'});
 assert.equal(r.status,200);assert.equal(r.json.retrieval,'calculated');assert.match(r.json.script,/Northgate/);assert.equal(retrieved,0);assert.equal(generated,0);
 const synced=await api.handle('/api/matches/sync','POST',snapshot);assert.equal(synced.status,200);
});

test('Unsupported language options are rejected and the default English speech path works',async()=>{
 const api=createAPI(settings({cloud:false}),{speech:async()=>({provider:'browser'})});
 assert.equal((await api.handle('/api/story','POST',{mode:'question',language:'fr'})).status,400);
 assert.equal((await api.handle('/api/speech','POST',{text:'Hello',language:'fr'})).status,400);
 assert.equal((await api.handle('/api/speech','POST',{text:'Hello'})).status,200);
});
