import { describe, expect, it } from "vitest";
import { FakeOptiboot, FlashError, fakeTransport, flashStk500, hexExtent, pagesOf } from "./stk500";

const image = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) & 0xff);

describe("STK500 flashing", () => {
  it("writes and verifies every page, with 0x20 bytes inside page data", async () => {
    const boot = new FakeOptiboot();
    const img = image(1000);
    img[5] = 0x20;
    const phases: string[] = [];
    const r = await flashStk500(fakeTransport(boot), img, (p) => phases.push(p.phase));
    expect(r.pages).toBe(8);
    expect([...boot.flash.subarray(0, 1000)]).toEqual([...img]);
    expect(boot.flash[1000]).toBe(0xff);
    expect(boot.left).toBe(true);
    expect(phases.at(-1)).toBe("done");
    expect(phases).toContain("verify");
  });

  it("explains a bootloader that never answers", async () => {
    const err = await flashStk500(
      fakeTransport(new FakeOptiboot({ deaf: true })),
      image(200),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FlashError);
    expect((err as FlashError).hint).toMatch(/57600/);
  });

  it("refuses a chip that isn't an ATmega328P", async () => {
    const boot = new FakeOptiboot({ signature: [0x1e, 0x98, 0x01] });
    await expect(flashStk500(fakeTransport(boot), image(200))).rejects.toThrow(/signature/);
    expect(boot.flash[0]).toBe(0xff);
  });

  it("catches a byte that doesn't read back", async () => {
    const boot = new FakeOptiboot({ stuckBit: 300 });
    const img = image(400);
    img[300] = 0x0f;
    await expect(flashStk500(fakeTransport(boot), img)).rejects.toThrow(/Verify failed at 0x12c/);
  });

  it("refuses an image that would overwrite the bootloader", async () => {
    await expect(flashStk500(fakeTransport(new FakeOptiboot()), image(32_600))).rejects.toThrow(
      /bootloader/,
    );
  });

  it("pads the last page and drops trailing erased bytes", () => {
    const img = new Uint8Array(300).fill(0xff);
    img.set([1, 2, 3], 0);
    const p = pagesOf(img, 128);
    expect(p).toHaveLength(1);
    expect(p[0]?.data[3]).toBe(0xff);
  });
});

describe("hexExtent", () => {
  it("is the end of the last data record, ignoring EOF and padding", () => {
    expect(hexExtent(":0400000001020304F2\n:00000001FF\n")).toBe(4);
    expect(hexExtent(":10010000214601360121470136007EFE09D2190140\n:00000001FF")).toBe(0x110);
  });
});
