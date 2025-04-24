require("dotenv").config({ path: "config/.env" });
const express = require("express");
const ErrorHandler = require("./middleware/error");
const cookieParser = require("cookie-parser");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();

// CORS middleware
app.use(
  cors({
    origin: ["http://localhost:3000", "https://blacksell.vercel.app"],
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Express middleware
app.use(express.json({ limit: "100mb" }));
app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: true, limit: "100mb" }));

// Routes
const user = require("./controller/user");
const social = require("./controller/social");
const shop = require("./controller/shop");
const product = require("./controller/product");
const event = require("./controller/event");
const coupon = require("./controller/coupounCode");
const payment = require("./controller/payment");
const order = require("./controller/order");
const conversation = require("./controller/conversation");
const message = require("./controller/message");
const withdraw = require("./controller/withdraw");

app.use("/api/v2/user", user);
console.log("Registered routes: /api/v2/user");
app.use("/api/v2/social", social);
console.log("Registered routes: /api/v2/social");
app.use("/api/v2/conversation", conversation);
console.log("Registered routes: /api/v2/conversation");
app.use("/api/v2/message", message);
console.log("Registered routes: /api/v2/message");
app.use("/api/v2/order", order);
console.log("Registered routes: /api/v2/order");
app.use("/api/v2/shop", shop);
console.log("Registered routes: /api/v2/shop");
app.use("/api/v2/product", product);
console.log("Registered routes: /api/v2/product");
app.use("/api/v2/event", event);
console.log("Registered routes: /api/v2/event");
app.use("/api/v2/coupon", coupon);
console.log("Registered routes: /api/v2/coupon");
app.use("/api/v2/payment", payment);
console.log("Registered routes: /api/v2/payment");
app.use("/api/v2/withdraw", withdraw);
console.log("Registered routes: /api/v2/withdraw");

// Test route
app.use("/test", (req, res) => {
  res.send("Hello world!");
});

// Error handling middleware
app.use(ErrorHandler);

module.exports = app;
