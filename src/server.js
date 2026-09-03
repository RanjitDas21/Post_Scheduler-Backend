import express from "express";
import connectDB from "./db/db.js";
import cookieParser from "cookie-parser";
import cors from "cors";
import 'dotenv/config';

const app = express();
const PORT = process.env.PORT || 4000


app.use(express.json({limit: "5mb"}));
app.use(express.urlencoded({ extended: true }));
app.use(
    cors({origin: process.env.CLINT_URL, credentials: true})
);
app.use(cookieParser());

connectDB()
.then(() => {
    app.listen(PORT, () => {
        console.log(`Server is running at port: ${PORT}`);
    })
})
.catch((err) => {
    console.log("MongoDB connection failed !! ", err);
})
