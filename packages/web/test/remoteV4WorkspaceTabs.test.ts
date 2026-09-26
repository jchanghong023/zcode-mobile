import assert from "node:assert/strict";
import test from "node:test";
import { buildMobileRemoteWorkspaceTabs } from "../src/remote-v4/workspaceTabs.js";

test("keeps distinct remote workspaces that share a path", () => {
  assert.deepEqual(
    buildMobileRemoteWorkspaceTabs(
      [
        { workspacePath: "/current", workspaceIdentity: "host-a" },
        { workspacePath: "/work", workspaceIdentity: "host-b" },
        { workspacePath: "/work", workspaceIdentity: "host-c" },
      ],
      ["/work", "/recent"],
    ),
    [
      { workspacePath: "/current", workspaceIdentity: "host-a" },
      { workspacePath: "/work", workspaceIdentity: "host-b" },
      { workspacePath: "/work", workspaceIdentity: "host-c" },
      { workspacePath: "/recent" },
    ],
  );
});
