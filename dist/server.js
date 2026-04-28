import "./bootstrap.js";
import Fastify from "fastify";
import formbody from "@fastify/formbody";
import { connect_to_db } from "./db.js";
import { create_sms_routes } from "./sms.js";
const port = 3000;
async function start_server() {
    const app = Fastify();
    await connect_to_db();
    app.register(formbody);
    app.register(create_sms_routes());
    try {
        await app.listen({ port: port });
        ilog(`Server listening at:`);
        ilog(`- Local:   http://localhost:${port}`);
    }
    catch (err) {
        elog("Server failed to start:", err);
    }
}
start_server();
