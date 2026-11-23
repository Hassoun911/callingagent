import { appendFile } from "node:fs/promises";

const marker = "<!-- callingagent-20-minute-check -->";
const checks = {payg:900,starter:1900,business:3900,plus:6900,pro:11900};
const repository = process.env.GITHUB_REPOSITORY || "Hassoun911/callingagent";
const token = process.env.GITHUB_TOKEN;
const site = "https://callingagent.ca";

async function get(url,opts={}) {
  const res = await fetch(url,{...opts,redirect:"error",signal:AbortSignal.timeout(14000)});
  if(!res.ok) throw new Error("HTTP " + res.status + " at " + new URL(url).pathname);
  return res;
}
async function api(path,method="GET",body) {
  const response=await get("https://api.github.com/repos/"+repository+path,{
    method,headers:{"Authorization":"Bearer "+token,"Accept":"application/vnd.github+json",
      "X-GitHub-Api-Version":"2022-11-28",...(body?{"Content-Type":"application/json"}:{})},
    ...(body?{body:JSON.stringify(body)}:{})
  });
  return response.json();
}
export function countChecklist(markdown) {
  const lines=String(markdown||"").split("\n");
  return {checked:lines.filter(x=>/^\s*- \[[xX]\] /.test(x)).length,
    remaining:lines.filter(x=>/^\s*- \[ \] /.test(x)).length};
}
export function checkPlans(plans) {
  if(!Array.isArray(plans)) throw Error("Plan response is not an array");
  for(const [slug,price] of Object.entries(checks)){
    const p=plans.find(x=>x.slug===slug);
    if(!p||p.priceCents!==price||!p.stripePriceId)
      throw Error("Missing or mismatched "+slug+" plan");
  }
  return {total:plans.length,checkoutEnabled:plans.filter(p=>p.checkoutEnabled).length};
}
async function probe(name,path,check) {
  try {const res=await get(site+path,{headers:{"User-Agent":"CallingAgent-GitHub-Launch-Monitor"}});
    return {name,ok:true,detail:await check(res)};
  } catch(err) {return {name,ok:false,detail:String(err?.message||err).slice(0,140)};}
}
async function main(){
  if(repository!=="Hassoun911/callingagent"||!token)throw Error("Expected CallingAgent repository and GitHub token");
  const [issue,openPrs,health,plans,start,signup] = await Promise.all([
    api("/issues/30"),api("/pulls?state=open&per_page=100"),
    probe("Health","/api/healthz",async r=>{
      const v=await r.json();if(v.status!=="ok")throw Error("Health is not ok");return "PASS";}),
    probe("Five CAD plans","/api/public-plans",async r=>{
      const p=checkPlans(await r.json());return "PASS; checkout-enabled="+p.checkoutEnabled;}),
    probe("Starter page","/start?plan=starter",async r=>{
      if(!String(r.headers.get("content-type")).includes("text/html"))throw Error("Not an HTML page");
      const text=await r.text();if(!/<html[\s>]/i.test(text))throw Error("Not an HTML document");
      return "PASS";}),
    probe("Signup gate","/api/signup/config",async r=>{
      const data=await r.json();
      if(typeof data.enabled!=="boolean")throw Error("Missing signup feature gate");
      return data.enabled?"ENABLED — verify SMTP and abuse safeguards":"DISABLED — signup not publicly available";
    })
  ]);
  const tasks=countChecklist(issue.body);
  const probes=[health,plans,start,signup];
  const overall=probes.every(x=>x.ok);
  const row=x=>"| "+x.name+" | "+(x.ok?"OK":"FAIL")+" | "+x.detail.replace(/[|\r\n]/g," ")+" |";
  const state={
    issue:issue.state,tasks,checks:probes,
    prs:openPrs.map(p=>({number:p.number,state:p.state,draft:p.draft})).sort((a,b)=>a.number-b.number)
  };
  const status=JSON.stringify(state);
  const markdown=[
    marker,"### CallingAgent 20-minute launch checks",
    "**Read-only monitoring only — not a paid-launch certification.**",
    "**Checklist:** "+tasks.checked+" completed, "+tasks.remaining+" remaining.",
    "**Checklist state:** "+issue.state,
    "","| Check | Status | Detail |","|---|---|---|",...probes.map(row),
    "","**Open development PRs:** "+
      (state.prs.length?state.prs.map(p=>"[#"+p.number+"](https://github.com/Hassoun911/callingagent/pull/"+p.number+") "+p.state+(p.draft?" (draft)":"")).join("; "):"None"),
    "","**Probe result:** "+(overall?"PASS":"FAIL")+". This does not verify live Stripe purchase, webhooks, provisioning, Telnyx invoices or paid entitlements.",
    "","[All 20-minute runs](https://github.com/Hassoun911/callingagent/actions/workflows/callingagent-launch-monitor.yml)",
    "<!-- monitor-state="+Buffer.from(status).toString("base64")+" -->"
  ].join("\n");
  if(process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY,markdown+"\n\nChecked at "+new Date().toISOString()+"\n");
  const comments=await api("/issues/30/comments?per_page=100");
  const existing=comments.find(x=>x.user?.type==="Bot"&&x.body?.includes(marker));
  const oldState=existing?.body?.match(/<!-- monitor-state=([^ ]+) -->/)?.[1];
  const newState=Buffer.from(status).toString("base64");
  if(issue.state==="open"&&oldState!==newState){
    const path=existing?"/issues/comments/"+existing.id:"/issues/30/comments";
    await api(path,existing?"PATCH":"POST",{body:markdown});
    console.log("Updated issue #30 monitor status");
  } else console.log("Launch status unchanged; no issue comment spam");
  console.log(JSON.stringify({checkedAt:new Date().toISOString(),...state}));
  if(!overall)process.exitCode=1;
}
if(import.meta.url==="file://"+process.argv[1])main().catch(err=>{console.error(err);process.exitCode=1});
export {main};
