import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply, FastifySchema } from "fastify";
import sms from "./sms.js";
import inv, {TT_SELECTIONS, type tt_selection} from "./invitation.js"
import { config } from "./config.js";

// Rejects the request unless it carries the configured bearer token in the
// Authorization header. Used to guard the invitation route.
async function require_bearer_auth(req: FastifyRequest, reply: FastifyReply) {
    const header = req.headers.authorization;
    const expected = `Bearer ${config.invitation.auth_token}`;
    if (header !== expected) {
        return reply.code(401).send({ message: "Unauthorized" });
    }
}

async function handle_post_sms(req: FastifyRequest, reply: FastifyReply) {
    const { From: from, Body: body } = req.body as Record<string, string>;
    ilog(`Received text from ${from}: ${body}`);
    const resp = await sms.process_message(from, body);
    reply.type("text/xml").send(resp);
}

const CONTACT_METHODS = ["sms", "email"] as const;
type contact_method = typeof CONTACT_METHODS[number];

type invite_body = {
    hres_id: string;
    contact_method: contact_method;
    type: tt_selection;
};

// Fastify validates the body against this before our handler runs, so the
// handler can trust hres_id is a non-empty string and contact_method is valid.
const invite_body_schema = {
    type: "object",
    required: ["hres_id", "contact_method", "type"],
    additionalProperties: false,
    properties: {
        hres_id: { type: "string", minLength: 1 },
        contact_method: { type: "string", enum: CONTACT_METHODS },
        type: {type: "string", enum: TT_SELECTIONS},
    },
} as const;

async function handle_post_invitation(req: FastifyRequest<{ Body: invite_body }>, reply: FastifyReply) {
    //const { contact_method, hres_id, type } = req.body;
    ilog(`Received api call with contact_method:${req.body.contact_method} hres_id:${req.body.hres_id} type:${req.body.type}`);
    try {
        const result = await inv.process_invitation(req.body.contact_method, req.body.hres_id, req.body.type);
        return reply.code(result.status).send({ok: result.ok, message: result.message});
    } catch (err: any) {
        return reply.code(501).send(err);
    }
}

export function create_time_tracking_routes(): FastifyPluginAsync {
    return async (fastify: FastifyInstance) => {
        fastify.post("/time-tracking/sms", handle_post_sms);
        fastify.post<{ Body: invite_body }>(
            "/time-tracking/invitation",
            { preHandler: require_bearer_auth, schema: { body: invite_body_schema } },
            handle_post_invitation
        );
    };
}
