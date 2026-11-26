import { useState } from "react";

/** Internal, read-only sales planning calculator. No billing, credits, provider calls or writes. */
export default function AiMarginSimulator() {
  const [monthlyPrice, setMonthlyPrice] = useState(99);
  const [includedMinutes, setIncludedMinutes] = useState(100);
  const [costPerMinute, setCostPerMinute] = useState(0.25);
  const [extraMinutePrice, setExtraMinutePrice] = useState(0.45);
  const [monthlyOverhead, setMonthlyOverhead] = useState(9);
  const [minutesUsed, setMinutesUsed] = useState(100);
  const MINIMUM_MARGIN = 50;
  const [targetMargin, setTargetMargin] = useState(65);
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
  const minimumMarginCap = costPerMinute > 0 ? Math.max(0,Math.floor((monthlyPrice * (1-MINIMUM_MARGIN/100) - monthlyOverhead)/costPerMinute)) : null;
  const status = result.marginPercent < MINIMUM_MARGIN ? "below minimum" : result.marginPercent < targetMargin ? "below target" : "on target";
  const numInput = (title:string,value:number,set:(v:number)=>void,min:number,max:number,step:number) =>
    <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-700">{title}
      <input type="number" min={min} max={max} step={step} value={value}
        onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n))set(Math.min(max,Math.max(min,n)))}}
        className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base font-semibold tabular-nums text-slate-950"/>
    </label>;
  return <section aria-label="AI pricing profitability planner" className="rounded-2xl border border-blue-200 bg-gradient-to-br from-[#f2f8ff] to-white p-4 shadow-sm sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-xl font-black text-[#0d2c58]">AI receptionist · margin simulator</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-700">Read-only internal planning. Your business goal is at least 50% margin; aim for 65% modeled contribution to leave room for additional expenses. Replace assumptions with real all-in CAD costs before approving pricing.</p></div>
      <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">Not connected to billing</span>
    </div>
    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><div className="rounded-xl border border-red-200 bg-red-50 p-4"><p className="text-xs font-extrabold uppercase tracking-wide text-red-800">Minimum margin floor</p><p className="mt-1 text-2xl font-black text-red-900">50%</p></div><div className="rounded-xl border border-blue-200 bg-blue-50 p-4"><p className="text-xs font-extrabold uppercase tracking-wide text-blue-800">Recommended operating target</p><p className="mt-1 text-2xl font-black text-blue-900">65%</p></div><div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Current scenario</p><p className={`mt-1 text-2xl font-black ${status==="below minimum"?"text-red-700":status==="below target"?"text-amber-700":"text-emerald-700"}`}>{result.marginPercent.toFixed(1)}%</p><p className="text-xs font-semibold text-slate-600">{status==="on target"?"Meets selected target":status==="below minimum"?"Below 50% minimum":"Between minimum and target"}</p></div></div>
    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {numInput("Base plan (CAD/month)",monthlyPrice,setMonthlyPrice,0,1000,1)}
      {numInput("Included AI minutes",includedMinutes,setIncludedMinutes,0,5000,25)}
      {numInput("Estimated cost / minute (CAD)",costPerMinute,setCostPerMinute,0,10,0.01)}
      {numInput("Extra minute price (CAD)",extraMinutePrice,setExtraMinutePrice,0,10,0.01)}
      {numInput("Monthly overhead / customer (CAD)",monthlyOverhead,setMonthlyOverhead,0,1000,1)}
      {numInput("Target contribution margin (%)",targetMargin,setTargetMargin,MINIMUM_MARGIN,95,5)}
      {numInput("Simulated minutes consumed",minutesUsed,setMinutesUsed,0,10000,25)}
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
      <p>At <strong>{minutesUsed}</strong> used minutes, <strong>{result.chargeableMinutes}</strong> would be billed above the proposed included allowance <em>only if the customer actively buys additional usage</em>. This calculator assumes all additional usage is paid, rather than automatically charged.</p>
      <p className="mt-2">Estimated maximum included minutes at your selected <strong>{targetMargin}% target</strong>: <strong>{marginCap === null ? "No variable minute cost" : marginCap+" minutes"}</strong>. At the absolute <strong>50% floor</strong>: <strong>{minimumMarginCap === null ? "No variable minute cost" : minimumMarginCap+" minutes"}</strong>. Base-plan break-even threshold: <strong>{breakevenIncluded===null?"No variable minute cost":breakevenIncluded+" minutes"}</strong>. Neither limit is enforced by the carrier.</p>
      {extraMinutePrice < costPerMinute && <p role="alert" className="mt-2 font-bold text-red-700">Warning: extra minutes are priced below estimated per-minute costs.</p>}
      {result.contribution < 0 && <p role="alert" className="mt-2 font-bold text-red-700">Warning: this scenario loses money before unmodeled expenses.</p>}
      {result.marginPercent < MINIMUM_MARGIN && <p role="alert" className="mt-2 font-bold text-red-700">Below the 50% minimum contribution-margin floor. Revise the allowance, cost estimate, or pricing before approving this package.</p>}
      {result.marginPercent >= MINIMUM_MARGIN && result.marginPercent < targetMargin && <p className="mt-2 font-bold text-amber-800">Above the minimum but below the selected contribution-margin target. There may not be enough headroom for unmodeled operating costs.</p>}
    </div>
    <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead className="bg-slate-100 text-slate-700"><tr><th className="p-3">AI minutes used</th><th className="p-3">Revenue</th><th className="p-3">Cost</th><th className="p-3">Contribution</th><th className="p-3">Margin</th></tr></thead>
        <tbody>{[50,100,150,200,300,500].map(minutes=>{const r=compute(minutes);return <tr key={minutes} className="border-t border-slate-100"><td className="p-3 tabular-nums">{minutes}</td><td className="p-3 tabular-nums">{money(r.revenue)}</td><td className="p-3 tabular-nums">{money(r.totalCost)}</td><td className={`p-3 tabular-nums ${r.contribution < 0?"font-bold text-red-700":""}`}>{money(r.contribution)}</td><td className="p-3 tabular-nums">{r.marginPercent.toFixed(1)}%</td></tr>})}</tbody>
      </table>
    </div>
    <p className="mt-4 text-xs leading-5 text-slate-600">Important: contribution margin is NOT net profit margin. Achieving 50% net profitability requires allocating all company operating expenses and taxes appropriately. This planning model should include estimated telephony, speech-to-text, model inference, text-to-speech, phone rentals, SMS/email, hosting, payment fees, support and currency conversion as applicable. This simple contribution model does not validate any actual cost, include Canadian sales tax, or activate recurring credit grants, top-ups, service limits, customer charges, or Stripe products.</p>
  </section>;
}
