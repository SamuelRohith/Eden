// Optional Azure host for the same API. No deployment happens by running Eden locally.
// Use function-level authentication and keep its key in the LOCAL Node proxy's .env.
import { app } from '@azure/functions';
import { createAPI } from './server/api.mjs';
import { createFunctionHandler } from './server/function-handler.mjs';
const api=createAPI();
app.http('eden',{
  route:'eden/{*path}',methods:['GET','POST'],authLevel:'function',
  handler:createFunctionHandler(api),
});
