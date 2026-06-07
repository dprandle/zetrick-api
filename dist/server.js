import "./bootstrap.js";
import Fastify from "fastify";
import formbody from "@fastify/formbody";
import mongo from "./db.js";
import { create_time_tracking_routes } from "./time_tracking.js";
const port = 3000;
async function start_server() {
    const app = Fastify();
    await mongo.connect();
    app.register(formbody);
    app.register(create_time_tracking_routes());
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
//# sourceMappingURL=server.js.map