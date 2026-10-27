import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPassages, eventOrder, queryScope, retrievalQuery, visibleEvents } from './passages.mjs';

const worker=fileURLToPath(new URL('../agents/retrieval_worker.py',import.meta.url));
export class SemanticIndex {
  constructor(config,{download=false,diagnostics=false,spawnWorker=spawn}={}) {
    this.config=config;this.options=config.semantic;this.download=download;this.diagnostics=diagnostics;this.spawnWorker=spawnWorker;
    this.jobs=new Map();this.latest=new Map();this.pending=new Map();this.sequence=0;this.chain=Promise.resolve();
    this.state={status:this.options?.enabled?'not_started':'disabled',model:this.options?.model,dimensions:384,metric:'cosine',device:'cpu'};
  }
  status(){return {...this.state};}
  async ready() {
    if(this.closed)throw new Error('Semantic retrieval is closed');
    if(!this.options?.enabled)throw new Error('Semantic retrieval is disabled');
    if(this.initializing)return this.initializing;
    if(this.failedAt&&Date.now()-this.failedAt<30000)throw new Error('Semantic retrieval unavailable; run npm run setup:rag');
    this.state.status='loading';
    this.initializing=(async()=>{
      this.child=this.spawnWorker(this.config.python,[worker],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONIOENCODING:'utf-8',HF_HUB_DISABLE_TELEMETRY:'1'}});
      const child=this.child;let buffer='';
      child.stdout.setEncoding('utf8');child.stderr.on('data',chunk=>{if(this.diagnostics)process.stderr.write(chunk);});
      child.stdout.on('data',chunk=>{
        buffer+=chunk;
        if(buffer.length>5000000){this.fail(new Error('Embedding response too large'));return;}
        let newline;
        while((newline=buffer.indexOf('\n'))>=0) {
          const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);
          try {
            const data=JSON.parse(line),job=this.pending.get(data.id);if(!job)continue;
            clearTimeout(job.timer);this.pending.delete(data.id);
            if(data.ok)job.resolve(data.result);else job.reject(new Error(data.error));
          }catch{this.fail(new Error('Invalid embedding worker response'));}
        }
      });
      child.stdin.on('error',()=>this.fail(new Error('Embedding worker input closed')));
      child.on('error',()=>this.fail(new Error('Embedding Python environment is unavailable')));
      child.on('exit',()=>{if(this.child===child)this.fail(new Error('Embedding worker stopped; run npm run setup:rag'));});
      const result=await this.send('init',{...this.options,download:this.download});
      this.state={...this.state,...result,status:'ready'};return result;
    })().catch(error=>{this.fail(error);throw error;});
    return this.initializing;
  }
  fail(error) {
    const child=this.child;this.child=null;this.initializing=null;this.failedAt=Date.now();
    this.state.status=this.closed?'closed':'unavailable';
    this.state.error='BGE/Chroma unavailable. Run npm run setup:rag or check the retrieval settings.';
    for(const job of this.pending.values()){clearTimeout(job.timer);job.reject(error);}this.pending.clear();
    child?.kill();
  }
  send(action,payload={}) {
    return new Promise((resolve,reject)=>{
      const id=++this.sequence;
      const timer=setTimeout(()=>this.fail(new Error('Embedding worker timed out')),this.options.timeout);
      this.pending.set(id,{resolve,reject,timer});
      try{this.child.stdin.write(JSON.stringify({id,action,payload})+'\n');}catch(error){this.fail(error);}
    });
  }
  request(action,payload) {
    const job=this.chain.catch(()=>{}).then(async()=>{await this.ready();return this.send(action,payload);});
    const checked=job.catch(error=>{this.state.status='unavailable';this.state.error='BGE/Chroma unavailable; check the local retrieval setup.';throw error;});
    this.chain=checked;return checked;
  }
  index(match) {
    if(!this.options?.enabled||this.closed)return Promise.resolve();
    // Coalesce frequent snapshots: embedding an old queued version would only
    // add work. Unchanged document hashes are skipped by the persistent worker.
    this.latest.set(match.id,{matchId:match.id,documents:buildPassages(match)});
    if(this.jobs.has(match.id))return this.jobs.get(match.id);
    const job=(async()=>{
      while(this.latest.has(match.id)) {
        const payload=this.latest.get(match.id);this.latest.delete(match.id);
        const result=await this.request('sync',payload);
        this.state={...this.state,...result,status:'ready'};
      }
    })().finally(()=>this.jobs.delete(match.id));
    this.jobs.set(match.id,job);return job;
  }
  async retrieve(match,query,cutoff,request={}) {
    await this.index(match);
    const selected=match.events.get(request.eventId),lastOrder=selected?eventOrder(selected):Number.MAX_SAFE_INTEGER;
    const text=query||retrievalQuery(match,request);
    const result=await this.request('query',{query:text,scope:queryScope(match,text,cutoff,lastOrder),topK:this.options.topK});
    this.state={...this.state,...result,status:'ready'};delete this.state.hits;
    const allowed=new Set(visibleEvents(match,cutoff,lastOrder).map(e=>e.id));
    const ids=[...new Set(result.hits.flatMap(h=>h.eventIds))].filter(id=>allowed.has(id));
    return {provider:'chroma',ids,hits:result.hits,notes:['Retrieved source events with BGE 384-dimensional embeddings and Chroma cosine distance.']};
  }
  close() {
    this.closed=true;this.latest.clear();this.fail(new Error('Semantic retrieval closed'));
  }
}
