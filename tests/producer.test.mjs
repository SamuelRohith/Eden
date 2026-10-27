import test from 'node:test';import assert from 'node:assert/strict';import {approvedCaption} from '../dist/producer.js';
test('Only producer-approved drafts export with provenance and the actual output language',()=>{
 const result={matchId:'m',asOf:12,language:'es',headline:'Gol',script:'Un gol.',audience:'broadcaster',provider:'ollama',validation:'references-and-numbers-checked',claims:[{eventIds:['event-1']},{eventIds:['event-1','stats']}]};
 for(const status of ['draft','rejected'])assert.throws(()=>approvedCaption(result,{status}));
 const caption=approvedCaption(result,{status:'approved',reviewedAt:'2026-10-28T00:00:00Z'});assert.equal(caption.language,'es');assert.equal(caption.synthetic,true);assert.deepEqual(caption.sourceEventIds,['event-1','stats']);assert.equal(caption.text,'Un gol.');
});
