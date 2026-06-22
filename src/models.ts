export const OUR_UPDATE_BY = "sms";
export const TIME_RECORD_SCHEMA_VERSION = 1;

export interface uid {
    source_str: string;
}

export type change_info = {
    by: uid;
    on: Date;
};

export const INVALID_DATETIME = new Date("0001-01-01T00:00:00.000Z");
export const INVALID_IND = -1;

// The only parts of value_change_item we actually need
export type value_change_item<T> = {
    val: T;
    effective: Date;
};

export interface uobj_common {
    _id: string;
    custom_params: Record<string, string>;
    archived_info: change_info;
    last_update: change_info;
    created: change_info;
    schema_version: number;
}

export interface time_record extends uobj_common {
    hrid: string;
    cont_id: string;
    notes: string;
    start: Date;
    end: Date;
    date: Date;
}

export interface employment_date_info {
    start: Date;
    end: Date;
}

export const TIME_TRACKING_APP = 1;
export const TIME_TRACKING_SMS = 2;

// Employee role keys whose linked hresources should receive a jobcode assignment.
export const EMP_ACTIVE_ROLE_KEYS = new Set(["A_Main_Carrier[021422170000UTC]", "B_Sub_Carrier[021422170000UTC]"]);
const SUBC_ACTIVE_CARRIER_ROLES = new Set(["A_SC_Main_Carrier[021422170000UTC]", "B_SC_Sub_Carrier[021422170000UTC]"]);
const ACTIVE_CARRIER_ROLES = new Set([...EMP_ACTIVE_ROLE_KEYS, ...SUBC_ACTIVE_CARRIER_ROLES]);

const EMP_ROLE_KEYS = new Set([...EMP_ACTIVE_ROLE_KEYS, "C_Previous_Carrier[021422170000UTC]"]);

// Broader set of roles that mark an hresource as an employee or manager (vs. a subcontractor).
export const EMP_MGR_ROLE_KEYS = new Set([
    ...EMP_ROLE_KEYS,
    "B_West_Manager[021422170000UTC]",
    "C_South_Manager[021422170000UTC]",
    "D_East_Manager[021422170000UTC]",
]);

export interface hresource extends uobj_common {
    first_name: string;
    last_name: string;
    phone_number: string;
    email: string;
    notes: string;
    allowed_roles: uid[];
    employment_dates: employment_date_info;
    tt_flags: number;
}

export interface crole_link {
    emp_id: uid;
}

type byte = number;

export interface contract_route extends uobj_common {
    route_names: value_change_item<string>[];
    route_num: string;
    assignments: Record<string, crole_link[]>;
    timezone: byte[];
}

export function make_ci(by: string, on: Date): change_info {
    return { by: { source_str: by }, on };
}

export function make_ci_now(by_extra: string = ""): change_info {
    return make_ci(OUR_UPDATE_BY + by_extra, new Date());
}

export function make_ci_not_archived(by_extra: string = ""): change_info {
    return make_ci(OUR_UPDATE_BY + by_extra, INVALID_DATETIME);
}

export function changed_by_us(ci: change_info): boolean {
    return ci.by.source_str.includes(OUR_UPDATE_BY);
}

export function is_active(archived_on: Date): boolean {
    return archived_on.getTime() <= INVALID_DATETIME.getTime();
}

export function find_value_change_item<T>(
    items: value_change_item<T>[],
    effective: Date,
    start_ind_reverse: number = INVALID_IND
) {
    if (start_ind_reverse < 0 || start_ind_reverse > items.length) start_ind_reverse = items.length - 1;
    for (let ind = start_ind_reverse; ind >= 0 && ind < items.length; --ind) {
        if (items[ind].effective <= effective) {
            return ind;
        }
    }
    return INVALID_IND;
}

export function get_current_route_name(cont: contract_route): string {
    const ind = find_value_change_item(cont.route_names, new Date());
    return ind !== INVALID_IND ? cont.route_names[ind].val : "";
}

export function is_tracking_enabled(tt_flags: number, flag: number) {
    return (tt_flags & flag) !== 0;
}

export function can_track_time(tt_flags: number, archived_on: Date, flag: number): boolean {
    const tracking_enabled = is_tracking_enabled(tt_flags, flag);
    return is_active(archived_on) && tracking_enabled;
}

export function can_track_time_via_sms(tt_flags: number, archived_on: Date): boolean {
    return can_track_time(tt_flags, archived_on, TIME_TRACKING_SMS);
}

export function can_track_time_via_qbt(tt_flags: number, archived_on: Date): boolean {
    return can_track_time(tt_flags, archived_on, TIME_TRACKING_APP);
}

export function is_employee(hres: hresource): boolean {
    return hres.allowed_roles.some((r) => EMP_ROLE_KEYS.has(r.source_str));
}

export function is_employee_or_mgr(hres: hresource): boolean {
    return hres.allowed_roles.some((r) => EMP_MGR_ROLE_KEYS.has(r.source_str));
}

export function get_active_allowed_roles(hres: hresource) {
    return hres.allowed_roles.filter((r) => ACTIVE_CARRIER_ROLES.has(r.source_str));
}
