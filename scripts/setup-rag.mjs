import { config } from '../server/config.mjs';
import { SemanticIndex } from '../server/semantic.mjs';

// Explicit first-run download. The app itself uses cached model files only.
const index=new SemanticIndex(config,{download:true,diagnostics:true});
try {
  const result=await index.ready();
  console.log(JSON.stringify({ready:true,model:result.model,dimensions:result.dimensions,metric:result.metric,device:result.device}));
} catch(error) {
  console.error(error.message);process.exitCode=1;
} finally {index.close();}
