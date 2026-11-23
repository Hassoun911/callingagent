import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { hasCompanyFullAccess } from "../lib/company-full-access";

const router: IRouter = Router();
const parseId=(value:unknown)=>{
  const id=Number(value);
  return Number.isSafeInteger(id)&&id>0?id:null;
};

router.get("/companies/:id/full-access",async(req,res):Promise<void>=>{
  if(!req.user){res.status(401).json({error:"Sign in required"});return;}
  const companyId=parseId(req.params.id);
  if(!companyId){res.status(400).json({error:"Invalid company id"});return;}
  if(req.user.role!=="super_admin" && Number(req.user.companyId)!==companyId){
    res.status(403).json({error:"Not permitted"});return;
  }
  try{
    const enabled=await hasCompanyFullAccess(companyId);
    res.set("Cache-Control","private, no-store");
    res.json({companyId,enabled,scope:"features_only",meteredUsageIncluded:false});
  }catch(err:any){
    req.log.error({error:err?.message},"Full Access lookup failed");
    res.status(503).json({error:"Full Access status unavailable"});
  }
});

router.put("/companies/:id/full-access",async(req,res):Promise<void>=>{
  if(req.user?.role!=="super_admin"){res.status(403).json({error:"Only the platform super administrator may grant Full Access"});return;}
  const companyId=parseId(req.params.id);
  const enabled=req.body?.enabled;
  const reason=typeof req.body?.reason==="string"?req.body.reason.trim():"";
  if(!companyId || typeof enabled!=="boolean" || reason.length<4 || reason.length>500){
    res.status(400).json({error:"A valid company, enabled flag and reason (4-500 characters) are required"});return;
  }
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const company=await client.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE",[companyId]);
    if(!company.rowCount){await client.query("ROLLBACK");res.status(404).json({error:"Company not found"});return;}
    await client.query(`INSERT INTO ca_company_full_access(company_id,enabled,reason,updated_by)
      VALUES($1,$2,$3,$4)
      ON CONFLICT(company_id) DO UPDATE SET enabled=EXCLUDED.enabled, reason=EXCLUDED.reason,
        updated_by=EXCLUDED.updated_by,updated_at=now()`,[companyId,enabled,reason,Number(req.user.id)||null]);
    await client.query(`INSERT INTO ca_company_full_access_audit(company_id,enabled,reason,actor_user_id)
      VALUES($1,$2,$3,$4)`,[companyId,enabled,reason,Number(req.user.id)||null]);
    await client.query("COMMIT");
    res.set("Cache-Control","private, no-store");
    res.json({companyId,enabled,scope:"features_only",paymentTaken:false,
      note:"Full Access unlocks account features, not metered credits, free carrier phone numbers, subscription changes or unavailable AI capabilities."});
  }catch(err:any){
    await client.query("ROLLBACK").catch(()=>{});
    req.log.error({error:err?.message},"Full Access update failed");
    res.status(503).json({error:"Unable to update Full Access"});
  }finally{client.release();}
});

export default router;
