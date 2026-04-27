import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { connect_to_db, get_time_records } from "./db.js";

function handle_post_sms(req: FastifyRequest, reply: FastifyReply) {
    const { From: from, Body: body } = req.body as Record<string, string>;
    console.log(`SMS from ${from}: ${body}`);
    const time_records = get_time_records();
    reply.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message>Got your message!</Message>
</Response>
`);
}

export function create_sms_routes(): FastifyPluginAsync {
    return async (fastify: FastifyInstance) => {
        fastify.post("/sms", handle_post_sms);
    };
}
