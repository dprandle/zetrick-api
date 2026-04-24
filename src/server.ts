import "./bootstrap.js";
import Fastify from "fastify";
import formbody from "@fastify/formbody";
import { connect_to_db, get_time_records } from "./db.js";

async function start_server() {
    const app = Fastify();

    await connect_to_db();

    app.register(formbody);

    app.post("/sms", async (req, reply) => {
        const { From: from, Body: body } = req.body as Record<string, string>;
        console.log(`SMS from ${from}: ${body}`);
        const time_records = get_time_records();

        reply.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message>Got your message!</Message>
</Response>
`);
    });

    try {
        await app.listen({ port: 3000 }, () => console.log("Running on port 3000"));
    } catch (err) {
        elog("Server failed to start:", err);
    }
}

start_server();
