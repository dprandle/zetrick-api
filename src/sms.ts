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
    get_active_allowed_roles,
    is_employee,
} from "./models.js";

const INVALID_DATETIME = new Date(-62135596800000);

const client = twilio(config.twilio.account_sid, config.twilio.auth_token);

const MENU_MSG = `Commands (case insensitive):
IN → clock in
OUT → clock out
STATUS → your current clock status
LAST → summary of your last time entry
MENU → show this list

If you work more than one contract:
CONTRACTS → list your contracts
IN contract_name → clock in to contract_name

Adding notes:
OUT your_note_here → clock out with a note added to the time entry
ADDNOTE your_note_here → add a note to your current time entry if clocked in, or to your last time entry if clocked out
ADDNOTE LAST your_note_here → add a note to your last clocked-out time entry`;

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

function get_menu_message(is_employee: boolean) {
    return !is_employee ? MENU_MSG : MENU_MSG.replaceAll("contract", "route").replaceAll("CONTRACT", "ROUTE");
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

function fmt_since(start: Date, now: Date, tz_bytes: number[] | null): string {
    const time = fmt_time(start, tz_bytes);
    if (!tz_bytes) return time;
    const start_day = day_start(start, tz_bytes);
    const now_day = day_start(now, tz_bytes);
    const diff_days = Math.round((now_day.getTime() - start_day.getTime()) / 86400000);
    if (diff_days <= 0) return time;
    if (diff_days === 1) return `yesterday at ${time}`;
    const date_str = start.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", timeZone: tz_str(tz_bytes) });
    return `${date_str} at ${time}`;
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

function xml_escape(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Prefix a note with a compact timestamp for provenance. Shows just the time when the note is
// added on the same (timezone-local) day as the record's clock-in, and prepends MM/DD otherwise
// (e.g. for an ADDNOTE LAST made the next day).
function stamp_note(note: string, now: Date, record_start: Date, tz_bytes: number[] | null): string {
    const time = fmt_time(now, tz_bytes);
    if (!tz_bytes) return `[${time}] ${note}`;
    const same_day = day_start(now, tz_bytes).getTime() === day_start(record_start, tz_bytes).getTime();
    if (same_day) return `[${time}] ${note}`;
    const date_str = now.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", timeZone: tz_str(tz_bytes) });
    return `[${date_str} ${time}] ${note}`;
}

function get_best_route_str(c: contract_route) {
    return c.route_num || get_current_route_name(c);
}

async function find_user_contracts(hr: hresource, contracts: Collection<contract_route>): Promise<contract_route[]> {
    // Narrow hr allowed roles to only active ones
    const active_allowed_roles = get_active_allowed_roles(hr);
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

async function find_most_recent_completed(
    hrid: string,
    time_coll: Collection<time_record>,
    end_cutoff?: Date
): Promise<time_record | null> {
    const end_filter: Record<string, Date> = { $ne: INVALID_DATETIME };
    if (end_cutoff) end_filter.$gte = end_cutoff;
    return time_coll.find({ hrid, end: end_filter }).sort({ end: -1 }).limit(1).next();
}

function fmt_completed(rec: time_record, contract: contract_route | null): string {
    const code = contract ? get_best_route_str(contract) : rec.cont_id;
    const tz = contract?.timezone ?? null;
    let msg = `Clocked out of ${code} at ${fmt_time(rec.end, tz)} - clocked in at ${fmt_since(rec.start, rec.end, tz)}. Total: ${fmt_duration(rec.start, rec.end)}.`;
    if (rec.notes) msg += `\n${xml_escape(rec.notes)}`;
    return msg;
}

function fmt_status(rec: time_record, contract: contract_route | null): string {
    const code = contract ? get_best_route_str(contract) : rec.cont_id;
    const tz = contract?.timezone ?? null;
    const now = new Date();
    let msg = `Clocked in to ${code} since ${fmt_since(rec.start, now, tz)} (${fmt_duration(rec.start, now)} elapsed).`;
    if (rec.notes) msg += `\n${xml_escape(rec.notes)}`;
    return msg;
}

async function handle_clock_in(hres: hresource, contract_code: string | null): Promise<string> {
    const contract_coll = mongo.get_conts();
    const time_coll = mongo.get_trecs();
    const active = await find_active_time_entry(hres._id, time_coll);
    if (active) {
        const contract = await contract_coll.findOne({ _id: active.cont_id });
        const code = contract ? get_best_route_str(contract) : active.cont_id;
        const tz = contract?.timezone ?? null;
        const since = fmt_since(active.start, new Date(), tz);
        return `You're already clocked in to ${code} (since ${since}). To clock out reply OUT`;
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
            return `Unknown contract "${contract_code}".\nYour contracts:\n${codes}`;
        }
    } else if (user_contracts.length === 1) {
        contract = user_contracts[0];
    } else {
        const codes = user_contracts.map((c) => get_best_route_str(c).toUpperCase()).join("\n");
        return `Which contract?\nYour contracts:\n${codes}\nTo clock in reply IN [contract]`;
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

async function handle_clock_out(hres: hresource, note: string): Promise<string> {
    const time_coll = mongo.get_trecs();
    const active = await find_active_time_entry(hres._id, time_coll);
    if (!active) {
        return "You're not currently clocked in. To clock in reply IN";
    }
    const contract_coll = mongo.get_conts();
    const contract = await contract_coll.findOne({ _id: active.cont_id });
    const now = new Date();
    const change_now = { by: { source_str: hres._id }, on: now };

    const set_fields: { end: Date; last_update: typeof change_now; notes?: string } = {
        end: now,
        last_update: change_now,
    };
    let new_notes = active.notes;
    if (note) {
        const stamped = stamp_note(note, now, active.start, contract?.timezone ?? null);
        new_notes = active.notes ? `${active.notes}\n${stamped}` : stamped;
        set_fields.notes = new_notes;
    }

    const updated_result = await time_coll.updateOne({ _id: active._id }, { $set: set_fields });
    if (updated_result.acknowledged && updated_result.matchedCount == updated_result.modifiedCount) {
        ilog(`Updated timesheet ${active._id} for ${hres._id} (end: ${format_date_for_log(now)})`);
        active.end = now;
        active.notes = new_notes;
        return fmt_completed(active, contract);
    }
    return "Server error - contact your admin";
}

async function handle_last(hres: hresource): Promise<string> {
    const time_coll = mongo.get_trecs();
    const rec = await find_most_recent_completed(hres._id, time_coll);
    if (!rec) {
        return "No previous time records found - to clock in send IN";
    }
    const contract = await mongo.get_conts().findOne({ _id: rec.cont_id });
    return fmt_completed(rec, contract);
}

async function handle_add_note(hres: hresource, note: string, ignore_active: boolean): Promise<string> {
    if (!note) {
        return "Provide a note, e.g. ADDNOTE finished early";
    }
    const time_coll = mongo.get_trecs();
    let target: time_record | null = null;
    let clocked_in = false;
    if (!ignore_active) {
        const active = await find_active_time_entry(hres._id, time_coll);
        if (active) {
            target = active;
            clocked_in = true;
        }
    }
    if (!target) {
        const cutoff = new Date(Date.now() - 2 * 86400000);
        target = await find_most_recent_completed(hres._id, time_coll, cutoff);
    }
    if (!target) {
        return "No recent time record (last 2 days) to add a note to.";
    }
    const contract = await mongo.get_conts().findOne({ _id: target.cont_id });
    const now = new Date();
    const stamped = stamp_note(note, now, target.start, contract?.timezone ?? null);
    const new_notes = target.notes ? `${target.notes}\n${stamped}` : stamped;
    const change_now = { by: { source_str: hres._id }, on: now };
    await time_coll.updateOne({ _id: target._id }, { $set: { notes: new_notes, last_update: change_now } });
    target.notes = new_notes;
    return clocked_in ? fmt_status(target, contract) : fmt_completed(target, contract);
}

async function handle_clock_status(hres: hresource): Promise<string> {
    const active = await find_active_time_entry(hres._id, mongo.get_trecs());
    if (!active) {
        return "You're not currently clocked in. To clock in reply IN";
    }
    const contract_coll = mongo.get_conts();
    const contract = await contract_coll.findOne({ _id: active.cont_id });
    return fmt_status(active, contract);
}

async function handle_contracts(hres: hresource): Promise<string> {
    const contract_coll = mongo.get_conts();
    const user_contracts = await find_user_contracts(hres, contract_coll);
    if (user_contracts.length === 0) {
        return "You have no assigned contracts. Contact your admin.";
    }
    const list = user_contracts.map((c) => get_best_route_str(c).toUpperCase()).join("\n");
    return `Your contracts:\n${list}`;
}

async function process_message(from_phone: string, message: string) {
    const qual_result: hresource | string = await find_qualified_hres(from_phone);
    if (typeof qual_result === "string") return twiml(qual_result, from_phone);
    const hres: hresource = qual_result;
    ilog(`Matched ${from_phone} to ${hres.first_name} ${hres.last_name} (${hres._id})`);

    // QString::simplified equivalent: trim ends and collapse internal whitespace runs to a
    // single space, while preserving punctuation so free-text notes keep their characters.
    const simplified = message.trim().replace(/\s+/g, " ");
    const tokens = simplified.length ? simplified.split(" ") : [];
    const keyword = (tokens[0] ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const menu_message = get_menu_message(is_employee(hres));
    let response: string;
    switch (keyword) {
        case "IN":
            if (tokens.length > 2) {
                response = `Unsupported message format. Please send a commands in following format:\n\n${menu_message}`;
            } else {
                const contract = tokens[1] ? tokens[1].replace(/[^a-zA-Z0-9]/g, "") : null;
                response = await handle_clock_in(hres, contract);
            }
            break;
        case "OUT":
            response = await handle_clock_out(hres, tokens.slice(1).join(" "));
            break;
        case "STATUS":
            response = await handle_clock_status(hres);
            break;
        case "LAST":
            response = await handle_last(hres);
            break;
        case "ADDNOTE": {
            const sub = (tokens[1] ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
            response =
                sub === "LAST"
                    ? await handle_add_note(hres, tokens.slice(2).join(" "), true)
                    : await handle_add_note(hres, tokens.slice(1).join(" "), false);
            break;
        }
        case "CONTRACTS":
            response = await handle_contracts(hres);
            break;
        case "MENU":
            response = menu_message;
            break;
        default:
            response = `Unknown command "${tokens[0] ?? ""}"\n${menu_message}`;
    }
    return twiml(response, from_phone);
}

const sms = {
    process_message,
    send_message,
    get_menu_message,
};
export default sms;
