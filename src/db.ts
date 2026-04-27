import { MongoClient, type Collection, type Db } from "mongodb";
import { config } from "./config.js"
import { time_record, hresource, contract_route } from "./models.js"

let client: MongoClient;

export async function connect_to_db(): Promise<void> {
    client = new MongoClient(config.mongo.uri);
    await client.connect();
    ilog("Connected to MongoDB");
}

export function get_db(): Db {
    return client.db(config.mongo.db_name);
}

export function get_time_records(): Collection<time_record> {
    const db = get_db();
    return db.collection<time_record>(config.mongo.time_records);
}

export function get_hresources(): Collection<hresource> {
    const db = get_db();
    return db.collection<hresource>(config.mongo.hresources);
}

export function get_contracts(): Collection<contract_route> {
    const db = get_db();
    return db.collection<contract_route>(config.mongo.contracts);
}
