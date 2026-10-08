import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SenderClaimLink, { claimLinkForClipboard, maskClaimLink, visibleClaimLink } from "../src/client/SenderClaimLink";

const capability = "a".repeat(43);
const url = `http://127.0.0.1:5173/c/55596398158796912738519836714353507070181302874783804146314302142802913996845#${capability}`;

test("funded sender link is masked by default and warns about bearer custody", () => {
  const markup = renderToStaticMarkup(React.createElement(SenderClaimLink, { url, onCopy: async () => undefined }));
  assert.match(markup, /Private Claim Link/);
  assert.match(markup, /Copy link/);
  assert.match(markup, /Reveal/);
  assert.match(markup, /Your recipient needs this private link and email verification to claim/);
  assert.match(markup, /\[REDACTED\]/);
  assert.doesNotMatch(markup, new RegExp(capability));
});

test("copy uses the exact usable URL while the visible default stays masked", () => {
  assert.equal(claimLinkForClipboard(url), url);
  assert.equal(visibleClaimLink(url, false), maskClaimLink(url));
  assert.equal(visibleClaimLink(url, true), url);
  assert.doesNotMatch(visibleClaimLink(url, false), new RegExp(capability));
});

test("explicit reveal exposes the link and hide removes it again", () => {
  const revealed = visibleClaimLink(url, true);
  const hidden = visibleClaimLink(url, false);
  assert.equal(revealed, url);
  assert.doesNotMatch(hidden, new RegExp(capability));
  assert.match(hidden, /\[REDACTED\]/);
});

test("public payout metadata, failed states, logs, and request URLs do not contain the capability", () => {
  const publicRecord = JSON.stringify({ id: "55596398158796912738519836714353507070181302874783804146314302142802913996845", amount: "100000", status: 1 });
  const failedState = "Funding failed. No payout was created.";
  const requestUrl = "http://127.0.0.1:5173/api/payout/55596398158796912738519836714353507070181302874783804146314302142802913996845";
  assert.doesNotMatch(publicRecord, new RegExp(capability));
  assert.doesNotMatch(failedState, new RegExp(capability));
  assert.doesNotMatch(requestUrl, new RegExp(capability));
});
