import { MongoClient } from "mongodb";
import { config } from "./config.js";
let client;
export async function connect_to_db() {
    client = new MongoClient(config.mongo_uri);
    await client.connect();
    ilog("Connected to MongoDB");
}
export function get_db() {
    return client.db(config.mongo_db_name);
}
export function get_time_records() {
    const db = get_db();
    return db.collection(config.mongo_time_records);
}
