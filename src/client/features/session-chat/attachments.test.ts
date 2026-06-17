import { describe, expect, it } from "bun:test";
import { MAX_IMAGE_MB, imageFilesFrom, readPendingImages } from "./attachments.ts";

const fileList = (files: File[]) => files as unknown as FileList;
const oversize = () =>
  new File([new Uint8Array(MAX_IMAGE_MB * 1024 * 1024 + 1)], "big.png", { type: "image/png" });

describe("imageFilesFrom", () => {
  it("returns nothing for an absent list", () => {
    expect(imageFilesFrom(null)).toEqual([]);
    expect(imageFilesFrom(undefined)).toEqual([]);
  });

  it("keeps only image files", () => {
    const png = new File(["x"], "a.png", { type: "image/png" });
    const txt = new File(["x"], "a.txt", { type: "text/plain" });
    expect(imageFilesFrom(fileList([png, txt]))).toEqual([png]);
  });
});

describe("readPendingImages", () => {
  it("reads images into data-URL file parts", async () => {
    const { images, error } = await readPendingImages([
      new File(["hello"], "shot.png", { type: "image/png" }),
    ]);
    expect(error).toBeUndefined();
    expect(images).toHaveLength(1);
    expect(images[0].part).toMatchObject({
      type: "file",
      mediaType: "image/png",
      filename: "shot.png",
    });
    expect(images[0].part.url.startsWith("data:image/png")).toBe(true);
    expect(images[0].id).toBeTruthy();
  });

  it("skips a file over the size cap and reports why", async () => {
    const { images, error } = await readPendingImages([oversize()]);
    expect(images).toHaveLength(0);
    expect(error).toContain(`${MAX_IMAGE_MB} MB`);
  });

  it("keeps the valid images when a sibling is too large", async () => {
    const { images, error } = await readPendingImages([
      new File(["hi"], "ok.png", { type: "image/png" }),
      oversize(),
    ]);
    expect(images).toHaveLength(1);
    expect(images[0].part.filename).toBe("ok.png");
    expect(error).toBeDefined();
  });
});
