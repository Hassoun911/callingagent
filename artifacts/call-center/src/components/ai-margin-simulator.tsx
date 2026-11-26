import { useState } from "react";

/** Internal, read-only sales planning calculator. No billing, credits, provider calls or writes. */
export default function AiMarginSimulator() {
  const [monthlyPrice, setMonthlyPrice] = useState(99);
  const [includedMinutes, setIncludedMinutes] = useState(80);
  const [costPerMinute, setCostPerMinute] = useState(0.25);
  const [extraMinutePrice, setExtraMinutePrice] = useState(0.85);
  const [costEvidenceVerified, setCostEvidenceVerified] = useState(false);
  const [monthlyOverhead, setMonthlyOverhead] = useState(9);
  const [minutesUsed, setMinutesUsed] = useState(80);
  const [targetMargin, setTargetMargin] = useState(70);
  const minimumMargin = 50;
  const money = (value:number) => `CA$${value.toFixed(2)}`;
  const compute = (minutes:number) => {
    const chargeableMinutes = Math.max(0, minutes - includedMinutes);
    const revenue = monthlyPrice + chargeableMinutes * extraMinutePrice;
    const variableCost = minutes * costPerMinute;
    const totalCost = variableCost + monthlyOverhead;
    const contribution = revenue - totalCost;
    const marginPercent = revenue > 0 ? (contribution / revenue) * 100 : 0;
    return { revenue, variableCost, totalCost, contribution, marginPercent, chargeableMinutes };
  };
  const result = compute(minutesUsed);
  const breakevenIncluded = costPerMinute > 0 ? Math.max(0,Math.floor((monthlyPrice - monthlyOverhead)/costPerMinute)) : null;
  const marginCap = costPerMinute > 0 ? Math.max(0,Math.floor((monthlyPrice * (1-targetMargin/100) - monthlyOverhead)/costPerMinute)) : null;
  const floorCap = costPerMinute > 0 ? Math.max(0,Math.floor((monthlyPrice * (1-minimumMargin/100) - monthlyOverhead)/costPerMinute)) : null;
  // This is the long-run top-up price floor at the chosen contribution target.
  // At higher usage the overage portion dominates the fixed subscription.
  const recommendedTopupPrice = targetMargin < 100 ? costPerMinute / (1 - targetMargin/100) : Infinity;
  const proposedBaseAtTarget = marginCap !== null && includedMinutes <= marginCap;
  const topupsMeetTarget = extraMinutePrice + 0.000001 >= recommendedTopupPrice;
  const modelMeetsTarget = proposedBaseAtTarget && topupsMeetTarget && monthlyPrice > 0;
  const recommendedSafeMinutes = marginCap === null ? null : Math.max(0,Math.floor(marginCap/5)*5);
  const highUsage = compute(Math.max(500,includedMinutes + 500));
  const moneyUp = (value:number) => `CA${(Math.ceil(value*100)/100).toFixed(2)}`;

  const numInput = (title:string,value:number,set:(v:number)=>void,min:number,max:number,step:number) =>
    <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-700">{title}
      <input type="number" min={min} max={max} step={step} value={value}
        onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n))set(Math.min(max,Math.max(min,n)))}}
        className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base font-semibold tabular-nums text-slate-950"/>
    </label>;
  return <section aria-label="AI pricing profitability planner" className="rounded-2xl border border-blue-200 bg-gradient-to-br from-[#f2f8ff] to-white p-4 shadow-sm sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-xl font-black text-[#0d2c58]">Incoming AI receptionist · margin simulator</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-700">Read-only internal planning. Incoming AI-answered calls only. Default goal: 70% contribution margin, with a 50% warning floor. Enter reconciled all-in costs before approving customer allowances. These defaults are assumptions, not observed costs. The launch gate below evaluates both included usage and extra-minute pricing.</p></div>
      <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">Not connected to billing</span>
    </div>
    <div className="mt-5 rounded-2xl border border-blue-200 bg-white p-4 sm:p-5">
      <h3 className="text-lg font-black text-[#0d2c58]">70% pricing launch gate</h3>
      <p className="mt-1 text-xs leading-5 text-slate-600">A pricing planning checklist—not an authorization to enable Stripe, recurring AI credits or live call limits.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold text-slate-600">Suggested max incoming allowance</p><p className="mt-1 text-2xl font-black tabular-nums">{recommendedSafeMinutes===null?"Unbounded model":recommendedSafeMinutes+" min"}</p><p className="mt-1 text-xs text-slate-600">Based on your assumptions, rounded down to 5-minute increments</p></div>
        <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold text-slate-600">Minimum incoming extra-minute charge for {targetMargin}%</p><p className="mt-1 text-2xl font-black tabular-nums">{moneyUp(recommendedTopupPrice)}</p><p className="mt-1 text-xs text-slate-600">Assumes all extra minutes are explicitly prepaid and billed</p></div>
        <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold text-slate-600">Heavy-use case ({Math.max(500,includedMinutes + 500)} min)</p><p className="mt-1 text-2xl font-black tabular-nums">{highUsage.marginPercent.toFixed(1)}%</p><p className="mt-1 text-xs text-slate-600">Checks risk beyond the included usage allowance</p></div>
      </div>
      <div className="mt-4 space-y-2 text-sm">
        <p className={proposedBaseAtTarget?"font-semibold text-emerald-700":"font-semibold text-red-700"}>{proposedBaseAtTarget?"✓":"✕"} Included minutes {proposedBaseAtTarget?"meet":"do not meet"} the {targetMargin}% margin target at full use</p>
        <p className={topupsMeetTarget?"font-semibold text-emerald-700":"font-semibold text-red-700"}>{topupsMeetTarget?"✓":"✕"} Proposed additional-minute price {topupsMeetTarget?"meets":"does not meet"} the {targetMargin}% incremental margin target</p>
        <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <input type="checkbox" checked={costEvidenceVerified} onChange={e=>setCostEvidenceVerified(e.target.checked)} className="mt-1"/>
          <span><strong>I have reconciled all provider and operating costs outside this calculator.</strong> This checkbox is temporary for my review only and is not saved, audited, or a launch approval.</span>
        </label>
        <p role="status" className={modelMeetsTarget&&costEvidenceVerified?"rounded-lg bg-emerald-50 p-3 font-semibold text-emerald-800":"rounded-lg bg-amber-50 p-3 font-semibold text-amber-950"}>{modelMeetsTarget&&costEvidenceVerified?"Pricing assumptions meet target; separate billing and metering certification is still required.":"NOT READY FOR PRICING APPROVAL: fix the red conditions and independently verify true costs, metering, caps, refunds and charging before live checkout."}</p>
      </div>
    </div>
    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {numInput("Base plan (CAD/month)",monthlyPrice,setMonthlyPrice,0,1000,1)}
      {numInput("Included incoming AI minutes",includedMinutes,setIncludedMinutes,0,5000,25)}
      {numInput("Estimated incoming AI cost / minute (CAD)",costPerMinute,setCostPerMinute,0,10,0.01)}
      {numInput("Extra incoming AI minute price (CAD)",extraMinutePrice,setExtraMinutePrice,0,10,0.01)}
      {numInput("Monthly overhead / customer (CAD)",monthlyOverhead,setMonthlyOverhead,0,1000,1)}
      {numInput("Profitability goal (%)",targetMargin,setTargetMargin,0,95,5)}
      {numInput("Incoming AI minutes consumed",minutesUsed,setMinutesUsed,0,10000,25)}
    </div>
    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[
        ["Revenue including extra usage",money(result.revenue)],
        ["Estimated operating cost",money(result.totalCost)],
        ["Contribution before tax & other costs",money(result.contribution)],
        ["Contribution margin",result.marginPercent.toFixed(1)+"%"],
      ].map(([label,value])=><div key={label} className="rounded-xl border border-blue-100 bg-white p-4"><p className="text-xs font-semibold text-slate-600">{label}</p><p className="mt-2 text-2xl font-black tabular-nums text-[#123963]">{value}</p></div>)}
    </div>
    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700">
      <p>At <strong>{minutesUsed}</strong> incoming AI minutes, <strong>{result.chargeableMinutes}</strong> would be billed above the proposed included allowance <em>only if the customer actively buys additional usage</em>. This calculator assumes all additional usage is paid, rather than automatically charged.</p>
      <p className="mt-2">Estimated maximum included minutes at your selected <strong>{targetMargin}% margin</strong>: <strong>{marginCap === null ? "No variable minute cost" : marginCap+" minutes"}</strong>. Maximum estimated included minutes at the <strong>50% warning floor</strong>: <strong>{floorCap===null?"No variable minute cost":floorCap+" minutes"}</strong>. Base-plan break-even threshold: <strong>{breakevenIncluded===null?"No variable minute cost":breakevenIncluded+" minutes"}</strong>. None are carrier-enforced caps.</p>
      {extraMinutePrice < costPerMinute && <p role="alert" className="mt-2 font-bold text-red-700">Warning: extra minutes are priced below estimated per-minute costs.</p>}
      {result.contribution < 0 && <p role="alert" className="mt-2 font-bold text-red-700">Warning: this scenario loses money before unmodeled expenses.</p>}
      {result.marginPercent < minimumMargin ? <p role="alert" className="mt-2 font-bold text-red-700">Below 50% minimum contribution-margin floor. Review the price, allowance and costs before launch.</p> : result.marginPercent < targetMargin ? <p role="status" className="mt-2 font-bold text-amber-800">Below your 70% target. Review the proposed included minutes or the price before launch.</p> : <p role="status" className="mt-2 font-bold text-emerald-700">Meets the selected profitability target under these assumptions.</p>}
    </div>
    <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead className="bg-slate-100 text-slate-700"><tr><th className="p-3">Incoming AI minutes used</th><th className="p-3">Revenue</th><th className="p-3">Cost</th><th className="p-3">Contribution</th><th className="p-3">Margin</th></tr></thead>
        <tbody>{[50,100,150,200,300,500].map(minutes=>{const r=compute(minutes);return <tr key={minutes} className="border-t border-slate-100"><td className="p-3 tabular-nums">{minutes}</td><td className="p-3 tabular-nums">{money(r.revenue)}</td><td className="p-3 tabular-nums">{money(r.totalCost)}</td><td className={`p-3 tabular-nums ${r.contribution < 0?"font-bold text-red-700":""}`}>{money(r.contribution)}</td><td className="p-3 tabular-nums">{r.marginPercent.toFixed(1)}%</td></tr>})}</tbody>
      </table>
    </div>
    <p className="mt-4 text-xs leading-5 text-slate-600">Costs must include telephony, speech-to-text, model inference, text-to-speech, phone rentals, SMS/email, hosting, Stripe fees, support and currency conversion as applicable. 70% here means contribution margin, NOT guaranteed net profit after all business expenses. The public 80-minute incoming AI proposal is not automatically approved by this target. Outgoing AI calls and ordinary VoIP are excluded from these calculations. This simple contribution model does not validate any actual cost, include Canadian sales tax, or activate recurring credit grants, top-ups, service limits, customer charges, or Stripe products.</p>
  </section>;
}
