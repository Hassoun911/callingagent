/**
 * An incoming AI usage allowance is tied to an explicitly certified and
 * paid subscription period, never an assumed UTC calendar month.
 * This module deliberately cannot approve or renew a subscription itself.
 */
export type CertifiedAiPeriod={start:Date;end:Date};
export function validCertifiedAiPeriod(start:Date,end:Date,now:Date):boolean{
  return Number.isFinite(start?.getTime()) && Number.isFinite(end?.getTime()) &&
    Number.isFinite(now?.getTime()) && start.getTime()<=now.getTime() &&
    now.getTime()<end.getTime() && end.getTime()>start.getTime() &&
    end.getTime()-start.getTime()<=32*86400000;
}
export function secondsUntilPeriodEnd(end:Date,now:Date):number{
  if(!Number.isFinite(end?.getTime())||!Number.isFinite(now?.getTime()))return 0;
  return Math.max(0,Math.floor((end.getTime()-now.getTime())/1000));
}
export function certifiedAiCycleCutoffSeconds(reservedSeconds:number,end:Date,now:Date):number{
  if(!Number.isSafeInteger(reservedSeconds)||reservedSeconds<=0)return 0;
  // Stop before the cycle rolls over, even if the latest call started seconds
  // before renewal. No automatic paid renewal is implied by this helper.
  return Math.min(reservedSeconds,Math.max(0,secondsUntilPeriodEnd(end,now)-25));
}
