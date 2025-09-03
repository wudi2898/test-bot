export function encodeBase64(data) {
  const str = JSON.stringify(data);
  return Buffer.from(str).toString("base64");
}

export function decodeBase64(base64) {
  const str = Buffer.from(base64, "base64").toString();
  return JSON.parse(str);
}

// 示例
const arr = [0, 190, "molly", "Full", 3, Date.now()];
const encoded = encodeBase64(arr);
console.log("加密后:", encoded);

// const decoded = decodeBase64("WzAsIDE5MCwgInRnZGFuYTAiLCAiRnVsbCIsIDMsIDE3NTY3MTM2MjE4NDZd");
const decoded = decodeBase64(encoded);
console.log("解密后:", decoded);
