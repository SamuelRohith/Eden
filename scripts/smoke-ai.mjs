import assert from 'node:assert/strict';
const base=process.env.EDEN_TEST_URL||'http://127.0.0.1:4173';
const health=await (await fetch(base+'/api/health')).json();
assert(health.ok,'Eden backend is unavailable');
assert(health.config.configured.ai||health.ollama.modelInstalled,'Start Ollama and run: ollama pull qwen3:4b');
const id=crypto.randomUUID();
const match={id,elapsed:12,finished:false,teams:[{name:'Red',formation:'4-3-3'},{name:'Blue',formation:'4-4-2'}],events:[
  {id:'event-1',elapsed:9,type:'pass',team:0,player:7,receiver:9,text:'#7 of Red completes a pass to #9.'},
  {id:'event-2',elapsed:10,type:'shot',team:0,player:9,text:'#9 of Red takes a shot.'},
  {id:'event-3',elapsed:11,type:'goal',team:0,player:9,text:'GOAL! #9 of Red scores. Red lead Blue 1-0.'},
]};
const response=await fetch(base+'/api/story',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({match,mode:'review',eventId:'event-3',audience:'broadcaster',language:'en',question:'Explain the recorded buildup to this goal.'})});
const result=await response.json();
assert(response.ok,JSON.stringify(result));
assert.notEqual(result.provider,'event_summary','The model did not produce a valid supported answer; check Ollama or the framework.');
assert(result.claims.length>0);assert.equal(result.validation,'references-and-numbers-checked');
console.log(JSON.stringify({provider:result.provider,runtime:result.runtime,latencyMs:result.latencyMs,headline:result.headline,claims:result.claims,notes:result.notes},null,2));
