const cron = require("node-cron");
const Event = require("../model/event");

const updateEventStatuses = async () => {
  try {
    const now = new Date();
    const eventsToUpdate = await Event.find({
      status: "Running",
      Finish_Date: { $lt: now },
    });

    if (eventsToUpdate.length === 0) {
      console.info("updateEventStatuses: No events to update", {
        timestamp: now,
      });
      return;
    }

    const updatePromises = eventsToUpdate.map(async (event) => {
      event.status = "Completed";
      event.statusHistory.push({
        status: "Completed",
        updatedAt: now,
        reason: "Event ended (Finish_Date passed)",
      });
      await event.save({ validateBeforeSave: false });
      console.info("updateEventStatuses: Event status updated", {
        eventId: event._id,
        shopId: event.shopId,
        name: event.name,
      });
    });

    await Promise.all(updatePromises);
    console.info("updateEventStatuses: Completed", {
      updatedCount: eventsToUpdate.length,
      timestamp: now,
    });
  } catch (error) {
    console.error("updateEventStatuses error:", {
      message: error.message,
      timestamp: now,
    });
  }
};

// Schedule job to run daily at midnight
const scheduleEventStatusUpdates = () => {
  cron.schedule("0 0 * * *", () => {
    console.info("Running event status update job", { timestamp: new Date() });
    updateEventStatuses();
  });
};

module.exports = { scheduleEventStatusUpdates, updateEventStatuses };
