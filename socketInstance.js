// socketInstance.js
let ioInstance = null;

const setIo = (io) => {
  ioInstance = io;
};

const getIo = () => {
  if (!ioInstance) {
    throw new Error("Socket.io instance not initialized");
  }
  return ioInstance;
};

const { getReceiverSocketId } = require("./socket/socket");

module.exports = { setIo, getIo, getReceiverSocketId };
