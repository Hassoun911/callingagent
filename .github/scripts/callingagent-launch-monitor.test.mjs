import test from "node:test";
import assert from "node:assert/strict";
import { countChecklist, checkPlans } from "./callingagent-launch-monitor.mjs";

test("counts only actual GitHub checklist lines",()=>{
  assert.deepEqual(countChecklist("- [x] Done\n- [ ] Open\n  - [x] Also done\nNot a task"),{checked:2,remaining:1});
});

test("requires all five exact CallingAgent CAD plan prices",()=>{
  const values={payg:900,starter:1900,business:3900,plus:6900,pro:11900};
  const plans=Object.entries(values).map(([slug,priceCents])=>({slug,priceCents,stripePriceId:"price_verified",checkoutEnabled:false}));
  assert.deepEqual(checkPlans(plans),{total:5,checkoutEnabled:0});
  assert.throws(()=>checkPlans(plans.filter(p=>p.slug!=="pro")),/pro plan/);
  assert.throws(()=>checkPlans(plans.map(p=>({...p,priceCents:p.slug==="starter"?2000:p.priceCents}))),/starter plan/);
  assert.throws(()=>checkPlans(plans.map(p=>({...p,stripePriceId:p.slug==="payg"?null:p.stripePriceId}))),/payg plan/);
});

test("rejects malformed catalog",()=>{
  assert.throws(()=>checkPlans({}),/array/);
});
