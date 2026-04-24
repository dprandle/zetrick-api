import { MongoClient, type Collection, type Db } from "mongodb";
import { config } from "./config.js"
import { time_record } from "./schemas.js"

let client: MongoClient;

export async function connect_to_db(): Promise<void> {
    client = new MongoClient(config.mongo_uri);
    await client.connect();
    ilog("Connected to MongoDB");
}

export function get_db(): Db {
    return client.db(config.mongo_db_name);
}

export function get_time_records(): Collection<time_record> {
    const db = get_db();
    return db.collection<time_record>(config.mongo_time_records);
}
