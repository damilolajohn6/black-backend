const mongoose = require("mongoose");

const followerSchema = new mongoose.Schema(
  {
    follower: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    followed: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    followedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

followerSchema.index({ follower: 1, followed: 1 }, { unique: true });
followerSchema.index({ followed: 1 });

module.exports = mongoose.model("Follower", followerSchema);
