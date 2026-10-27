import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SemanticIndex } from './semantic.mjs';
import { configured } from './config.mjs';

const worker = fileURLToPath(new URL('../agents/story_agent.py', import.meta.url));
export const storySchema = { type:'object', properties:{ headline:{type:'string'}, claims:{type:'array',items:{type:'object',
  properties:{text:{type:'string'},eventIds:{type:'array',items:{type:'string'}}},required:['text','eventIds'],additionalProperties:false} } },
  required:['headline','claims'], additionalProperties:false };

export function frameworkGenerate(config, system, prompt) {
  return new Promise((resolve,reject)=>{
    const child=spawn(config.python,[worker],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONIOENCODING:'utf-8'}});
    let out='',err='',settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
    const timer=setTimeout(()=>{child.kill();finish(new Error('Agent Framework timed out'));},config.timeout);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',b=>{out+=b;if(out.length>100000){child.kill();finish(new Error('Agent response too large'));}});
    child.stderr.on('data',b=>{err+=b.toString();});
    child.on('error',()=>finish(new Error('Agent Framework Python environment is unavailable')));
    child.stdin.on('error',()=>{});
    child.on('close',code=>{
      if(code!==0)return finish(new Error('Agent Framework worker failed; check the Python environment'));
      try{const data=JSON.parse(out);if(data.error)throw new Error();finish(null,data.text);}catch{finish(new Error('Agent Framework returned an invalid response'));}
    });
    child.stdin.end(JSON.stringify({system,prompt,host:config.ollama,model:config.model,context:config.context,maxTokens:config.output,schema:storySchema}));
  });
}

export function createProviders(config, fetcher=fetch, runFramework=frameworkGenerate,semantic=new SemanticIndex(config)) {
  async function request(url, body, headers={}, timeout=config.cloudTimeout, binary=false, method='POST') {
    const response=await fetcher(url,{method,headers:{'Content-Type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
    // Never return cloud response bodies: they can contain resource details or prompts.
    if(!response.ok)throw new Error(`Upstream HTTP ${response.status}`);
    return binary?Buffer.from(await response.arrayBuffer()):response.json();
  }
  const azureURL=path=>{
    const u=new URL(config.azure.endpoint);
    if(u.protocol!=='https:')throw new Error('Azure endpoint must use HTTPS');
    if(u.pathname!=='/'&&!/^\/openai\/v1\/?$/.test(u.pathname))throw new Error('Use an Azure model resource endpoint, not a project URL');
    return `${u.origin}/openai/v1/${path}`;
  };
  async function directOllama(system,prompt) {
    const result=await request(`${config.ollama.replace(/\/$/,'')}/api/chat`,{model:config.model,stream:false,think:false,format:storySchema,
      messages:[{role:'system',content:system},{role:'user',content:prompt}],options:{num_ctx:config.context,num_predict:config.output,temperature:0}}, {},config.timeout);
    if(!result.message?.content)throw new Error('Ollama returned no text');
    return result.message.content;
  }
  async function localGenerate(system,prompt) {
    if(config.runtime==='framework') {
      try{return {raw:await runFramework(config,system,prompt),provider:'ollama',runtime:'Microsoft Agent Framework',notes:[]};}
      catch(error) {
        if(!config.fallback)throw error;
        // BACKUP FOR TESTING PURPOSES AND SMOOTH EXECUTION:
        // Use the same Qwen model directly if the optional framework worker fails.
        return {raw:await directOllama(system,prompt),provider:'ollama',runtime:'Direct Ollama backup',notes:['Agent Framework unavailable; used direct Ollama.']};
      }
    }
    return {raw:await directOllama(system,prompt),provider:'ollama',runtime:'Direct Ollama',notes:[]};
  }
  async function generate(system,prompt,forceLocal=false) {
    const useAzure=!forceLocal&&config.ai!=='ollama'&&configured('ai',config);
    if(useAzure) {
      try {
        const data=await request(azureURL('chat/completions'),{model:config.azure.deployment,messages:[{role:'system',content:system},{role:'user',content:prompt}],
          response_format:{type:'json_object'},max_completion_tokens:config.output},{'api-key':config.azure.key});
        if(!data.choices?.[0]?.message?.content)throw new Error('Azure model returned no text');
        return {raw:data.choices[0].message.content,provider:'azure_openai',runtime:'Microsoft Foundry / Azure OpenAI',notes:[]};
      } catch(error) {
        if(!config.fallback)throw error;
        // BACKUP FOR TESTING PURPOSES AND SMOOTH EXECUTION:
        // Microsoft model failure falls back to the configured local Qwen model, never another paid API.
        const result=await localGenerate(system,prompt);
        result.notes.unshift('Microsoft model request failed; used local Qwen.');return result;
      }
    }
    if(config.ai==='azure_openai'&&!config.fallback&&!forceLocal)throw new Error('Azure model is not configured or cloud access is disabled');
    const result=await localGenerate(system,prompt);
    if(config.ai!=='ollama'&&!forceLocal)result.notes.unshift(config.cloud?'Microsoft model is not configured; used local Qwen.':'Cloud access disabled; used local Qwen.');
    return result;
  }
  const searchURL=path=>{
    const u=new URL(config.azure.search);if(u.protocol!=='https:')throw new Error('Search endpoint must use HTTPS');
    return `${u.origin}/indexes/${encodeURIComponent(config.azure.index)}${path}?api-version=${encodeURIComponent(config.azure.searchVersion)}`;
  };
  const searchHeaders={'api-key':config.azure.searchKey};
  async function createSearchIndex() {
    if(!configured('search',config))throw new Error('Enable cloud access and configure Azure AI Search first');
    return request(searchURL(''),{name:config.azure.index,fields:[
      {name:'id',type:'Edm.String',key:true},{name:'matchId',type:'Edm.String',filterable:true},
      {name:'eventId',type:'Edm.String',filterable:true},{name:'elapsed',type:'Edm.Double',filterable:true,sortable:true},
      {name:'text',type:'Edm.String',searchable:true},
    ]},searchHeaders,config.cloudTimeout,false,'PUT');
  }
  async function localRetrieval(match,query,cutoff,request) {
    if(config.retrieval!=='local'&&config.semantic?.enabled) {
      try{return await semantic.retrieve(match,query,cutoff,request);}
      catch(error) {
        if(!config.fallback)throw error;
        // BACKUP FOR TESTING PURPOSES AND SMOOTH EXECUTION:
        // Keyword/event retrieval preserves the source history if BGE/Chroma fails.
        return {provider:'local',ids:[],notes:['BGE/Chroma unavailable; used local keyword and structured-event retrieval. Run npm run setup:rag.']};
      }
    }
    if(config.retrieval==='chroma'&&!config.fallback)throw new Error('BGE/Chroma is disabled');
    return {provider:'local',ids:[],notes:config.retrieval==='chroma'?['BGE/Chroma is disabled; used local keyword retrieval.']:[]};
  }
  async function retrieve(match,query,cutoff,options={}) {
    if(['local','chroma'].includes(config.retrieval)||!configured('search',config)) {
      if(config.retrieval==='azure_search'&&!config.fallback)throw new Error('Azure AI Search is not configured or cloud access is disabled');
      const result=await localRetrieval(match,query,cutoff,options);
      if(config.retrieval==='azure_search')result.notes.unshift('Azure Search unavailable; used local retrieval.');
      return result;
    }
    try {
      const events=[...match.events.values()].filter(e=>e.elapsed<=cutoff);
      for(let start=0;start<events.length;start+=500) {
        const upload=await request(searchURL('/docs/index'),{value:events.slice(start,start+500).map(e=>({'@search.action':'mergeOrUpload',
          id:`${match.id}_${e.id}`,matchId:match.id,eventId:e.id,elapsed:e.elapsed,text:e.text}))},searchHeaders);
        if(upload.value?.some(r=>!r.status))throw new Error('Some search documents were not indexed');
      }
      const result=await request(searchURL('/docs/search'),{search:query||'*',queryType:'simple',searchMode:'any',
        filter:`matchId eq '${match.id}' and elapsed le ${cutoff}`,select:'eventId',top:12},searchHeaders);
      return {provider:'azure_search',ids:(result.value||[]).map(e=>e.eventId),notes:[]};
    }catch(error){
      if(!config.fallback)throw error;
      // BACKUP FOR TESTING PURPOSES AND SMOOTH EXECUTION:
      // Local event retrieval keeps the same match/time boundaries if Azure Search fails.
      const result=await localRetrieval(match,query,cutoff,options);
      result.notes.unshift('Azure Search failed; used local retrieval.');return result;
    }
  }
  const xml=text=>text.replace(/[<>&"']/g,ch=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[ch]));
  async function speech(text,language='en') {
    if(config.speech==='browser'||!configured('speech',config)) {
      if(config.speech==='azure_speech'&&!config.fallback)throw new Error('Azure Speech is not configured or cloud access is disabled');
      return {provider:'browser',reason:'Using available device voices.'};
    }
    try {
      if(!/^[a-z0-9-]+$/.test(config.azure.speechRegion))throw new Error('Invalid Speech region');
      const locale={en:'en-US',ar:'ar-SA',es:'es-ES'}[language]||'en-US';
      const voice=config.azure.voice||{en:'en-US-JennyNeural',ar:'ar-SA-ZariyahNeural',es:'es-ES-ElviraNeural'}[language]||'en-US-JennyNeural';
      const audio=await request(`https://${config.azure.speechRegion}.tts.speech.microsoft.com/cognitiveservices/v1`,
        `<speak version="1.0" xml:lang="${locale}"><voice name="${xml(voice)}">${xml(text)}</voice></speak>`,
        {'Content-Type':'application/ssml+xml','Ocp-Apim-Subscription-Key':config.azure.speechKey,'X-Microsoft-OutputFormat':'audio-16khz-32kbitrate-mono-mp3'},config.cloudTimeout,true);
      if(!audio.length)throw new Error('Azure Speech returned empty audio');
      return {provider:'azure_speech',audio:audio.toString('base64'),mime:'audio/mpeg'};
    }catch(error){
      if(!config.fallback)throw error;
      // BACKUP FOR TESTING PURPOSES AND SMOOTH EXECUTION:
      // Browser speech is requested explicitly by the UI after an Azure Speech failure.
      return {provider:'browser',reason:'Azure Speech failed; using available device voices.'};
    }
  }
  async function health() {
    try {const r=await fetcher(`${config.ollama.replace(/\/$/,'')}/api/tags`,{signal:AbortSignal.timeout(3000)});
      if(!r.ok)throw new Error();const data=await r.json();return {reachable:true,modelInstalled:(data.models||[]).some(m=>m.name===config.model||m.model===config.model)};
    }catch{return {reachable:false,modelInstalled:false};}
  }
  return {generate,retrieve,speech,health,createSearchIndex,
    index:match=>config.semantic?.enabled&&config.retrieval!=='local'?semantic.index(match):Promise.resolve(),
    retrievalHealth:()=>semantic.status(),close:()=>semantic.close()};
}
