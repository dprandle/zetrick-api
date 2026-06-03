export interface uid {
    source_str: string;
}

export interface change_info {
    by: uid;
    on: Date;
}

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

export interface hresource extends uobj_common {
    first_name: string;
    last_name: string;
    phone_number: string;
    email: string;
    notes: string;
    allowed_roles: uid[];
    employment_dates: employment_date_info;
}

export interface crole_link {
    emp_id: uid;
}

type byte = number;

export interface contract_route extends uobj_common {
    route_num: string;
    assignments: Record<string, crole_link[]>;
    timezone: byte[];
}
