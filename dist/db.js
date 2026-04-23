import { MongoClient } from "mongodb";
import { config } from "./config.js";
let timeRecords;
export async function connectDB() {
    const client = new MongoClient(config.mongo_uri);
    await client.connect();
    const db = client.db(config.mongo_db_name);
    timeRecords = db.collection(config.mongo_time_records);
    console.log("Connected to MongoDB");
}
export function getTimeRecords() {
    return timeRecords;
}
