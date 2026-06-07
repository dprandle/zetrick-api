import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import sms from "./sms.js"

async function handle_post_sms(req: FastifyRequest, reply: FastifyReply) {
    const { From: from, Body: body } = req.body as Record<string, string>;
    ilog(`Received text from ${from}: ${body}`);
    const resp = sms.process_message(from, body);
    reply.type("text/xml").send(resp);
}

export function create_time_tracking_routes(): FastifyPluginAsync {
    return async (fastify: FastifyInstance) => {
        fastify.post("time-tracking/sms", handle_post_sms);
    };
}
