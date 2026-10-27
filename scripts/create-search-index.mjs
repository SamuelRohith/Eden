import { config } from '../server/config.mjs';
import { createProviders } from '../server/providers.mjs';
// Explicit setup action: creates an index inside YOUR EXISTING Search service.
// It never creates, upgrades, or provisions an Azure service or subscription.
try {await createProviders(config).createSearchIndex();console.log('Eden Search index is ready.');}
catch{console.error('Index setup failed. Check cloud access, endpoint, index name, admin key and service quota.');process.exitCode=1;}
