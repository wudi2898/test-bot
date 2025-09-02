const to_hex_array = [],
    to_byte_map = {};
for (let ord = 0; ord <= 255; ord++) {
    let e = ord.toString(16);
    e.length < 2 && (e = "0" + e),
        to_hex_array.push(e),
        to_byte_map[e] = ord
}
function bytesToHex(e) {
    let t = [];
    for (let s = 0; s < e.byteLength; s++)
        t.push(to_hex_array[e[s]]);
    return t.join("")
}
function hexToBytes(e) {
    e = e.toLowerCase();
    let t = e.length;
    if (t % 2 != 0)
        throw "hex string must have length a multiple of 2";
    let s = t / 2,
        r = new Uint8Array(s);
    for (let n = 0; n < s; n++) {
        let i = 2 * n,
            l = e.substring(i, i + 2);
        if (!to_byte_map.hasOwnProperty(l))
            throw Error("invalid hex character " + l);
        r[n] = to_byte_map[l]
    }
    return r
}
function stringToBytes(e, t = 1) {
    let s,
        r;
    1 === t && (s = new ArrayBuffer(e.length), r = new Uint8Array(s)),
        2 === t && (s = new ArrayBuffer(2 * e.length), r = new Uint16Array(s)),
        4 === t && (s = new ArrayBuffer(4 * e.length), r = new Uint32Array(s));
    for (let n = 0, i = e.length; n < i; n++)
        r[n] = e.charCodeAt(n);
    return new Uint8Array(r.buffer)
}
function crc16(e) {
    let t = 0,
        s = new Uint8Array(e.length + 2);
    for (let r of (s.set(e), s)) {
        let n = 128;
        for (; n > 0;)
            t <<= 1,
                r & n && (t += 1),
                n >>= 1,
                t > 65535 && (t &= 65535, t ^= 4129)
    }
    return new Uint8Array([Math.floor(t / 256), t % 256])
}
const base64abc = (() => {
    let e = [];
    for (let t = 0; t < 26; ++t)
        e.push(String.fromCharCode(65 + t));
    for (let s = 0; s < 26; ++s)
        e.push(String.fromCharCode(97 + s));
    for (let r = 0; r < 10; ++r)
        e.push(String.fromCharCode(48 + r));
    return e.push("+"), e.push("/"), e
})();
function base64toString(e) {
    return "undefined" == typeof self ? Buffer.from(e, "base64").toString("binary") : atob(e)
}
function stringToBase64(e) {
    return "undefined" == typeof self ? Buffer.from(e, "binary").toString("base64") : btoa(e)
}
const bounceable_tag = 17,
    non_bounceable_tag = 81,
    test_flag = 128;
function parseFriendlyAddress(e) {
    if (48 !== e.length)
        throw Error("User-friendly address should contain strictly 48 characters");
    let t = stringToBytes(base64toString(e));
    if (36 !== t.length)
        throw "Unknown address type: byte length is not equal to 36";
    let s = t.slice(0, 34),
        r = t.slice(34, 36),
        n = crc16(s);
    if (!(n[0] === r[0] && n[1] === r[1]))
        throw "Wrong crc16 hashsum";
    let i = s[0],
        l = !1,
        o = !1;
    if (128 & i && (l = !0, i ^= 128), 17 !== i && 81 !== i)
        throw "Unknown address tag";
    o = 17 === i;
    let a = null;
    if (0 !== (a = 255 === s[1] ? -1 : s[1]) && -1 !== a)
        throw Error("Invalid address wc " + a);
    let h = s.slice(2, 34);
    return {
        isTestOnly: l,
        isBounceable: o,
        workchain: a,
        hashPart: h
    }
}
class Address {
    static isValid(e) {
        try {
            return new Address(e), !0
        } catch (t) {
            return !1
        }
    }
    constructor(e) {
        if (null == e)
            throw "Invalid address";
        if (e instanceof Address) {
            this.wc = e.wc,
                this.hashPart = e.hashPart,
                this.isTestOnly = e.isTestOnly,
                this.isUserFriendly = e.isUserFriendly,
                this.isBounceable = e.isBounceable,
                this.isUrlSafe = e.isUrlSafe;
            return
        }
        if (this.isUrlSafe = !0, e.search(/\-/) > 0 || e.search(/_/) > 0 ? e = e.replace(/\-/g, "+").replace(/_/g, "/") : this.isUrlSafe = !1, e.indexOf(":") > -1) {
            let t = e.split(":");
            if (2 !== t.length)
                throw Error("Invalid address " + e);
            let s = parseInt(t[0]);
            if (0 !== s && -1 !== s)
                throw Error("Invalid address wc " + e);
            let r = t[1];
            if (64 !== r.length)
                throw Error("Invalid address hex " + e);
            this.isUserFriendly = !1,
                this.wc = s,
                this.hashPart = hexToBytes(r),
                this.isTestOnly = !1,
                this.isBounceable = !1
        } else {
            this.isUserFriendly = !0;
            let n = parseFriendlyAddress(e);
            this.wc = n.workchain,
                this.hashPart = n.hashPart,
                this.isTestOnly = n.isTestOnly,
                this.isBounceable = n.isBounceable
        }
    }
    toString(e, t, s, r) {
        if (void 0 === e && (e = this.isUserFriendly), void 0 === t && (t = this.isUrlSafe), void 0 === s && (s = this.isBounceable), void 0 === r && (r = this.isTestOnly), !e)
            return this.wc + ":" + bytesToHex(this.hashPart);
        {
            let n = s ? 17 : 81;
            r && (n |= 128);
            let i = new Int8Array(34);
            i[0] = n,
                i[1] = this.wc,
                i.set(this.hashPart, 2);
            let l = new Uint8Array(36);
            l.set(i),
                l.set(crc16(i), 34);
            let o = stringToBase64(String.fromCharCode.apply(null, new Uint8Array(l)));
            return t && (o = o.replace(/\+/g, "-").replace(/\//g, "_")), o
        }
    }
}
