import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../server/config.mjs';
import { createProviders } from '../server/providers.mjs';
import { createBackendRouter } from '../server/backend.mjs';
import { createFunctionHandler } from '../server/function-handler.mjs';
import { createAPI } from '../server/api.mjs';
import { Telemetry } from '../server/telemetry.mjs';

// Fake URLs, fake keys and intercepted requests only. This suite needs no account.
const c=(overrides={})=>({...config,semantic:{...config.semantic,enabled:false},cloud:true,fallback:true,ai:'azure_openai',retrieval:'azure_search',speech:'azure_speech',azure:{...config.azure,endpoint:'https://example.openai.azure.com',deployment:'demo',key:'TEST',search:'https://example.search.windows.net',index:'eden-events',searchKey:'TEST',speechRegion:'eastus',speechKey:'TEST',insights:''},...overrides});
const response=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});

test('Azure Search index setup creates the searchable text and filterable match/time schema',async()=>{
 const p=createProviders(c(),async(url,init)=>{
  assert.equal(init.method,'PUT');assert.match(url,/indexes\/eden-events\?api-version=2024-07-01$/);assert.equal(init.headers['api-key'],'TEST');
  const b=JSON.parse(init.body),fields=new Map(b.fields.map(f=>[f.name,f]));
  assert(fields.get('id').key);assert(fields.get('text').searchable);assert(fields.get('matchId').filterable);assert(fields.get('elapsed').filterable);
  return response(b);
 });assert.equal((await p.createSearchIndex()).name,'eden-events');
});

test('Microsoft project URLs are rejected rather than sent as model resource URLs',async()=>{
 let calls=0;const bad=c({fallback:false});bad.azure={...bad.azure,endpoint:'https://example.services.ai.azure.com/api/projects/demo'};
 await assert.rejects(()=>createProviders(bad,async()=>{calls++;throw Error('must not call');}).generate('system','JSON prompt'),/resource endpoint/);assert.equal(calls,0);
});

test('Speech refuses an empty successful response and strict checks cannot use browser backup',async()=>{
 const empty=async()=>new Response(new Uint8Array());
 assert.equal((await createProviders(c(),empty).speech('Hello','en')).provider,'browser');
 await assert.rejects(()=>createProviders(c({fallback:false}),empty).speech('Hello','en'),/empty audio/);
});

test('Functions proxy sends the complete payload and keeps the authentication key in its server request',async()=>{
 const payload={match:{id:'new-worker',events:[{id:'event-1'}]},mode:'recap'};let local=0;
 const route=createBackendRouter(c(),{handle:()=>{local++;}},async(url,init)=>{
  assert.equal(url,'https://example.azurewebsites.net/api/eden/story');assert.equal(init.headers['x-functions-key'],'TEST-FUNCTION-KEY');
  assert.deepEqual(JSON.parse(init.body),payload);return response({provider:'azure_openai',script:'A script',notes:[]});
 },{EDEN_FUNCTIONS_URL:'https://example.azurewebsites.net/api/eden/',AZURE_FUNCTIONS_KEY:'TEST-FUNCTION-KEY'});
 const r=await route('/api/story','POST',payload);assert.equal(r.json.backend,'azure_functions');assert(!JSON.stringify(r).includes('TEST-FUNCTION-KEY'));assert.equal(local,0);
});

test('Functions failure recovers locally, while strict verification returns an error',async()=>{
 const api={handle:async()=>({status:200,json:{provider:'match_analysis',notes:[]}})};
 const failed=async()=>new Response('',{status:503});const env={EDEN_FUNCTIONS_URL:'https://example.azurewebsites.net/api/eden'};
 const recovered=await createBackendRouter(c(),api,failed,env)('/api/story','POST',{});
 assert.match(recovered.json.notes[0],/Functions unavailable/);
 const strict=await createBackendRouter(c({fallback:false}),api,failed,env)('/api/story','POST',{});assert.equal(strict.status,502);
});

test('Cloud gate blocks Functions forwarding and local health never forwards to Azure',async()=>{
 let requests=0,local=0;const fetcher=async()=>{requests++;throw Error('unexpected request');};
 const api={handle:async()=>{local++;return {status:200,json:{ok:true}};}};const env={EDEN_FUNCTIONS_URL:'https://example.azurewebsites.net/api/eden'};
 await createBackendRouter(c({cloud:false}),api,fetcher,env)('/api/story','POST',{});
 await createBackendRouter(c(),api,fetcher,env)('/api/health','GET',{});
 assert.equal(requests,0);assert.equal(local,2);
});

test('Functions handler rehydrates a new worker from the story snapshot and returns broadcaster analysis',async()=>{
 const api=createAPI(c({cloud:false}),{retrieve:async()=>({provider:'local',ids:[],notes:[]}),generate:async()=>{throw Error('known counts need no model');}});
 const handle=createFunctionHandler(api);const match={id:'fresh-function-worker',elapsed:2,teams:[{name:'Red'},{name:'Blue'}],events:[{id:'event-1',type:'dribble',elapsed:1,team:0,player:7,text:'#7 of Red carries the ball.'}]};
 const r=await handle({method:'POST',params:{path:'story'},text:async()=>JSON.stringify({match,mode:'question',question:'Which team dribbled more?'})});
 assert.equal(r.status,200);assert.equal(r.jsonBody.audience,'broadcaster');assert.match(r.jsonBody.script,/Red: 1; Blue: 0/);
 const oldAudience=await api.handle('/api/story','POST',{match,mode:'question',audience:'invalid'});assert.equal(oldAudience.status,400);
});

test('Functions handler rejects malformed and oversized bodies before reaching the API',async()=>{
 let calls=0;const handler=createFunctionHandler({handle:()=>{calls++;}});
 assert.equal((await handler({method:'POST',params:{path:'story'},text:async()=>'{'})).status,400);
 assert.equal((await handler({method:'POST',params:{path:'story'},text:async()=>'x'.repeat(1500001)})).status,413);assert.equal(calls,0);
});

test('Application Insights creates aggregate metrics without exporting prompts or replies',async()=>{
 const calls=[];let options;const t=new Telemetry();
 await t.initialize(c({azure:{...c().azure,insights:'TEST-CONNECTION'}}),async()=>({useAzureMonitor:o=>{options=o;},metrics:{getMeter:()=>({createCounter:name=>({add:(n,attributes)=>calls.push({name,n,attributes})}),createHistogram:name=>({record:(n,attributes)=>calls.push({name,n,attributes})})})}}));
 assert.equal(options.azureMonitorExporterOptions.connectionString,'TEST-CONNECTION');assert.equal(options.instrumentationOptions.http.enabled,false);
 t.record({provider:'azure_openai',script:'PRIVATE STORY',question:'PRIVATE QUESTION'},125);
 assert.equal(t.snapshot().exporter,'azure_application_insights');assert.equal(t.snapshot().requests,1);assert.equal(calls.length,2);
 assert(!JSON.stringify(calls).includes('PRIVATE'));assert.deepEqual(calls[0].attributes,{provider:'azure_openai'});
});

test('Monitoring remains local when disabled or when its SDK fails',async()=>{
 let loads=0;const failed=async()=>{loads++;throw Error('SDK unavailable');};const t=new Telemetry();
 await t.initialize(c({cloud:false}),failed);assert.equal(loads,0);
 await t.initialize(c({azure:{...c().azure,insights:'TEST'}}),failed);assert.match(t.snapshot().exporter,/unavailable/);
 t.record(null,50);assert.equal(t.snapshot().failures,1);
});

test('Installed Microsoft hosting and monitoring SDK entry points load locally',async()=>{
 const [{app},{useAzureMonitor},{metrics}]=await Promise.all([import('@azure/functions'),import('@azure/monitor-opentelemetry'),import('@opentelemetry/api')]);
 assert.equal(typeof app.http,'function');assert.equal(typeof useAzureMonitor,'function');assert.equal(typeof metrics.getMeter,'function');
});
