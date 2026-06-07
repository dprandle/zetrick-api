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
