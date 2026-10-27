import assert from 'node:assert/strict';
import { config, configured } from '../server/config.mjs';
import { createProviders } from '../server/providers.mjs';
import { MatchMemory, makeContext } from '../server/memory.mjs';
import { tellStory } from '../server/story.mjs';

// This opt-in check makes REAL calls to configured Azure resources. No silent
// backup is allowed: a local answer must never pass as verified Microsoft AI.
if(!configured('ai',config)) {
  console.error('Add AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT, AZURE_OPENAI_API_KEY to .env and set EDEN_ALLOW_CLOUD=true first.');
  process.exit(1);
}
const strict={...config,ai:'azure_openai',retrieval:'azure_search',speech:'azure_speech',fallback:false};
const p=createProviders(strict);
const match=new MatchMemory().sync({id:'verify-'+crypto.randomUUID(),elapsed:2,teams:[{name:'Red'},{name:'Blue'}],events:[
  {id:'event-1',elapsed:1,type:'pass',team:0,player:7,receiver:9,text:'#7 of Red passes to #9.'},
]});
try {
  if(configured('search',config)) {
    const result=await p.retrieve(match,'pass',2);assert.equal(result.provider,'azure_search');console.log('Azure AI Search: PASS');
  }else console.log('Azure AI Search: skipped (not configured).');
  const story=await tellStory(p,makeContext(match,{mode:'review',eventId:'event-1',audience:'broadcaster'}),false);
  assert.equal(story.provider,'azure_openai');console.log('Microsoft model with evidence checks: PASS');
  if(configured('speech',config)) {
    const audio=await p.speech('Eden is ready.','en');assert.equal(audio.provider,'azure_speech');assert(audio.audio);console.log('Azure Speech: PASS');
  }else console.log('Azure Speech: skipped (not configured).');
  console.log('Functions hosting and Application Insights ingestion require separate deployment/portal verification.');
}catch{
  console.error('Microsoft verification FAILED. Check endpoint types, keys, deployment capabilities, Search index setup and resource quotas. Backups were disabled for this check.');
  process.exitCode=1;
}

finally {p.close();}
