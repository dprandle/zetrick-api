import mongo from "./db.js";
import { can_track_time_via_qbt, can_track_time_via_sms, hresource } from "./models.js";

type qbt_invite_response = {
    message: string;
};

export type invite_result = {
    ok: boolean;
    message: string;
    status: number;
};

export const TT_SELECTIONS = ["qbt", "sms"] as const;
export type tt_selection = typeof TT_SELECTIONS[number];

async function create_qbt_invite(contact_method: string, hr: hresource): Promise<invite_result> {
    if (!can_track_time_via_qbt(hr.tt_flags, hr.archived_info.on)) {
        return {
            ok: false,
            message: `Cannot send invite as ${hr.first_name} ${hr.last_name} does not have time tracking enabled.`,
            status: 404,
        };
    }
    const result = await fetch("http://localhost:3001/invitation", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ contact_method, hres_id: hr._id }),
    });
    const data: qbt_invite_response = await result.json();
    return { ok: result.ok, message: data.message, status: result.status };
}

async function process_invitation(
    contact_method: string,
    hres_id: string,
    which: tt_selection
): Promise<invite_result> {
    const hrcoll = mongo.get_hresources();
    const hr = await hrcoll.findOne({ _id: hres_id });
    if (!hr) return { ok: false, message: `Could not find hres ${hres_id}`, status: 404 };

    switch (which) {
        case "sms":
            return { ok: false, message: `${which} is not yet implemented`, status: 404 };
        case "qbt":
            return create_qbt_invite(contact_method, hr);
        default:
            return { ok: false, message: `Unexpected request type ${which}`, status: 404 };
    }
}

const inv = {
    process_invitation,
};

export default inv;
