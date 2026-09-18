import assert from "node:assert/strict";
import test from "node:test";

import { adminRequestAllowed, clientIpFromHeaders } from "../lib/admin-access.ts";

function withAdminEnv(
  env: { ADMIN_ALLOWED_IPS?: string; ADMIN_CLIENT_IP_HEADER?: string },
  run: () => void,
) {
  const previousIps = process.env.ADMIN_ALLOWED_IPS;
  const previousHeader = process.env.ADMIN_CLIENT_IP_HEADER;
  try {
    if (env.ADMIN_ALLOWED_IPS === undefined) delete process.env.ADMIN_ALLOWED_IPS;
    else process.env.ADMIN_ALLOWED_IPS = env.ADMIN_ALLOWED_IPS;
    if (env.ADMIN_CLIENT_IP_HEADER === undefined) delete process.env.ADMIN_CLIENT_IP_HEADER;
    else process.env.ADMIN_CLIENT_IP_HEADER = env.ADMIN_CLIENT_IP_HEADER;
    run();
  } finally {
    if (previousIps === undefined) delete process.env.ADMIN_ALLOWED_IPS;
    else process.env.ADMIN_ALLOWED_IPS = previousIps;
    if (previousHeader === undefined) delete process.env.ADMIN_CLIENT_IP_HEADER;
    else process.env.ADMIN_CLIENT_IP_HEADER = previousHeader;
  }
}

test("empty allowlist admits every request", () => {
  withAdminEnv({ ADMIN_ALLOWED_IPS: "" }, () => {
    assert.equal(adminRequestAllowed(new Headers()), true);
  });
});

test("IPv6 allowlist matches an unbracketed client address", () => {
  withAdminEnv({ ADMIN_ALLOWED_IPS: "2001:db8::10", ADMIN_CLIENT_IP_HEADER: "x-real-ip" }, () => {
    assert.equal(adminRequestAllowed(new Headers({ "x-real-ip": "2001:db8::10" })), true);
    assert.equal(adminRequestAllowed(new Headers({ "x-real-ip": "2001:db8::11" })), false);
  });
});

test("spoofed left-most X-Forwarded-For does not unlock the admin gate", () => {
  withAdminEnv({
    ADMIN_ALLOWED_IPS: "203.0.113.10",
    ADMIN_CLIENT_IP_HEADER: "x-forwarded-for",
  }, () => {
    assert.equal(
      adminRequestAllowed(new Headers({ "x-forwarded-for": "203.0.113.10, 198.51.100.9" })),
      false,
    );
    assert.equal(
      adminRequestAllowed(new Headers({ "x-forwarded-for": "198.51.100.9, 203.0.113.10" })),
      true,
    );
  });
});

test("default header is x-real-ip and ignores client X-Forwarded-For", () => {
  withAdminEnv({ ADMIN_ALLOWED_IPS: "203.0.113.10" }, () => {
    assert.equal(
      adminRequestAllowed(new Headers({ "x-forwarded-for": "203.0.113.10" })),
      false,
    );
    assert.equal(
      adminRequestAllowed(new Headers({ "x-real-ip": "203.0.113.10" })),
      true,
    );
  });
});

test("clientIpFromHeaders reads the configured edge header and ignores the rest", () => {
  withAdminEnv({ ADMIN_CLIENT_IP_HEADER: "x-real-ip" }, () => {
    assert.equal(clientIpFromHeaders(new Headers({ "x-real-ip": "203.0.113.9" })), "203.0.113.9");
    assert.equal(clientIpFromHeaders(new Headers({ "x-client-ip": "203.0.113.9" })), null);
    assert.equal(clientIpFromHeaders(new Headers()), null);
    assert.equal(clientIpFromHeaders(new Headers({ "x-real-ip": "not-an-ip" })), null);
  });
  withAdminEnv({ ADMIN_CLIENT_IP_HEADER: "x-forwarded-for" }, () => {
    assert.equal(clientIpFromHeaders(new Headers({ "x-forwarded-for": "1.1.1.1, 203.0.113.9" })), "203.0.113.9");
  });
});
