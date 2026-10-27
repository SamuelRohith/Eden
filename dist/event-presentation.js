// Match events decide what happened. The renderer never infers a counterattack
// from a generic tackle: only the simulator's explicit counterattack event does.
const labels={tackle:'! TACKLE',counterattack:'! COUNTERATTACK ↗',throwin:'! THROW-IN ↗',
  corner:'! CORNER ↗',freekick:'! FREE KICK ↗',goalkick:'! GOAL KICK ↗',goal:'! GOAL!'};
const lightweight=new Set(['throwin','corner','freekick','goalkick','goal']);
export function eventPresentation(event,restartKind=null) {
  // A foul and its free kick are one stoppage, not two competing presentations.
  const simple=lightweight.has(event.type)||(event.type==='foul'&&restartKind==='freekick');
  return {label:labels[event.type]||null,lightweight:simple,markerDuration:1000,autoplayDelay:simple?1000:2000};
}
