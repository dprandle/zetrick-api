import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { ObjectId, type Collection } from "mongodb";
import { get_time_records, get_hresources, get_contracts } from "./db.js";
import type { hresource, contract_route, time_record, uid } from "./models.js";

const INVALID_DATE = new Date(-62135596800000);
const SUBC_ROLES: uid[] = [
    { source_str: "A_SC_Main_Carrier[021422170000UTC]" },
    { source_str: "B_SC_Sub_Carrier[021422170000UTC]" },
    { source_str: "C_SC_Previous_Carrier[021422170000UTC]" },
];

function hres_has_allowed_role(hr: hresource): boolean {
    for (const item of hr.allowed_roles) {
        if (
            SUBC_ROLES.some((subc_item) => {
                const matches = subc_item.source_str === item.source_str;
                dlog(`Checking ${subc_item.source_str} against ${subc_item.source_str}: ${matches}`);
                return matches;
            })
        )
            return true;
    }
    return false;
}

function twiml(message: string, from_phone_for_logging: string): string {
    ilog(`Replying to ${from_phone_for_logging}: ${message}`);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n    <Message>${message}</Message>\n</Response>`;
}

function normalize_phone(phone: string): string {
    const digits = phone.replace(/\D/g, "");
    return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function tz_str(tz_bytes: number[]): string {
    return Buffer.from(tz_bytes).toString("utf8");
}

function fmt_time(date: Date, tz_bytes: number[] | null): string {
    const tz = tz_bytes ? tz_str(tz_bytes) : "UTC";
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz });
}

function fmt_duration(start: Date, end: Date): string {
    const ms = end.getTime() - start.getTime();
    const hours = Math.floor(ms / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    const secs = Math.floor((ms % 60000) / 1000);

    if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
}

function day_start(start: Date, tz_bytes: number[]): Date {
    const tz_id = tz_str(tz_bytes);
    const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: tz_id,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
    const fmt_parts = fmt.formatToParts(start);

    const find_type = (type: string, parts: Intl.DateTimeFormatPart[]) => {
        const val = parts.find((elem) => elem.type === type);
        return val!.value;
    };

    const year = find_type("year", fmt_parts);
    const month = find_type("month", fmt_parts);
    const day = find_type("day", fmt_parts);
    return new Date(`${year}-${month}-${day}T00:00:00Z`);
}

function format_date_for_log(dt: Date): string {
    const formatted =
        new Intl.DateTimeFormat("en-US", {
            weekday: "short",
            month: "short",
            day: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: "UTC",
        }).format(dt) + " UTC";
    return formatted;
}

function wrap_ltgt(word: string) {
    return "&lt;" + word + "&gt;";
}

async function find_user_contracts(hr: hresource, contracts: Collection<contract_route>): Promise<contract_route[]> {
    const role_filter_objs = SUBC_ROLES.map((r) => {
        return { [`assignments.${r.source_str}.emp_id`]: hr._id };
    });
    const filter = { $or: role_filter_objs };
    return contracts.find(filter).toArray();
}

async function find_hres(phone: string): Promise<hresource | null> {
    const hr_coll = get_hresources();
    const phone_number = normalize_phone(phone);
    return hr_coll.findOne({ phone_number });
}

async function find_active_time_entry(hrid: string, time_coll: Collection<time_record>): Promise<time_record | null> {
    return time_coll.findOne({ hrid, end: INVALID_DATE });
}

async function handle_clock_in(hres: hresource, contract_code: string | null): Promise<string> {
    const contract_coll = get_contracts();
    const time_coll = get_time_records();
    const active = await find_active_time_entry(hres._id, time_coll);
    if (active) {
        const contract = await contract_coll.findOne({ _id: active.cont_id });
        const code = contract?.route_num ?? active.cont_id;
        const tz = contract?.timezone ?? null;
        const time = fmt_time(active.start, tz);
        return `You're already clocked in to ${code} (since ${time}). To clock out reply:\nOUT`;
    }

    const user_contracts = await find_user_contracts(hres, contract_coll);
    if (user_contracts.length === 0) {
        return "You have no assigned contracts. Contact your admin.";
    }

    let contract: contract_route | undefined;

    if (contract_code) {
        contract = user_contracts.find((c) => c.route_num.toLowerCase() === contract_code.toLowerCase());
        if (!contract) {
            const codes = user_contracts.map((c) => c.route_num).join("\n");
            return `Unknown contract "${contract_code}".\n\nYour contracts:\n${codes}`;
        }
    } else if (user_contracts.length === 1) {
        contract = user_contracts[0];
    } else {
        const codes = user_contracts.map((c) => c.route_num).join("\n");
        return `Which contract?\n\nYour contracts:\n${codes}\n\nTo clock in reply:\nIN ${wrap_ltgt("code")}`;
    }

    const now = new Date();
    const sys = { source_str: "sms" };
    const change_now = { by: sys, on: now };
    const new_time_record: time_record = {
        _id: new ObjectId().toHexString(),
        hrid: hres._id,
        cont_id: contract._id,
        start: now,
        end: INVALID_DATE,
        date: day_start(now, contract.timezone),
        tsid: 0,
        archived_info: null as any,
        last_update: change_now,
        created: change_now,
    };
    const result = await time_coll.insertOne(new_time_record);
    if (result.acknowledged && result.insertedId === new_time_record._id) {
        ilog(
            `Created timesheet ${new_time_record._id} for ${new_time_record.hrid} (start: ${format_date_for_log(new_time_record.start)})`
        );
        const auto_note = user_contracts.length === 1 && !contract_code ? " (your only contract)" : "";
        return `Clocked in to ${contract.route_num}${auto_note} at ${fmt_time(now, contract.timezone)}. Reply OUT when done.`;
    }
    return `Clock in failed - server error`;
}

async function handle_clock_out(hres: hresource): Promise<string> {
    const time_coll = get_time_records();
    const active = await find_active_time_entry(hres._id, time_coll);
    if (!active) {
        return "You're not currently clocked in. To clock in reply:\nIN";
    }
    const contract_coll = get_contracts();
    const now = new Date();
    const change_now = { by: { source_str: hres._id }, on: now };

    const updated_result = await time_coll.updateOne(
        { _id: active._id },
        { $set: { end: now, last_update: change_now } }
    );
    if (updated_result.acknowledged && updated_result.matchedCount == updated_result.modifiedCount) {
        const contract = await contract_coll.findOne({ _id: active.cont_id });
        const code = contract?.route_num ?? active.cont_id;
        ilog(`Updated timesheet ${active._id} for ${hres._id} (end: ${format_date_for_log(now)})`);
        return `Clocked out of ${code} at ${fmt_time(now, contract?.timezone ?? null)}. Total: ${fmt_duration(active.start, now)}.`;
    }
    return "Server error - contact your admin";
}

async function handle_get_status(hres: hresource): Promise<string> {
    const active = await find_active_time_entry(hres._id, get_time_records());
    if (!active) {
        return "You're not currently clocked in. To clock in reply:\nIN";
    }
    const contract_coll = get_contracts();
    const contract = await contract_coll.findOne({ _id: active.cont_id });
    const code = contract?.route_num ?? active.cont_id;
    const now = new Date();
    return `Clocked in to ${code} since ${fmt_time(active.start, contract?.timezone ?? null)} (${fmt_duration(active.start, now)} elapsed).`;
}

async function handle_get_contracts(hres: hresource): Promise<string> {
    const contract_coll = get_contracts();
    const user_contracts = await find_user_contracts(hres, contract_coll);
    if (user_contracts.length === 0) {
        return "You have no assigned contracts. Contact your admin.";
    }
    const list = user_contracts.map((c) => c.route_num).join("\n");
    return `Your contracts:\n${list}\n\n`;
}

const HELP_MSG = `IN
Clock in (single contract)

IN ${wrap_ltgt("code")}
Clock in to contract

OUT
Clock out

STATUS
Check current clock status

CONTRACTS
List your contracts
`;

async function handle_post_sms(req: FastifyRequest, reply: FastifyReply) {
    const { From: from, Body: body } = req.body as Record<string, string>;
    ilog(`Received text from ${from}: ${body}`);
    const hres = await find_hres(from);
    if (!hres) {
        reply.type("text/xml").send(twiml("Your number is not registered. Contact your admin.", from));
        return;
    } else if (!hres_has_allowed_role(hres)) {
        reply.type("text/xml").send(twiml("Your number is not configured properly. Contact your admin.", from));
        return;
    }
    ilog(`Matched ${from} to ${hres.first_name} ${hres.last_name} (${hres._id})`);

    const cleaned = body.replace(/[^a-zA-Z0-9\s]/g, "").trim();

    const parts = cleaned.split(/\s+/);
    let response: string = `Unsupported message format. Please send a commands in following format:\n\n${HELP_MSG}`;
    if (parts.length <= 2) {
        const keyword = parts[0]?.toUpperCase() ?? null;
        const arg = parts[1] ?? null;
        switch (keyword) {
            case "IN":
                response = await handle_clock_in(hres, arg);
                break;
            case "OUT":
                response = await handle_clock_out(hres);
                break;
            case "STATUS":
                response = await handle_get_status(hres);
                break;
            case "CONTRACTS":
                response = await handle_get_contracts(hres);
                break;
            case "HELP":
                response = `The following commands are available:\n\n${HELP_MSG}`;
                break;
            default:
                response = `Unknown command "${parts[0]}" Please use one of the following commands:\n\n${HELP_MSG}`;
        }
    }
    reply.type("text/xml").send(twiml(response, from));
}

export function create_sms_routes(): FastifyPluginAsync {
    return async (fastify: FastifyInstance) => {
        fastify.post("/sms", handle_post_sms);
    };
}
