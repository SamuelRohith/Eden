import { config, publicConfig } from './config.mjs';
import { MatchMemory, makeContext } from './memory.mjs';
import { createProviders } from './providers.mjs';
import { tellStory } from './story.mjs';
import { retrievalQuery } from './passages.mjs';
import { englishQuestion,localizeStory,languages } from './language.mjs';
import { Telemetry } from './telemetry.mjs';

export function createAPI(c=config,providers=createProviders(c)) {
  const memory=new MatchMemory(),telemetry=new Telemetry();
  let busy=false;
  const ready=telemetry.initialize(c);
  const validOptions=input=>{
    if(!['question','commentary','review','recap'].includes(input.mode||'question'))throw Object.assign(new Error('Invalid story mode'),{status:400});
    if(!['fan','broadcaster'].includes(input.audience||'broadcaster')||!languages.includes(input.language||'en'))throw Object.assign(new Error('Invalid audience or language'),{status:400});
  };
  async function handle(path,method,body={}) {
    await ready;
    try {
      if(method==='GET'&&path==='/api/health')return {status:200,json:{ok:true,service:'eden',config:publicConfig(),ollama:await providers.health(),metrics:telemetry.snapshot(),retrieval:providers.retrievalHealth?.()||null}};
      if(method==='GET'&&path==='/api/metrics')return {status:200,json:telemetry.snapshot()};
      if(method==='POST'&&path==='/api/matches/sync') {
        const m=memory.sync(body);providers.index?.(m)?.catch(()=>{});return {status:200,json:{id:m.id,eventCount:m.events.size}};
      }
      if(method==='POST'&&path==='/api/story') {
        validOptions(body);
        if(busy)return {status:429,json:{error:'Eden is finishing another story. Try again shortly.'}};
        busy=true;const start=Date.now();
        try {
          const m=body.match?memory.sync(body.match):memory.get(body.matchId);
          const cutoff=body.eventId?m.events.get(body.eventId)?.elapsed:m.elapsed;
          if(cutoff==null)throw Object.assign(new Error('Unknown event'),{status:404});
          const language=body.language||'en';
          const translated=await englishQuestion(providers,String(body.question||'').slice(0,500),language,m.teams.map(t=>t.name));
          const prepared={...body,question:translated.question,language:'en'};
          let context=makeContext(m,prepared);
          let retrieval;
          if(context.answer) {
            providers.index?.(m)?.catch(()=>{});
            retrieval={provider:'calculated',ids:[],notes:['This answer uses exact full-history counts; semantic similarity is not used to count events.']};
          }else {
            retrieval=await providers.retrieve(m,retrievalQuery(m,prepared),cutoff,prepared);
            context=makeContext(m,prepared,retrieval.ids);
          }
          const english=await tellStory(providers,context,c.fallback);
          const story=await localizeStory(providers,english,context,language,c.fallback);
          const result={...story,matchId:m.id,notes:[...translated.notes,...retrieval.notes,...story.notes],retrieval:retrieval.provider,retrievalMatches:retrieval.hits||[],
            evidence:context.evidence,asOf:context.asOf,eventCount:context.eventCount,language:story.language,requestedLanguage:language,
            audience:context.audience,mode:context.mode,interpretedQuestion:language!=='en'&&body.question?prepared.question:null,latencyMs:Date.now()-start,
            validationNote:'References and numeric consistency checked. This does not establish that every tactical interpretation is correct.',
            stages:['Ingest events','Calculate question-specific facts','Retrieve buildup','Draft story','Edit spoken copy','Check references and numbers','Personalize and render']};
          telemetry.record(result,result.latencyMs);return {status:200,json:result};
        }catch(error){telemetry.record(null,Date.now()-start);throw error;}finally{busy=false;}
      }
      if(method==='POST'&&path==='/api/speech') {
        if(typeof body.text!=='string'||body.text.length<1||body.text.length>3000||!languages.includes(body.language||'en'))return {status:400,json:{error:'Invalid speech text or language'}};
        return {status:200,json:await providers.speech(body.text,body.language||'en')};
      }
      return {status:404,json:{error:'Unknown API route'}};
    }catch(error){return {status:error.status||400,json:{error:error.status?error.message:'Request failed. Check configuration and try again.'}};}
  }
  return {handle,memory,telemetry,close:()=>providers.close?.()};
}
