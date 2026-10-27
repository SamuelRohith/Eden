// Local producer approval creates an export, not an external broadcast action.
export function approvedCaption(result,decision) {
  if(decision.status!=='approved')throw new Error('Review and approve this draft before exporting it.');
  return {schemaVersion:1,matchId:result.matchId,matchMinute:result.asOf,language:result.language||'en',
    headline:result.headline,text:result.script||result.spokenText,audience:result.audience,
    sourceEventIds:[...new Set(result.claims.flatMap(c=>c.eventIds))],
    provider:result.provider,validation:result.validation,
    review:{status:'approved',reviewedAt:decision.reviewedAt},
    synthetic:true};
}
