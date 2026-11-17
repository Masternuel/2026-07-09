export class RoomError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = "RoomError";
    this.code = code;
    this.status = status;
  }
}
