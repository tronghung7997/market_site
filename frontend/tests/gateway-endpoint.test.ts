import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { endpointMethodLabel } from "../lib/gateway-endpoint.ts";

describe("gateway endpoint method label", () => {
  it("shows a fixed method as declared", () => {
    assert.equal(endpointMethodLabel("POST"), "POST");
    assert.equal(endpointMethodLabel("get"), "GET");
  });

  it("does not invent a method for a bare-path endpoint", () => {
    assert.equal(endpointMethodLabel(null), "GET · POST");
    assert.equal(endpointMethodLabel(undefined), "GET · POST");
  });
});
