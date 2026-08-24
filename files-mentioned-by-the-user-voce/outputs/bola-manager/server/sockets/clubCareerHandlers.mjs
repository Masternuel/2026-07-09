import {
  clubNewsReadSchema,
  clubStaffFireSchema,
  clubStaffHireSchema,
  clubStaffRenewSchema,
  clubUpgradeSchema,
  parseOrThrow,
  professionalLifecycleSocketSchema,
} from "../schemas.mjs";
import { emitRoomForViewers, roomForViewer } from "../services/roomVisibility.mjs";
import { registerSafe, rememberMembership } from "./helpers.mjs";

async function publish(io, socket, room, managerId) {
  rememberMembership(socket, room.code);
  await emitRoomForViewers(io, room);
  return roomForViewer(room, managerId);
}

export function registerClubCareerHandlers(io, socket, { store }) {
  const user = socket.data.user;

  registerSafe(socket, "club:upgrade", async (payload) => {
    const data = parseOrThrow(clubUpgradeSchema, payload);
    const result = await store.startClubFacilityUpgrade(data.code, user.uid, data);
    return {
      ...result,
      room: await publish(io, socket, result.room, user.uid),
    };
  });

  registerSafe(socket, "career:staff:hire", async (payload) => {
    const data = parseOrThrow(clubStaffHireSchema, payload);
    const result = await store.hireClubStaff(data.code, user.uid, data);
    return {
      ...result,
      room: await publish(io, socket, result.room, user.uid),
    };
  });

  registerSafe(socket, "career:staff:fire", async (payload) => {
    const data = parseOrThrow(clubStaffFireSchema, payload);
    const result = await store.fireClubStaff(data.code, user.uid, data);
    return {
      ...result,
      room: await publish(io, socket, result.room, user.uid),
    };
  });

  registerSafe(socket, "career:staff:renew", async (payload) => {
    const data = parseOrThrow(clubStaffRenewSchema, payload);
    const result = await store.renewClubStaff(data.code, user.uid, data);
    return {
      ...result,
      room: await publish(io, socket, result.room, user.uid),
    };
  });

  registerSafe(socket, "career:professional:lifecycle", async (payload) => {
    const data = parseOrThrow(professionalLifecycleSocketSchema, payload);
    const result = await store.manageProfessionalLifecycle(data.code, user.uid, data);
    return {
      ...result,
      room: await publish(io, socket, result.room, user.uid),
    };
  });

  registerSafe(socket, "club:news-read", async (payload) => {
    const data = parseOrThrow(clubNewsReadSchema, payload);
    const result = await store.markClubNewsRead(data.code, user.uid, data);
    return {
      ...result,
      room: await publish(io, socket, result.room, user.uid),
    };
  });
}
