import { Router, type IRouter } from "express";
import { createPublicKey, verify } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, phoneNumbersTable, companiesTable, callLogsTable, extensionsTable } from "@workspace/db";

const router: IRouter = Router();
const seen = new Map<string, number>();
const keepSeconds = 300;

function isSigned(req: any): boolean {
  const key = process.env.TELNYX_PUBLIC_KEY;
  const raw: Buffer | undefined = req.rawBody;
  const stamp = req.get("telnyx-timestamp");
  const sig = req.get("telnyx-signature-ed25519");
  if (!key || !raw || !stamp || !sig || !/^\d+$/.test(stamp)) return false;
  if (Math.abs(Date.now() / 1000 - Number(stamp)) > keepSeconds) return false;
  try {
    const bytes = Buffer.from(key, "base64");
    const signature = Buffer.from(sig, "base64");
    if (bytes.length !== 32 || signature.length !== 64) return false;
    const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), bytes]), format: "der", type: "spki" });
    return verify(null, Buffer.concat([Buffer.from(stamp + "|"), raw]), publicKey, signature);
  } catch { return false; }
}

async function action(id: string, name: string, payload: Record<string, unknown> = {}) {
  const key = process.env.TELNYX_API_KEY;
  if (!key) throw new Error("Telnyx API key is not configured");
  const response = await fetch("https://api.telnyx.com/v2/calls/" + encodeURIComponent(id) + "/actions/" + name, {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) { const detail = (await response.text()).slice(0, 600); throw new Error("Telnyx call command " + name + " failed (" + response.status + "): " + detail); }
}

async function notifyAdminOfVoicemail(logSid: string, recordingUrl: string) {
  const [log] = await db.select().from(callLogsTable).where(eq(callLogsTable.twilioCallSid, logSid));
  if (!log?.phoneNumberId) return;
  const [line] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.id, log.phoneNumberId));
  if (!line?.companyId) return;
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, line.companyId));
  // The administrator contact belongs to this company only; never use a global phone.
  const recipient = company?.adminWhatsapp?.trim().replace(/[\\s().-]/g, "");
  if (!recipient || !/^\+[1-9]\d{7,14}$/.test(recipient)) {
    return;
  }
  const key = process.env.TELNYX_API_KEY;
  const profile = process.env.TELNYX_MESSAGING_PROFILE_ID;
  if (!key || !profile) throw new Error("Telnyx messaging credentials unavailable");
  const message = `New voicemail for ${company.name} (${line.number}). Caller: ${log.fromNumber}. Listen in CallingAgent: https://callingagent.ca/calls?companyId=${line.companyId}`;
  const payload: Record<string, unknown> = {
    from: line.number, to: recipient, text: message, messaging_profile_id: profile,
  };
  // An HTTPS recording URL can be delivered as MMS audio if the carrier accepts its media type.
  if (/^https:\/\//i.test(recordingUrl)) payload.media_urls = [recordingUrl];
  const result = await fetch("https://api.telnyx.com/v2/messages", {
    method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(12000),
  });
  if (!result.ok && payload.media_urls) {
    // MMS delivery may fail for inaccessible/unsupported carrier recording URLs. At least send a text alert.
    delete payload.media_urls;
    const fallback = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(12000),
    });
    if (!fallback.ok) throw new Error("Telnyx voicemail SMS failed: " + fallback.status);
  } else if (!result.ok) throw new Error("Telnyx voicemail delivery failed: " + result.status);
}

// Outbound leg ownership is encoded in signed carrier-returned client_state and kept
// in memory for webhook sequencing. A deployment restart may interrupt an active transfer.
const outboundToInbound = new Map<string, { inbound: string; lineId: number; bridged: boolean; pressOne: boolean; displayName: string; team?: { remaining: string[]; extension: string; fallback: string } }>();
const incomingToOutbound = new Map<string, string>();
const ivrMenus = new Map<string, { lineId: number; caller: string; options: Array<{ digit: string; name: string; id: number; agents: Array<{ userId: number; phone: string }>; forwardTo: string; ringCount: number; fallbackAction: string }> }>();
type ClickToCall = { agent: string; target: string; from: string; companyId: number; stage: "calling_agent" | "calling_target" | "connected"; targetLeg?: string };
const clickToCallByLeg = new Map<string, ClickToCall>();

async function dialClickToCallLeg(to: string, from: string, label: string): Promise<string> {
  const key = process.env.TELNYX_API_KEY;
  const connection = process.env.TELNYX_CONNECTION_ID;
  if (!key || !connection) throw new Error("Telnyx outbound credentials are missing");
  const result = await fetch("https://api.telnyx.com/v2/calls", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ connection_id: connection, to, from, timeout_secs: 35,
      client_state: Buffer.from(JSON.stringify({ clickToCall: label })).toString("base64") }),
    signal: AbortSignal.timeout(12000),
  });
  if (!result.ok) throw new Error("Telnyx outbound dial failed (" + result.status + "): " + (await result.text()).slice(0, 400));
  const json: any = await result.json();
  if (typeof json?.data?.call_control_id !== "string") throw new Error("Telnyx returned no call control ID");
  return json.data.call_control_id;
}

// Creates an outbound call from the selected company's verified Telnyx line.
// The agent receives a call first and must press 1 before the customer is dialed.
export async function initiateCompanyClickToCall(companyId: number, agent: string, target: string, from: string): Promise<string> {
  const agentLeg = await dialClickToCallLeg(agent, from, "agent");
  clickToCallByLeg.set(agentLeg, { agent: agentLeg, target, from, companyId, stage: "calling_agent" });
  return agentLeg;
}


async function startControlledForward(inbound: string, line: typeof phoneNumbersTable.$inferSelect, route?: { phone: string; display: string; ringCount: number; team: { remaining: string[]; extension: string; fallback: string } }): Promise<string> {
  if (!(route?.phone || line.forwardTo) || !/^\+[1-9]\d{7,14}$/.test(route?.phone || line.forwardTo || "")) throw new Error("Invalid forwarding destination");
  const key = process.env.TELNYX_API_KEY;
  const connection = process.env.TELNYX_CONNECTION_ID;
  if (!key || !connection) throw new Error("Telnyx forwarding credentials unavailable");
  const response = await fetch("https://api.telnyx.com/v2/calls", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({
      connection_id: connection,
      to: route?.phone || line.forwardTo,
      from: line.number, // Always present the verified CallingAgent business number
      // Independent outbound leg: bridge only after acceptance. Linking at dial time
      // can propagate the original caller identity and bypass screening.
      ...((route || line.callScreen) ? {} : { answering_machine_detection: "detect" }),
      timeout_secs: Math.max(5, Math.min(60, (route?.ringCount || line.ringCount || 4) * 6)),
      client_state: Buffer.from(JSON.stringify({ inbound, lineId: line.id })).toString("base64"),
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Telnyx dial failed (" + response.status + "): " + (await response.text()).slice(0, 400));
  const result: any = await response.json();
  const outbound = result?.data?.call_control_id;
  if (typeof outbound !== "string") throw new Error("Telnyx dial did not return an outbound leg");
  outboundToInbound.set(outbound, { inbound, lineId: line.id, bridged: false, pressOne: route ? true : Boolean(line.callScreen), displayName: (route?.display || line.callerIdName?.trim() || line.friendlyName?.trim() || "your business").slice(0, 50), team: route?.team });
  // Carrier accepted the dial command; this does not mean the destination handset rang.

  incomingToOutbound.set(inbound, outbound);
  return outbound;
}

async function startSystemVoicemail(inbound: string, line: typeof phoneNumbersTable.$inferSelect, from: string, department?: string) {
  const [company] = line.companyId
    ? await db.select().from(companiesTable).where(eq(companiesTable.id, line.companyId))
    : [];
  const name = company?.name?.trim() || line.callerIdName?.trim() || "our business";
  const greeting = (department ? "Thank you for calling the " + department + " department at " + name + ". " : "") + (line.voicemailGreeting?.trim() || "Thank you for calling " + name +
    ". We're sorry we missed your call. Please leave your name, phone number, and a brief message after the tone, and someone from our team will contact you as soon as possible.");
  const logSid = "telnyx:" + inbound;
  const [prior] = await db.select().from(callLogsTable).where(eq(callLogsTable.twilioCallSid, logSid));
  if (!prior) await db.insert(callLogsTable).values({
    twilioCallSid: logSid, phoneNumberId: line.id, direction: "inbound",
    status: "voicemail_greeting", fromNumber: from, toNumber: line.number, answerMode: "voicemail",
  });
  else await db.update(callLogsTable).set({ status: "voicemail_greeting" }).where(eq(callLogsTable.twilioCallSid, logSid));
  await action(inbound, "speak", { payload: greeting, voice: "female", language: "en-US" });
}

// This is a Call Control API v2 webhook, not a Twilio TwiML endpoint.
router.post("/telnyx/voice", async (req, res): Promise<void> => {
  if (!process.env.TELNYX_PUBLIC_KEY) { res.status(503).json({ error: "Telnyx webhook signing key not configured" }); return; }
  if (!isSigned(req)) { res.status(401).json({ error: "Invalid Telnyx webhook signature" }); return; }
  const event = req.body?.data;
  const type = event?.event_type;
  const payload = event?.payload;
  const id = payload?.call_control_id;
  if (typeof type !== "string" || typeof id !== "string" || !id) { res.status(400).end(); return; }

  const eventId = event?.id;
  const now = Date.now();
  for (const [k, time] of seen) if (now - time > keepSeconds * 1000) seen.delete(k);
  if (typeof eventId === "string" && seen.has(eventId)) { res.status(200).json({ received: true, duplicate: true }); return; }
  if (typeof eventId === "string") seen.set(eventId, now);
  req.log.info({ eventType: type, direction: payload?.direction, hasDestination: Boolean(payload?.to), hangupCause: type === "call.hangup" ? payload?.hangup_cause : undefined, hangupSource: type === "call.hangup" ? payload?.hangup_source : undefined, detection: type === "call.machine.detection.ended" ? payload?.result : undefined, gatheredDigits: type === "call.gather.ended" ? (payload?.digits ? "[provided]" : "[none]") : undefined }, "Telnyx voice webhook received");
  // Fast acknowledgment prevents carrier retries while Call Control runs.
  res.status(200).json({ received: true });
  try {
    if (type === "call.answered" && clickToCallByLeg.has(id)) {
      const call = clickToCallByLeg.get(id)!;
      if (id === call.agent && call.stage === "calling_agent") {
        await action(id, "gather_using_speak", {
          payload: "CallingAgent outbound call for your company. Press 1 to call the customer.",
          voice: "female", language: "en-US", valid_digits: "1",
          maximum_digits: 1, minimum_digits: 1, initial_timeout_millis: 12000, timeout_millis: 12000,
        });
        req.log.info({ companyId: call.companyId }, "Click-to-call agent answered; waiting for confirmation");
      } else if (id === call.targetLeg && call.stage === "calling_target") {
        await action(call.agent, "bridge", { call_control_id: id, park_after_unbridge: "self" });
        call.stage = "connected";
        req.log.info({ companyId: call.companyId }, "Click-to-call legs connected");
      }
    } else if (type === "call.gather.ended" && clickToCallByLeg.has(id)) {
      const call = clickToCallByLeg.get(id)!;
      if (id === call.agent && call.stage === "calling_agent") {
        if (String(payload?.digits || "") !== "1") {
          clickToCallByLeg.delete(id);
          await action(id, "hangup");
        } else {
          // Only dial the destination after an explicit keypress from the agent.
          call.stage = "calling_target";
          try {
            const destId = await dialClickToCallLeg(call.target, call.from, "customer");
            call.targetLeg = destId;
            clickToCallByLeg.set(destId, call);
            await action(call.agent, "speak", { payload: "Connecting your outbound call now. Please hold.", voice: "female", language: "en-US" });
            req.log.info({ companyId: call.companyId }, "Click-to-call destination dial initiated");
          } catch (error) {
            clickToCallByLeg.delete(id);
            await action(id, "hangup");
            throw error;
          }
        }
      }
    } else if (type === "call.hangup" && clickToCallByLeg.has(id)) {
      const call = clickToCallByLeg.get(id)!;
      clickToCallByLeg.delete(call.agent);
      if (call.targetLeg) clickToCallByLeg.delete(call.targetLeg);
      const other = id === call.agent ? call.targetLeg : call.agent;
      if (other) await action(other, "hangup").catch(() => {});
    } else if (type === "call.initiated" && payload?.direction === "incoming") {
      await action(id, "answer");
    } else if (type === "call.answered" && outboundToInbound.has(id)) {
      const state = outboundToInbound.get(id)!;
      if (state.pressOne) {
        // Immediate DTMF verification, rather than waiting on ambiguous machine detection.
        await action(id, "gather_using_speak", {
          payload: "Incoming forwarded call for " + (state.displayName || "your business") + ". Press 1 now to accept.",
          voice: "female", language: "en-US", valid_digits: "1",
          maximum_digits: 1, minimum_digits: 1,
          initial_timeout_millis: 9000, timeout_millis: 9000,
        });
        req.log.info({ lineId: state.lineId }, "Forwarded leg answered; press 1 request sent");
      } else {
        req.log.info({ lineId: state.lineId }, "Forwarded leg answered; awaiting machine detection");
      }

    } else if (type === "call.machine.detection.ended" && outboundToInbound.has(id)) {
      const state = outboundToInbound.get(id)!;
      const result = String(payload?.result || "").toLowerCase();
      if (result === "human" || (state.pressOne && result === "not_sure")) {
        if (state.pressOne) {
          await action(id, "gather_using_speak", {
            payload: "You have a forwarded business call. Press 1 to accept this call.",
            voice: "female", language: "en-US",
            valid_digits: "1", maximum_digits: 1, minimum_digits: 1,
            initial_timeout_millis: 8000, timeout_millis: 12000,
          });
          req.log.info({ lineId: state.lineId }, "Waiting for forwarding recipient to press 1");
        } else {
          await action(state.inbound, "bridge", { call_control_id: id, park_after_unbridge: "self" });
          state.bridged = true;
          req.log.info({ lineId: state.lineId }, "Forwarded Telnyx call bridged automatically");
        }
      } else {
        req.log.info({ result, lineId: state.lineId }, "Forwarded destination not confirmed human; using system voicemail");
        await action(id, "hangup");
        // Outbound call.hangup triggers company voicemail on the parked inbound leg.
      }
    } else if (type === "call.answered" && payload?.direction !== "outgoing") {
      const destination = payload?.to;
      const [line] = typeof destination === "string"
        ? await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.number, destination))
        : [];
      req.log.info({ foundLine: Boolean(line), active: Boolean(line?.isActive), mode: line?.answerMode }, "Telnyx inbound routing decision");
      if (!line?.isActive) {
        await action(id, "speak", {
          payload: "This number is not currently accepting calls. Please try again later.",
          voice: "female", language: "en-US",
        });
      } else if (line.answerMode === "reject") {
        await action(id, "hangup");
      } else {
        const [company] = line.companyId
          ? await db.select().from(companiesTable).where(eq(companiesTable.id, line.companyId))
          : [];
        const name = company?.name?.trim() || line.callerIdName?.trim() || "our business";
        const defaultVoicemail = "Thank you for calling " + name +
          ". We're sorry we missed your call. Please leave your name, phone number, and a brief message after the tone, and someone from our team will contact you as soon as possible.";
        if (line.answerMode === "ivr" && line.companyId) {
          const all = await db.select().from(extensionsTable).where(eq(extensionsTable.companyId, line.companyId));
          const options = all.filter(e => e.enabled && /^[1-9]$/.test(e.digit)).map(e => ({
            digit: e.digit, name: e.name, id: e.id, agents: e.agents || [],
            forwardTo: e.forwardTo, ringCount: e.ringCount, fallbackAction: e.fallbackAction,
          }));
          if (!options.length) {
            await startSystemVoicemail(id, line, typeof payload?.from === "string" ? payload.from : "unknown");
          } else {
            ivrMenus.set(id, { lineId: line.id, caller: typeof payload?.from === "string" ? payload.from : "unknown", options });
            const choices = options.sort((a,b) => a.digit.localeCompare(b.digit))
              .map(e => "Press " + e.digit + " for " + e.name + ".").join(" ");
            await action(id, "gather_using_speak", {
              payload: "Thank you for calling " + name + ". " + choices,
              voice: "female", language: "en-US",
              valid_digits: options.map(x => x.digit).join(""), maximum_digits: 1, minimum_digits: 1,
              initial_timeout_millis: 12000, timeout_millis: 12000,
            });
            req.log.info({ lineId: line.id, extensionCount: options.length }, "Extension menu presented");
          }
        } else if (line.answerMode === "forward" && line.forwardTo) {
          try { await startControlledForward(id, line); }
          catch (error: any) {
            req.log.error({ error: error?.message, lineId: line.id }, "Forward setup failed, using system voicemail");
            await startSystemVoicemail(id, line, typeof payload?.from === "string" ? payload.from : "unknown");
          }
        } else {
          await startSystemVoicemail(id, line, typeof payload?.from === "string" ? payload.from : "unknown");
        }
      }
    } else if (type === "call.gather.ended" && ivrMenus.has(id)) {
      const menu = ivrMenus.get(id)!;
      ivrMenus.delete(id);
      const selected = menu.options.find(option => option.digit === String(payload?.digits || ""));
      const [line] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.id, menu.lineId));
      if (!line || !line.isActive) {
        await action(id, "hangup");
      } else if (!selected) {
        await startSystemVoicemail(id, line, menu.caller);
      } else {
        const phones = (selected.agents.length ? selected.agents.map(a => a.phone) : [selected.forwardTo])
          .filter(phone => /^\+[1-9]\d{7,14}$/.test(phone));
        const team = { remaining: phones.slice(1), extension: selected.name, fallback: selected.fallbackAction };
        if (!phones.length) {
          await startSystemVoicemail(id, line, menu.caller, selected.name);
        } else {
          try {
            await startControlledForward(id, line, {
              phone: phones[0], display: selected.name,
              ringCount: selected.ringCount, team,
            });
            req.log.info({ lineId: line.id, extension: selected.name, memberCount: phones.length }, "Sequential extension routing started");
          } catch (error: any) {
            req.log.error({ extension: selected.name, error: error?.message }, "First extension member dial failed");
            await startSystemVoicemail(id, line, menu.caller, selected.name);
          }
        }
      }
    } else if (type === "call.gather.ended" && outboundToInbound.has(id)) {
      const state = outboundToInbound.get(id)!;
      if (state.pressOne && String(payload?.digits || "") === "1") {
        await action(state.inbound, "bridge", { call_control_id: id, park_after_unbridge: "self" });
        state.bridged = true;
        req.log.info({ lineId: state.lineId }, "Forwarded call accepted with key 1");
      } else {
        req.log.info({ lineId: state.lineId }, "Forwarded call not accepted; system voicemail fallback");
        await action(id, "hangup");
      }
    } else if (type === "call.hangup" && outboundToInbound.has(id)) {
      const state = outboundToInbound.get(id)!;
      outboundToInbound.delete(id);
      incomingToOutbound.delete(state.inbound);
      if (!state.bridged) {
        const [line] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.id, state.lineId));
        if (line && line.isActive) {
          let retryStarted = false;
          if (state.team) {
            while (state.team.remaining.length > 0) {
              const nextPhone = state.team.remaining.shift()!;
              try {
                await startControlledForward(state.inbound, line, {
                  phone: nextPhone, display: state.team.extension,
                  ringCount: line.ringCount, team: state.team,
                });
                req.log.info({ lineId: line.id, department: state.team.extension }, "Ringing next extension member");
                retryStarted = true;
                break;
              } catch (error: any) {
                req.log.error({ department: state.team.extension, message: error?.message }, "Extension member dial failed; trying next");
              }
            }
          }
          if (!retryStarted) {
            try { await startSystemVoicemail(state.inbound, line, "unknown", state.team?.extension); }
            catch (error: any) { req.log.error({ message: error?.message }, "Failed to return unanswered forward to system voicemail"); }
          }
        }
      }
    } else if (type === "call.hangup" && ivrMenus.has(id)) {
      ivrMenus.delete(id);
    } else if (type === "call.hangup" && incomingToOutbound.has(id)) {
      const outbound = incomingToOutbound.get(id)!;
      incomingToOutbound.delete(id);
      outboundToInbound.delete(outbound);
    } else if (type === "call.speak.ended") {
      // speak.ended omits "to": recover the exact line from the call log created at answer time.
      const logSid = "telnyx:" + id;
      const [call] = await db.select().from(callLogsTable).where(eq(callLogsTable.twilioCallSid, logSid));
      if (!call || call.status !== "voicemail_greeting") {
        req.log.warn({ hasCall: Boolean(call), status: call?.status }, "Voicemail recording skipped: no pending greeting");
      } else {
        await action(id, "record_start", {
          format: "mp3", channels: "single", recording_track: "inbound",
          play_beep: true, max_length: 120, timeout_secs: 8,
          transcription: true, transcription_language: "en-US",
          command_id: id + "-voicemail-start",
        });
        await db.update(callLogsTable).set({ status: "voicemail_recording" })
          .where(eq(callLogsTable.twilioCallSid, logSid));
        req.log.info({ phoneNumberId: call.phoneNumberId }, "Telnyx voicemail recording started with beep");
      }
    } else if (type === "call.recording.saved") {
      const logSid = "telnyx:" + id;
      const urls = payload?.recording_urls;
      const url = urls?.mp3 || urls?.wav || payload?.recording_url;
      await db.update(callLogsTable).set({
        status: "voicemail_saved",
        recordingUrl: typeof url === "string" ? url : null,
        recordingSid: typeof payload?.recording_id === "string" ? payload.recording_id : null,
      }).where(eq(callLogsTable.twilioCallSid, logSid));
      req.log.info({ recordingSaved: true, hasUrl: Boolean(url) }, "Telnyx voicemail saved");
      if (typeof url === "string") {
        try { await notifyAdminOfVoicemail(logSid, url); }
        catch (error: any) { req.log.error({ message: error?.message }, "Telnyx voicemail admin delivery failed"); }
      }
    } else if (type === "call.recording.transcription.saved") {
      const transcript = payload?.transcription_data?.transcript || payload?.transcription;
      if (typeof transcript === "string") {
        await db.update(callLogsTable).set({ transcription: transcript })
          .where(eq(callLogsTable.twilioCallSid, "telnyx:" + id));
      }
    } else if (type === "call.recording.error") {
      req.log.error({ callControlId: id }, "Telnyx voicemail recording failed");
    }
  } catch (error: any) {
    req.log.error({ type, message: error?.message }, "Telnyx voice event processing failed");
  }
});

export default router;
