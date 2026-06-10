import { ObjectId, type Collection } from "mongodb";
import mongo from "./db.js";
import twilio from "twilio";
import { config } from "./config.js";
import {
    type hresource,
    type contract_route,
    type time_record,
    make_ci_not_archived,
    make_ci_now,
    TIME_RECORD_SCHEMA_VERSION,
    can_track_time_via_sms,
    get_current_route_name,
} from "./models.js";

const INVALID_DATETIME = new Date(-62135596800000);

const EMPLOYEE_ACTIVE_CARRIER_ROLES = new Set(["A_Main_Carrier[021422170000UTC]", "B_Sub_Carrier[021422170000UTC]"]);
const SUBC_ACTIVE_CARRIER_ROLES = new Set(["A_SC_Main_Carrier[021422170000UTC]", "B_SC_Sub_Carrier[021422170000UTC]"]);
const ACTIVE_CARRIER_ROLES = new Set([...EMPLOYEE_ACTIVE_CARRIER_ROLES, ...SUBC_ACTIVE_CARRIER_ROLES]);

const client = twilio(config.twilio.account_sid, config.twilio.auth_token);

const MENU_MSG = `Commands:
IN → clock in (single contract)
IN ${wrap_ltgt("contract")} → clock in to <contract>
OUT → clock out
STATUS → current clock status
CONTRACTS → list your contracts
MENU → show this list`;

type sms_send_result = {
    sid: string;
    status: string;
    created: Date;
};

async function send_message(number: string, body: string): Promise<sms_send_result> {
    try {
        ilog(`Sending sms to ${number}: ${body}`);
        const message = await client.messages.create({
            messagingServiceSid: config.twilio.message_service_sid,
            to: `+1${normalize_phone(number)}`,
            body,
        });
        ilog(`Successfully sent message at ${message.dateCreated} - sid: ${message.sid} status: ${message.status}`);
        return { sid: message.sid, status: message.status, created: message.dateCreated };
    } catch (err: any) {
        console.error("Error sending SMS:", err.message);
        throw err;
    }
}

function get_menu_message() {
    return MENU_MSG;
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

function get_best_route_str(c: contract_route) {
    return c.route_num || get_current_route_name(c);
}

async function find_user_contracts(hr: hresource, contracts: Collection<contract_route>): Promise<contract_route[]> {
    // Narrow hr allowed roles to only active ones
    const active_allowed_roles = hr.allowed_roles.filter((r) => ACTIVE_CARRIER_ROLES.has(r.source_str));
    // Create our filter from the narrowed roles
    const role_filter_objs = active_allowed_roles.map((r) => {
        return { [`assignments.${r.source_str}.emp_id`]: hr._id };
    });
    const filter = { $or: role_filter_objs };
    return contracts.find(filter).toArray();
}

async function find_qualified_hres(phone: string): Promise<hresource | string> {
    const hr_coll = mongo.get_hresources();
    const phone_number = normalize_phone(phone);
    const hrlist = await hr_coll.find({ phone_number }).toArray();
    if (hrlist.length === 0) return "Your number is not registered. Contact your admin.";
    const with_flag = hrlist.filter((hr) => can_track_time_via_sms(hr.tt_flags, hr.archived_info.on));
    if (with_flag.length === 0) return "SMS time tracking is currently disabled for your number. Contact your admin.";
    if (with_flag.length > 1) return "Your number matches multiple records and must be resolved. Contact your admin";
    return with_flag[0];
}

async function find_active_time_entry(hrid: string, time_coll: Collection<time_record>): Promise<time_record | null> {
    return time_coll.findOne({ hrid, end: INVALID_DATETIME });
}

async function handle_clock_in(hres: hresource, contract_code: string | null): Promise<string> {
    const contract_coll = mongo.get_conts();
    const time_coll = mongo.get_trecs();
    const active = await find_active_time_entry(hres._id, time_coll);
    if (active) {
        const contract = await contract_coll.findOne({ _id: active.cont_id });
        const code = contract ? get_best_route_str(contract) : active.cont_id;
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
        contract = user_contracts.find((c) => get_best_route_str(c).toLowerCase() === contract_code.toLowerCase());
        if (!contract) {
            const codes = user_contracts.map((c) => get_best_route_str(c).toUpperCase()).join("\n");
            return `Unknown contract "${contract_code}".\n\nYour contracts:\n${codes}`;
        }
    } else if (user_contracts.length === 1) {
        contract = user_contracts[0];
    } else {
        const codes = user_contracts.map((c) => get_best_route_str(c).toUpperCase()).join("\n");
        return `Which contract?\n\nYour contracts:\n${codes}\n\nTo clock in reply:\nIN ${wrap_ltgt("code")}`;
    }

    const now = new Date();
    const change_now = make_ci_now();
    const new_time_record: time_record = {
        _id: new ObjectId().toHexString(),
        custom_params: {},
        archived_info: make_ci_not_archived(),
        last_update: change_now,
        created: change_now,
        schema_version: TIME_RECORD_SCHEMA_VERSION,
        hrid: hres._id,
        cont_id: contract._id,
        notes: "",
        start: now,
        end: INVALID_DATETIME,
        date: day_start(now, contract.timezone),
    };
    const result = await time_coll.insertOne(new_time_record);
    if (result.acknowledged && result.insertedId === new_time_record._id) {
        ilog(
            `Created timesheet ${new_time_record._id} for ${new_time_record.hrid} (start: ${format_date_for_log(new_time_record.start)})`
        );
        const auto_note = user_contracts.length === 1 && !contract_code ? " (your only contract)" : "";
        return `Clocked in to ${get_best_route_str(contract)}${auto_note} at ${fmt_time(now, contract.timezone)}. Reply OUT when done.`;
    }
    return `Clock in failed - server error`;
}

async function handle_clock_out(hres: hresource): Promise<string> {
    const time_coll = mongo.get_trecs();
    const active = await find_active_time_entry(hres._id, time_coll);
    if (!active) {
        return "You're not currently clocked in. To clock in reply:\nIN";
    }
    const contract_coll = mongo.get_conts();
    const now = new Date();
    const change_now = { by: { source_str: hres._id }, on: now };

    const updated_result = await time_coll.updateOne(
        { _id: active._id },
        { $set: { end: now, last_update: change_now } }
    );
    if (updated_result.acknowledged && updated_result.matchedCount == updated_result.modifiedCount) {
        const contract = await contract_coll.findOne({ _id: active.cont_id });
        const code = contract ? get_best_route_str(contract) : active.cont_id;
        ilog(`Updated timesheet ${active._id} for ${hres._id} (end: ${format_date_for_log(now)})`);
        return `Clocked out of ${code} at ${fmt_time(now, contract?.timezone ?? null)}. Total: ${fmt_duration(active.start, now)}.`;
    }
    return "Server error - contact your admin";
}

async function handle_clock_status(hres: hresource): Promise<string> {
    const active = await find_active_time_entry(hres._id, mongo.get_trecs());
    if (!active) {
        return "You're not currently clocked in. To clock in reply:\nIN";
    }
    const contract_coll = mongo.get_conts();
    const contract = await contract_coll.findOne({ _id: active.cont_id });
    const code = contract ? get_best_route_str(contract) : active.cont_id;
    const now = new Date();
    return `Clocked in to ${code} since ${fmt_time(active.start, contract?.timezone ?? null)} (${fmt_duration(active.start, now)} elapsed).`;
}

async function handle_contracts(hres: hresource): Promise<string> {
    const contract_coll = mongo.get_conts();
    const user_contracts = await find_user_contracts(hres, contract_coll);
    if (user_contracts.length === 0) {
        return "You have no assigned contracts. Contact your admin.";
    }
    const list = user_contracts.map((c) => get_best_route_str(c).toUpperCase()).join("\n");
    return `Your contracts:\n${list}\n\n`;
}

async function process_message(from_phone: string, message: string) {
    const qual_result: hresource | string = await find_qualified_hres(from_phone);
    if (typeof qual_result === "string") return twiml(qual_result, from_phone);
    const hres: hresource = qual_result;
    ilog(`Matched ${from_phone} to ${hres.first_name} ${hres.last_name} (${hres._id})`);

    const cleaned = message.replace(/[^a-zA-Z0-9\s]/g, "").trim();
    const parts = cleaned.split(/\s+/);
    let response: string = `Unsupported message format. Please send a commands in following format:\n\n${MENU_MSG}`;
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
                response = await handle_clock_status(hres);
                break;
            case "CONTRACTS":
                response = await handle_contracts(hres);
                break;
            case "MENU":
                response = MENU_MSG;
                break;
            default:
                response = `Unknown command "${parts[0]}"\n${MENU_MSG}`;
        }
    }
    return twiml(response, from_phone);
}

const sms = {
    process_message,
    send_message,
    get_menu_message,
};
export default sms;
