import { MongoClient } from "mongodb";
import { config } from "./config.js";
let client;
export async function connect_to_db() {
    client = new MongoClient(config.mongo.uri);
    await client.connect();
    ilog("Connected to MongoDB");
}
export function get_db() {
    return client.db(config.mongo.db_name);
}
export function get_time_records() {
    const db = get_db();
    return db.collection(config.mongo.time_records);
}
export function get_hresources() {
    const db = get_db();
    return db.collection(config.mongo.hresources);
}
export function get_contracts() {
    const db = get_db();
    return db.collection(config.mongo.contracts);
}
