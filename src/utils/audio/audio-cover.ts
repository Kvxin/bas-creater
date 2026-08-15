import { FileRef } from "@dantheman827/taglib-ts/fileRef.js";

/** 从 TagLib 的统一 PICTURE 属性中提取内嵌封面。 */
export async function extractAudioCover(file: File): Promise<string | null> {
  try {
    const reference = await FileRef.fromBlob(file, file.name, false);
    const pictures = reference.complexProperties("PICTURE");
    const picture =
      pictures.find((item) => {
        const type = item.get("pictureType")?.toString().toLowerCase();
        return type === "3" || type === "front cover";
      }) ?? pictures[0];
    const data = picture?.get("data")?.toByteVector().data;

    if (!data?.length) return null;

    let base64 = "";
    for (const byte of data) {
      base64 += String.fromCharCode(byte);
    }

    const mimeType = picture.get("mimeType")?.toString() || "image/jpeg";
    return `data:${mimeType};base64,${window.btoa(base64)}`;
  } catch {
    return null;
  }
}
