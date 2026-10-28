import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
const router: IRouter = Router();

const defaults = [
  ["payg","Pay as you go",900,0,1,["numbers","call_logs"],"Your Canadian business number without a big monthly bill."],
  ["starter","Starter",1900,100,1,["numbers","forwarding","voicemail","email_alerts","call_logs"],"For solo professionals and simple business calls."],
  ["business","Business",3900,300,1,["numbers","forwarding","voicemail","email_alerts","call_logs"],"Everything most small businesses need."],
  ["plus","Business Plus",6900,750,2,["numbers","forwarding","voicemail","email_alerts","call_logs","extensions"],"More numbers and minutes for a growing team."],
  ["pro","Pro",11900,1500,3,["numbers","forwarding","voicemail","email_alerts","call_logs","extensions"],"Room to grow with optional AI upgrades."]
] as const;
export async function ensurePlanCatalog():Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS ca_plans (
    id serial PRIMARY KEY, slug text UNIQUE NOT NULL, name text NOT NULL,
    price_cents integer NOT NULL CHECK(price_cents >= 0),
    monthly_minutes integer NOT NULL CHECK(monthly_minutes >= 0),
    included_numbers integer NOT NULL CHECK(included_numbers >= 0),
    features jsonb NOT NULL DEFAULT '[]'::jsonb,
    description text NOT NULL DEFAULT '',
    is_published boolean NOT NULL DEFAULT true,
    is_enabled boolean NOT NULL DEFAULT true,
    checkout_enabled boolean NOT NULL DEFAULT false,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  for (const [i,[slug,name,price,minutes,numbers,features,description]] of defaults.entries()) {
    await pool.query(`INSERT INTO ca_plans(slug,name,price_cents,monthly_minutes,included_numbers,features,description,sort_order)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) ON CONFLICT(slug) DO NOTHING`,
      [slug,name,price,minutes,numbers,JSON.stringify(features),description,i]);
  }
}
const columns = "id,slug,name,price_cents AS \"priceCents\",monthly_minutes AS \"monthlyMinutes\",included_numbers AS \"includedNumbers\",features,description,is_published AS \"isPublished\",is_enabled AS \"isEnabled\",checkout_enabled AS \"checkoutEnabled\",sort_order AS \"sortOrder\"";
const admin = (req:any,res:any) => {
  if (!req.user || (req.user.role && req.user.role !== "super_admin")) {res.status(403).json({error:"Only the platform administrator can manage plans."});return false;}
  return true;
};
router.get("/public-plans", async (_req,res) => {
  try {
    const r=await pool.query(`SELECT ${columns} FROM ca_plans WHERE is_published=true AND is_enabled=true ORDER BY sort_order,id`);
    res.json(r.rows.map(p=>({...p,checkoutEnabled:false}))); // checkout is intentionally unavailable until verified billing + caps
  } catch(err:any){res.status(503).json({error:"Plan catalog is unavailable"});}
});
router.get("/admin/plans",async(req,res)=>{
  if(!admin(req,res))return;
  try { const r=await pool.query(`SELECT ${columns} FROM ca_plans ORDER BY sort_order,id`);res.json(r.rows); }
  catch(e:any){res.status(500).json({error:"Could not load plans"});}
});
function validate(body:any) {
 const name=String(body.name||"").trim();
 const slug=String(body.slug||"").toLowerCase().trim();
 const price=Number(body.priceCents),minutes=Number(body.monthlyMinutes),numbers=Number(body.includedNumbers),order=Number(body.sortOrder??0);
 const features=body.features;
 if(!name||name.length>80||!/^[a-z0-9-]{2,40}$/.test(slug))throw Error("Enter a valid name and slug.");
 if(![price,minutes,numbers,order].every(Number.isSafeInteger)||price<0||price>1000000||minutes<0||minutes>1000000||numbers<0||numbers>1000)throw Error("Invalid price or allowance.");
 if(!Array.isArray(features)||features.length>30||features.some(x=>typeof x!=="string"||x.length>60))throw Error("Invalid features.");
 return {name,slug,price,minutes,numbers,order,features,description:String(body.description||"").slice(0,400),isPublished:body.isPublished===true,isEnabled:body.isEnabled===true};
}
router.post("/admin/plans",async(req,res)=>{
 if(!admin(req,res))return;
 try {const p=validate(req.body);const r=await pool.query(`INSERT INTO ca_plans(slug,name,price_cents,monthly_minutes,included_numbers,features,description,is_published,is_enabled,checkout_enabled,sort_order) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,false,$10) RETURNING id`,[p.slug,p.name,p.price,p.minutes,p.numbers,JSON.stringify(p.features),p.description,p.isPublished,p.isEnabled,p.order]);res.status(201).json(r.rows[0]);}
 catch(e:any){res.status(e.code==="23505"?409:400).json({error:e.code==="23505"?"Plan slug already exists":e.message});}
});
router.patch("/admin/plans/:id",async(req,res)=>{
 if(!admin(req,res))return;
 const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<=0){res.status(400).json({error:"Invalid plan ID"});return;}
 try {const p=validate(req.body);const r=await pool.query(`UPDATE ca_plans SET slug=$2,name=$3,price_cents=$4,monthly_minutes=$5,included_numbers=$6,features=$7::jsonb,description=$8,is_published=$9,is_enabled=$10,checkout_enabled=false,sort_order=$11,updated_at=now() WHERE id=$1 RETURNING id`,[id,p.slug,p.name,p.price,p.minutes,p.numbers,JSON.stringify(p.features),p.description,p.isPublished,p.isEnabled,p.order]);if(!r.rowCount){res.status(404).json({error:"Plan not found"});return;}res.json(r.rows[0]);}
 catch(e:any){res.status(e.code==="23505"?409:400).json({error:e.code==="23505"?"Plan slug already exists":e.message});}
});
router.delete("/admin/plans/:id",async(req,res)=>{
 if(!admin(req,res))return;
 const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<=0){res.status(400).json({error:"Invalid ID"});return;}
 try {const r=await pool.query("DELETE FROM ca_plans WHERE id=$1 RETURNING id",[id]);if(!r.rowCount){res.status(404).json({error:"Plan not found"});return;}res.json({deleted:true});}
 catch(e:any){res.status(409).json({error:"Plan may be referenced by existing subscriptions. Disable it instead."});}
});
export default router;
