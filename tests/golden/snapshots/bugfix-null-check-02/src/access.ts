export interface User {
  profile?: { name: string } | null;
}

export function getName(user: User | null): string {
  // BUG: accesses .profile.name without null guard
  return user.profile.name;
}
