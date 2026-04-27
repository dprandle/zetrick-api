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
        if (SUBC_ROLES.includes(item)) return true;
    }
    return false;
}

function twiml(message: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n    <Message>${message}</Message>\n</Response>`;
}

function normalize_phone(phone: string): string {
    const digits = phone.replace(/\D/g, "");
    return digits.startsWith("1") ? `+${digits}` : `+1${digits}`;
}

function fmt_time(date: Date): string {
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function fmt_duration(start: Date, end: Date): string {
    const ms = end.getTime() - start.getTime();
    const hours = Math.floor(ms / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

function day_start(start: Date, tz_bytes: number[]): Date {
    const tz_id = Buffer.from(tz_bytes).toString("utf8");
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

async function find_user_contracts(user: hresource, contracts: Collection<contract_route>): Promise<contract_route[]> {
    const filter = {
        $or: SUBC_ROLES.map(r => ({
            [`assignments.${r.source_str}`]: { $elemMatch: { "emp_id.source_str": user._id } }
        }))
    };
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

async function handle_clock_in(user: hresource, contract_code: string | null): Promise<string> {
    const contract_coll = get_contracts();
    const time_coll = get_time_records();
    const active = await find_active_time_entry(user._id, time_coll);
    if (active) {
        const contract = await contract_coll.findOne({_id: active.cont_id});
        const code = contract?.route_num ?? active.cont_id;
        return `You're already clocked in to ${code} (since ${fmt_time(active.start)}). Reply OUT to clock out.`;
    }

    const user_contracts = await find_user_contracts(user, contract_coll);

    if (user_contracts.length === 0) {
        return "You have no assigned contracts. Contact your admin.";
    }

    let contract: contract_route | undefined;

    if (contract_code) {
        contract = user_contracts.find((c) => c.route_num.toLowerCase() === contract_code.toLowerCase());
        if (!contract) {
            const codes = user_contracts.map((c) => c.route_num).join(", ");
            return `Unknown contract "${contract_code}". Your contracts: ${codes}\nReply IN <code> to clock in.`;
        }
    } else if (user_contracts.length === 1) {
        contract = user_contracts[0];
    } else {
        const codes = user_contracts.map((c) => c.route_num).join(", ");
        return `Which contract? Reply: IN <code>\nYour contracts: ${codes}`;
    }

    const now = new Date();
    const sys = { source_str: "sms" };
    const change_now = { by: sys, on: now };
    const new_time_record: time_record = {
        _id: new ObjectId().toHexString(),
        hrid: user._id,
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
        const auto_note = user_contracts.length === 1 && !contract_code ? " (your only contract)" : "";
        return `Clocked in to ${contract.route_num}${auto_note} at ${fmt_time(now)}. Reply OUT when done.`;
    }
    return `Clock in failed - server error`;
}

async function handle_clock_out(user: hresource): Promise<string> {
    const time_coll = get_time_records();
    const active = await find_active_time_entry(user._id, time_coll);
    if (!active) {
        return "You're not currently clocked in. Reply IN to clock in.";
    }
    const contract_coll = get_contracts();
    const now = new Date();
    const change_now = { by: { source_str: "sms" }, on: now };

    await time_coll.updateOne({ _id: active._id }, { $set: { end: now, last_update: change_now } });

    const contract = await contract_coll.findOne({_id: active.cont_id});
    const code = contract?.route_num ?? active.cont_id;
    return `Clocked out of ${code} at ${fmt_time(now)}. Total: ${fmt_duration(active.start, now)}.`;
}

async function handle_get_status(user: hresource): Promise<string> {
    const active = await find_active_time_entry(user._id, get_time_records());
    if (!active) {
        return "You're not currently clocked in. Reply IN to clock in.";
    }
    
    const contract_coll = get_contracts();
    const contract = await contract_coll.findOne({_id: active.cont_id});
    const code = contract?.route_num ?? active.cont_id;
    const now = new Date();
    return `Clocked in to ${code} since ${fmt_time(active.start)} (${fmt_duration(active.start, now)} elapsed).`;
}

async function handle_get_contracts(user: hresource): Promise<string> {
    const contract_coll = get_contracts();
    const user_contracts = await find_user_contracts(user, contract_coll);
    if (user_contracts.length === 0) {
        return "You have no assigned contracts. Contact your admin.";
    }
    const list = user_contracts.map((c) => c.route_num).join(", ");
    return `Your contracts: ${list}\nReply IN <code> to clock in.`;
}

const HELP_MSG = `Commands:
IN - Clock in (auto-selects if 1 contract)
IN <code> - Clock in to a contract
OUT - Clock out
STATUS - Check current status
CONTRACTS - List your contracts`;

async function handle_post_sms(req: FastifyRequest, reply: FastifyReply) {
    const { From: from, Body: body } = req.body as Record<string, string>;

    const hres = await find_hres(from);
    if (!hres) {
        reply.type("text/xml").send(twiml("Your number is not registered. Contact your admin."));
        return;
    }

    // Split by any whitespace - log the result
    const parts = body.trim().split(/\s+/);
    const keyword = parts[0].toUpperCase();
    const arg = parts[1] ?? null;

    let response: string;
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
            response = HELP_MSG;
            break;
        default:
            response = `Unknown command "${keyword}". Reply HELP for options.`;
    }

    reply.type("text/xml").send(twiml(response));
}

export function create_sms_routes(): FastifyPluginAsync {
    return async (fastify: FastifyInstance) => {
        fastify.post("/sms", handle_post_sms);
    };
}
