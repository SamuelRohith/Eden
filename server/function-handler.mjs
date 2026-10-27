// Host-independent handler: cloud authentication is supplied by Azure Functions.
export function createFunctionHandler(api) {
 return async request=>{
    let body={};
    try {
      if(request.method==='POST') {
        const text=await request.text();
        if(Buffer.byteLength(text)>1500000)return {status:413,jsonBody:{error:'Request too large'}};
        body=JSON.parse(text);
      }
      // A full match snapshot accompanies every story request because Azure can
      // recycle or scale its workers. This demo does not claim durable cloud storage.
      const result=await api.handle('/api/'+(request.params.path||''),request.method,body);
      return {status:result.status,jsonBody:result.json};
    }catch{return {status:400,jsonBody:{error:'Invalid request'}};}
  };
}
