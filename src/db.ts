import { MongoClient, type Collection, type Document, type Db } from "mongodb";
import { config } from "../../../.emacs.d/backup/!home!dprandle!projects!zetrick-api!src!config.ts~";

let client: MongoClient;

export async function connect_to_db(): Promise<void> {
    client = new MongoClient(config.mongo_uri);
    await client.connect();
    ilog("Connected to MongoDB");
}

export function get_db(): Db {
    return client.db(config.mongo_db_name);
}
