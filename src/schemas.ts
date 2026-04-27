export interface uid {
    source_str: string;
}

export interface change_info {
    by: uid;
    on: Date;
}

export interface time_record {
    _id: string;
    archived_info: change_info;
    last_update: change_info;
    created: change_info;
    hrid: string;
    cont_id: string;
    start: Date;
    end: Date;
    date: Date;
    tsid: number;
}
