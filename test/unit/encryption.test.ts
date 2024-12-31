import { encryptData, decryptData } from "../../src/utils/encryption";

describe("Encryption Utils", () => {
  it("encrypts and decrypts data correctly", () => {
    const text = "my secret data";
    const pass = "12345";
    const enc = encryptData(text, pass);
    expect(enc).not.toEqual(text);

    const dec = decryptData(enc, pass);
    expect(dec).toBe(text);
  });

  it("throws error on wrong password", () => {
    const enc = encryptData("hello", "right-pass");
    expect(() => decryptData(enc, "wrong-pass")).toThrow();
  });
});
