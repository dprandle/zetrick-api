import { MongoClient } from "mongodb";
import { config } from "./config.js";
let client;
async function connect() {
    client = new MongoClient(config.mongo.uri);
    await client.connect();
    ilog("Connected to MongoDB");
}
export function get_db() {
    return client.db(config.mongo.db_name);
}
export function get_trecs() {
    const db = get_db();
    return db.collection(config.mongo.time_records);
}
export function get_hresources() {
    const db = get_db();
    return db.collection(config.mongo.hresources);
}
export function get_conts() {
    const db = get_db();
    return db.collection(config.mongo.contracts);
}
const mongo = {
    connect,
    get_db,
    get_trecs,
    get_hresources,
    get_conts
};
export default mongo;
//# sourceMappingURL=db.js.map