import "./bootstrap.js";
import express from "express";
import { connectDB, getTimeRecords } from "./db.js";
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.post("/sms", async (req, res) => {
    const from = req.body.From;
    const body = req.body.Body;
    console.log(`SMS from ${from}: ${body}`);
    const timeRecords = getTimeRecords();
    res.set("Content-Type", "text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message>Got your message!</Message>
</Response>
`);
});
connectDB().then(() => {
    app.listen(3000, () => console.log("Running on port 3000"));
});
