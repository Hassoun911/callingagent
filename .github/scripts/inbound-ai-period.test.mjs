import test from "node:test";
import assert from "node:assert/strict";
import {validCertifiedAiPeriod,secondsUntilPeriodEnd,certifiedAiCycleCutoffSeconds}
  from "../../artifacts/api-server/src/lib/inbound-ai-period.ts";

const d=(s)=>new Date(s);
test("certified subscription cycle starts on paid anniversary, not on first of month",()=>{
  const start=d("2026-11-17T15:00:00Z"),end=d("2026-12-17T15:00:00Z");
  assert.equal(validCertifiedAiPeriod(start,end,d("2026-12-01T00:01:00Z")),true);
  assert.equal(validCertifiedAiPeriod(start,end,d("2026-12-17T15:00:00Z")),false);
  assert.equal(validCertifiedAiPeriod(start,end,d("2026-11-17T14:59:59Z")),false);
});
test("no missing or invalid paid period can authorize new minutes",()=>{
  const now=d("2026-11-26T20:00:00Z");
  for(const [start,end] of [
    [new Date(NaN),d("2026-12-26T20:00:00Z")],
    [d("2026-11-26T20:00:00Z"),new Date(NaN)],
    [d("2026-11-26T20:00:00Z"),d("2026-11-26T20:00:00Z")],
    [d("2026-11-26T20:00:00Z"),d("2027-01-26T20:00:00Z")]
  ])assert.equal(validCertifiedAiPeriod(start,end,now),false);
});
test("cutoff never extends beyond paid subscription period or reserved seconds",()=>{
  const now=d("2026-11-26T20:00:00Z");
  assert.equal(certifiedAiCycleCutoffSeconds(275,d("2026-11-26T20:02:00Z"),now),95);
  assert.equal(certifiedAiCycleCutoffSeconds(275,d("2026-11-26T21:00:00Z"),now),275);
  assert.equal(certifiedAiCycleCutoffSeconds(275,d("2026-11-26T20:00:24Z"),now),0);
  assert.equal(secondsUntilPeriodEnd(d("2026-11-26T19:59:59Z"),now),0);
});
