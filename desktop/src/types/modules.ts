// The four Nexus pillars (formally named in pivot-brief Section 2 and
// codified as design tokens in tokens.css).

export const MODULE_IDS = ["chatbot", "coding", "image", "video"] as const;

export type ModuleId = (typeof MODULE_IDS)[number];

export interface ModuleDescriptor {
  id: ModuleId;
  label: string;
  route: string;
  accentVar: string;
  accentSoftVar: string;
}

export const MODULES: Record<ModuleId, ModuleDescriptor> = {
  chatbot: {
    id: "chatbot",
    label: "Chatbot",
    route: "/chatbot",
    accentVar: "--accent-chatbot",
    accentSoftVar: "--accent-chatbot-soft",
  },
  coding: {
    id: "coding",
    label: "Agents",
    route: "/coding",
    accentVar: "--accent-coding",
    accentSoftVar: "--accent-coding-soft",
  },
  image: {
    id: "image",
    label: "Images",
    route: "/images",
    accentVar: "--accent-image",
    accentSoftVar: "--accent-image-soft",
  },
  video: {
    id: "video",
    label: "Videos",
    route: "/videos",
    accentVar: "--accent-video",
    accentSoftVar: "--accent-video-soft",
  },
};

export const moduleList: readonly ModuleDescriptor[] = MODULE_IDS.map(
  (id) => MODULES[id],
);

export function isModuleId(value: string): value is ModuleId {
  return (MODULE_IDS as readonly string[]).includes(value);
}
