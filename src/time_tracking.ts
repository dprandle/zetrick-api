import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply, FastifySchema } from "fastify";

import sms from "./sms.js";
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

type contact_method = "sms" | "email";

type invite_body = {
    hres_id: string;
    contact_method: contact_method;
};

// Fastify validates the body against this before our handler runs, so the
// handler can trust hres_id is a non-empty string and contact_method is valid.
const invite_body_schema = {
    type: "object",
    required: ["hres_id", "contact_method"],
    additionalProperties: false,
    properties: {
        hres_id: { type: "string", minLength: 1 },
        contact_method: { type: "string", enum: ["sms", "email"] },
    },
} as const;

type qbt_invite_response = {
    message: string;
};

async function handle_post_invitation(req: FastifyRequest<{ Body: invite_body }>, reply: FastifyReply) {
    const { contact_method, hres_id } = req.body;
    ilog(`Received api call with contact_method:${contact_method} and hres_id:${hres_id}`);
    try {
        const result = await fetch("http://localhost:3001/invitation", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(req.body),
        });
        const data: qbt_invite_response = await result.json();
        return { ok: result.ok, message: data.message };
    } catch (err) {
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
