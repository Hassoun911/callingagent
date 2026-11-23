import { pool } from "@workspace/db";

export async function ensureCompanyFullAccessSchema():Promise<void>{
  await pool.query(`CREATE TABLE IF NOT EXISTS ca_company_full_access (
    company_id integer PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    enabled boolean NOT NULL DEFAULT false,
    reason text NOT NULL DEFAULT '',
    updated_by integer,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS ca_company_full_access_audit (
    id bigserial PRIMARY KEY,
    company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    enabled boolean NOT NULL,
    reason text NOT NULL,
    actor_user_id integer,
    occurred_at timestamptz NOT NULL DEFAULT now()
  )`);
}

/** Feature-only override. No free minutes, AI credits, phone number purchases,
 * Stripe plan changes, telecom provider operations, or uncapped usage. */
export async function hasCompanyFullAccess(companyId:number):Promise<boolean>{
  if(!Number.isSafeInteger(companyId)||companyId<=0)return false;
  const r=await pool.query("SELECT enabled FROM ca_company_full_access WHERE company_id=$1",[companyId]);
  return r.rows[0]?.enabled===true;
}
