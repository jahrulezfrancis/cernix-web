import { getDatabase } from "@/server/db/database";
import { UserRepository } from "./user-repository";
import { createSessionRepository } from "./session-repository";

let userRepository: UserRepository | undefined;
let sessionRepository: ReturnType<typeof createSessionRepository> | undefined;

export function userRepositorySingleton(): UserRepository {
  if (!userRepository) userRepository = new UserRepository(getDatabase());
  return userRepository;
}

export function sessionRepositorySingleton() {
  if (!sessionRepository) {
    sessionRepository = createSessionRepository(getDatabase(), userRepositorySingleton());
  }
  return sessionRepository;
}

export function resetAuthRepositoriesForTests(): void {
  userRepository = undefined;
  sessionRepository = undefined;
}
