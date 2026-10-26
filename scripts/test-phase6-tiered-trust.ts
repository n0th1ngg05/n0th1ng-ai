import { getDbAsync, getDb } from "../api/queries/connection";
import { sessions } from "../db/schema";
import { eq } from "drizzle-orm";
import {
  createSession,
  verifySession,
  elevateSession,
  demoteSession,
  setMasterPassword,
  SESSION_COOKIE_NAME,
} from "../api/services/auth.service";
import { authRouter } from "../api/routers/auth.router";
import { appRouter } from "../api/router";

async function runTests() {
  console.log("=================================================");
  console.log("n0th1ng AI - Phase 6 Tiered Trust & Elevation Test");
  console.log("=================================================\n");

  await getDbAsync();
  const db = getDb();

  const TEST_PASSWORD = "test-master-password-12345!";
  await setMasterPassword(TEST_PASSWORD);

  // 1. Session minting scopes
  console.log("Test 1: Verification of Initial Scopes...");
  const pinSession = await createSession({
    methodUsed: "pin",
    scope: "standard",
    deviceLabel: "Test Device",
    rememberMe: true,
  });
  if (pinSession.sessionId) {
    const verified = await verifySession(pinSession.cookieValue);
    if (!verified || verified.scope !== "standard") {
      throw new Error(`Expected PIN session scope 'standard', got '${verified?.scope}'`);
    }
  }

  const pwdSession = await createSession({
    methodUsed: "password",
    scope: "forge_unlocked",
    deviceLabel: "Test Device",
    rememberMe: true,
  });
  if (pwdSession.sessionId) {
    const verified = await verifySession(pwdSession.cookieValue);
    if (!verified || verified.scope !== "forge_unlocked") {
      throw new Error(`Expected Password session scope 'forge_unlocked', got '${verified?.scope}'`);
    }
  }
  console.log("✓ Initial session scopes correctly assigned (PIN: standard, Password: forge_unlocked).\n");

  // 2. tRPC Elevation Gate enforcement
  console.log("Test 2: tRPC Elevation Gate Enforcement on Forge/ForgeX...");
  const callerStandard = appRouter.createCaller({
    req: new Request("http://localhost/api/trpc", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${pinSession.cookieValue}` },
    }),
    resHeaders: new Headers(),
    session: await verifySession(pinSession.cookieValue),
  });

  let blocked = false;
  try {
    await callerStandard.forgex.create({
      goal: "Test goal",
      modelId: "test-model",
    });
  } catch (err: any) {
    if (err.message === "ELEVATION_REQUIRED" && err.code === "FORBIDDEN") {
      blocked = true;
    } else {
      console.error("Unexpected error:", err);
    }
  }

  if (!blocked) {
    throw new Error("Standard session was NOT blocked from creating ForgeX session!");
  }
  console.log("✓ Standard session blocked from executing Forge/ForgeX with FORBIDDEN: ELEVATION_REQUIRED.\n");

  // 3. Step-Up Elevation HTTP Endpoint
  console.log("Test 3: Step-Up Elevation via POST /api/auth/elevate...");
  // Attempt with invalid password
  const failedElevateRes = await authRouter.fetch(
    new Request("http://localhost/elevate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `${SESSION_COOKIE_NAME}=${pinSession.cookieValue}`,
      },
      body: JSON.stringify({ password: "wrong-password" }),
    })
  );
  if (failedElevateRes.status !== 401) {
    throw new Error(`Expected 401 for invalid elevation password, got ${failedElevateRes.status}`);
  }

  // Attempt with correct password
  const successElevateRes = await authRouter.fetch(
    new Request("http://localhost/elevate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `${SESSION_COOKIE_NAME}=${pinSession.cookieValue}`,
      },
      body: JSON.stringify({ password: TEST_PASSWORD }),
    })
  );
  const elevateJson = await successElevateRes.json();
  if (successElevateRes.status !== 200 || !elevateJson.ok || elevateJson.scope !== "forge_unlocked") {
    throw new Error(`Elevation failed: ${JSON.stringify(elevateJson)}`);
  }

  const sessionAfterElevate = await verifySession(pinSession.cookieValue);
  if (!sessionAfterElevate || sessionAfterElevate.scope !== "forge_unlocked") {
    throw new Error("Database session scope was not updated to 'forge_unlocked'!");
  }
  console.log("✓ Session successfully elevated to 'forge_unlocked' after password verification.\n");

  // 4. Verification after elevation passes the gate
  console.log("Test 4: Elevated Session Access Through Gate...");
  const callerElevated = appRouter.createCaller({
    req: new Request("http://localhost/api/trpc", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${pinSession.cookieValue}` },
    }),
    resHeaders: new Headers(),
    session: sessionAfterElevate,
  });

  // Calling a procedure protected by elevatedForgeProcedure passes the elevation middleware
  // (we test python.stop which resolves cleanly)
  let passedGate = false;
  try {
    await callerElevated.runtime.python.stop();
    passedGate = true;
  } catch (err: any) {
    if (err.message !== "ELEVATION_REQUIRED") {
      passedGate = true; // Error was runtime-related, not elevation blocked!
    }
  }
  if (!passedGate) {
    throw new Error("Elevated session was unexpectedly blocked by ELEVATION_REQUIRED!");
  }
  console.log("✓ Elevated session successfully passes through the elevation gate.\n");

  // 5. Explicit Demotion
  console.log("Test 5: Explicit Demotion via POST /api/auth/demote...");
  const demoteRes = await authRouter.fetch(
    new Request("http://localhost/demote", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${pinSession.cookieValue}` },
    })
  );
  const demoteJson = await demoteRes.json();
  if (demoteRes.status !== 200 || !demoteJson.ok || demoteJson.scope !== "standard") {
    throw new Error(`Demotion failed: ${JSON.stringify(demoteJson)}`);
  }

  const sessionAfterDemote = await verifySession(pinSession.cookieValue);
  if (!sessionAfterDemote || sessionAfterDemote.scope !== "standard") {
    throw new Error("Database session scope was not updated to 'standard'!");
  }
  console.log("✓ Session explicitly demoted back to 'standard' scope.\n");

  // 6. Inactivity Auto-Demotion (> 30 minutes)
  console.log("Test 6: Inactivity Auto-Demotion (> 30 minutes)...");
  // Elevate session again
  await elevateSession(pinSession.sessionId);
  const reElevated = await verifySession(pinSession.cookieValue);
  if (reElevated?.scope !== "forge_unlocked") {
    throw new Error("Failed to re-elevate session for idle test.");
  }

  // Simulate 31 minutes of idle time
  const thirtyOneMinutesAgo = new Date(Date.now() - 31 * 60 * 1000);
  await db
    .update(sessions)
    .set({ lastSeenAt: thirtyOneMinutesAgo })
    .where(eq(sessions.id, pinSession.sessionId));

  // verifySession should detect idle timeout and auto-demote to 'standard'
  const autoDemoted = await verifySession(pinSession.cookieValue);
  if (!autoDemoted || autoDemoted.scope !== "standard") {
    throw new Error(`Expected auto-demoted scope 'standard', got '${autoDemoted?.scope}'`);
  }

  // Confirm DB row was updated
  const [dbRow] = await db.select().from(sessions).where(eq(sessions.id, pinSession.sessionId));
  if (dbRow.scope !== "standard") {
    throw new Error(`DB scope was not persisted as 'standard', found '${dbRow.scope}'`);
  }
  console.log("✓ 30-minute idle session automatically demoted from 'forge_unlocked' to 'standard'.\n");

  // Cleanup test sessions
  await db.delete(sessions).where(eq(sessions.id, pinSession.sessionId));
  await db.delete(sessions).where(eq(sessions.id, pwdSession.sessionId));

  console.log("=================================================");
  console.log("ALL PHASE 6 TESTS PASSED (100% SUCCESS)!");
  console.log("=================================================\n");
  process.exit(0);
}

runTests().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
