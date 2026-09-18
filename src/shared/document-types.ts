// Document attachments ride the message as binary file parts, so unlike text
// files (inlined as text) they only reach a model whose provider transport
// maps the part. Which types a session can attach is decided server-side per
// provider (see `endpointFor`); this list is the vocabulary both sides
// share, keyed by extension because browsers report an empty or generic MIME
// type for many Office files.

/** The one document type every hosted provider path accepts. */
export const PDF_MEDIA_TYPE = "application/pdf";

/** Every attachable document type: its file extension and the media type it rides as. */
export const DOCUMENT_TYPES: readonly { extension: string; mediaType: string }[] = [
  { extension: ".pdf", mediaType: PDF_MEDIA_TYPE },
  {
    extension: ".docx",
    mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  { extension: ".doc", mediaType: "application/msword" },
  {
    extension: ".pptx",
    mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
  { extension: ".ppt", mediaType: "application/vnd.ms-powerpoint" },
  {
    extension: ".xlsx",
    mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  { extension: ".xls", mediaType: "application/vnd.ms-excel" },
];

/** The media types of every document type, PDF first. */
export const ALL_DOCUMENT_MEDIA_TYPES: readonly string[] = DOCUMENT_TYPES.map(
  (type) => type.mediaType,
);
