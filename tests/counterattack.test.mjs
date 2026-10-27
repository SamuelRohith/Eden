import test from 'node:test';
import assert from 'node:assert/strict';
import { MatchSimulator } from '../dist/simulator.js';
import { eventPresentation } from '../dist/event-presentation.js';

const make=()=>{
  const sim=new MatchSimulator({seed:42,teams:[{name:'Red',formation:'4-3-3'},{name:'Blue',formation:'4-4-2'}]});
  sim.start();sim.elapsed=10;sim.motion=null;sim.flight=null;sim.setPiece=null;return sim;
};
function tackle(origin) {
  const sim=make(),carrier=sim.active(0).find(p=>p.number===9),defender=sim.active(1).find(p=>p.number===4);
  Object.assign(carrier,{x:50,y:50});Object.assign(defender,{x:51,y:50});
  sim.possessor=carrier;sim.possession=0;sim.ball={x:50,y:50,z:0};sim.lastSetPiece=origin;
  sim.motion={kind:'challenge',carrier,defender,foul:false,elapsed:0};sim.stepMotion(.04);
  return sim;
}

test('An ordinary contact tackle stays a tackle, with no counter event or scoring bonus',()=>{
  const sim=tackle(null),event=sim.events.find(e=>e.type==='tackle');
  assert(event);assert.equal(sim.possession,1);assert(!sim.events.some(e=>e.type==='counterattack'));
  assert(!/counterattack/i.test(event.text));assert.equal(eventPresentation(event).label,'! TACKLE');
  assert.equal(sim.counterBonus(1),0);assert.equal(sim.paused,false);
});

test('Winning a live free kick or corner starts a single explicit counter after the tackle',()=>{
  for(const kind of ['freekick','corner']) {
    const sim=tackle({team:0,kind,until:20});
    const tackleIndex=sim.events.findIndex(e=>e.type==='tackle'),counterIndex=sim.events.findIndex(e=>e.type==='counterattack');
    assert(counterIndex>tackleIndex,'The tackle marker must not overwrite the counter marker');
    const counter=sim.events[counterIndex];assert.equal(counter.team,1);assert.equal(counter.source,kind);assert.equal(counter.recovery,'tackle');
    assert.equal(counter.stop,false);assert.equal(sim.counterBonus(1),.06);assert(sim.phase>=.58);
    assert(sim.nextAction<=sim.elapsed+.22);assert.equal(sim.lastSetPiece,null);
    assert.equal(eventPresentation(counter).label,'! COUNTERATTACK ↗');
    assert.equal(sim.beginCounter(1),false);assert.equal(sim.events.filter(e=>e.type==='counterattack').length,1);
    sim.elapsed=sim.counterattack.until;assert.equal(sim.counterBonus(1),0);
  }
});

test('Expired, same-side and other restart origins cannot turn a tackle into a counter',()=>{
  for(const origin of [{team:0,kind:'corner',until:9},{team:1,kind:'corner',until:20},
    ...['throwin','goalkick','penalty'].map(kind=>({team:0,kind,until:20}))]) {
    const sim=tackle(origin);assert(!sim.events.some(e=>e.type==='counterattack'),JSON.stringify(origin));assert.equal(sim.counterBonus(1),0);
  }
});

test('Actual free-kick and corner deliveries can be intercepted into the opposite direction',()=>{
  for(const kind of ['freekick','corner']) {
    const sim=make();
    if(kind==='corner')sim.awardCorner(0,{x:100,y:0});
    else sim.restart('freekick',0,55,45,'Free kick to Red.');
    sim.resume();let steps=0;
    while(sim.setPiece&&steps++<600)sim.advance(.04);
    assert.equal(sim.lastSetPiece?.kind,kind);assert.equal(sim.flight?.type,'pass');
    sim.flight.intercepted=true;sim.flight.target=sim.active(1).find(p=>p.number===4);
    while(!sim.events.some(e=>e.type==='counterattack')&&steps++<1000)sim.advance(.04);
    const counter=sim.events.find(e=>e.type==='counterattack');assert(counter);assert.equal(counter.team,1);assert.equal(counter.recovery,'interception');
    assert.equal(sim.possessor.team,1);assert.match(counter.text,/opposite goal/);
  }
});

test('A new dead ball or loss of possession ends the counter advantage',()=>{
  const sim=tackle({team:0,kind:'corner',until:20});
  sim.possession=0;sim.possessor=sim.active(0).find(p=>p.number===9);sim.beginCounter(0);
  assert.equal(sim.counterattack,null);assert.equal(sim.counterBonus(1),0);
  sim.counterattack={team:0,source:'freekick',until:30};
  sim.prepareSetPiece('goalkick',0,sim.active(0).find(p=>p.keeper),{x:7,y:50});
  assert.equal(sim.counterattack,null);assert.equal(sim.lastSetPiece,null);
});

test('Requested restart/goal cues replace the large box with the one-second animation',()=>{
  for(const type of ['corner','freekick','goalkick','goal','throwin']) {
    const cue=eventPresentation({type,stop:true});assert(cue.label);assert(cue.lightweight);assert.equal(cue.markerDuration,1000);assert.equal(cue.autoplayDelay,1000);
  }
  assert.equal(eventPresentation({type:'foul'},'freekick').lightweight,true);
  assert.equal(eventPresentation({type:'foul'},'penalty').lightweight,false);
});
