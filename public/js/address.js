/**
 * TON Address 工具类
 * 提供 TON 地址解析、验证和格式转换功能
 */

// 十六进制转换表
const HEX_CHARS_ARRAY = [];
const HEX_TO_BYTE_MAP = {};

// 初始化十六进制转换表
for (let charCode = 0; charCode <= 255; charCode++) {
  let hexChar = charCode.toString(16);
  if (hexChar.length < 2) {
    hexChar = "0" + hexChar;
  }
  HEX_CHARS_ARRAY.push(hexChar);
  HEX_TO_BYTE_MAP[hexChar] = charCode;
}

/**
 * 将字节数组转换为十六进制字符串
 * @param {Uint8Array} byteArray - 字节数组
 * @returns {string} 十六进制字符串
 */
function bytesToHex(byteArray) {
  let hexChars = [];
  for (let index = 0; index < byteArray.byteLength; index++) {
    hexChars.push(HEX_CHARS_ARRAY[byteArray[index]]);
  }
  return hexChars.join("");
}

/**
 * 将十六进制字符串转换为字节数组
 * @param {string} hexString - 十六进制字符串
 * @returns {Uint8Array} 字节数组
 */
function hexToBytes(hexString) {
  hexString = hexString.toLowerCase();
  let stringLength = hexString.length;
  
  if (stringLength % 2 !== 0) {
    throw new Error("hex string must have length a multiple of 2");
  }
  
  let byteLength = stringLength / 2;
  let resultArray = new Uint8Array(byteLength);
  
  for (let index = 0; index < byteLength; index++) {
    let hexIndex = 2 * index;
    let hexPair = hexString.substring(hexIndex, hexIndex + 2);
    
    if (!HEX_TO_BYTE_MAP.hasOwnProperty(hexPair)) {
      throw new Error("invalid hex character " + hexPair);
    }
    resultArray[index] = HEX_TO_BYTE_MAP[hexPair];
  }
  return resultArray;
}

/**
 * 将字符串转换为字节数组
 * @param {string} inputString - 输入字符串
 * @param {number} bytesPerChar - 每个字符的字节数 (1, 2, 或 4)
 * @returns {Uint8Array} 字节数组
 */
function stringToBytes(inputString, bytesPerChar = 1) {
  let arrayBuffer, typedArray;
  
  if (bytesPerChar === 1) {
    arrayBuffer = new ArrayBuffer(inputString.length);
    typedArray = new Uint8Array(arrayBuffer);
  } else if (bytesPerChar === 2) {
    arrayBuffer = new ArrayBuffer(2 * inputString.length);
    typedArray = new Uint16Array(arrayBuffer);
  } else if (bytesPerChar === 4) {
    arrayBuffer = new ArrayBuffer(4 * inputString.length);
    typedArray = new Uint32Array(arrayBuffer);
  }
  
  for (let index = 0, length = inputString.length; index < length; index++) {
    typedArray[index] = inputString.charCodeAt(index);
  }
  return new Uint8Array(typedArray.buffer);
}

/**
 * 计算 CRC16 校验和
 * @param {Uint8Array} data - 输入数据
 * @returns {Uint8Array} CRC16 校验和 (2字节)
 */
function calculateCrc16(data) {
  let crc = 0;
  let dataWithPadding = new Uint8Array(data.length + 2);
  dataWithPadding.set(data);
  
  for (let byte of dataWithPadding) {
    let mask = 128;
    while (mask > 0) {
      crc <<= 1;
      if (byte & mask) {
        crc += 1;
      }
      mask >>= 1;
      if (crc > 65535) {
        crc &= 65535;
        crc ^= 4129;
      }
    }
  }
  return new Uint8Array([Math.floor(crc / 256), crc % 256]);
}

// Base64 字符表
const BASE64_ALPHABET = (() => {
  let chars = [];
  // A-Z
  for (let index = 0; index < 26; ++index) {
    chars.push(String.fromCharCode(65 + index));
  }
  // a-z
  for (let index = 0; index < 26; ++index) {
    chars.push(String.fromCharCode(97 + index));
  }
  // 0-9
  for (let index = 0; index < 10; ++index) {
    chars.push(String.fromCharCode(48 + index));
  }
  chars.push("+");
  chars.push("/");
  return chars;
})();

/**
 * Base64 字符串转为普通字符串
 * @param {string} base64String - Base64 字符串
 * @returns {string} 解码后的字符串
 */
function base64ToString(base64String) {
  return typeof self === "undefined"
    ? Buffer.from(base64String, "base64").toString("binary")
    : atob(base64String);
}

/**
 * 字符串转为 Base64
 * @param {string} inputString - 输入字符串
 * @returns {string} Base64 编码字符串
 */
function stringToBase64(inputString) {
  return typeof self === "undefined"
    ? Buffer.from(inputString, "binary").toString("base64")
    : btoa(inputString);
}

// TON 地址标签常量
const BOUNCEABLE_TAG = 17;
const NON_BOUNCEABLE_TAG = 81;
const TEST_NETWORK_FLAG = 128;

/**
 * 解析用户友好格式的 TON 地址
 * @param {string} friendlyAddress - 48字符的用户友好地址
 * @returns {Object} 解析结果
 */
function parseFriendlyAddress(friendlyAddress) {
  if (friendlyAddress.length !== 48) {
    throw new Error("User-friendly address should contain strictly 48 characters");
  }
  
  let addressBytes = stringToBytes(base64ToString(friendlyAddress));
  if (addressBytes.length !== 36) {
    throw new Error("Unknown address type: byte length is not equal to 36");
  }
  
  let addressData = addressBytes.slice(0, 34);
  let providedChecksum = addressBytes.slice(34, 36);
  let calculatedChecksum = calculateCrc16(addressData);
  
  if (!(calculatedChecksum[0] === providedChecksum[0] && calculatedChecksum[1] === providedChecksum[1])) {
    throw new Error("Wrong crc16 hashsum");
  }
  
  let addressTag = addressData[0];
  let isTestNetwork = false;
  let isBounceable = false;
  
  // 检查测试网络标志
  if (addressTag & TEST_NETWORK_FLAG) {
    isTestNetwork = true;
    addressTag ^= TEST_NETWORK_FLAG;
  }
  
  // 检查地址标签
  if (addressTag !== BOUNCEABLE_TAG && addressTag !== NON_BOUNCEABLE_TAG) {
    throw new Error("Unknown address tag");
  }
  
  isBounceable = (addressTag === BOUNCEABLE_TAG);
  
  // 解析工作链
  let workchain = null;
  let workchainByte = addressData[1];
  if (workchainByte === 255) {
    workchain = -1;
  } else {
    workchain = workchainByte;
  }
  
  if (workchain !== 0 && workchain !== -1) {
    throw new Error("Invalid address workchain " + workchain);
  }
  
  let hashPart = addressData.slice(2, 34);
  
  return {
    isTestOnly: isTestNetwork,
    isBounceable: isBounceable,
    workchain: workchain,
    hashPart: hashPart,
  };
}

/**
 * TON 地址类
 */
class Address {
  /**
   * 验证地址是否有效
   * @param {string|Address} address - 要验证的地址
   * @returns {boolean} 地址是否有效
   */
  static isValid(address) {
    try {
      new Address(address);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 构造函数
   * @param {string|Address} address - 地址字符串或 Address 实例
   */
  constructor(address) {
    if (address == null) {
      throw new Error("Invalid address");
    }
    
    // 如果传入的是 Address 实例，复制其属性
    if (address instanceof Address) {
      this.wc = address.wc;
      this.hashPart = address.hashPart;
      this.isTestOnly = address.isTestOnly;
      this.isUserFriendly = address.isUserFriendly;
      this.isBounceable = address.isBounceable;
      this.isUrlSafe = address.isUrlSafe;
      return;
    }

    // 默认设置为 URL 安全格式
    this.isUrlSafe = true;
    
    // 检查并转换 URL 安全格式
    if (address.search(/\-/) > 0 || address.search(/_/) > 0) {
      address = address.replace(/\-/g, "+").replace(/_/g, "/");
    } else {
      this.isUrlSafe = false;
    }

    // 判断是原始格式还是用户友好格式
    if (address.indexOf(":") > -1) {
      // 原始格式 (workchain:hash)
      let addressParts = address.split(":");
      if (addressParts.length !== 2) {
        throw new Error("Invalid address " + address);
      }
      
      let workchain = parseInt(addressParts[0]);
      if (workchain !== 0 && workchain !== -1) {
        throw new Error("Invalid address workchain " + address);
      }
      
      let hashHex = addressParts[1];
      if (hashHex.length !== 64) {
        throw new Error("Invalid address hex " + address);
      }
      
      this.isUserFriendly = false;
      this.wc = workchain;
      this.hashPart = hexToBytes(hashHex);
      this.isTestOnly = false;
      this.isBounceable = false;
    } else {
      // 用户友好格式
      this.isUserFriendly = true;
      let parsedAddress = parseFriendlyAddress(address);
      this.wc = parsedAddress.workchain;
      this.hashPart = parsedAddress.hashPart;
      this.isTestOnly = parsedAddress.isTestOnly;
      this.isBounceable = parsedAddress.isBounceable;
    }
  }

  /**
   * 转换为字符串格式
   * @param {boolean} userFriendly - 是否使用用户友好格式
   * @param {boolean} urlSafe - 是否使用 URL 安全格式
   * @param {boolean} bounceable - 是否为可反弹地址
   * @param {boolean} testOnly - 是否为测试网络
   * @returns {string} 格式化的地址字符串
   */
  toString(userFriendly, urlSafe, bounceable, testOnly) {
    // 使用默认值
    if (userFriendly === undefined) userFriendly = this.isUserFriendly;
    if (urlSafe === undefined) urlSafe = this.isUrlSafe;
    if (bounceable === undefined) bounceable = this.isBounceable;
    if (testOnly === undefined) testOnly = this.isTestOnly;

    if (!userFriendly) {
      // 返回原始格式
      return this.wc + ":" + bytesToHex(this.hashPart);
    } else {
      // 返回用户友好格式
      let addressTag = bounceable ? BOUNCEABLE_TAG : NON_BOUNCEABLE_TAG;
      if (testOnly) {
        addressTag |= TEST_NETWORK_FLAG;
      }
      
      let addressData = new Int8Array(34);
      addressData[0] = addressTag;
      addressData[1] = this.wc;
      addressData.set(this.hashPart, 2);
      
      let addressWithChecksum = new Uint8Array(36);
      addressWithChecksum.set(addressData);
      addressWithChecksum.set(calculateCrc16(addressData), 34);
      
      let base64Result = stringToBase64(
        String.fromCharCode.apply(null, new Uint8Array(addressWithChecksum))
      );
      
      if (urlSafe) {
        base64Result = base64Result.replace(/\+/g, "-").replace(/\//g, "_");
      }
      
      return base64Result;
    }
  }
}
