import crypto from "crypto";
import nodemailer from "nodemailer";
import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { hashPassword, verifyPassword } from "../lib/password";

const router: IRouter = Router();
const isEnabled = () => process.env.CALLINGAGENT_SELF_SIGNUP_ENABLED === "true";
const validEmail = (email: string) => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const normalize = (value: unknown) => typeof value === "string" ? value.trim() : "";
const safeInput = (data: any) => {
  const email = normalize(data?.email).toLowerCase();
  const companyName = normalize(data?.companyName);
  const contactName = normalize(data?.contactName);
  const password = data?.password;
  if (!validEmail(email) || companyName.length < 2 || companyName.length > 120
    || contactName.length < 2 || contactName.length > 120
    || typeof password !== "string" || password.length < 12 || password.length > 128) {
    throw new Error("Enter a valid business name, contact, email, and password (12–128 characters).");
  }
  return { email, companyName, contactName, password };
};

export async function ensureCompanySignupSchema(): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS ca_company_signup_requests (
    email text PRIMARY KEY, company_name text NOT NULL,
    contact_name text NOT NULL, password_hash text NOT NULL,
    code_hash text NOT NULL, expires_at timestamptz NOT NULL,
    failed_attempts integer NOT NULL DEFAULT 0,
    last_sent_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS ca_signup_ip_limits (
    ip_hash text NOT NULL, action text NOT NULL, hour_bucket timestamptz NOT NULL,
    attempts integer NOT NULL DEFAULT 1,
    PRIMARY KEY(ip_hash,action,hour_bucket)
  )`);
}

/** Database-atomic across app instances. Never trust forwarded IP headers supplied by clients. */
async function allowSignupAttempt(ip: string, action: "request"|"verify"): Promise<boolean> {
  const ipHash=crypto.createHash("sha256").update(ip).digest("hex");
  const limit=action==="request"?10:60;
  const result=await pool.query(`
    INSERT INTO ca_signup_ip_limits(ip_hash,action,hour_bucket,attempts)
    VALUES($1,$2,date_trunc('hour',now()),1)
    ON CONFLICT(ip_hash,action,hour_bucket)
    DO UPDATE SET attempts=ca_signup_ip_limits.attempts+1
    WHERE ca_signup_ip_limits.attempts<$3
    RETURNING attempts`,[ipHash,action,limit]);
  return Boolean(result.rowCount);
}

router.get("/signup/config",(_req,res)=>{
  res.set("Cache-Control","no-store");
  res.json({enabled:isEnabled()});
});

router.post("/signup/request",async(req,res)=>{
  res.set("Cache-Control","no-store");
  if(!isEnabled()){res.status(503).json({error:"Self-registration is not yet available."});return;}
  let data: ReturnType<typeof safeInput>;
  try {data=safeInput(req.body);} catch(err:any){res.status(400).json({error:err.message});return;}
  const host=process.env.SMTP_HOST,user=process.env.SMTP_USER,pass=process.env.SMTP_PASS;
  if(!host||!user||!pass){res.status(503).json({error:"Email verification is temporarily unavailable."});return;}
  try{
    if(!await allowSignupAttempt(req.ip||"unknown","request")){
      res.status(429).json({error:"Too many registration attempts. Try again later."});return;
    }
    const existing=await pool.query("SELECT 1 FROM platform_users WHERE lower(email)=$1 OR lower(username)=$1 LIMIT 1",[data.email]);
    if(existing.rowCount){res.status(409).json({error:"An account already exists. Please sign in."});return;}
    const code=crypto.randomInt(0,100000000).toString().padStart(8,"0");
    const [passwordHash,codeHash]=await Promise.all([hashPassword(data.password),hashPassword(code)]);
    // One email per address per five minutes; repeated calls cannot reset
    // verification attempts or exhaust the SMTP account continuously.
    const saved=await pool.query(`INSERT INTO ca_company_signup_requests
      (email,company_name,contact_name,password_hash,code_hash,expires_at)
      VALUES($1,$2,$3,$4,$5,now()+interval '15 minutes')
      ON CONFLICT(email) DO UPDATE SET
        company_name=EXCLUDED.company_name,
        contact_name=EXCLUDED.contact_name,
        password_hash=EXCLUDED.password_hash,
        code_hash=EXCLUDED.code_hash,
        expires_at=EXCLUDED.expires_at,
        failed_attempts=0,last_sent_at=now()
      WHERE ca_company_signup_requests.last_sent_at<now()-interval '5 minutes'
      RETURNING email`,[data.email,data.companyName,data.contactName,passwordHash,codeHash]);
    if(!saved.rowCount){res.status(429).json({error:"A verification email was recently requested. Try again later."});return;}
    const transport=nodemailer.createTransport({
      host,port:Number(process.env.SMTP_PORT||587),secure:process.env.SMTP_SECURE==="true",
      auth:{user,pass},connectionTimeout:5000,greetingTimeout:5000,socketTimeout:5000
    });
    try{
      await transport.sendMail({
        from:process.env.SMTP_FROM||user,to:data.email,
        subject:"Verify your CallingAgent business account",
        text:"Your CallingAgent verification code is "+code+". It expires in 15 minutes. If you did not request this, ignore this email."
      });
    }catch(error:any){
      await pool.query("DELETE FROM ca_company_signup_requests WHERE email=$1 AND code_hash=$2",[data.email,codeHash]).catch(()=>{});
      req.log.warn({error:error?.message},"Company signup verification email failed");
      res.status(503).json({error:"Could not deliver verification email. Try again."});return;
    }finally{transport.close();}
    res.status(202).json({verificationRequired:true,message:"Check your email for an eight-digit verification code."});
  }catch(error:any){
    req.log.error({error:error?.message},"Signup request failed");
    res.status(503).json({error:"Registration temporarily unavailable."});
  }
});

router.post("/signup/verify",async(req,res)=>{
  res.set("Cache-Control","no-store");
  if(!isEnabled()){res.status(503).json({error:"Self-registration is not yet available."});return;}
  const email=normalize(req.body?.email).toLowerCase();
  const code=normalize(req.body?.code);
  if(!validEmail(email)||!/^\d{8}$/.test(code)){res.status(400).json({error:"Invalid verification request."});return;}
  try {
    if(!await allowSignupAttempt(req.ip||"unknown","verify")){
      res.status(429).json({error:"Too many verification attempts. Try again later."});return;
    }
  } catch(error:any) {
    req.log.error({error:error?.message},"Signup rate limit unavailable");
    res.status(503).json({error:"Verification temporarily unavailable."});return;
  }
  let client: Awaited<ReturnType<typeof pool.connect>> | undefined;
  try{
    client=await pool.connect();
    await client.query("BEGIN");
    const row=await client.query(
      "SELECT email,company_name,contact_name,password_hash,code_hash,expires_at,failed_attempts FROM ca_company_signup_requests WHERE email=$1 FOR UPDATE",[email]);
    const pending=row.rows[0];
    if(!pending||pending.failed_attempts>=5||new Date(pending.expires_at).getTime()<=Date.now()){
      await client.query("COMMIT");
      res.status(400).json({error:"Code expired or invalid. Request a new code."});return;
    }
    const valid=await verifyPassword(code,pending.code_hash);
    if(!valid){
      await client.query("UPDATE ca_company_signup_requests SET failed_attempts=failed_attempts+1 WHERE email=$1",[email]);
      await client.query("COMMIT");
      res.status(400).json({error:"Code expired or invalid. Request a new code."});return;
    }
    // A verified email may only create a company and its administrator once.
    // Both inserts commit together; failures never leave an orphaned company.
    const exists=await client.query("SELECT 1 FROM platform_users WHERE lower(email)=$1 OR lower(username)=$1 LIMIT 1",[email]);
    if(exists.rowCount)throw new Error("Account already exists");
    const company=await client.query(
      "INSERT INTO companies(name,owner_name,email,admin_notification_email) VALUES($1,$2,$3,$3) RETURNING id",
      [pending.company_name,pending.contact_name,email]);
    await client.query(
      "INSERT INTO platform_users(username,email,password_hash,role,company_id,is_active) VALUES($1,$1,$2,'company_admin',$3,true)",
      [email,pending.password_hash,company.rows[0].id]);
    await client.query("DELETE FROM ca_company_signup_requests WHERE email=$1",[email]);
    await client.query("COMMIT");
    res.status(201).json({created:true,companyId:company.rows[0].id,message:"Account verified. Sign in to continue."});
  }catch(error:any){
    if(client) await client.query("ROLLBACK").catch(()=>{});
    req.log.error({error:error?.message},"Company verification failed");
    res.status(client ? 409 : 503).json({error:client ? "Could not complete registration. Check if you already have an account." : "Registration temporarily unavailable."});
  }finally{client?.release();}
});
export default router;
