import assert from 'node:assert/strict';
import {config} from '../server/config.mjs';
import {createProviders} from '../server/providers.mjs';
import {tellStory} from '../server/story.mjs';
import {MatchMemory,makeContext} from '../server/memory.mjs';
// Local-only narrative check: no web server or Microsoft resource is started.
const events=[
 {type:'dribble',elapsed:5,team:0,player:9,text:'#9 of Red carries the ball forward.'},
 {type:'goal',elapsed:12,team:0,player:9,text:'Goal! #9 of Red finds the net with a low drive.'},
 {type:'dribble',elapsed:25,team:0,player:7,text:'#7 of Red carries the ball forward.'},
 {type:'dribble',elapsed:35,team:0,player:9,text:'#9 of Red carries the ball forward.'},
 {type:'foul',elapsed:49,team:0,player:7,offender:4,offenderTeam:1,text:'Foul! #4 of Blue trips #7 of Red.'},
 {type:'dribble',elapsed:69,team:1,player:10,text:'#10 of Blue carries the ball forward.'},
 {type:'goal',elapsed:78,team:1,player:10,text:'Goal! #10 of Blue finds the net with a low drive.'},
 {type:'fulltime',elapsed:90,text:'Full time.'},
].map((e,i)=>({...e,id:`event-${i+1}`}));
const match=new MatchMemory().sync({id:'local-narrative-check',elapsed:90,finished:true,scenario:{league:'Eden Premier Division',stakes:'title'},teams:[{name:'Red',formation:'4-3-3'},{name:'Blue',formation:'4-4-2'}],events});
const providers=createProviders({...config,cloud:false});
for(const request of [{mode:'question',question:'Which team dribbled more?',audience:'broadcaster'},{mode:'recap',audience:'broadcaster'},{mode:'commentary',audience:'broadcaster'}]) {
 const start=Date.now(),result=await tellStory(providers,makeContext(match,request));
 assert(result.script);
 if(request.mode==='question')assert.match(result.script,/Red: 3; Blue: 1/);
 else {assert.match(result.script,/#9/);assert.match(result.script,/#10/);}
 console.log(JSON.stringify({mode:request.mode,audience:request.audience,provider:result.provider,seconds:(Date.now()-start)/1000,script:result.script,notes:result.notes}));
}
