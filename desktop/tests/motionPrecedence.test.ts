import { describe, expect, it } from "vitest";
import {
  allowsMotion,
  composerMotionCandidates,
  dockMotionCandidates,
  GENERATION_CANVAS_CANDIDATES,
  MOTION_PRECEDENCE,
  primaryMotion,
} from "../src/motion/precedence";

describe("motion precedence", () => {
  it("ranks orb above metal above beam above aurora", () => {
    expect(MOTION_PRECEDENCE).toEqual(["orb", "metal", "beam", "aurora"]);
    expect(primaryMotion(["beam", "orb", "metal"])).toBe("orb");
    expect(primaryMotion(["beam", "metal"])).toBe("metal");
    expect(primaryMotion(["aurora", "beam"])).toBe("beam");
    expect(primaryMotion(["aurora"])).toBe("aurora");
    expect(primaryMotion([])).toBeNull();
  });

  it("allows only the winning kind", () => {
    expect(allowsMotion("orb", ["orb", "beam"])).toBe(true);
    expect(allowsMotion("beam", ["orb", "beam"])).toBe(false);
    expect(allowsMotion("metal", ["metal", "beam"])).toBe(true);
  });

  it("picks beam while a composer is streaming and metal while it is focused", () => {
    expect(composerMotionCandidates({ streaming: true, focused: true })).toEqual(["beam"]);
    expect(composerMotionCandidates({ streaming: true, focused: false })).toEqual(["beam"]);
    expect(composerMotionCandidates({ streaming: false, focused: true })).toEqual(["metal"]);
    expect(composerMotionCandidates({ streaming: false, focused: false })).toEqual([]);
  });

  it("picks orb on a working dock and beam on an idle dock", () => {
    expect(dockMotionCandidates({ idle: true })).toEqual(["beam"]);
    expect(dockMotionCandidates({ idle: false })).toEqual(["orb"]);
    expect(dockMotionCandidates({ idle: false, loading: true })).toEqual(["orb"]);
  });

  it("lets the orb win on the retained generation canvas", () => {
    expect(primaryMotion(GENERATION_CANVAS_CANDIDATES)).toBe("orb");
    expect(allowsMotion("beam", GENERATION_CANVAS_CANDIDATES)).toBe(false);
    expect(allowsMotion("aurora", GENERATION_CANVAS_CANDIDATES)).toBe(false);
  });
});
