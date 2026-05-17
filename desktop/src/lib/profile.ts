// Phase 1 profile loader. In a Tauri build the profile lives at
// `~/.nexus/profile.json` and is read through a Rust command; until that lands
// we fall back to a localStorage shim, then to "User".

import { z } from "zod";

export const Profile = z.object({
  firstName: z.string().min(1).max(64),
});
export type ProfileT = z.infer<typeof Profile>;

const PROFILE_KEY = "nexus.profile";

export function readProfileSync(): ProfileT {
  try {
    if (typeof window === "undefined") return { firstName: "User" };
    const raw = window.localStorage?.getItem(PROFILE_KEY);
    if (!raw) return { firstName: "User" };
    const parsed = Profile.safeParse(JSON.parse(raw));
    if (!parsed.success) return { firstName: "User" };
    return parsed.data;
  } catch {
    return { firstName: "User" };
  }
}

export function writeProfileSync(profile: ProfileT): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage?.setItem(PROFILE_KEY, JSON.stringify(Profile.parse(profile)));
  } catch {
    // ignore
  }
}
