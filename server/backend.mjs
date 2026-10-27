// Optional Azure Functions proxy, shared by the server and offline contract checks.
export function createBackendRouter(config,api,fetcher=fetch,env=process.env) {
 return async function handleAPI(pathname,method,body) {
  if(config.cloud && env.EDEN_FUNCTIONS_URL && !['/api/health','/api/metrics'].includes(pathname)) {
    try {
      const base=env.EDEN_FUNCTIONS_URL.replace(/\/$/,'');
      if(!base.startsWith('https://'))throw new Error('Functions URL must use HTTPS');
      const response=await fetcher(base+pathname.replace('/api',''),{method,
        headers:{'Content-Type':'application/json',...(env.AZURE_FUNCTIONS_KEY?{'x-functions-key':env.AZURE_FUNCTIONS_KEY}:{})},
        body:method==='POST'?JSON.stringify(body):undefined,signal:AbortSignal.timeout(config.timeout)});
      if(!response.ok)throw new Error('Functions request failed');
      const json=await response.json();return {status:response.status,json:{...json,backend:'azure_functions'}};
    }catch{
      if(!config.fallback)return {status:502,json:{error:'Azure Functions backend is unavailable'}};
      // BACKUP FOR TESTING PURPOSES AND SMOOTH EXECUTION:
      // The same handlers run locally when the optional Azure Functions backend fails.
      const result=await api.handle(pathname,method,body);
      if(pathname==='/api/story'&&result.status===200)result.json.notes.unshift('Azure Functions unavailable; used the local backend.');
      return result;
    }
  }
  return api.handle(pathname,method,body);
}
}
