import test from "node:test";
import assert from "node:assert/strict";
import { incomingAiStopAfterSeconds,incomingAiCutoffDue } from "../../artifacts/api-server/src/lib/inbound-ai-cutoff.ts";

test("conservative incoming AI cutoff is earlier than reserved usage",()=>{
  for(let minutes=1;minutes<=5;minutes++){
    const stop=incomingAiStopAfterSeconds(minutes);
    assert.equal(stop,Math.max(15,minutes*60-25));
    assert.ok(stop < minutes*60);
  }
});
test("hard cutoff is due exactly at reserved early-stop deadline",()=>{
  const started=new Date("2026-11-26T20:00:00.000Z");
  assert.equal(incomingAiCutoffDue(started,5,new Date("2026-11-26T20:04:34.999Z")),false);
  assert.equal(incomingAiCutoffDue(started,5,new Date("2026-11-26T20:04:35.000Z")),true);
});
test("one-minute remaining allowance has its own independent cutoff",()=>{
  const started=new Date("2026-11-26T20:00:00.000Z");
  assert.equal(incomingAiCutoffDue(started,1,new Date("2026-11-26T20:00:34Z")),false);
  assert.equal(incomingAiCutoffDue(started,1,new Date("2026-11-26T20:00:35Z")),true);
});
test("invalid or missing durations cannot generate a cutoff",()=>{
  for(const invalid of [0,-1,6,0.5,NaN,Infinity]){
    assert.throws(()=>incomingAiStopAfterSeconds(invalid));
  }
  assert.equal(incomingAiCutoffDue(new Date("invalid"),5,new Date()),false);
});
