import assert from 'node:assert/strict';
import {config} from '../server/config.mjs';
import {createProviders} from '../server/providers.mjs';
import {createAPI} from '../server/api.mjs';
const c={...config,cloud:false};
const providers=createProviders(c),api=createAPI(c,providers);
const events=[
 {type:'dribble',elapsed:3,team:0,player:9,text:'#9 of Northgate FC carries the ball forward.'},
 {type:'goal',elapsed:12,team:0,player:9,text:'#9 of Northgate FC scored with a low drive.'},
 {type:'dribble',elapsed:25,team:0,player:7,text:'#7 of Northgate FC carries the ball forward.'},
 {type:'dribble',elapsed:50,team:1,player:10,text:'#10 of Harbor United carries the ball forward.'},
 {type:'goal',elapsed:78,team:1,player:10,text:'#10 of Harbor United scored.'},
 {type:'fulltime',elapsed:90,text:'Full time.'},
].map((e,i)=>({...e,id:`event-${i+1}`}));
const match={id:'language-smoke-'+crypto.randomUUID(),elapsed:90,finished:true,teams:[{name:'Northgate FC'},{name:'Harbor United'}],events};
try {
 for(const request of [
  {mode:'question',language:'es',audience:'fan',question:'¿Qué equipo hizo más regates?'},
  {mode:'question',language:'ar',audience:'fan',question:'أي فريق قام بمراوغات أكثر؟'},
  {mode:'recap',language:'es',audience:'broadcaster'},
 ]) {
  const r=await api.handle('/api/story','POST',{match,...request});
  console.log(JSON.stringify({requested:request.language,status:r.status,language:r.json.language,audience:r.json.audience,provider:r.json.provider,translationProvider:r.json.translationProvider,script:r.json.script,interpretedQuestion:r.json.interpretedQuestion,notes:r.json.notes,error:r.json.error}));
  assert.equal(r.status,200);assert.equal(r.json.language,request.language,'Model translation fell back to English');assert(r.json.englishScript);
 }
}finally{api.close();}
