import mongo from "./db.js";
import sms from "./sms.js";
import { can_track_time_via_qbt, can_track_time_via_sms, hresource } from "./models.js";
import { config } from "./config.js";

const DEV_PHONE_NUMBER = "+19076874045";

const CONTACT_METHODS = ["sms", "email"] as const;
type contact_method = (typeof CONTACT_METHODS)[number];

const TT_SELECTIONS = ["qbt", "sms"] as const;
type tt_selection = (typeof TT_SELECTIONS)[number];

export type invite_request_body = {
    hres_id: string;
    contact_method: contact_method;
    type: tt_selection;
};

// Fastify validates the body against this before our handler runs, so the
// handler can trust hres_id is a non-empty string and contact_method is valid.
const invite_request_body_schema = {
    type: "object",
    required: ["hres_id", "contact_method", "type"],
    additionalProperties: false,
    properties: {
        hres_id: { type: "string", minLength: 1 },
        contact_method: { type: "string", enum: CONTACT_METHODS },
        type: { type: "string", enum: TT_SELECTIONS },
    },
} as const;

type qbt_invite_response = {
    message: string;
};

export type invite_result = {
    ok: boolean;
    message: string;
    status: number;
};

function get_invite_request_body_schema() {
    return invite_request_body_schema;
}

async function create_qbt_invite(contact_method: string, hr: hresource): Promise<invite_result> {
    if (!can_track_time_via_qbt(hr.tt_flags, hr.archived_info.on)) {
        return {
            ok: false,
            message: `Cannot send QBT invite as ${hr.first_name} ${hr.last_name} does not have QBT time tracking enabled.`,
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

async function create_sms_invitation(hr: hresource): Promise<invite_result> {
    if (!can_track_time_via_sms(hr.tt_flags, hr.archived_info.on)) {
        return {
            ok: false,
            message: `Cannot send SMS invite as ${hr.first_name} ${hr.last_name} does not have SMS time tracking enabled.`,
            status: 404,
        };
    }

    const result = await sms.send_message(
        config.env === "prod" ? hr.phone_number : DEV_PHONE_NUMBER,
        `Welcome to Zetrick's SMS clock-in system!\n${sms.get_menu_message()}`
    );

    return {
        ok: true,
        message: `Successfully created sms at ${result.created} -- sid:${result.sid} status:${result.status}`,
        status: 201,
    };
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
            if (contact_method === "email") {
                return { ok: false, message: `${contact_method} invitation is not supported for sms`, status: 404 };
            }
            return create_sms_invitation(hr);
        case "qbt":
            return create_qbt_invite(contact_method, hr);
        default:
            return { ok: false, message: `Unexpected request type ${which}`, status: 404 };
    }
}

const inv = {
    process_invitation,
    get_invite_request_body_schema,
};

export default inv;
