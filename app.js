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
    origin: ["http://localhost:3000", "https://example.com"],
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
const adminRoutes = require("./controller/admin");
const instructor = require("./controller/instructor");
const enrollment = require("./controller/enrollment");
const review = require("./controller/review");
const course = require("./controller/course");
const courseReviews = require("./controller/reviews");
const analytics = require("./controller/analytics");
const instructorWithdrawal = require("./controller/instructorWithdrawal");

app.use("/api/v2/user", user);
app.use("/api/v2/social", social);
app.use("/api/v2/conversation", conversation);
app.use("/api/v2/message", message);
app.use("/api/v2/order", order);
app.use("/api/v2/shop", shop);
app.use("/api/v2/product", product);
app.use("/api/v2/event", event);
app.use("/api/v2/coupon", coupon);
app.use("/api/v2/payment", payment);
app.use("/api/v2/withdraw", withdraw);
app.use("/api/v2/admin", adminRoutes);
app.use("/api/v2/instructor", instructor);
app.use("/api/v2/enrollment", enrollment);
app.use("/api/v2/review", review);
app.use("/api/v2/course", course);
app.use("/api/v2/course-reviews", courseReviews);
app.use("/api/v2/analytics", analytics);
app.use("/api/v2/instructor-withdraw", instructorWithdrawal);

// Test route
app.use("/test", (req, res) => {
  res.send("Hello world!");
});

// Error handling middleware
app.use(ErrorHandler);

module.exports = app;
