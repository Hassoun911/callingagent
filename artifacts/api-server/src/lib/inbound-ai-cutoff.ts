/**
 * Pure helpers for the certified opt-in incoming AI cutoff.
 * An early carrier stop is intentionally used because a completed-call
 * callback and Twilio billing may be delayed after a request to hang up.
 */
export function incomingAiStopAfterSeconds(reservedMinutes:number):number {
  if(!Number.isSafeInteger(reservedMinutes)||reservedMinutes<1||reservedMinutes>5)
    throw Error("Invalid reserved incoming AI minutes");
  return Math.max(15,reservedMinutes*60-25);
}

export function incomingAiCutoffDue(
  startedAt:Date,
  reservedMinutes:number,
  now:Date,
):boolean{
  if(!(startedAt instanceof Date)||!Number.isFinite(startedAt.getTime())||
    !(now instanceof Date)||!Number.isFinite(now.getTime()))return false;
  return now.getTime()>=startedAt.getTime()+incomingAiStopAfterSeconds(reservedMinutes)*1000;
}
