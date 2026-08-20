/**
 * Shared Chat + Coding composer accept list for parse-document turns.
 *
 * v1.20.0 Phase 2 expanded this past PDF/image once the magic-byte router and
 * native Office engines existed. Image Studio / Video Lab keep the MediaComposer
 * default (`image/*`) and must not import this list.
 */

export const DOCUMENT_ACCEPT = [
  "application/pdf",
  "image/*",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx",
  ".pptx",
  ".xlsx",
].join(",");
