import { expect, test } from "bun:test";
import Formats from "../../src/Formats.js";
import configHandler from "../../src/handlers/config.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const json5Format = Formats.JSON5.builder("json5").lossless().fromTo();

test("config handler parses JSON5 input and writes JSON output", async () => {
  const handler = new configHandler();
  const [output] = await handler.doConvert(
    [
      {
        name: "config.json5",
        bytes: encoder.encode(`{
        // comment
        unquoted: 'value',
        trailing: [1, 2,],
      }`),
      },
    ],
    json5Format,
    Formats.JSON.builder("json").lossless().fromTo(),
  );

  expect(output.name).toBe("config.json");
  expect(JSON.parse(decoder.decode(output.bytes))).toEqual({
    unquoted: "value",
    trailing: [1, 2],
  });
});

test("config handler writes JSON5 output that round-trips through the parser", async () => {
  const handler = new configHandler();
  const [output] = await handler.doConvert(
    [
      {
        name: "config.json",
        bytes: encoder.encode(
          JSON.stringify({
            enabled: true,
            nested: { value: 3 },
          }),
        ),
      },
    ],
    Formats.JSON.builder("json").lossless().fromTo(),
    json5Format,
  );

  expect(output.name).toBe("config.json5");
  const outputText = decoder.decode(output.bytes);
  expect(outputText).toContain("enabled:true");
  expect(outputText).toContain("nested:");

  const reparsed = await handler.doConvert(
    [{ name: output.name, bytes: output.bytes }],
    json5Format,
    Formats.JSON.builder("json").lossless().fromTo(),
  );

  expect(JSON.parse(decoder.decode(reparsed[0].bytes))).toEqual({
    enabled: true,
    nested: { value: 3 },
  });
});
