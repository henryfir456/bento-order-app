var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/http/errors.js
var HttpError = class extends Error {
  static {
    __name(this, "HttpError");
  }
  constructor(status, code, message = code, details = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
};
var badRequest = /* @__PURE__ */ __name((code, message = code, details = {}) => new HttpError(400, code, message, details), "badRequest");
var unauthorized = /* @__PURE__ */ __name((code = "AUTH_REQUIRED", message = code) => new HttpError(401, code, message), "unauthorized");
var forbidden = /* @__PURE__ */ __name((code = "FORBIDDEN", message = code) => new HttpError(403, code, message), "forbidden");
var notFound = /* @__PURE__ */ __name((code = "NOT_FOUND", message = code) => new HttpError(404, code, message), "notFound");
var conflict = /* @__PURE__ */ __name((code, message = code) => new HttpError(409, code, message), "conflict");
var toPublicError = /* @__PURE__ */ __name((error) => {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      body: {
        error: error.code,
        ...Object.keys(error.details || {}).length ? { details: error.details } : {}
      }
    };
  }
  return {
    status: 500,
    body: { error: "INTERNAL_SERVER_ERROR" }
  };
}, "toPublicError");

// src/domain/profile.js
var VALID_PICKUP_FLOORS = Object.freeze(["1\u6A13", "9\u6A13"]);
var isProfileComplete = /* @__PURE__ */ __name((user) => typeof user?.displayName === "string" && user.displayName.trim().length > 0 && VALID_PICKUP_FLOORS.includes(user.pickupFloor), "isProfileComplete");

// src/auth/permissions.js
var ACTIONS = Object.freeze({
  READ_SELF: "READ_SELF",
  REGISTER_SELF: "REGISTER_SELF",
  WRITE_SELF: "WRITE_SELF",
  CAN_VIEW_SELF_ONBOARDING_STATE: "CAN_VIEW_SELF_ONBOARDING_STATE",
  CAN_COMPLETE_PROFILE: "CAN_COMPLETE_PROFILE",
  CAN_BIND_LINE: "CAN_BIND_LINE",
  CAN_BIND_EMPLOYEE: "CAN_BIND_EMPLOYEE",
  READ_ADMIN_SUMMARY: "READ_ADMIN_SUMMARY",
  READ_MEMBER_BALANCES: "READ_MEMBER_BALANCES",
  ADMIN_BALANCE: "ADMIN_BALANCE",
  ADMIN_TOP_UP: "ADMIN_TOP_UP",
  ADMIN_CALENDAR: "ADMIN_CALENDAR",
  ADMIN_VENDORS: "ADMIN_VENDORS",
  ADMIN_ROLE: "ADMIN_ROLE",
  ADMIN_ANNOUNCEMENTS: "ADMIN_ANNOUNCEMENTS",
  ADMIN_MENU_CHANGES: "ADMIN_MENU_CHANGES",
  ADMIN_EMPLOYEE_BIND: "ADMIN_EMPLOYEE_BIND",
  VIEW_AS: "VIEW_AS",
  DELEGATE_ORDER: "DELEGATE_ORDER"
});
var ROLE_ACTIONS = Object.freeze({
  User: /* @__PURE__ */ new Set([
    ACTIONS.READ_SELF,
    ACTIONS.REGISTER_SELF,
    ACTIONS.WRITE_SELF,
    ACTIONS.READ_ADMIN_SUMMARY
  ]),
  ProxyAdmin: /* @__PURE__ */ new Set([
    ACTIONS.READ_SELF,
    ACTIONS.REGISTER_SELF,
    ACTIONS.WRITE_SELF,
    ACTIONS.READ_ADMIN_SUMMARY,
    ACTIONS.ADMIN_CALENDAR,
    ACTIONS.ADMIN_VENDORS,
    ACTIONS.DELEGATE_ORDER
  ]),
  Admin: new Set(Object.values(ACTIONS))
});
var GUEST_ACTIONS = /* @__PURE__ */ new Set([
  ACTIONS.READ_SELF,
  ACTIONS.REGISTER_SELF,
  ACTIONS.WRITE_SELF,
  ACTIONS.READ_ADMIN_SUMMARY
]);
var VERIFICATION_STATUSES = Object.freeze({
  VERIFIED: "VERIFIED",
  UNVERIFIED: "UNVERIFIED"
});
var IDENTITY_STATES = Object.freeze({
  NEW_PROVISIONAL_EMPLOYEE: "NEW_PROVISIONAL_EMPLOYEE",
  PENDING_VERIFICATION: "PENDING_VERIFICATION",
  // Retained as a source-compatibility name for onboarding callers. New
  // canonical-user projections use PENDING_VERIFICATION publicly.
  EXISTING_UNVERIFIED_EMPLOYEE: "EXISTING_UNVERIFIED_EMPLOYEE",
  EMPLOYEE_BIND_REQUIRED: "EMPLOYEE_BIND_REQUIRED",
  VERIFIED: "VERIFIED",
  UNREGISTERED: "UNREGISTERED"
});
var hasEmployeeId = /* @__PURE__ */ __name((value) => String(value ?? "").trim().length > 0, "hasEmployeeId");
var canonicalRoleFor = /* @__PURE__ */ __name((principal) => principal?.canonicalRole || principal?.role || "User", "canonicalRoleFor");
var isGeneralUser = /* @__PURE__ */ __name((principal) => canonicalRoleFor(principal) === "User", "isGeneralUser");
var isRegisteredEmployeeGuestPrincipal = /* @__PURE__ */ __name((principal) => Boolean(
  principal?.authMode === "employee_guest" && isGeneralUser(principal) && principal?.active === true && hasEmployeeId(principal.employeeId) && isProfileComplete(principal)
), "isRegisteredEmployeeGuestPrincipal");
var isRegisteredLinePrincipal = /* @__PURE__ */ __name((principal) => Boolean(
  principal?.authMode === "line" && principal?.active === true && hasEmployeeId(principal?.employeeId)
), "isRegisteredLinePrincipal");
var isProvisionalPrincipal = /* @__PURE__ */ __name((principal) => Boolean(
  principal?.authMode === "employee_guest" && principal?.provisional
), "isProvisionalPrincipal");
var identityStateFor = /* @__PURE__ */ __name((principal) => {
  const authMode = principal?.authMode || "line";
  if (principal?.userId && authMode === "line" && !hasEmployeeId(principal.employeeId)) {
    return IDENTITY_STATES.EMPLOYEE_BIND_REQUIRED;
  }
  if (principal?.provisional || isProvisionalPrincipal(principal)) {
    return principal?.userId ? IDENTITY_STATES.PENDING_VERIFICATION : IDENTITY_STATES.NEW_PROVISIONAL_EMPLOYEE;
  }
  if (authMode === "employee_guest" && principal?.userId && principal?.active !== false && principal?.registered) {
    return IDENTITY_STATES.VERIFIED;
  }
  if (isRegisteredLinePrincipal(principal) || principal?.registered && principal?.active !== false) {
    return IDENTITY_STATES.VERIFIED;
  }
  if (principal?.userId && !hasEmployeeId(principal.employeeId)) {
    return IDENTITY_STATES.EMPLOYEE_BIND_REQUIRED;
  }
  return IDENTITY_STATES.UNREGISTERED;
}, "identityStateFor");
var capabilitiesFor = /* @__PURE__ */ __name((role, authMode = "line", active = true, employeeId = null, employeeBindingRequired = false) => {
  if (!active) return [];
  if (authMode === "employee_guest") {
    return [...GUEST_ACTIONS].sort();
  }
  if (authMode === "line" && (employeeBindingRequired || !hasEmployeeId(employeeId))) {
    return [
      ACTIONS.CAN_BIND_EMPLOYEE,
      ACTIONS.CAN_VIEW_SELF_ONBOARDING_STATE
    ].sort();
  }
  const actions = ROLE_ACTIONS[role] || /* @__PURE__ */ new Set();
  return [...actions].sort();
}, "capabilitiesFor");
var can = /* @__PURE__ */ __name((role, action, authMode = "line", active = true, employeeId = null, employeeBindingRequired = false) => capabilitiesFor(
  role,
  authMode,
  active,
  employeeId,
  employeeBindingRequired
).includes(action), "can");
var isEmployeeBindingPrincipal = /* @__PURE__ */ __name((principal) => Boolean(
  principal?.userId && principal?.authMode === "line" && principal?.active === true && principal?.requiresEmployeeBinding
), "isEmployeeBindingPrincipal");
var assertCan = /* @__PURE__ */ __name((identity, action) => {
  const actor = identity?.actor;
  const authMode = actor?.authMode || "line";
  const registered = isRegisteredLinePrincipal(actor);
  const guest = authMode === "employee_guest" && actor?.active === true;
  const unbound = isEmployeeBindingPrincipal(actor);
  if (!actor || !registered && !guest && !unbound || !can(
    actor.role,
    action,
    authMode,
    actor.active === true,
    actor.employeeId,
    actor.requiresEmployeeBinding
  )) {
    throw forbidden();
  }
  return true;
}, "assertCan");
var assertSelfTarget = /* @__PURE__ */ __name((identity, targetUserId) => {
  if (identity?.actor?.userId !== targetUserId || identity?.effectiveSubject?.userId && identity.effectiveSubject.userId !== targetUserId) {
    throw forbidden("FORBIDDEN_TARGET", "The mutation target must be the authenticated actor.");
  }
  return true;
}, "assertSelfTarget");

// src/db/users.js
var toUser = /* @__PURE__ */ __name((row) => {
  if (!row) return null;
  return {
    userId: String(row.user_id),
    employeeId: row.employee_id === null || row.employee_id === void 0 ? null : String(row.employee_id),
    lineUserId: row.line_user_id === null || row.line_user_id === void 0 ? null : String(row.line_user_id),
    displayName: String(row.display_name || ""),
    pickupFloor: row.pickup_floor === null || row.pickup_floor === void 0 ? null : String(row.pickup_floor),
    balance: Number(row.balance),
    role: String(row.role || "User"),
    active: Boolean(row.active),
    verificationStatus: row.verification_status || "VERIFIED",
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}, "toUser");
var authoritativeBalanceProjection = /* @__PURE__ */ __name((alias = "u") => `COALESCE((
  SELECT bl.balance_after
  FROM balance_ledger bl
  JOIN balance_ledger_sequence bls ON bls.transaction_id = bl.transaction_id
  WHERE bl.user_id = ${alias}.user_id
  ORDER BY bls.sequence_number DESC
  LIMIT 1
), ${alias}.balance)`, "authoritativeBalanceProjection");
var currentBalanceProjection = authoritativeBalanceProjection;
var userColumns = /* @__PURE__ */ __name((alias = "u") => `
  ${alias}.user_id, ${alias}.employee_id, ${alias}.line_user_id,
  ${alias}.display_name, ${alias}.pickup_floor,
  ${currentBalanceProjection(alias)} AS balance,
  ${alias}.role, ${alias}.active, ${alias}.verification_status,
  ${alias}.created_at, ${alias}.updated_at
`, "userColumns");
var getUserById = /* @__PURE__ */ __name(async (database, userId) => {
  const row = await database.prepare(`
    SELECT ${userColumns("u")}
    FROM users u
    WHERE u.user_id = ?
    LIMIT 1
  `).bind(userId).first();
  return toUser(row);
}, "getUserById");
var getUserByEmployeeId = /* @__PURE__ */ __name(async (database, employeeId) => {
  const lookupKey = String(employeeId || "").trim().toUpperCase();
  const row = await database.prepare(`
    SELECT ${userColumns("u")}
    FROM users u
    WHERE UPPER(trim(u.employee_id)) = ? AND length(trim(u.employee_id)) > 0
    LIMIT 1
  `).bind(lookupKey).first();
  return toUser(row);
}, "getUserByEmployeeId");
var getUserByLineId = /* @__PURE__ */ __name(async (database, lineUserId) => {
  const row = await database.prepare(`
    SELECT ${userColumns("u")}
    FROM users u
    WHERE u.line_user_id = ?
    LIMIT 1
  `).bind(lineUserId).first();
  return toUser(row);
}, "getUserByLineId");
var publicUser = /* @__PURE__ */ __name((user, { authMode: projectedAuthMode = null, provisional = false } = {}) => {
  if (!user) return null;
  const hasEmployeeId4 = Boolean(String(user.employeeId || "").trim());
  const verificationStatus = user.verificationStatus || VERIFICATION_STATUSES.VERIFIED;
  const hasLineBinding = Boolean(String(user.lineUserId || "").trim());
  const authMode = projectedAuthMode || user.authMode || (hasLineBinding ? "line" : "canonical");
  const isEmployeeGuest = authMode === "employee_guest";
  const canonicalRole = user.canonicalRole || user.role;
  const registeredEmployeeGuest = isRegisteredEmployeeGuestPrincipal({
    ...user,
    authMode,
    canonicalRole
  });
  const identityState = identityStateFor({
    userId: user.userId,
    employeeId: user.employeeId,
    authMode,
    registered: isEmployeeGuest ? registeredEmployeeGuest : user.active && hasEmployeeId4,
    provisional: isEmployeeGuest && (provisional || !registeredEmployeeGuest),
    verificationStatus,
    active: user.active
  });
  const authSource = isEmployeeGuest ? "EMPLOYEE_GUEST" : hasLineBinding ? "LINE" : hasEmployeeId4 ? "EMPLOYEE" : "NON_LINE";
  return {
    userId: user.userId,
    employeeId: user.employeeId,
    name: user.displayName,
    floor: user.pickupFloor,
    defaultFloor: user.pickupFloor,
    balance: user.balance,
    // The employee_guest projection is intentionally self-service only and
    // must never expose an elevated role obtained through employee auth.
    role: isEmployeeGuest ? "User" : user.role,
    active: user.active,
    authSource,
    identityState,
    verificationStatus,
    lineBound: hasLineBinding,
    lineUserId: isEmployeeGuest ? null : user.lineUserId,
    displayName: user.displayName,
    profileComplete: isProfileComplete(user)
  };
}, "publicUser");

// ../src/auth/asyncDeadline.js
var createDeadline = /* @__PURE__ */ __name(({ timeoutMs, error, signal } = {}) => {
  const controller = new AbortController();
  let rejectDeadline;
  const expired = new Promise((_, reject) => {
    rejectDeadline = reject;
  });
  expired.catch(() => {
  });
  const abort = /* @__PURE__ */ __name((reason) => {
    if (controller.signal.aborted) return;
    controller.abort(reason);
    rejectDeadline(reason);
  }, "abort");
  const onAbort = /* @__PURE__ */ __name(() => abort(signal.reason || new Error("Attempt superseded")), "onAbort");
  const timer = setTimeout(() => abort(error), timeoutMs);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    wait(task) {
      if (controller.signal.aborted) return Promise.reject(controller.signal.reason);
      return Promise.race([Promise.resolve().then(() => {
        if (controller.signal.aborted) throw controller.signal.reason;
        return task();
      }), expired]);
    },
    dispose() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  };
}, "createDeadline");

// src/auth/lineProfile.js
var PROFILE_URL = "https://api.line.me/v2/profile";
var fetchLineProfile = /* @__PURE__ */ __name(async (accessToken, fetchImpl = globalThis.fetch, profileUrl = PROFILE_URL) => {
  const token = typeof accessToken === "string" ? accessToken.trim() : "";
  if (!token) throw unauthorized("TOKEN_INVALID", "A LINE access token is required.");
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required.");
  }
  const deadline = createDeadline({
    timeoutMs: 8e3,
    error: new HttpError(503, "LINE_PROFILE_TIMEOUT", "LINE verification timed out. Please retry.")
  });
  try {
    let response;
    try {
      response = await deadline.wait(() => fetchImpl(profileUrl, {
        headers: { Authorization: "Bearer " + token },
        signal: deadline.signal
      }));
    } catch (error) {
      if (error?.code === "LINE_PROFILE_TIMEOUT") throw error;
      throw unauthorized("TOKEN_INVALID", "LINE profile verification failed.");
    }
    if (!response?.ok) {
      if (response?.status === 401 || response?.status === 403) {
        throw unauthorized("TOKEN_INVALID", "LINE access token was rejected.");
      }
      throw unauthorized("TOKEN_INVALID", "LINE profile verification was unavailable.");
    }
    let profile;
    try {
      profile = await deadline.wait(() => response.json());
    } catch (error) {
      if (error?.code === "LINE_PROFILE_TIMEOUT") throw error;
      throw unauthorized("TOKEN_INVALID", "LINE profile response was invalid.");
    }
    const lineUserId = typeof profile?.userId === "string" ? profile.userId.trim() : "";
    if (!lineUserId) {
      throw unauthorized("TOKEN_INVALID", "LINE profile did not contain a user ID.");
    }
    return {
      lineUserId,
      displayName: typeof profile.displayName === "string" ? profile.displayName.trim() : ""
    };
  } finally {
    deadline.dispose();
  }
}, "fetchLineProfile");

// src/db/transactions.js
var validateSqlText = /* @__PURE__ */ __name((text11) => {
  if (typeof text11 !== "string" || !text11.trim()) {
    throw new TypeError("A non-empty SQL statement is required.");
  }
  if (text11.includes("\0") || text11.includes("${") || text11.includes("{{")) {
    throw new TypeError("SQL text contains an interpolation marker. Use bound parameters.");
  }
}, "validateSqlText");
var prepareStatement = /* @__PURE__ */ __name((database, query, bindings) => {
  if (!database || typeof database.prepare !== "function") {
    throw new Error("D1 prepare is required.");
  }
  let text11;
  let params;
  if (query?.kind === "prepared-query") {
    if (bindings !== void 0) {
      throw new TypeError("Tagged SQL already owns its bound parameters.");
    }
    text11 = query.text;
    params = query.bindings;
  } else {
    if (!Array.isArray(bindings)) {
      throw new TypeError("Raw SQL requires an explicit bindings array.");
    }
    text11 = query;
    params = bindings;
  }
  validateSqlText(text11);
  const statement = database.prepare(text11);
  if (!statement || typeof statement.bind !== "function") {
    throw new Error("D1 prepare did not return a bindable statement.");
  }
  return statement.bind(...params);
}, "prepareStatement");
var runMutationBatch = /* @__PURE__ */ __name(async (database, statements) => {
  if (!database || typeof database.batch !== "function") {
    throw new Error("D1 batch is required for an atomic mutation.");
  }
  if (!Array.isArray(statements) || statements.length === 0) {
    throw new TypeError("An atomic mutation requires at least one statement.");
  }
  if (statements.some((statement) => !statement || typeof statement.run !== "function")) {
    throw new TypeError("Every mutation statement must be executable.");
  }
  try {
    return await database.batch(statements);
  } catch (cause) {
    const error = new Error("D1 mutation transaction failed.");
    error.name = "TransactionError";
    error.code = "TRANSACTION_FAILED";
    error.cause = cause;
    throw error;
  }
}, "runMutationBatch");
var resolveClock = /* @__PURE__ */ __name((clock = /* @__PURE__ */ new Date()) => {
  const value = typeof clock === "function" ? clock() : clock;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("An invalid clock value was supplied.");
  return date;
}, "resolveClock");
var randomId = /* @__PURE__ */ __name((prefix = "ID") => {
  const suffix = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix ? prefix + "_" + suffix : suffix;
}, "randomId");

// src/auth/guestSession.js
var DEFAULT_LIFETIME_MS = 8 * 60 * 60 * 1e3;
var GUEST_TOKEN_PREFIX = "eg_";
var bytesToHex = /* @__PURE__ */ __name((bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""), "bytesToHex");
var randomToken = /* @__PURE__ */ __name(() => {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Web Crypto randomness is required for guest sessions.");
  }
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return GUEST_TOKEN_PREFIX + bytesToHex(bytes);
}, "randomToken");
var hashGuestToken = /* @__PURE__ */ __name(async (token) => {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto hashing is required for guest sessions.");
  }
  const bytes = new TextEncoder().encode(String(token));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}, "hashGuestToken");
var isGuestToken = /* @__PURE__ */ __name((token) => String(token || "").startsWith(GUEST_TOKEN_PREFIX), "isGuestToken");
var sessionRow = /* @__PURE__ */ __name(async (database, token) => {
  const tokenHash = await hashGuestToken(token);
  return database.prepare(`
    SELECT egs.session_id, egs.token_hash, egs.user_id, egs.auth_mode,
           egs.employee_id AS session_employee_id, egs.status AS session_status,
           egs.created_at, egs.expires_at, egs.revoked_at, egs.revoked_reason,
           u.employee_id, u.line_user_id, u.display_name, u.pickup_floor,
           ${currentBalanceProjection("u")} AS balance,
           u.role, u.active, u.verification_status,
           u.created_at AS user_created_at,
           u.updated_at AS user_updated_at
    FROM employee_guest_sessions egs
    LEFT JOIN users u ON u.user_id = egs.user_id
    WHERE egs.token_hash = ?
    LIMIT 1
  `).bind(tokenHash).first();
}, "sessionRow");
var createGuestSession = /* @__PURE__ */ __name(async (database, {
  userId = null,
  employeeId = null,
  status = "VERIFIED",
  clock = /* @__PURE__ */ new Date(),
  lifetimeMs = DEFAULT_LIFETIME_MS
} = {}) => {
  if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs <= 0) {
    throw new TypeError("Guest session lifetime must be a positive safe integer.");
  }
  const createdAt = resolveClock(clock);
  const expiresAt = new Date(createdAt.getTime() + lifetimeMs);
  const token = randomToken();
  await database.prepare(`
    INSERT INTO employee_guest_sessions (
      session_id, token_hash, user_id, employee_id, auth_mode, status,
      created_at, expires_at
    ) VALUES (?, ?, ?, ?, 'employee_guest', ?, ?, ?)
  `).bind(
    randomId("guest"),
    await hashGuestToken(token),
    userId,
    employeeId,
    status,
    createdAt.toISOString(),
    expiresAt.toISOString()
  ).run();
  return { token, expiresAt: expiresAt.toISOString() };
}, "createGuestSession");
var inspectGuestSession = /* @__PURE__ */ __name(async (database, token, { now = /* @__PURE__ */ new Date(), allowRevokedLineBindReplay = false } = {}) => {
  const row = await sessionRow(database, token);
  if (!row) return null;
  const nowIso2 = resolveClock(now).toISOString();
  const expired = row.expires_at <= nowIso2;
  const active = row.user_id ? Boolean(row.active) : true;
  const lineBound = Boolean(String(row.line_user_id ?? "").trim());
  const normal = !expired && active && row.revoked_at === null;
  const replay = allowRevokedLineBindReplay && !expired && active && row.revoked_at !== null && row.revoked_reason === "line_bound" && lineBound;
  return {
    session: {
      sessionId: row.session_id,
      userId: row.user_id,
      employeeId: row.session_employee_id || row.employee_id || null,
      status: row.session_status || "VERIFIED",
      authMode: row.auth_mode,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      revokedReason: row.revoked_reason
    },
    user: row.user_id ? toUser({
      user_id: row.user_id,
      employee_id: row.employee_id,
      line_user_id: row.line_user_id,
      display_name: row.display_name,
      pickup_floor: row.pickup_floor,
      balance: row.balance,
      role: row.role,
      active: row.active,
      verification_status: row.verification_status,
      created_at: row.user_created_at,
      updated_at: row.user_updated_at
    }) : null,
    normal,
    replay,
    expired,
    active,
    lineBound,
    provisional: row.session_status === "UNVERIFIED_EMPLOYEE",
    employeeId: row.session_employee_id || row.employee_id || null,
    status: row.session_status || "VERIFIED"
  };
}, "inspectGuestSession");

// src/auth/identity.js
var bearerToken = /* @__PURE__ */ __name((request) => {
  const header = request?.headers?.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}, "bearerToken");
var actorFromUser = /* @__PURE__ */ __name((user, {
  authMode = "line",
  displayName = "",
  lineUserId = null,
  employeeId = null,
  provisional = false
} = {}) => {
  const verificationStatus = user?.verificationStatus || (provisional ? VERIFICATION_STATUSES.UNVERIFIED : null);
  const hasEmployeeId4 = Boolean(String(user?.employeeId || employeeId || "").trim());
  const requiresEmployeeBinding = Boolean(
    user && authMode === "line" && !hasEmployeeId4
  );
  const active = user ? Boolean(user.active) : true;
  const registered = Boolean(
    user && active && hasEmployeeId4 && (authMode === "line" || isRegisteredEmployeeGuestPrincipal({
      ...user,
      authMode,
      employeeId: user.employeeId || employeeId,
      canonicalRole: user.role
    }))
  );
  const canonicalRole = user?.role || null;
  const guestProvisional = authMode === "employee_guest" && (provisional || !registered);
  const actor = {
    ...user || {},
    userId: user?.userId || null,
    employeeId: user?.employeeId || employeeId || null,
    lineUserId: user?.lineUserId || lineUserId || null,
    displayName: user?.displayName || displayName || "",
    registered,
    provisional: guestProvisional,
    requiresEmployeeBinding,
    verificationStatus,
    canonicalRole,
    // Employee-only authentication never becomes an elevated principal.
    role: authMode === "employee_guest" ? "User" : canonicalRole || "User",
    authMode
  };
  actor.capabilities = capabilitiesFor(
    actor.role,
    authMode,
    active,
    actor.employeeId,
    requiresEmployeeBinding
  );
  actor.identityState = identityStateFor(actor);
  return actor;
}, "actorFromUser");
var resolveLineIdentity = /* @__PURE__ */ __name(async (request, database, fetchImpl = globalThis.fetch) => {
  const token = bearerToken(request);
  if (!token) throw unauthorized();
  const profile = await fetchLineProfile(token, fetchImpl);
  const user = await getUserByLineId(database, profile.lineUserId);
  return {
    token,
    profile,
    user,
    actor: actorFromUser(user, {
      authMode: "line",
      displayName: profile.displayName,
      lineUserId: profile.lineUserId
    })
  };
}, "resolveLineIdentity");
var viewAsTarget = /* @__PURE__ */ __name((url) => url.searchParams.get("viewAsUserId")?.trim() || url.searchParams.get("viewAs")?.trim() || "", "viewAsTarget");
var resolveGuestCanonicalUser = /* @__PURE__ */ __name(async (database, guest) => {
  if (!guest?.provisional || guest.user || !guest.employeeId) return guest?.user || null;
  const user = await getUserByEmployeeId(database, guest.employeeId);
  if (!user || !user.active) {
    return null;
  }
  return user;
}, "resolveGuestCanonicalUser");
var resolveCanonicalIdentity = /* @__PURE__ */ __name(async (request, env, fetchImpl = globalThis.fetch, { allowViewAs = false, now = /* @__PURE__ */ new Date() } = {}) => {
  const token = bearerToken(request);
  if (!token) throw unauthorized();
  if (!env?.DB || typeof env.DB.prepare !== "function") {
    throw new Error("D1 binding is unavailable.");
  }
  const guest = await inspectGuestSession(env.DB, token, { now });
  if (isGuestToken(token)) {
    if (viewAsTarget(new URL(request.url))) throw forbidden("VIEW_AS_FORBIDDEN");
    if (guest?.provisional) {
      const canonicalUser = await resolveGuestCanonicalUser(env.DB, guest);
      if (canonicalUser && canonicalUser.role !== "User") {
        throw forbidden("ADMIN_LINE_AUTH_REQUIRED");
      }
      const actor3 = actorFromUser(canonicalUser, {
        authMode: "employee_guest",
        employeeId: guest.employeeId,
        provisional: !canonicalUser
      });
      return {
        actor: actor3,
        authorizationActor: actor3,
        effectiveSubject: actor3,
        viewAs: null
      };
    }
    if (!guest?.normal) throw unauthorized("GUEST_SESSION_INVALID");
    if (guest.user && guest.user.role !== "User") {
      throw forbidden("ADMIN_LINE_AUTH_REQUIRED");
    }
    const actor2 = actorFromUser(guest.user, { authMode: "employee_guest" });
    return {
      actor: actor2,
      authorizationActor: actor2,
      effectiveSubject: actor2,
      viewAs: null
    };
  }
  const line = await resolveLineIdentity(request, env.DB, fetchImpl);
  const actor = line.actor;
  const url = new URL(request.url);
  const requestedTarget = viewAsTarget(url);
  if (!requestedTarget) {
    return {
      actor,
      authorizationActor: actor,
      effectiveSubject: actor,
      viewAs: null
    };
  }
  if (!allowViewAs || !isRegisteredLinePrincipal(actor) || actor.authMode !== "line" || !actor.capabilities.includes("VIEW_AS")) {
    throw forbidden("VIEW_AS_FORBIDDEN");
  }
  const effectiveUser = await getUserById(env.DB, requestedTarget);
  if (!effectiveUser) throw forbidden("VIEW_AS_TARGET_NOT_FOUND");
  const effectiveSubject = actorFromUser(effectiveUser, { authMode: "line" });
  return {
    actor,
    authorizationActor: actor,
    effectiveSubject,
    viewAs: {
      targetUserId: effectiveSubject.userId,
      actorUserId: actor.userId
    }
  };
}, "resolveCanonicalIdentity");

// src/db/audit.js
var auditStatement = /* @__PURE__ */ __name((database, {
  auditId = randomId("audit"),
  actorUserId,
  actorAuthMode = "line",
  actorEmployeeIdSnapshot = null,
  actorLineUserIdSnapshot = null,
  targetUserId = null,
  targetEmployeeIdSnapshot = null,
  targetLineUserIdSnapshot = null,
  action,
  metadata = {},
  occurredAt,
  onlyIfPriorMutation = false
}) => prepareStatement(database, onlyIfPriorMutation ? `
  INSERT INTO admin_audit_log (
    audit_id, actor_user_id, actor_auth_mode, actor_employee_id_snapshot,
    actor_line_user_id_snapshot, target_user_id, target_employee_id_snapshot,
    target_line_user_id_snapshot, action, metadata_json, occurred_at
  )
  SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
  WHERE changes() = 1
` : `
  INSERT INTO admin_audit_log (
    audit_id, actor_user_id, actor_auth_mode, actor_employee_id_snapshot,
    actor_line_user_id_snapshot, target_user_id, target_employee_id_snapshot,
    target_line_user_id_snapshot, action, metadata_json, occurred_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, [
  auditId,
  actorUserId,
  actorAuthMode,
  actorEmployeeIdSnapshot,
  actorLineUserIdSnapshot,
  targetUserId,
  targetEmployeeIdSnapshot,
  targetLineUserIdSnapshot,
  action,
  JSON.stringify(metadata),
  occurredAt
]), "auditStatement");
var appendAuditEvent = /* @__PURE__ */ __name(async (database, input) => {
  const auditId = input.auditId || randomId("audit");
  await runMutationBatch(database, [auditStatement(database, { ...input, auditId })]);
  return auditId;
}, "appendAuditEvent");

// src/domain/users.js
var nowIso = /* @__PURE__ */ __name((clock) => {
  const value = clock instanceof Date ? clock : /* @__PURE__ */ new Date();
  return value.toISOString();
}, "nowIso");
var assertFloor = /* @__PURE__ */ __name((pickupFloor) => {
  if (!VALID_PICKUP_FLOORS.includes(pickupFloor)) {
    throw badRequest("INVALID_PICKUP_FLOOR");
  }
}, "assertFloor");
var assertDisplayName = /* @__PURE__ */ __name((displayName) => {
  if (typeof displayName !== "string") throw badRequest("PROFILE_INVALID");
  const value = displayName.trim();
  const hasControlCharacter2 = [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (!value || value.length > 100 || hasControlCharacter2) {
    throw badRequest("PROFILE_INVALID");
  }
  return value;
}, "assertDisplayName");
var getMe = /* @__PURE__ */ __name((identity) => {
  const actor = identity?.actor || {};
  const guest = actor.authMode === "employee_guest";
  const identityState = identityStateFor(actor);
  const employeeBindingRequired = identityState === IDENTITY_STATES.EMPLOYEE_BIND_REQUIRED;
  const registered = Boolean(actor.registered);
  const user = actor.userId ? publicUser(actor) : null;
  return {
    success: true,
    registered,
    identityState,
    authMode: actor.authMode || null,
    user,
    lineBound: user?.lineBound === true,
    ...employeeBindingRequired ? {
      status: "EMPLOYEE_BIND_REQUIRED",
      verificationStatus: actor.verificationStatus || VERIFICATION_STATUSES.VERIFIED,
      capabilities: Array.isArray(actor.capabilities) ? actor.capabilities : [],
      employeeId: actor.employeeId || "",
      lineUserId: actor.lineUserId || "",
      displayName: actor.displayName || ""
    } : guest ? {
      status: actor.verificationStatus === VERIFICATION_STATUSES.UNVERIFIED ? "UNVERIFIED_EMPLOYEE" : "VERIFIED",
      verificationStatus: actor.verificationStatus || VERIFICATION_STATUSES.UNVERIFIED,
      capabilities: Array.isArray(actor.capabilities) ? actor.capabilities : [],
      employeeId: actor.employeeId || "",
      lineUserId: "",
      displayName: actor.displayName || ""
    } : registered ? {
      status: "VERIFIED",
      verificationStatus: actor.verificationStatus || VERIFICATION_STATUSES.VERIFIED,
      capabilities: Array.isArray(actor.capabilities) ? actor.capabilities : [],
      employeeId: actor.employeeId || "",
      lineUserId: actor.lineUserId || "",
      displayName: actor.displayName || ""
    } : {
      lineUserId: actor.lineUserId || "",
      displayName: actor.displayName || ""
    }
  };
}, "getMe");
var registerUser = /* @__PURE__ */ __name(async (database, identity, { pickupFloor }, clock = /* @__PURE__ */ new Date()) => {
  if (identity?.actor?.registered) return getMe(identity);
  assertFloor(pickupFloor);
  throw conflict("EMPLOYEE_BIND_REQUIRED");
}, "registerUser");
var updatePickupFloor = /* @__PURE__ */ __name(async (database, identity, pickupFloor, clock = /* @__PURE__ */ new Date(), displayName) => {
  const guest = identity?.actor?.authMode === "employee_guest";
  assertCan(identity, ACTIONS.WRITE_SELF);
  assertSelfTarget(identity, identity.actor.userId);
  assertFloor(pickupFloor);
  const nextDisplayName = displayName === void 0 ? null : assertDisplayName(displayName);
  const timestamp2 = nowIso(clock);
  const update = nextDisplayName === null ? database.prepare(`
      UPDATE users
      SET pickup_floor = ?, updated_at = ?
      WHERE user_id = ?
    `).bind(pickupFloor, timestamp2, identity.actor.userId) : database.prepare(`
      UPDATE users
      SET display_name = ?, pickup_floor = ?, updated_at = ?
      WHERE user_id = ?
    `).bind(nextDisplayName, pickupFloor, timestamp2, identity.actor.userId);
  await update.run();
  await appendAuditEvent(database, {
    actorUserId: identity.actor.userId,
    targetUserId: identity.actor.userId,
    actorAuthMode: identity.actor.authMode,
    action: "UPDATE_PICKUP_FLOOR",
    occurredAt: timestamp2
  });
  const user = await getUserById(database, identity.actor.userId);
  const registered = identity.actor.authMode === "employee_guest" ? isRegisteredEmployeeGuestPrincipal({
    ...user,
    authMode: identity.actor.authMode,
    canonicalRole: user?.role
  }) : Boolean(
    identity.actor.registered && identity.actor.authMode === "line" && String(user?.employeeId || "").trim()
  );
  return {
    success: true,
    registered,
    identityState: identityStateFor({
      ...identity.actor,
      userId: user?.userId || identity.actor.userId,
      verificationStatus: user?.verificationStatus || identity.actor.verificationStatus,
      active: user?.active ?? identity.actor.active,
      authMode: identity.actor.authMode,
      employeeId: user?.employeeId || identity.actor.employeeId,
      registered
    }),
    authMode: identity.actor.authMode,
    ...guest ? {
      status: user.verificationStatus === VERIFICATION_STATUSES.UNVERIFIED ? "UNVERIFIED_EMPLOYEE" : "VERIFIED",
      verificationStatus: user.verificationStatus || VERIFICATION_STATUSES.UNVERIFIED,
      employeeId: user.employeeId,
      capabilities: capabilitiesFor(
        user.role,
        identity.actor.authMode,
        user.active,
        user.employeeId,
        identity.actor.requiresEmployeeBinding
      )
    } : {
      status: "VERIFIED",
      verificationStatus: user.verificationStatus || VERIFICATION_STATUSES.VERIFIED,
      capabilities: capabilitiesFor(
        user.role,
        identity.actor.authMode,
        user.active,
        user.employeeId,
        identity.actor.requiresEmployeeBinding
      )
    },
    user: publicUser(user, {
      authMode: identity.actor.authMode,
      provisional: identity.actor.provisional
    })
  };
}, "updatePickupFloor");

// src/domain/employeeVerification.js
var VERIFICATION_DECISIONS = Object.freeze({
  AUTO_VERIFIED: "AUTO_VERIFIED",
  PENDING_TRUST_REVIEW: "PENDING_TRUST_REVIEW",
  NO_CHANGE: "NO_CHANGE"
});
var TRUSTED_EMPLOYEE_PROVENANCE = Object.freeze([
  "TRUSTED_IMPORT",
  "ADMIN_APPROVED"
]);
var employeeIdText = /* @__PURE__ */ __name((value) => {
  if (typeof value !== "string") throw badRequest("INVALID_EMPLOYEE_ID");
  const employeeId = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(employeeId)) {
    throw badRequest("INVALID_EMPLOYEE_ID");
  }
  return employeeId;
}, "employeeIdText");
var sameEmployeeId = /* @__PURE__ */ __name((left, right) => typeof left === "string" && typeof right === "string" && left.trim().toUpperCase() === right.trim().toUpperCase(), "sameEmployeeId");
var digestEmployeeId = /* @__PURE__ */ __name(async (employeeId) => {
  const bytes = new TextEncoder().encode(employeeId);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}, "digestEmployeeId");
var rowsFrom = /* @__PURE__ */ __name((result) => Array.isArray(result) ? result : Array.isArray(result?.results) ? result.results : [], "rowsFrom");
var resolveEmployeeVerification = /* @__PURE__ */ __name(async (database, employeeIdInput) => {
  const employeeId = employeeIdText(employeeIdInput);
  const result = await database.prepare(`
    SELECT roster_id, employee_id, active, provenance, source_ref
    FROM employee_roster
    WHERE UPPER(trim(employee_id)) = ?
    ORDER BY roster_id ASC
  `).bind(employeeId).all();
  const matches = rowsFrom(result);
  const trustedMatches = matches.filter((row) => Number(row.active) === 1 && TRUSTED_EMPLOYEE_PROVENANCE.includes(String(row.provenance || "").trim()));
  if (matches.length === 1 && trustedMatches.length === 1) {
    return {
      employeeId,
      verificationStatus: VERIFICATION_STATUSES.VERIFIED,
      identityState: "VERIFIED",
      decision: VERIFICATION_DECISIONS.AUTO_VERIFIED,
      reason: "TRUSTED_UNIQUE_ACTIVE",
      rosterId: String(matches[0].roster_id),
      sourceRef: matches[0].source_ref || null
    };
  }
  return {
    employeeId,
    verificationStatus: VERIFICATION_STATUSES.UNVERIFIED,
    identityState: "PENDING_VERIFICATION",
    decision: VERIFICATION_DECISIONS.PENDING_TRUST_REVIEW,
    reason: matches.length === 0 ? "NO_TRUSTED_MATCH" : matches.length > 1 ? "AMBIGUOUS_MATCH" : "INACTIVE_OR_UNTRUSTED_MATCH",
    rosterId: null,
    sourceRef: null
  };
}, "resolveEmployeeVerification");

// src/domain/employeeGuestEvidence.js
var matchingEmployeeGuestEvidencePredicate = /* @__PURE__ */ __name(({
  sessionAlias = "employee_guest_sessions",
  ownerUserIdExpression = "?",
  ownerEmployeeIdExpression = "?"
} = {}) => `
  ${sessionAlias}.user_id = ${ownerUserIdExpression}
  AND ${sessionAlias}.auth_mode = 'employee_guest'
  AND ${sessionAlias}.status = 'UNVERIFIED_EMPLOYEE'
  AND ${sessionAlias}.employee_id IS NOT NULL
  AND length(trim(${sessionAlias}.employee_id)) > 0
  AND UPPER(trim(${sessionAlias}.employee_id)) = UPPER(trim(${ownerEmployeeIdExpression}))
`, "matchingEmployeeGuestEvidencePredicate");

// src/domain/employeeClaim.js
var BUSINESS_DEPENDENCIES = Object.freeze([
  Object.freeze({
    name: "orders",
    query: `SELECT 1 FROM orders WHERE user_id = ? LIMIT 1`
  }),
  Object.freeze({
    name: "balance_ledger",
    query: `SELECT 1 FROM balance_ledger WHERE user_id = ? LIMIT 1`
  }),
  Object.freeze({
    name: "opening_balance_snapshots",
    query: `SELECT 1 FROM opening_balance_snapshots WHERE user_id = ? LIMIT 1`
  }),
  Object.freeze({
    name: "likes",
    query: `SELECT 1 FROM likes WHERE user_id = ? LIMIT 1`
  }),
  Object.freeze({
    name: "idempotency_keys",
    query: `SELECT 1 FROM idempotency_keys WHERE actor_user_id = ? LIMIT 1`
  })
]);
var rowsFrom2 = /* @__PURE__ */ __name((result) => Array.isArray(result) ? result : Array.isArray(result?.results) ? result.results : [], "rowsFrom");
var normalizedEmployeeId = /* @__PURE__ */ __name((value) => String(value ?? "").trim().toUpperCase(), "normalizedEmployeeId");
var hasEmployeeId2 = /* @__PURE__ */ __name((value) => normalizedEmployeeId(value).length > 0, "hasEmployeeId");
var sameNormalizedEmployeeId = /* @__PURE__ */ __name((left, right) => hasEmployeeId2(left) && normalizedEmployeeId(left) === normalizedEmployeeId(right), "sameNormalizedEmployeeId");
var readCanonicalOwners = /* @__PURE__ */ __name(async (database, employeeId) => {
  const result = await database.prepare(`
    SELECT
      user_id, employee_id, line_user_id, display_name, pickup_floor,
      ${currentBalanceProjection("u")} AS balance,
      role, active, verification_status, created_at, updated_at
    FROM users u
    WHERE UPPER(trim(u.employee_id)) = ?
      AND length(trim(u.employee_id)) > 0
    ORDER BY u.user_id ASC
  `).bind(employeeId).all();
  return rowsFrom2(result).map(toUser);
}, "readCanonicalOwners");
var readBusinessDependencies = /* @__PURE__ */ __name(async (database, userId) => {
  const names = [];
  for (const dependency of BUSINESS_DEPENDENCIES) {
    const row = await database.prepare(dependency.query).bind(userId).first();
    if (row) names.push(dependency.name);
  }
  return names;
}, "readBusinessDependencies");
var readEmployeeGuestEvidence = /* @__PURE__ */ __name(async (database, { ownerUserId, employeeId }) => {
  const row = await database.prepare(`
    SELECT session_id
    FROM employee_guest_sessions
    WHERE ${matchingEmployeeGuestEvidencePredicate()}
    LIMIT 1
  `).bind(ownerUserId, employeeId).first();
  return Boolean(row);
}, "readEmployeeGuestEvidence");
var readClaimState = /* @__PURE__ */ __name(async (database, { survivorUserId, lineUserId, employeeId }) => {
  const [survivor, lineOwner, owners] = await Promise.all([
    getUserById(database, survivorUserId),
    getUserByLineId(database, lineUserId),
    readCanonicalOwners(database, employeeId)
  ]);
  const owner = owners.length === 1 ? owners[0] : null;
  const [hasEmployeeGuestEvidence, dependencies] = owner ? await Promise.all([
    readEmployeeGuestEvidence(database, {
      ownerUserId: owner.userId,
      employeeId
    }),
    readBusinessDependencies(database, owner.userId)
  ]) : [false, []];
  return {
    survivor,
    lineOwner,
    owners,
    owner,
    hasEmployeeGuestEvidence,
    dependencies
  };
}, "readClaimState");
var hasClaimableOwnerShape = /* @__PURE__ */ __name((state, { survivorUserId, lineUserId, employeeId }) => {
  const owner = state.owner;
  return Boolean(
    state.owners.length === 1 && owner && owner.userId !== survivorUserId && state.survivor?.userId === survivorUserId && state.lineOwner?.userId === survivorUserId && state.survivor.lineUserId === lineUserId && state.survivor.active === true && state.survivor.employeeId === null && owner.active === true && sameNormalizedEmployeeId(owner.employeeId, employeeId) && owner.lineUserId === null && owner.role !== "Admin" && owner.role !== "ProxyAdmin" && state.hasEmployeeGuestEvidence
  );
}, "hasClaimableOwnerShape");
var bindingResult = /* @__PURE__ */ __name((user, status = "BOUND") => ({
  success: true,
  status,
  registered: true,
  identityState: publicUser(user).identityState,
  verificationStatus: user.verificationStatus,
  authMode: "line",
  user: publicUser(user)
}), "bindingResult");
var LIVE_MATCHING_GUEST_SESSION_PREDICATE = `
  auth_mode = 'employee_guest'
  AND revoked_at IS NULL
  AND expires_at > ?
  AND (
    (
      employee_id IS NOT NULL
      AND length(trim(employee_id)) > 0
      AND UPPER(trim(employee_id)) = ?
    )
    OR user_id = ?
  )
`;
var claimAssertion = /* @__PURE__ */ __name((database, timestamp2) => prepareStatement(database, `
  INSERT INTO employee_guest_sessions (session_id, token_hash, expires_at)
  SELECT ?, NULL, ?
  WHERE changes() <> 1
`, [randomId("claim_assert"), timestamp2]), "claimAssertion");
var survivorGuardStatement = /* @__PURE__ */ __name((database, {
  survivorUserId,
  lineUserId,
  timestamp: timestamp2
}) => prepareStatement(database, `
  UPDATE users
  SET updated_at = ?
  WHERE user_id = ?
    AND line_user_id = ?
    AND active = 1
    AND employee_id IS NULL
`, [timestamp2, survivorUserId, lineUserId]), "survivorGuardStatement");
var ownerReleaseStatement = /* @__PURE__ */ __name((database, {
  survivorUserId,
  lineUserId,
  ownerUserId,
  employeeId,
  timestamp: timestamp2
}) => prepareStatement(database, `
  UPDATE users
  SET employee_id = NULL,
      updated_at = ?
  WHERE user_id = ?
    AND user_id <> ?
    AND active = 1
    AND line_user_id IS NULL
    AND role NOT IN ('Admin', 'ProxyAdmin')
    AND employee_id IS NOT NULL
    AND length(trim(employee_id)) > 0
    AND UPPER(trim(employee_id)) = ?
    AND (
      SELECT COUNT(*)
      FROM users
      WHERE employee_id IS NOT NULL
        AND length(trim(employee_id)) > 0
        AND UPPER(trim(employee_id)) = ?
    ) = 1
    AND EXISTS (
      SELECT 1
      FROM employee_guest_sessions
      WHERE user_id = ?
        AND auth_mode = 'employee_guest'
        AND status = 'UNVERIFIED_EMPLOYEE'
        AND employee_id IS NOT NULL
        AND length(trim(employee_id)) > 0
        AND UPPER(trim(employee_id)) = ?
    )
    AND NOT EXISTS (
      SELECT 1 FROM orders WHERE user_id = ?
    )
    AND NOT EXISTS (
      SELECT 1 FROM balance_ledger WHERE user_id = ?
    )
    AND NOT EXISTS (
      SELECT 1 FROM opening_balance_snapshots WHERE user_id = ?
    )
    AND NOT EXISTS (
      SELECT 1 FROM likes WHERE user_id = ?
    )
    AND NOT EXISTS (
      SELECT 1 FROM idempotency_keys WHERE actor_user_id = ?
    )
    AND EXISTS (
      SELECT 1
      FROM users AS survivor
      WHERE survivor.user_id = ?
        AND survivor.line_user_id = ?
        AND survivor.active = 1
        AND survivor.employee_id IS NULL
    )
`, [
  timestamp2,
  ownerUserId,
  survivorUserId,
  employeeId,
  employeeId,
  ownerUserId,
  employeeId,
  ownerUserId,
  ownerUserId,
  ownerUserId,
  ownerUserId,
  ownerUserId,
  survivorUserId,
  lineUserId
]), "ownerReleaseStatement");
var ownerRetireStatement = /* @__PURE__ */ __name((database, {
  survivorUserId,
  lineUserId,
  ownerUserId,
  timestamp: timestamp2
}) => prepareStatement(database, `
  UPDATE users
  SET active = 0,
      employee_id = NULL,
      updated_at = ?
  WHERE user_id = ?
    AND active = 1
    AND line_user_id IS NULL
    AND employee_id IS NULL
    AND role NOT IN ('Admin', 'ProxyAdmin')
    AND EXISTS (
      SELECT 1
      FROM users AS survivor
      WHERE survivor.user_id = ?
        AND survivor.line_user_id = ?
        AND survivor.active = 1
        AND survivor.employee_id IS NULL
    )
`, [timestamp2, ownerUserId, survivorUserId, lineUserId]), "ownerRetireStatement");
var survivorAssignStatement = /* @__PURE__ */ __name((database, {
  survivorUserId,
  lineUserId,
  ownerUserId,
  employeeId,
  timestamp: timestamp2
}) => prepareStatement(database, `
  UPDATE users
  SET employee_id = ?,
      updated_at = ?
  WHERE user_id = ?
    AND line_user_id = ?
    AND active = 1
    AND employee_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM users AS retired_owner
      WHERE retired_owner.user_id = ?
        AND retired_owner.active = 0
        AND retired_owner.employee_id IS NULL
        AND retired_owner.line_user_id IS NULL
        AND retired_owner.role NOT IN ('Admin', 'ProxyAdmin')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM users AS competing
      WHERE competing.user_id <> ?
        AND competing.employee_id IS NOT NULL
        AND length(trim(competing.employee_id)) > 0
        AND UPPER(trim(competing.employee_id)) = ?
    )
`, [
  employeeId,
  timestamp2,
  survivorUserId,
  lineUserId,
  ownerUserId,
  survivorUserId,
  employeeId
]), "survivorAssignStatement");
var revokeGuestSessionsStatement = /* @__PURE__ */ __name((database, {
  employeeId,
  ownerUserId,
  timestamp: timestamp2
}) => prepareStatement(database, `
  UPDATE employee_guest_sessions
  SET revoked_at = ?,
      revoked_reason = 'line_bound'
  WHERE ${LIVE_MATCHING_GUEST_SESSION_PREDICATE}
`, [timestamp2, timestamp2, employeeId, ownerUserId]), "revokeGuestSessionsStatement");
var revokePostconditionAssertion = /* @__PURE__ */ __name((database, { employeeId, ownerUserId, timestamp: timestamp2 }) => prepareStatement(database, `
  INSERT INTO employee_guest_sessions (session_id, token_hash, expires_at)
  SELECT ?, NULL, ?
  WHERE EXISTS (
    SELECT 1
    FROM employee_guest_sessions
    WHERE ${LIVE_MATCHING_GUEST_SESSION_PREDICATE}
  )
`, [
  randomId("claim_revoke_assert"),
  timestamp2,
  timestamp2,
  employeeId,
  ownerUserId
]), "revokePostconditionAssertion");
var auditStatement2 = /* @__PURE__ */ __name((database, {
  auditId,
  survivorUserId,
  lineUserId,
  ownerUserId,
  employeeIdDigest,
  survivorVerificationStatus,
  timestamp: timestamp2
}) => prepareStatement(database, `
  INSERT INTO admin_audit_log (
    audit_id, actor_user_id, actor_auth_mode, actor_employee_id_snapshot,
    actor_line_user_id_snapshot, target_user_id, target_employee_id_snapshot,
    target_line_user_id_snapshot, action, metadata_json, occurred_at
  )
  VALUES (?, ?, 'line', NULL, ?, ?, NULL, NULL,
          'PROVISIONAL_EMPLOYEE_CLAIMED', ?, ?)
`, [
  auditId,
  survivorUserId,
  lineUserId,
  ownerUserId,
  JSON.stringify({
    survivorUserId,
    retiredProvisionalUserId: ownerUserId,
    employeeIdDigest,
    survivorVerificationStatus: survivorVerificationStatus || null,
    outcome: "CLAIMED"
  }),
  timestamp2
]), "auditStatement");
var classifyTransactionFailure = /* @__PURE__ */ __name(async (database, {
  error,
  survivorUserId,
  lineUserId,
  employeeId
}) => {
  const state = await readClaimState(database, {
    survivorUserId,
    lineUserId,
    employeeId
  });
  if (state.survivor?.active === true && state.lineOwner?.userId === survivorUserId && sameNormalizedEmployeeId(state.survivor.employeeId, employeeId)) {
    return bindingResult(state.survivor, "ALREADY_BOUND");
  }
  if (state.survivor?.lineUserId === lineUserId && hasEmployeeId2(state.survivor.employeeId) && !sameNormalizedEmployeeId(state.survivor.employeeId, employeeId)) {
    throw conflict("LINE_ALREADY_BOUND");
  }
  if (state.owner && state.owner.userId !== survivorUserId) {
    const claimable = hasClaimableOwnerShape(state, {
      survivorUserId,
      lineUserId,
      employeeId
    });
    if (claimable && state.dependencies.length > 0) {
      throw conflict("PROVISIONAL_IDENTITY_HAS_DEPENDENCIES");
    }
    if (state.owners.length !== 1 || !claimable) {
      throw conflict("EMPLOYEE_ID_ALREADY_BOUND");
    }
  }
  throw error;
}, "classifyTransactionFailure");
var claimProvisionalEmployee = /* @__PURE__ */ __name(async (database, {
  survivorUserId,
  lineUserId,
  employeeId: employeeIdInput,
  clock = /* @__PURE__ */ new Date()
} = {}) => {
  const survivorId = String(survivorUserId || "").trim();
  const verifiedLineUserId = String(lineUserId || "").trim();
  if (!survivorId || !verifiedLineUserId) throw conflict("LINE_BIND_CONFLICT");
  const employeeId = employeeIdText(employeeIdInput);
  const timestamp2 = resolveClock(clock).toISOString();
  const state = await readClaimState(database, {
    survivorUserId: survivorId,
    lineUserId: verifiedLineUserId,
    employeeId
  });
  if (!state.survivor || state.lineOwner?.userId !== survivorId) {
    throw conflict("LINE_BIND_CONFLICT");
  }
  if (!state.survivor.active) throw forbidden("EMPLOYEE_INACTIVE");
  if (hasEmployeeId2(state.survivor.employeeId)) {
    if (sameNormalizedEmployeeId(state.survivor.employeeId, employeeId)) {
      return bindingResult(state.survivor, "ALREADY_BOUND");
    }
    throw conflict("LINE_ALREADY_BOUND");
  }
  if (state.owners.length !== 1 || !state.owner) {
    throw conflict("EMPLOYEE_ID_ALREADY_BOUND");
  }
  if (!hasClaimableOwnerShape(state, {
    survivorUserId: survivorId,
    lineUserId: verifiedLineUserId,
    employeeId
  })) {
    throw conflict("EMPLOYEE_ID_ALREADY_BOUND");
  }
  if (state.dependencies.length > 0) {
    throw conflict("PROVISIONAL_IDENTITY_HAS_DEPENDENCIES");
  }
  const employeeIdDigest = await digestEmployeeId(employeeId);
  const ownerUserId = state.owner.userId;
  const statements = [
    survivorGuardStatement(database, {
      survivorUserId: survivorId,
      lineUserId: verifiedLineUserId,
      timestamp: timestamp2
    }),
    claimAssertion(database, timestamp2),
    ownerReleaseStatement(database, {
      survivorUserId: survivorId,
      lineUserId: verifiedLineUserId,
      ownerUserId,
      employeeId,
      timestamp: timestamp2
    }),
    claimAssertion(database, timestamp2),
    ownerRetireStatement(database, {
      survivorUserId: survivorId,
      lineUserId: verifiedLineUserId,
      ownerUserId,
      timestamp: timestamp2
    }),
    claimAssertion(database, timestamp2),
    survivorAssignStatement(database, {
      survivorUserId: survivorId,
      lineUserId: verifiedLineUserId,
      ownerUserId,
      employeeId,
      timestamp: timestamp2
    }),
    claimAssertion(database, timestamp2),
    revokeGuestSessionsStatement(database, {
      employeeId,
      ownerUserId,
      timestamp: timestamp2
    }),
    revokePostconditionAssertion(database, {
      employeeId,
      ownerUserId,
      timestamp: timestamp2
    }),
    auditStatement2(database, {
      auditId: randomId("audit"),
      survivorUserId: survivorId,
      lineUserId: verifiedLineUserId,
      ownerUserId,
      employeeIdDigest,
      survivorVerificationStatus: state.survivor.verificationStatus,
      timestamp: timestamp2
    }),
    claimAssertion(database, timestamp2)
  ];
  try {
    await runMutationBatch(database, statements);
  } catch (error) {
    return classifyTransactionFailure(database, {
      error,
      survivorUserId: survivorId,
      lineUserId: verifiedLineUserId,
      employeeId
    });
  }
  const bound = await getUserById(database, survivorId);
  if (!bound || bound.active !== true || bound.lineUserId !== verifiedLineUserId || !sameNormalizedEmployeeId(bound.employeeId, employeeId) || bound.verificationStatus !== state.survivor.verificationStatus) {
    throw conflict("LINE_BIND_CONFLICT");
  }
  return bindingResult(bound, "BOUND");
}, "claimProvisionalEmployee");

// src/domain/guestAccess.js
var lineIdText = /* @__PURE__ */ __name((value) => {
  const lineUserId = typeof value === "string" ? value.trim() : "";
  if (!lineUserId || lineUserId.length > 200) throw badRequest("LINE_BIND_PROFILE_INVALID");
  return lineUserId;
}, "lineIdText");
var profileText = /* @__PURE__ */ __name((value, fallback = "") => {
  const text11 = typeof value === "string" ? value.trim() : fallback;
  const hasControlCharacter2 = [...text11].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (!text11 || text11.length > 100 || hasControlCharacter2) {
    throw badRequest("PROFILE_INVALID");
  }
  return text11;
}, "profileText");
var legacyEmployeeDisplayName = /* @__PURE__ */ __name((employeeId) => `Legacy employee ${String(employeeId ?? "").trim()}`, "legacyEmployeeDisplayName");
var verifiedNameForLegacyProfile = /* @__PURE__ */ __name((user, lineDisplayName) => {
  if (user?.displayName !== legacyEmployeeDisplayName(user?.employeeId)) return null;
  const text11 = typeof lineDisplayName === "string" ? lineDisplayName.trim() : "";
  const hasControlCharacter2 = [...text11].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  return text11 && text11.length <= 100 && !hasControlCharacter2 ? text11 : null;
}, "verifiedNameForLegacyProfile");
var pickupFloorText = /* @__PURE__ */ __name((value) => {
  if (!VALID_PICKUP_FLOORS.includes(value)) throw badRequest("INVALID_PICKUP_FLOOR");
  return value;
}, "pickupFloorText");
var statementChanges = /* @__PURE__ */ __name((result) => Number(
  result?.meta?.changes ?? result?.changes ?? 0
), "statementChanges");
var guestStatusFor = /* @__PURE__ */ __name((user) => user?.verificationStatus === VERIFICATION_STATUSES.UNVERIFIED ? "UNVERIFIED_EMPLOYEE" : "VERIFIED", "guestStatusFor");
var employeeGuestResult = /* @__PURE__ */ __name((user, session, status = guestStatusFor(user)) => {
  const registered = isRegisteredEmployeeGuestPrincipal({
    ...user,
    authMode: "employee_guest",
    canonicalRole: user.role
  });
  return {
    success: true,
    registered,
    status,
    identityState: identityStateFor({
      ...user,
      authMode: "employee_guest",
      provisional: !registered,
      registered
    }),
    verificationStatus: user.verificationStatus,
    authMode: "employee_guest",
    ...session ? {
      token: session.token,
      expiresAt: session.expiresAt
    } : {},
    capabilities: capabilitiesFor(
      user.role,
      "employee_guest",
      user.active,
      user.employeeId
    ),
    employeeId: user.employeeId,
    user: publicUser(user, {
      authMode: "employee_guest",
      provisional: !registered
    })
  };
}, "employeeGuestResult");
var employeeGuestLogin = /* @__PURE__ */ __name(async (database, employeeIdInput, clock = /* @__PURE__ */ new Date()) => {
  const employeeId = employeeIdText(employeeIdInput);
  const user = await getUserByEmployeeId(database, employeeId);
  if (!user) {
    const session2 = await createGuestSession(database, {
      employeeId,
      status: "UNVERIFIED_EMPLOYEE",
      clock
    });
    return {
      success: true,
      status: "UNVERIFIED_EMPLOYEE",
      identityState: identityStateFor({
        provisional: true,
        verificationStatus: VERIFICATION_STATUSES.UNVERIFIED
      }),
      verificationStatus: VERIFICATION_STATUSES.UNVERIFIED,
      authMode: "employee_guest",
      token: session2.token,
      expiresAt: session2.expiresAt,
      capabilities: capabilitiesFor(
        null,
        "employee_guest",
        true,
        null
      ),
      employeeId,
      user: null
    };
  }
  if (!user.active) throw forbidden("EMPLOYEE_INACTIVE");
  if (!isGeneralUser(user)) throw forbidden("ADMIN_LINE_AUTH_REQUIRED");
  const status = guestStatusFor(user);
  const session = await createGuestSession(database, {
    userId: user.userId,
    employeeId: user.employeeId || employeeId,
    status,
    clock
  });
  return employeeGuestResult(user, session, status);
}, "employeeGuestLogin");
var provisionalGuestResult = /* @__PURE__ */ __name((user, session) => {
  return employeeGuestResult(user, session);
}, "provisionalGuestResult");
var completeEmployeeGuestOnboarding = /* @__PURE__ */ __name(async (database, {
  guestToken,
  displayName,
  pickupFloor,
  clock = /* @__PURE__ */ new Date()
} = {}) => {
  if (typeof guestToken !== "string" || !guestToken.trim()) {
    throw unauthorized("GUEST_SESSION_INVALID");
  }
  const now = resolveClock(clock).toISOString();
  const inspected = await inspectGuestSession(database, guestToken, { now });
  if (!inspected || !inspected.normal || !inspected.employeeId) {
    throw unauthorized("GUEST_SESSION_INVALID");
  }
  if (inspected.user && !inspected.provisional) {
    return provisionalGuestResult(inspected.user, inspected.session);
  }
  if (!inspected.provisional) throw unauthorized("GUEST_SESSION_INVALID");
  if (inspected.user) {
    if (inspected.user.verificationStatus !== VERIFICATION_STATUSES.UNVERIFIED || inspected.user.lineUserId !== null) {
      throw conflict("EMPLOYEE_ONBOARDING_CONFLICT");
    }
    return provisionalGuestResult(inspected.user, inspected.session);
  }
  const employeeId = employeeIdText(inspected.employeeId);
  const onboardingName = profileText(displayName);
  const onboardingFloor = pickupFloorText(pickupFloor);
  const existing = await getUserByEmployeeId(database, employeeId);
  if (existing) throw conflict("EMPLOYEE_ONBOARDING_CONFLICT");
  const decision = await resolveEmployeeVerification(database, employeeId);
  const userId = randomId("user");
  const insertUser = prepareStatement(database, `
    INSERT INTO users (
      user_id, employee_id, line_user_id, display_name, pickup_floor,
      balance, role, active, verification_status, created_at, updated_at
    ) VALUES (?, ?, NULL, ?, ?, 0, 'User', 1, ?, ?, ?)
  `, [
    userId,
    employeeId,
    onboardingName,
    onboardingFloor,
    decision.verificationStatus,
    now,
    now
  ]);
  const attachSession = prepareStatement(database, `
    UPDATE employee_guest_sessions
    SET user_id = ?, status = ?
    WHERE session_id = ?
      AND UPPER(trim(employee_id)) = ?
      AND status = 'UNVERIFIED_EMPLOYEE'
      AND user_id IS NULL
      AND revoked_at IS NULL
  `, [userId, decision.verificationStatus === VERIFICATION_STATUSES.VERIFIED ? "VERIFIED" : "UNVERIFIED_EMPLOYEE", inspected.session.sessionId, employeeId]);
  try {
    const [insertResult, attachResult] = await database.batch([insertUser, attachSession]);
    if (statementChanges(insertResult) !== 1 || statementChanges(attachResult) !== 1) {
      throw new Error("Employee guest onboarding attach failed.");
    }
  } catch (error) {
    if (/unique|constraint/i.test(error?.message || error?.cause?.message || "")) {
      const replay = await inspectGuestSession(database, guestToken, { now });
      if (replay?.normal && replay.provisional && replay.user) {
        return provisionalGuestResult(replay.user, replay.session);
      }
      throw conflict("EMPLOYEE_ONBOARDING_CONFLICT");
    }
    throw error;
  }
  const user = await getUserById(database, userId);
  if (!user || user.lineUserId !== null || user.verificationStatus !== decision.verificationStatus) {
    throw new Error("Employee guest onboarding readback failed.");
  }
  return provisionalGuestResult(user, inspected.session);
}, "completeEmployeeGuestOnboarding");
var employeePreview = /* @__PURE__ */ __name((user) => ({
  employeeId: user.employeeId,
  name: user.displayName,
  floor: user.pickupFloor,
  defaultFloor: user.pickupFloor,
  verificationStatus: user.verificationStatus
}), "employeePreview");
var lineBindingResult = /* @__PURE__ */ __name((user, status = "BOUND") => ({
  success: true,
  status,
  registered: true,
  identityState: publicUser(user).identityState,
  verificationStatus: user.verificationStatus,
  authMode: "line",
  user: publicUser(user)
}), "lineBindingResult");
var lineEmployeeLookup = /* @__PURE__ */ __name(async (database, {
  employeeId: employeeIdInput,
  lineUserId
} = {}) => {
  const employeeId = employeeIdText(employeeIdInput);
  const verifiedLineUserId = lineIdText(lineUserId);
  const currentLineUser = await getUserByLineId(database, verifiedLineUserId);
  if (currentLineUser) {
    if (!currentLineUser.active) throw forbidden("EMPLOYEE_INACTIVE");
    if (!isGeneralUser(currentLineUser) && currentLineUser.employeeId !== null && currentLineUser.employeeId !== void 0) {
      throw conflict("LINE_ALREADY_BOUND");
    }
  }
  const user = await getUserByEmployeeId(database, employeeId);
  if (!user) {
    return {
      success: true,
      status: "UNVERIFIED_EMPLOYEE",
      identityState: identityStateFor({
        provisional: true,
        verificationStatus: VERIFICATION_STATUSES.UNVERIFIED
      }),
      verificationStatus: VERIFICATION_STATUSES.UNVERIFIED,
      authMode: "line",
      employeeId,
      capabilities: capabilitiesFor(
        null,
        "line",
        true,
        null,
        true
      ),
      user: null
    };
  }
  if (!user.active) throw forbidden("EMPLOYEE_INACTIVE");
  if (isGeneralUser(user)) {
    const registered = isRegisteredEmployeeGuestPrincipal({
      ...user,
      authMode: "employee_guest",
      canonicalRole: user.role
    });
    return {
      success: true,
      status: "FOUND",
      resolution: "EMPLOYEE_SESSION",
      ownershipChanged: false,
      identityState: identityStateFor({
        ...user,
        authMode: "employee_guest",
        provisional: !registered,
        registered
      }),
      verificationStatus: user.verificationStatus,
      authMode: "line",
      employeeId,
      user: employeePreview(user)
    };
  }
  throw conflict("EMPLOYEE_ALREADY_LINE_BOUND");
}, "lineEmployeeLookup");
var createProvisionalCanonicalUser = /* @__PURE__ */ __name(async (database, {
  employeeId,
  lineUserId,
  lineDisplayName,
  displayName,
  pickupFloor,
  clock
}) => {
  const timestamp2 = resolveClock(clock).toISOString();
  const onboardingName = profileText(displayName || lineDisplayName);
  const onboardingFloor = pickupFloorText(pickupFloor);
  const userId = randomId("user");
  const result = await prepareStatement(database, `
    INSERT INTO users (
      user_id, employee_id, line_user_id, display_name, pickup_floor,
      balance, role, active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 0, 'User', 1, ?, ?)
  `, [
    userId,
    employeeId,
    lineUserId,
    onboardingName,
    onboardingFloor,
    timestamp2,
    timestamp2
  ]).run();
  if (statementChanges(result) !== 1) {
    throw new Error("Provisional user creation failed.");
  }
  const user = await getUserById(database, userId);
  if (!user) throw new Error("Provisional LINE binding readback failed.");
  return user;
}, "createProvisionalCanonicalUser");
var lineEmployeeBind = /* @__PURE__ */ __name(async (database, {
  employeeId: employeeIdInput,
  lineUserId,
  lineDisplayName = "",
  displayName,
  pickupFloor,
  clock = /* @__PURE__ */ new Date()
} = {}) => {
  const employeeId = employeeIdText(employeeIdInput);
  const verifiedLineUserId = lineIdText(lineUserId);
  const currentLineUser = await getUserByLineId(database, verifiedLineUserId);
  const user = await getUserByEmployeeId(database, employeeId);
  if (user && user.active && isGeneralUser(user) && !currentLineUser && !user.lineUserId) {
    const timestamp2 = resolveClock(clock).toISOString();
    const replacementName = verifiedNameForLegacyProfile(user, lineDisplayName);
    try {
      const result = await database.prepare(`
        UPDATE users
        SET line_user_id = ?,
            display_name = CASE
              WHEN display_name = ? THEN COALESCE(?, display_name)
              ELSE display_name
            END,
            updated_at = ?
        WHERE user_id = ?
          AND line_user_id IS NULL
          AND active = 1
          AND role = 'User'
      `).bind(
        verifiedLineUserId,
        legacyEmployeeDisplayName(user.employeeId),
        replacementName,
        timestamp2,
        user.userId
      ).run();
      if (statementChanges(result) !== 1) {
        const replay = await getUserById(database, user.userId);
        if (replay?.lineUserId === verifiedLineUserId) {
          return lineBindingResult(replay, "ALREADY_BOUND");
        }
        if (replay?.lineUserId) throw conflict("EMPLOYEE_ALREADY_LINE_BOUND");
        throw conflict("LINE_BIND_CONFLICT");
      }
    } catch (error) {
      if (error?.status === 409) throw error;
      if (/unique|constraint/i.test(error?.message || error?.cause?.message || "")) {
        const conflictingLine = await getUserByLineId(database, verifiedLineUserId);
        if (conflictingLine && conflictingLine.userId !== user.userId) {
          throw conflict("LINE_ALREADY_BOUND");
        }
        const replay = await getUserById(database, user.userId);
        if (replay?.lineUserId === verifiedLineUserId) {
          return lineBindingResult(replay, "ALREADY_BOUND");
        }
        if (replay?.lineUserId) throw conflict("EMPLOYEE_ALREADY_LINE_BOUND");
        throw conflict("LINE_BIND_CONFLICT");
      }
      throw error;
    }
    const boundUser = await getUserById(database, user.userId);
    if (!boundUser || boundUser.lineUserId !== verifiedLineUserId) {
      throw conflict("LINE_BIND_CONFLICT");
    }
    return lineBindingResult(boundUser);
  }
  const currentLineHasEmployee = Boolean(String(currentLineUser?.employeeId || "").trim());
  const currentLineCanResolveNormalUser = !currentLineUser || isGeneralUser(currentLineUser) && currentLineHasEmployee;
  if (user && user.active && isGeneralUser(user) && currentLineCanResolveNormalUser) {
    if (sameEmployeeId(currentLineUser?.employeeId, employeeId)) {
      return lineBindingResult(currentLineUser, "ALREADY_BOUND");
    }
    const session = await createGuestSession(database, {
      userId: user.userId,
      employeeId: user.employeeId || employeeId,
      status: guestStatusFor(user),
      clock
    });
    return {
      ...employeeGuestResult(user, session, "RESOLVED"),
      resolution: "EMPLOYEE_SESSION",
      ownershipChanged: false
    };
  }
  if (currentLineUser) {
    if (!currentLineUser.active) throw forbidden("EMPLOYEE_INACTIVE");
    if (sameEmployeeId(currentLineUser.employeeId, employeeId)) {
      return lineBindingResult(currentLineUser, "ALREADY_BOUND");
    }
    if (currentLineUser.employeeId !== null && currentLineUser.employeeId !== void 0) {
      throw conflict("LINE_ALREADY_BOUND");
    }
    const conflictingEmployee = await getUserByEmployeeId(database, employeeId);
    if (conflictingEmployee && conflictingEmployee.userId !== currentLineUser.userId) {
      return claimProvisionalEmployee(database, {
        survivorUserId: currentLineUser.userId,
        lineUserId: verifiedLineUserId,
        employeeId,
        clock
      });
    }
    const timestamp2 = resolveClock(clock).toISOString();
    try {
      const result = await database.prepare(`
        UPDATE users
        SET employee_id = ?, updated_at = ?
        WHERE user_id = ?
          AND line_user_id = ?
          AND employee_id IS NULL
          AND active = 1
      `).bind(
        employeeId,
        timestamp2,
        currentLineUser.userId,
        verifiedLineUserId
      ).run();
      if (statementChanges(result) !== 1) {
        const concurrentUser = await getUserByLineId(database, verifiedLineUserId);
        if (sameEmployeeId(concurrentUser?.employeeId, employeeId)) {
          return lineBindingResult(concurrentUser, "ALREADY_BOUND");
        }
        if (await getUserByEmployeeId(database, employeeId)) {
          throw conflict("EMPLOYEE_ID_ALREADY_BOUND");
        }
        throw conflict("LINE_BIND_CONFLICT");
      }
    } catch (error) {
      if (error?.status === 409) throw error;
      if (/unique|constraint/i.test(error?.message || error?.cause?.message || "")) {
        const conflicting = await getUserByEmployeeId(database, employeeId);
        if (conflicting && conflicting.userId !== currentLineUser.userId) {
          throw conflict("EMPLOYEE_ID_ALREADY_BOUND");
        }
        throw conflict("LINE_BIND_CONFLICT");
      }
      throw error;
    }
    const boundUser = await getUserByLineId(database, verifiedLineUserId);
    if (!boundUser || boundUser.userId !== currentLineUser.userId || !sameEmployeeId(boundUser.employeeId, employeeId)) {
      throw conflict("LINE_BIND_CONFLICT");
    }
    return lineBindingResult(boundUser);
  }
  if (user) {
    if (!user.active) throw forbidden("EMPLOYEE_INACTIVE");
    if (user.lineUserId !== null && user.lineUserId !== void 0) {
      throw conflict("EMPLOYEE_ALREADY_LINE_BOUND");
    }
    throw conflict("EMPLOYEE_ID_ALREADY_BOUND");
  }
  try {
    const provisionalUser = await createProvisionalCanonicalUser(database, {
      employeeId,
      lineUserId: verifiedLineUserId,
      lineDisplayName,
      displayName,
      pickupFloor,
      clock
    });
    return {
      success: true,
      status: "BOUND",
      registered: true,
      identityState: publicUser(provisionalUser).identityState,
      verificationStatus: provisionalUser.verificationStatus,
      authMode: "line",
      lineDisplayName: provisionalUser.displayName,
      user: publicUser(provisionalUser)
    };
  } catch (error) {
    if (/unique|constraint/i.test(error?.message || error?.cause?.message || "")) {
      const conflictingEmployee = await getUserByEmployeeId(database, employeeId);
      if (conflictingEmployee?.lineUserId === verifiedLineUserId) {
        return {
          success: true,
          status: "ALREADY_BOUND",
          identityState: publicUser(conflictingEmployee).identityState,
          verificationStatus: conflictingEmployee.verificationStatus,
          authMode: "line",
          user: publicUser(conflictingEmployee)
        };
      }
      if (conflictingEmployee) throw conflict("EMPLOYEE_ALREADY_LINE_BOUND");
      const conflictingLine = await getUserByLineId(database, verifiedLineUserId);
      if (conflictingLine) throw conflict("LINE_ALREADY_BOUND");
    }
    throw error;
  }
}, "lineEmployeeBind");
var bindLineIdentity = /* @__PURE__ */ __name(async (database, {
  guestToken,
  lineUserId,
  lineDisplayName = "",
  displayName,
  pickupFloor,
  clock = /* @__PURE__ */ new Date()
} = {}) => {
  if (typeof guestToken !== "string" || !guestToken.trim()) {
    throw unauthorized("GUEST_SESSION_INVALID");
  }
  const verifiedLineUserId = lineIdText(lineUserId);
  const now = resolveClock(clock).toISOString();
  const inspected = await inspectGuestSession(database, guestToken, {
    now,
    allowRevokedLineBindReplay: true
  });
  if (!inspected) throw unauthorized("GUEST_SESSION_INVALID");
  const existingLineUser = await getUserByLineId(database, verifiedLineUserId);
  if (inspected.replay) {
    if (inspected.user.lineUserId === verifiedLineUserId) {
      return {
        success: true,
        status: "ALREADY_BOUND",
        identityState: publicUser(inspected.user).identityState,
        authMode: "line",
        user: publicUser(inspected.user)
      };
    }
    throw conflict("EMPLOYEE_ALREADY_LINE_BOUND");
  }
  if (!inspected.normal) {
    throw unauthorized("GUEST_SESSION_INVALID");
  }
  if (inspected.user?.lineUserId) {
    if (inspected.user.lineUserId === verifiedLineUserId) {
      return {
        success: true,
        status: "ALREADY_BOUND",
        identityState: publicUser(inspected.user).identityState,
        authMode: "line",
        user: publicUser(inspected.user)
      };
    }
    throw conflict("EMPLOYEE_ALREADY_LINE_BOUND");
  }
  if (existingLineUser && existingLineUser.userId !== inspected.user.userId) {
    throw conflict("LINE_ALREADY_BOUND");
  }
  if (inspected.provisional && !inspected.user) {
    const timestamp2 = now;
    const employeeId = employeeIdText(inspected.employeeId);
    const onboardingName = profileText(displayName || lineDisplayName);
    const onboardingFloor = pickupFloorText(pickupFloor);
    const userId = randomId("user");
    const insertUser = prepareStatement(database, `
      INSERT INTO users (
        user_id, employee_id, line_user_id, display_name, pickup_floor,
        balance, role, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, 'User', 1, ?, ?)
    `, [
      userId,
      employeeId,
      verifiedLineUserId,
      onboardingName,
      onboardingFloor,
      timestamp2,
      timestamp2
    ]);
    const attachAndRevoke = prepareStatement(database, `
      UPDATE employee_guest_sessions
      SET user_id = ?, revoked_at = ?, revoked_reason = 'line_bound'
      WHERE UPPER(trim(employee_id)) = ? AND revoked_at IS NULL
    `, [userId, timestamp2, employeeId]);
    try {
      const [insertResult, attachResult] = await database.batch([
        insertUser,
        attachAndRevoke
      ]);
      if (statementChanges(insertResult) !== 1 || statementChanges(attachResult) < 1) {
        throw new Error("Provisional user creation failed.");
      }
    } catch (error) {
      if (/unique|constraint/i.test(error?.message || error?.cause?.message || "")) {
        const conflictingEmployee = await getUserByEmployeeId(database, employeeId);
        if (conflictingEmployee) throw conflict("EMPLOYEE_BIND_CONFLICT");
        const conflictingLine = await getUserByLineId(database, verifiedLineUserId);
        if (conflictingLine) throw conflict("LINE_ALREADY_BOUND");
      }
      throw error;
    }
    const user = await getUserById(database, userId);
    if (!user) throw new Error("Provisional LINE binding readback failed.");
    return {
      success: true,
      status: "BOUND",
      identityState: publicUser(user).identityState,
      verificationStatus: user.verificationStatus,
      authMode: "line",
      lineDisplayName: onboardingName,
      user: publicUser(user)
    };
  }
  const replacementName = verifiedNameForLegacyProfile(inspected.user, lineDisplayName);
  const update = prepareStatement(database, `
    UPDATE users
    SET line_user_id = ?,
        display_name = CASE
          WHEN display_name = ? THEN COALESCE(?, display_name)
          ELSE display_name
        END,
        updated_at = ?
    WHERE user_id = ? AND active = 1 AND line_user_id IS NULL
  `, [
    verifiedLineUserId,
    legacyEmployeeDisplayName(inspected.user.employeeId),
    replacementName,
    now,
    inspected.user.userId
  ]);
  const revoke = prepareStatement(database, `
    UPDATE employee_guest_sessions
    SET revoked_at = ?, revoked_reason = 'line_bound'
    WHERE user_id = ?
      AND revoked_at IS NULL
      AND changes() = 1
      AND EXISTS (
        SELECT 1 FROM users
        WHERE user_id = ? AND line_user_id = ?
      )
  `, [now, inspected.user.userId, inspected.user.userId, verifiedLineUserId]);
  try {
    const [updateResult] = await database.batch([update, revoke]);
    const updateCount = statementChanges(updateResult);
    const user = await getUserById(database, inspected.user.userId);
    if (!user) throw new Error("LINE binding readback failed.");
    if (user.lineUserId !== verifiedLineUserId) {
      throw conflict("LINE_BIND_CONFLICT");
    }
    return {
      success: true,
      status: updateCount === 1 ? "BOUND" : "ALREADY_BOUND",
      verificationStatus: user.verificationStatus,
      identityState: publicUser(user).identityState,
      authMode: "line",
      lineDisplayName,
      user: publicUser(user)
    };
  } catch (error) {
    if (/unique|constraint/i.test(error?.message || error?.cause?.message || "")) {
      const conflicting = await getUserByLineId(database, verifiedLineUserId);
      if (conflicting && conflicting.userId !== inspected.user.userId) {
        throw conflict("LINE_ALREADY_BOUND");
      }
      throw conflict("LINE_BIND_CONFLICT");
    }
    throw error;
  }
}, "bindLineIdentity");

// src/http/response.js
var PRODUCTION_FRONTEND_ORIGIN = "https://stirring-pony-3571ac.netlify.app";
var LOCAL_DEVELOPMENT_ORIGIN = "http://localhost:5173";
var LOOPBACK_DEVELOPMENT_ORIGIN = "http://127.0.0.1:5173";
var CORS_HEADERS = Object.freeze({
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key, X-Employee-Guest-Session",
  "Access-Control-Allow-Methods": "GET, OPTIONS, PATCH, POST, PUT, DELETE"
});
var isLocalCorsMode = /* @__PURE__ */ __name((env) => String(env?.CORS_MODE || "").trim().toLowerCase() === "local", "isLocalCorsMode");
var isRemoteTestCorsMode = /* @__PURE__ */ __name((env) => String(env?.CORS_MODE || "").trim().toLowerCase() === "remote-test", "isRemoteTestCorsMode");
var isExplicitDevOrTestCorsMode = /* @__PURE__ */ __name((env) => isLocalCorsMode(env) || isRemoteTestCorsMode(env), "isExplicitDevOrTestCorsMode");
var PINGGY_REMOTE_TEST_HOST_PATTERN = /^(?!run\.)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.run\.pinggy\.link|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.run)?\.pinggy-free\.link)$/i;
var normalizeExactOrigin = /* @__PURE__ */ __name((value) => {
  const candidate = String(value || "").trim();
  if (!candidate || candidate.includes("*") || candidate.includes("?")) return null;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== candidate) {
    return null;
  }
  return candidate;
}, "normalizeExactOrigin");
var resolveAllowedOrigins = /* @__PURE__ */ __name((env = {}) => {
  const allowedOrigins = /* @__PURE__ */ new Set([
    PRODUCTION_FRONTEND_ORIGIN,
    LOCAL_DEVELOPMENT_ORIGIN,
    LOOPBACK_DEVELOPMENT_ORIGIN
  ]);
  if (!isExplicitDevOrTestCorsMode(env)) return allowedOrigins;
  String(env.DEV_ALLOWED_ORIGINS || "").split(",").map(normalizeExactOrigin).filter(Boolean).forEach((origin) => allowedOrigins.add(origin));
  return allowedOrigins;
}, "resolveAllowedOrigins");
var isDynamicPinggyOrigin = /* @__PURE__ */ __name((origin) => {
  if (!origin) return false;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && parsed.port === "" && parsed.origin === origin && PINGGY_REMOTE_TEST_HOST_PATTERN.test(parsed.hostname);
}, "isDynamicPinggyOrigin");
var isAllowedOrigin = /* @__PURE__ */ __name((origin, env = {}) => {
  const normalizedOrigin = normalizeExactOrigin(origin);
  return Boolean(
    normalizedOrigin && (resolveAllowedOrigins(env).has(normalizedOrigin) || isDynamicPinggyOrigin(normalizedOrigin))
  );
}, "isAllowedOrigin");
var applyCorsPolicy = /* @__PURE__ */ __name((response, request, env = {}) => {
  const headers = new Headers(response.headers);
  const origin = normalizeExactOrigin(request?.headers.get("Origin"));
  if (!isAllowedOrigin(origin, env)) {
    headers.delete("Access-Control-Allow-Origin");
    headers.delete("Access-Control-Allow-Headers");
    headers.delete("Access-Control-Allow-Methods");
  } else {
    headers.set("Access-Control-Allow-Origin", origin);
    Object.entries(CORS_HEADERS).forEach(([header, value]) => headers.set(header, value));
  }
  headers.set("Vary", "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}, "applyCorsPolicy");
var jsonResponse = /* @__PURE__ */ __name((body, status = 200, headers = {}) => new Response(
  JSON.stringify(body),
  {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers
    }
  }
), "jsonResponse");
var emptyResponse = /* @__PURE__ */ __name((status = 204) => new Response(null, {
  status
}), "emptyResponse");

// src/routes/auth.js
var readJson = /* @__PURE__ */ __name(async (request) => {
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("body");
    return value;
  } catch {
    throw badRequest("INVALID_JSON");
  }
}, "readJson");
var readOptionalJson = /* @__PURE__ */ __name(async (request) => {
  if (!request.headers.get("content-type") && !request.headers.get("content-length")) {
    return {};
  }
  return readJson(request);
}, "readOptionalJson");
var handleAuthRoute = /* @__PURE__ */ __name(async (request, env, {
  fetchImpl = globalThis.fetch,
  now = /* @__PURE__ */ new Date()
} = {}) => {
  const url = new URL(request.url);
  const isGuestLogin = request.method === "POST" && url.pathname === "/api/auth/employee-guest";
  const isGuestOnboarding = request.method === "POST" && url.pathname === "/api/auth/employee-guest/onboarding";
  const isLineBind = request.method === "POST" && url.pathname === "/api/auth/line-bind";
  const isLineEmployeeLookup = request.method === "POST" && url.pathname === "/api/auth/line-employee-lookup";
  const isLineEmployeeBind = request.method === "POST" && url.pathname === "/api/auth/line-employee-bind";
  if (!isGuestLogin && !isGuestOnboarding && !isLineBind && !isLineEmployeeLookup && !isLineEmployeeBind) return null;
  if (isGuestLogin) {
    const body2 = await readJson(request);
    const result = await employeeGuestLogin(env.DB, body2.employeeId, now);
    return jsonResponse(
      result,
      result.status === "UNVERIFIED_EMPLOYEE" ? 200 : 201
    );
  }
  if (isGuestOnboarding) {
    const guestToken2 = request.headers.get("X-Employee-Guest-Session")?.trim() || "";
    if (!guestToken2) throw unauthorized("GUEST_SESSION_INVALID");
    const result = await completeEmployeeGuestOnboarding(env.DB, {
      guestToken: guestToken2,
      ...await readJson(request),
      clock: now
    });
    return jsonResponse(result);
  }
  if (isLineEmployeeLookup || isLineEmployeeBind) {
    const line2 = await resolveLineIdentity(request, env.DB, fetchImpl);
    const body2 = await readJson(request);
    const result = isLineEmployeeLookup ? await lineEmployeeLookup(env.DB, {
      employeeId: body2.employeeId,
      lineUserId: line2.profile.lineUserId
    }) : await lineEmployeeBind(env.DB, {
      employeeId: body2.employeeId,
      lineUserId: line2.profile.lineUserId,
      lineDisplayName: line2.profile.displayName,
      displayName: body2.displayName,
      pickupFloor: body2.pickupFloor,
      clock: now
    });
    return jsonResponse(result);
  }
  const guestToken = request.headers.get("X-Employee-Guest-Session")?.trim() || "";
  if (!guestToken) throw unauthorized("GUEST_SESSION_INVALID");
  const line = await resolveLineIdentity(request, env.DB, fetchImpl);
  const body = await readOptionalJson(request);
  return jsonResponse(await bindLineIdentity(env.DB, {
    guestToken,
    lineUserId: line.profile.lineUserId,
    lineDisplayName: line.profile.displayName,
    displayName: body.displayName,
    pickupFloor: body.pickupFloor,
    clock: now
  }));
}, "handleAuthRoute");

// src/http/authMiddleware.js
var requireIdentity = /* @__PURE__ */ __name((request, env, options = {}) => resolveCanonicalIdentity(request, env, options.fetchImpl || globalThis.fetch, options), "requireIdentity");

// src/routes/me.js
var readJson2 = /* @__PURE__ */ __name(async (request) => {
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("body");
    }
    return value;
  } catch {
    throw badRequest("INVALID_JSON");
  }
}, "readJson");
var handleMeRoute = /* @__PURE__ */ __name(async (request, env, {
  fetchImpl = globalThis.fetch,
  now = /* @__PURE__ */ new Date()
} = {}) => {
  const url = new URL(request.url);
  const isMeRoute = request.method === "GET" && url.pathname === "/api/me" || request.method === "POST" && url.pathname === "/api/register" || request.method === "PATCH" && url.pathname === "/api/me/pickup-floor";
  if (!isMeRoute) return null;
  const identity = await requireIdentity(request, env, { fetchImpl, now });
  if (request.method === "GET" && url.pathname === "/api/me") {
    return jsonResponse(getMe(identity));
  }
  if (request.method === "POST" && url.pathname === "/api/register") {
    return jsonResponse(await registerUser(env.DB, identity, await readJson2(request), now), 201);
  }
  if (request.method === "PATCH" && url.pathname === "/api/me/pickup-floor") {
    const body = await readJson2(request);
    return jsonResponse(await updatePickupFloor(
      env.DB,
      identity,
      body.pickupFloor,
      now,
      body.displayName
    ));
  }
  return null;
}, "handleMeRoute");

// src/db/idempotency.js
var MAX_KEY_LENGTH = 200;
var hasControlCharacter = /* @__PURE__ */ __name((value) => Array.from(value).some((character) => {
  const code = character.charCodeAt(0);
  return code < 32 || code === 127;
}), "hasControlCharacter");
var assertText = /* @__PURE__ */ __name((value, code) => {
  const text11 = typeof value === "string" ? value.trim() : "";
  if (!text11) throw badRequest(code);
  return text11;
}, "assertText");
var requireIdempotencyKey = /* @__PURE__ */ __name((value) => {
  const key = assertText(value, "IDEMPOTENCY_REQUIRED");
  if (key.length > MAX_KEY_LENGTH || hasControlCharacter(key)) {
    throw badRequest("IDEMPOTENCY_KEY_INVALID");
  }
  return key;
}, "requireIdempotencyKey");
var canonicalize = /* @__PURE__ */ __name((value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value).filter((key) => value[key] !== void 0).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError("Idempotency payload must contain finite numbers.");
  }
  return value;
}, "canonicalize");
var canonicalJson = /* @__PURE__ */ __name((value) => JSON.stringify(canonicalize(value)), "canonicalJson");
var hashRequest = /* @__PURE__ */ __name(async (value) => {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is required for request hashing.");
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}, "hashRequest");
var claimParams = /* @__PURE__ */ __name(({ actorUserId, operation, idempotencyKey: idempotencyKey3, requestHash, claimToken }) => [
  actorUserId,
  operation,
  idempotencyKey3,
  requestHash,
  claimToken
], "claimParams");
var idempotencyGuard = /* @__PURE__ */ __name((details) => ({
  sql: `EXISTS (
    SELECT 1
    FROM idempotency_keys
    WHERE actor_user_id = ?
      AND operation = ?
      AND idempotency_key = ?
      AND request_hash = ?
      AND claim_token = ?
      AND status = 'IN_PROGRESS'
  )`,
  params: claimParams(details)
}), "idempotencyGuard");
var beginIdempotentOperation = /* @__PURE__ */ __name((database, {
  actorUserId,
  operation,
  idempotencyKey: idempotencyKey3,
  requestHash,
  claimToken = randomId("claim"),
  occurredAt
}) => prepareStatement(database, `
  INSERT OR IGNORE INTO idempotency_keys (
    actor_user_id, operation, idempotency_key, request_hash,
    claim_token, status, created_at
  )
  VALUES (?, ?, ?, ?, ?, 'IN_PROGRESS', ?)
`, [actorUserId, operation, idempotencyKey3, requestHash, claimToken, occurredAt]), "beginIdempotentOperation");
var completeIdempotentOperation = /* @__PURE__ */ __name((database, {
  actorUserId,
  operation,
  idempotencyKey: idempotencyKey3,
  requestHash,
  claimToken,
  occurredAt,
  responseSpec
}) => {
  if (!responseSpec?.trusted || typeof responseSpec.expression !== "string") {
    throw new TypeError("A trusted stored response specification is required.");
  }
  return prepareStatement(database, `
    UPDATE idempotency_keys
    SET status = 'COMPLETED',
        response_json = ${responseSpec.expression},
        completed_at = ?
    WHERE actor_user_id = ?
      AND operation = ?
      AND idempotency_key = ?
      AND request_hash = ?
      AND claim_token = ?
      AND status = 'IN_PROGRESS'
  `, [
    ...responseSpec.params,
    occurredAt,
    actorUserId,
    operation,
    idempotencyKey3,
    requestHash,
    claimToken
  ]);
}, "completeIdempotentOperation");
var readIdempotencyRecord = /* @__PURE__ */ __name(async (database, { actorUserId, operation, idempotencyKey: idempotencyKey3 }) => prepareStatement(database, `
  SELECT actor_user_id, operation, idempotency_key, request_hash,
         claim_token, status, response_json, created_at, completed_at
  FROM idempotency_keys
  WHERE actor_user_id = ? AND operation = ? AND idempotency_key = ?
  LIMIT 1
`, [actorUserId, operation, idempotencyKey3]).first(), "readIdempotencyRecord");
var mutationResponseSpec = /* @__PURE__ */ __name(({
  message,
  orderId,
  balanceUserId
}) => ({
  trusted: true,
  expression: `json_object(
    'success', json('true'),
    'message', ?,
    'orderId', ?,
    'newBalance', (SELECT ${currentBalanceProjection("u")} FROM users u WHERE u.user_id = ?)
  )`,
  params: [message, orderId, balanceUserId]
}), "mutationResponseSpec");
var balanceMutationResponseSpec = /* @__PURE__ */ __name(({
  message,
  targetUserId,
  balanceUserId,
  transactionId
}) => ({
  trusted: true,
  expression: `json_object(
    'success', json('true'),
    'message', ?,
    'targetUserId', ?,
    'transactionId', ?,
    'newBalance', (SELECT ${currentBalanceProjection("u")} FROM users u WHERE u.user_id = ?)
  )`,
  params: [message, targetUserId, transactionId, balanceUserId]
}), "balanceMutationResponseSpec");
var parseStoredResponse = /* @__PURE__ */ __name((record) => {
  try {
    return JSON.parse(record.response_json);
  } catch {
    const error = new Error("Stored idempotency response is invalid.");
    error.code = "IDEMPOTENCY_RESPONSE_INVALID";
    throw error;
  }
}, "parseStoredResponse");
var readExistingIdempotencyResult = /* @__PURE__ */ __name(async (database, { actorUserId, operation, idempotencyKey: idempotencyKey3, requestHash }) => {
  const record = await readIdempotencyRecord(database, {
    actorUserId,
    operation,
    idempotencyKey: idempotencyKey3
  });
  if (!record) return null;
  if (record.request_hash !== requestHash) throw conflict("IDEMPOTENCY_CONFLICT");
  if (record.status === "COMPLETED") return parseStoredResponse(record);
  if (record.status === "IN_PROGRESS") throw conflict("IDEMPOTENCY_IN_PROGRESS");
  throw conflict("IDEMPOTENCY_FAILED");
}, "readExistingIdempotencyResult");
var runIdempotentMutation = /* @__PURE__ */ __name(async (database, {
  actorUserId,
  operation,
  idempotencyKey: idempotencyKey3,
  requestHash,
  occurredAt,
  responseSpec,
  buildStatements,
  claimToken = randomId("claim")
}) => {
  const details = {
    actorUserId,
    operation,
    idempotencyKey: idempotencyKey3,
    requestHash,
    claimToken
  };
  const statements = [beginIdempotentOperation(database, {
    ...details,
    occurredAt
  })];
  const built = await buildStatements({ ...details, guard: idempotencyGuard(details) });
  if (!Array.isArray(built) || built.length === 0) {
    throw new TypeError("An idempotent mutation must provide mutation statements.");
  }
  statements.push(...built);
  statements.push(completeIdempotentOperation(database, {
    ...details,
    occurredAt,
    responseSpec
  }));
  await runMutationBatch(database, statements);
  const record = await readIdempotencyRecord(database, {
    actorUserId,
    operation,
    idempotencyKey: idempotencyKey3
  });
  if (!record) throw new Error("Idempotency claim disappeared after commit.");
  if (record.request_hash !== requestHash) throw conflict("IDEMPOTENCY_CONFLICT");
  if (record.status === "COMPLETED") return parseStoredResponse(record);
  if (record.status === "IN_PROGRESS") throw conflict("IDEMPOTENCY_IN_PROGRESS");
  throw conflict("IDEMPOTENCY_FAILED");
}, "runIdempotentMutation");

// src/domain/topupMethods.js
var TOPUP_METHOD_VALUES = Object.freeze([
  "TAIWAN_PAY",
  "LINE_PAY_MONEY",
  "BANK_TRANSFER",
  "CASH",
  "IPASS_MONEY"
]);
var TOPUP_METHOD_SET = new Set(TOPUP_METHOD_VALUES);
var text = /* @__PURE__ */ __name((value) => typeof value === "string" ? value.trim() : "", "text");
var isAllowedTopupMethod = /* @__PURE__ */ __name((value) => TOPUP_METHOD_SET.has(text(value)), "isAllowedTopupMethod");
var requireTopupMethod = /* @__PURE__ */ __name((value) => {
  const method = text(value);
  if (!method) throw badRequest("TOP_UP_METHOD_REQUIRED");
  if (!isAllowedTopupMethod(method)) throw badRequest("TOP_UP_METHOD_INVALID");
  return method;
}, "requireTopupMethod");

// src/db/ledgerQueries.js
var LEDGER_TYPES = Object.freeze(["TOPUP", "ORDER", "REFUND", "ADJUSTMENT"]);
var AUTH_MODES = /* @__PURE__ */ new Set(["line", "employee_guest", "legacy_import"]);
var text2 = /* @__PURE__ */ __name((value) => typeof value === "string" ? value.trim() : "", "text");
var optionalTopupMethod = /* @__PURE__ */ __name((value) => {
  if (value === null || value === void 0) return null;
  const method = text2(value);
  if (!method) return null;
  if (!isAllowedTopupMethod(method)) throw badRequest("LEDGER_TOPUP_METHOD_INVALID");
  return method;
}, "optionalTopupMethod");
var timestamp = /* @__PURE__ */ __name((value) => {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw badRequest("LEDGER_TIMESTAMP_INVALID");
  return date.toISOString();
}, "timestamp");
var approvedPolicy = /* @__PURE__ */ __name((policy) => Boolean(
  policy?.approved === true && typeof policy.policyId === "string" && policy.policyId.trim() && typeof policy.approvedBy === "string" && policy.approvedBy.trim() && typeof policy.approvedAt === "string" && !Number.isNaN(new Date(policy.approvedAt).getTime()) && typeof policy.reference === "string" && policy.reference.trim()
), "approvedPolicy");
var referenceRule = /* @__PURE__ */ __name((entry) => {
  if (entry.type === "ORDER" || entry.type === "REFUND") {
    return {
      sql: `EXISTS (
        SELECT 1 FROM orders o
        WHERE o.order_id = ? AND o.user_id = ?
      )`,
      params: [entry.referenceId, entry.userId]
    };
  }
  if (entry.type === "TOPUP") {
    return {
      sql: `EXISTS (
        SELECT 1 FROM admin_audit_log a
        WHERE a.audit_id = ?
          AND a.target_user_id = ?
          AND a.actor_user_id = ?
          AND a.action = 'BALANCE_TOP_UP'
      )`,
      params: [entry.referenceId, entry.userId, entry.operatorUserId]
    };
  }
  return {
    sql: `EXISTS (
      SELECT 1 FROM admin_audit_log a
      WHERE a.audit_id = ?
        AND a.target_user_id = ?
        AND a.actor_user_id = ?
        AND a.action = 'BALANCE_ADJUSTMENT'
    )`,
    params: [entry.referenceId, entry.userId, entry.operatorUserId]
  };
}, "referenceRule");
var validateLedgerEntry = /* @__PURE__ */ __name((input) => {
  const authMode = text2(input?.authMode) || "line";
  const entry = {
    transactionId: text2(input?.transactionId),
    userId: text2(input?.userId),
    employeeIdSnapshot: text2(input?.employeeIdSnapshot) || null,
    lineUserIdSnapshot: text2(input?.lineUserIdSnapshot) || null,
    displayNameSnapshot: text2(input?.displayNameSnapshot) || null,
    amount: input?.amount,
    balanceAfter: input?.balanceAfter,
    type: text2(input?.type).toUpperCase(),
    topupMethod: optionalTopupMethod(input?.topupMethod),
    referenceId: text2(input?.referenceId),
    operatorUserId: text2(input?.operatorUserId) || null,
    operatorEmployeeIdSnapshot: text2(input?.operatorEmployeeIdSnapshot) || null,
    operatorLineUserIdSnapshot: text2(input?.operatorLineUserIdSnapshot) || null,
    operatorDisplayNameSnapshot: text2(input?.operatorDisplayNameSnapshot) || null,
    operatorAuthMode: text2(input?.operatorAuthMode) || null,
    authMode,
    note: text2(input?.note),
    occurredAt: timestamp(input?.occurredAt),
    sourceBatchId: text2(input?.sourceBatchId) || null,
    policy: input?.policy || null
  };
  if (!entry.transactionId) throw badRequest("LEDGER_TRANSACTION_ID_REQUIRED");
  if (!entry.userId) throw badRequest("LEDGER_USER_REQUIRED");
  if (!Number.isSafeInteger(entry.amount)) throw badRequest("LEDGER_AMOUNT_INTEGER_REQUIRED");
  if (!Number.isSafeInteger(entry.balanceAfter)) {
    throw badRequest("LEDGER_BALANCE_INTEGER_REQUIRED");
  }
  if (!LEDGER_TYPES.includes(entry.type)) throw badRequest("LEDGER_TYPE_INVALID");
  if (entry.topupMethod !== null && entry.type !== "TOPUP") {
    throw badRequest("LEDGER_TOPUP_METHOD_INVALID");
  }
  if (!AUTH_MODES.has(entry.authMode)) throw badRequest("LEDGER_AUTH_MODE_INVALID");
  if (entry.operatorAuthMode !== null && !AUTH_MODES.has(entry.operatorAuthMode)) {
    throw badRequest("LEDGER_OPERATOR_AUTH_MODE_INVALID");
  }
  if (!entry.referenceId) throw badRequest("LEDGER_REFERENCE_REQUIRED");
  if ((entry.type === "TOPUP" || entry.type === "ADJUSTMENT") && !entry.operatorUserId) {
    throw badRequest("LEDGER_OPERATOR_REQUIRED");
  }
  if (entry.type === "ADJUSTMENT" && !approvedPolicy(entry.policy)) {
    throw conflict("OPENING_BALANCE_POLICY_REQUIRED");
  }
  if (entry.note.length > 2e3) throw badRequest("LEDGER_NOTE_TOO_LONG");
  return entry;
}, "validateLedgerEntry");
var ledgerMutationStatements = /* @__PURE__ */ __name((database, input, { guard, dynamicBalanceAfter = false, dynamicOrder = null } = {}) => {
  const entry = validateLedgerEntry({
    ...input,
    balanceAfter: dynamicBalanceAfter ? 0 : input?.balanceAfter
  });
  const guardSql = guard?.sql || "1 = 1";
  const guardParams = guard?.params || [];
  const dynamicOrderDate = text2(dynamicOrder?.orderDate);
  if (dynamicOrder && !dynamicOrderDate) {
    throw badRequest("LEDGER_ORDER_DATE_REQUIRED");
  }
  const dynamicOrderParams = dynamicOrder ? [entry.userId, dynamicOrderDate] : [];
  const dynamicOrderExists = dynamicOrder ? `EXISTS (
        SELECT 1 FROM orders o
        WHERE o.user_id = ?
          AND o.order_date = ?
          AND o.status = 'ACTIVE'
      )` : null;
  const dynamicOrderAmount = dynamicOrder ? `(SELECT o.total_amount
        FROM orders o
        WHERE o.user_id = ?
          AND o.order_date = ?
          AND o.status = 'ACTIVE'
        LIMIT 1)` : null;
  const dynamicOrderReference = dynamicOrder ? `(SELECT o.order_id
        FROM orders o
        WHERE o.user_id = ?
          AND o.order_date = ?
          AND o.status = 'ACTIVE'
        LIMIT 1)` : null;
  const reference = dynamicOrder ? { sql: dynamicOrderExists, params: dynamicOrderParams } : referenceRule(entry);
  const authoritativeBalance = authoritativeBalanceProjection("target");
  const updateCondition = dynamicBalanceAfter ? `(${reference.sql})` : `(${authoritativeBalance} + ? = ? AND (${reference.sql}))`;
  const updateAmount = dynamicOrder ? dynamicOrderAmount : "?";
  const dynamicBalanceAfterSql = dynamicBalanceAfter ? "target.balance" : "?";
  const insertAmountParams = dynamicOrder ? dynamicOrderParams : [entry.amount];
  const insertBalanceParams = dynamicBalanceAfter ? [] : [entry.balanceAfter];
  const updateElse = dynamicOrder ? "target.balance" : "NULL";
  const updateParams = dynamicBalanceAfter ? [
    ...reference.params,
    ...dynamicOrder ? dynamicOrderParams : [entry.amount],
    entry.occurredAt,
    entry.userId,
    ...guardParams
  ] : [
    entry.amount,
    entry.balanceAfter,
    ...reference.params,
    ...dynamicOrder ? dynamicOrderParams : [entry.amount],
    entry.occurredAt,
    entry.userId,
    ...guardParams
  ];
  const update = prepareStatement(database, `
    UPDATE users AS target
    SET balance = CASE
          WHEN ${updateCondition}
          THEN ${authoritativeBalance} + ${updateAmount}
          ELSE ${updateElse}
        END,
        updated_at = ?
    WHERE target.user_id = ? AND ${guardSql}
  `, updateParams);
  const insert = prepareStatement(database, `
    INSERT INTO balance_ledger (
      transaction_id, user_id, employee_id_snapshot, line_user_id_snapshot,
      display_name_snapshot, amount, balance_after, type, topup_method, reference_id,
      operator_user_id, operator_employee_id_snapshot,
      operator_line_user_id_snapshot, operator_display_name_snapshot,
      operator_auth_mode, auth_mode, note, occurred_at, source_batch_id
    )
    SELECT ?, ?, ?, ?, ?,
      ${dynamicOrder ? dynamicOrderAmount : "?"},
      ${dynamicBalanceAfterSql},
      ?,
      ?,
      ${dynamicOrder ? dynamicOrderReference : "?"},
      ?, ?, ?, ?, ?, ?, ?, ?, ?
    FROM users AS target
    WHERE target.user_id = ?
      ${dynamicOrder ? `AND ${dynamicOrderAmount} IS NOT NULL` : ""}
      ${dynamicBalanceAfter || dynamicOrder ? "" : "AND target.balance = ?"}
      AND ${guardSql}
  `, [
    entry.transactionId,
    entry.userId,
    entry.employeeIdSnapshot,
    entry.lineUserIdSnapshot,
    entry.displayNameSnapshot,
    ...insertAmountParams,
    ...insertBalanceParams,
    entry.type,
    entry.topupMethod,
    ...dynamicOrder ? dynamicOrderParams : [entry.referenceId],
    entry.operatorUserId,
    entry.operatorEmployeeIdSnapshot,
    entry.operatorLineUserIdSnapshot,
    entry.operatorDisplayNameSnapshot,
    entry.operatorAuthMode,
    entry.authMode,
    entry.note,
    entry.occurredAt,
    entry.sourceBatchId,
    entry.userId,
    ...dynamicBalanceAfter || dynamicOrder ? [] : [entry.balanceAfter],
    ...dynamicOrder ? dynamicOrderParams : [],
    ...guardParams
  ]);
  return { entry, statements: [update, insert] };
}, "ledgerMutationStatements");
var getLedgerRows = /* @__PURE__ */ __name(async (database, userId, { from, to } = {}) => {
  const result = await database.prepare(`
    SELECT bl.transaction_id, bl.user_id, bl.employee_id_snapshot,
           bl.line_user_id_snapshot, bl.display_name_snapshot, bl.amount,
           bl.balance_after, bl.type, bl.topup_method, bl.operator_user_id, bl.note,
           bls.sequence_number,
           bl.reference_id, bl.occurred_at, bl.source_batch_id, o.order_date
    FROM balance_ledger bl
    JOIN balance_ledger_sequence bls ON bls.transaction_id = bl.transaction_id
    LEFT JOIN orders o ON o.order_id = bl.reference_id
      AND bl.type IN ('ORDER', 'REFUND')
    WHERE bl.user_id = ?
      AND (? IS NULL OR bl.occurred_at >= ?)
      AND (? IS NULL OR bl.occurred_at < ?)
    ORDER BY bls.sequence_number ASC
  `).bind(userId, from || null, from || null, to || null, to || null).all();
  return Array.isArray(result) ? result : result?.results || [];
}, "getLedgerRows");
var getHistoricalOrderDetails = /* @__PURE__ */ __name(async (database, orderIds = []) => {
  const ids = [...new Set(orderIds.map((orderId) => String(orderId || "").trim()).filter(Boolean))];
  const details = /* @__PURE__ */ new Map();
  const chunkSize = 50;
  for (let index = 0; index < ids.length; index += chunkSize) {
    const chunk = ids.slice(index, index + chunkSize);
    const placeholders = chunk.map(() => "?").join(", ");
    const result = await database.prepare(`
      SELECT o.order_id, o.order_date, o.vendor,
             oi.line_no, oi.item_name_snapshot, oi.quantity
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.order_id
      WHERE o.order_id IN (${placeholders})
      ORDER BY o.order_id, oi.line_no
    `).bind(...chunk).all();
    const rows = Array.isArray(result) ? result : result?.results || [];
    for (const row of rows) {
      if (!details.has(row.order_id)) {
        details.set(row.order_id, {
          orderDate: row.order_date || null,
          vendorName: row.vendor || "",
          items: []
        });
      }
      if (row.item_name_snapshot !== null && row.item_name_snapshot !== void 0) {
        details.get(row.order_id).items.push({
          name: String(row.item_name_snapshot),
          quantity: Number(row.quantity)
        });
      }
    }
  }
  return details;
}, "getHistoricalOrderDetails");
var getLatestLedgerRow = /* @__PURE__ */ __name(async (database, userId, before = null) => database.prepare(`
     SELECT bl.transaction_id, bl.user_id, bl.employee_id_snapshot,
            bl.line_user_id_snapshot, bl.display_name_snapshot, bl.amount,
            bl.balance_after, bl.type, bl.reference_id, bl.topup_method, bl.operator_user_id,
            bl.note, bl.occurred_at, bl.source_batch_id,
            bls.sequence_number
    FROM balance_ledger bl
    JOIN balance_ledger_sequence bls ON bls.transaction_id = bl.transaction_id
    WHERE bl.user_id = ?
      AND (? IS NULL OR bl.occurred_at < ?)
    ORDER BY bls.sequence_number DESC
    LIMIT 1
  `).bind(userId, before, before).first(), "getLatestLedgerRow");

// src/domain/deadlines.js
var TIME_ZONE = "Asia/Taipei";
var isDateOnly = /* @__PURE__ */ __name((value) => {
  const text11 = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text11)) return false;
  const [year, month, day] = text11.split("-").map(Number);
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}, "isDateOnly");
var getTaipeiDate = /* @__PURE__ */ __name((now = /* @__PURE__ */ new Date()) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now).reduce((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
  return parts.year + "-" + parts.month + "-" + parts.day;
}, "getTaipeiDate");
var deadlineAt = /* @__PURE__ */ __name((orderDate, mode) => {
  if (!isDateOnly(orderDate)) return null;
  const [year, month, day] = orderDate.split("-").map(Number);
  const deadline = new Date(Date.UTC(year, month - 1, day));
  if (mode === "B") {
    deadline.setUTCDate(deadline.getUTCDate() - 1);
    deadline.setUTCHours(10, 0, 0, 0);
  } else {
    deadline.setUTCHours(2, 0, 0, 0);
  }
  return deadline;
}, "deadlineAt");
var deadlineInfo = /* @__PURE__ */ __name((orderDate, mode, now = /* @__PURE__ */ new Date()) => {
  const deadline = deadlineAt(orderDate, mode);
  if (!deadline) return null;
  return {
    now: now.toISOString(),
    deadline: deadline.toISOString(),
    isExpired: now > deadline
  };
}, "deadlineInfo");

// src/domain/orderAuthorization.js
var DELEGATED_ROLES = /* @__PURE__ */ new Set(["ProxyAdmin", "Admin"]);
var normalizeTargetUserId = /* @__PURE__ */ __name((value) => {
  if (value === void 0 || value === null) return null;
  if (typeof value !== "string") throw badRequest("TARGET_USER_ID_INVALID");
  const targetUserId = value.trim();
  return targetUserId || null;
}, "normalizeTargetUserId");
var hasEmployeeId3 = /* @__PURE__ */ __name((value) => String(value ?? "").trim().length > 0, "hasEmployeeId");
var isEligibleOrderTarget = /* @__PURE__ */ __name((user) => Boolean(
  user?.userId && user.active === true && hasEmployeeId3(user.employeeId) && isProfileComplete(user)
), "isEligibleOrderTarget");
var orderTargetColumns = /* @__PURE__ */ __name((alias = "u") => `
  ${alias}.user_id, ${alias}.employee_id, ${alias}.line_user_id,
  ${alias}.display_name, ${alias}.pickup_floor,
  ${currentBalanceProjection(alias)} AS balance,
  ${alias}.role, ${alias}.active, ${alias}.verification_status,
  ${alias}.created_at, ${alias}.updated_at
`, "orderTargetColumns");
var orderTargetRecord = /* @__PURE__ */ __name((row) => ({ user: toUser(row) }), "orderTargetRecord");
var getOrderTargetById = /* @__PURE__ */ __name(async (database, userId) => {
  const row = await database.prepare(`
    SELECT ${orderTargetColumns("u")}
    FROM users u
    WHERE u.user_id = ?
    LIMIT 1
  `).bind(userId).first();
  return orderTargetRecord(row);
}, "getOrderTargetById");
var authenticatedActor = /* @__PURE__ */ __name((identity) => {
  assertCan(identity, ACTIONS.WRITE_SELF);
  const actor = identity?.actor;
  if (!actor?.userId) throw forbidden("AUTH_REQUIRED");
  if (identity?.effectiveSubject?.userId && identity.effectiveSubject.userId !== actor.userId) {
    throw forbidden("VIEW_AS_MUTATION_FORBIDDEN");
  }
  return actor;
}, "authenticatedActor");
var getAuthenticatedOrderActor = /* @__PURE__ */ __name((identity) => authenticatedActor(identity), "getAuthenticatedOrderActor");
var resolveOrderActorTarget = /* @__PURE__ */ __name(async (database, identity, requestedTargetUserId) => {
  const actor = authenticatedActor(identity);
  const requestedId = normalizeTargetUserId(requestedTargetUserId);
  const targetUserId = requestedId || actor.userId;
  const isDelegated = targetUserId !== actor.userId;
  if (isDelegated) {
    if (!DELEGATED_ROLES.has(actor.role)) {
      throw forbidden("DELEGATED_ORDER_FORBIDDEN");
    }
    assertCan(identity, ACTIONS.DELEGATE_ORDER);
  }
  const targetRecord = await getOrderTargetById(database, targetUserId);
  const target = targetRecord.user;
  if (!isEligibleOrderTarget(target)) {
    throw forbidden(targetUserId === actor.userId ? "PROFILE_COMPLETION_REQUIRED" : "ORDER_TARGET_INELIGIBLE");
  }
  return {
    actor,
    target,
    targetUserId,
    isDelegated,
    requestedTargetUserId: requestedId
  };
}, "resolveOrderActorTarget");
var resolveOrderMutationTiming = /* @__PURE__ */ __name(({
  actor,
  isDelegated,
  targetDate,
  mode,
  now,
  enforceProxyDelegatedDate = true
}) => {
  const adminBypass = actor?.role === "Admin";
  const proxyDelegatedBypass = actor?.role === "ProxyAdmin" && isDelegated;
  const proxyDelegatedDateAllowed = !proxyDelegatedBypass || targetDate >= getTaipeiDate(now);
  if (proxyDelegatedBypass && !proxyDelegatedDateAllowed && enforceProxyDelegatedDate) {
    throw forbidden("DELEGATED_ORDER_DATE_NOT_ELIGIBLE");
  }
  const cutoffApplies = !adminBypass;
  const deadline = deadlineInfo(targetDate, mode, now);
  return {
    deadline,
    cutoffApplies,
    deadlineBypassed: !cutoffApplies,
    allowed: proxyDelegatedDateAllowed && Boolean(deadline) && (!cutoffApplies || !deadline.isExpired)
  };
}, "resolveOrderMutationTiming");
var resolveOrderPermission = /* @__PURE__ */ __name(async (database, identity, { targetUserId, targetDate, mode, now, enforceProxyDelegatedDate = true }) => {
  const actorTarget = await resolveOrderActorTarget(database, identity, targetUserId);
  return {
    ...actorTarget,
    timing: resolveOrderMutationTiming({
      actor: actorTarget.actor,
      isDelegated: actorTarget.isDelegated,
      targetDate,
      mode,
      now,
      enforceProxyDelegatedDate
    })
  };
}, "resolveOrderPermission");
var orderPolicyResponse = /* @__PURE__ */ __name(({ actor, target, isDelegated, timing }) => ({
  actorUserId: actor.userId,
  targetUserId: target.userId,
  delegated: isDelegated,
  cutoffApplies: timing.cutoffApplies,
  deadlineBypassed: timing.deadlineBypassed,
  canMutate: timing.allowed
}), "orderPolicyResponse");
var rowsFrom3 = /* @__PURE__ */ __name((result) => Array.isArray(result) ? result : Array.isArray(result?.results) ? result.results : [], "rowsFrom");
var getEligibleOrderTargets = /* @__PURE__ */ __name(async (database, identity) => {
  const actor = authenticatedActor(identity);
  assertCan(identity, ACTIONS.DELEGATE_ORDER);
  const result = await database.prepare(`
    SELECT ${orderTargetColumns("u")}
    FROM users u
    WHERE u.active = 1
    ORDER BY u.display_name ASC, u.user_id ASC
  `).all();
  return rowsFrom3(result).map(orderTargetRecord).filter((record) => isEligibleOrderTarget(record.user)).filter((record) => record.user.userId !== actor.userId).map((record) => publicUser(record.user, { authMode: "canonical" }));
}, "getEligibleOrderTargets");

// src/domain/menuVendors.js
var HISTORICAL_SQL_VENDOR = "\u8521\u8001\u5E2B";
var CANONICAL_HE_SHI_VENDOR = "\u79BE\u62FE";
var LEGACY_HE_SHI_VENDOR = "\u5408\u5341";
var CANONICAL_MENU_VENDORS = Object.freeze([
  HISTORICAL_SQL_VENDOR,
  CANONICAL_HE_SHI_VENDOR
]);
var text3 = /* @__PURE__ */ __name((value) => typeof value === "string" ? value.trim() : "", "text");
var normalizeMenuVendor = /* @__PURE__ */ __name((value) => {
  const normalized = text3(value);
  return normalized === LEGACY_HE_SHI_VENDOR ? CANONICAL_HE_SHI_VENDOR : normalized;
}, "normalizeMenuVendor");
var isHistoricalMenuVendor = /* @__PURE__ */ __name((value) => {
  const normalized = normalizeMenuVendor(value);
  return normalized === HISTORICAL_SQL_VENDOR || normalized === CANONICAL_HE_SHI_VENDOR;
}, "isHistoricalMenuVendor");
var historicalMenuRowVendorCandidates = /* @__PURE__ */ __name((value) => {
  const normalized = normalizeMenuVendor(value);
  if (normalized === CANONICAL_HE_SHI_VENDOR) {
    return [CANONICAL_HE_SHI_VENDOR, LEGACY_HE_SHI_VENDOR];
  }
  return [normalized];
}, "historicalMenuRowVendorCandidates");
var compatibilityVendorCandidates = /* @__PURE__ */ __name((value) => {
  const normalized = normalizeMenuVendor(value);
  return normalized === CANONICAL_HE_SHI_VENDOR ? [CANONICAL_HE_SHI_VENDOR, LEGACY_HE_SHI_VENDOR] : [normalized];
}, "compatibilityVendorCandidates");
var canonicalMenuRowVendor = /* @__PURE__ */ __name(({ vendor } = {}) => normalizeMenuVendor(vendor), "canonicalMenuRowVendor");

// src/domain/menuImageFallback.js
var text4 = /* @__PURE__ */ __name((value) => typeof value === "string" ? value.trim() : "", "text");
var normalizeHistoricalImageName = /* @__PURE__ */ __name((value) => text4(value).normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase(), "normalizeHistoricalImageName");
var HISTORICAL_IMAGE_MAPPING = Object.freeze({
  "E.\u98A8\u5473\u9910": "\u98A8\u5473\u9910",
  "A.\u98A8\u5473\u4FBF\u7576": "\u98A8\u5473\u4FBF\u7576",
  "\u98A8\u5473\u6703\u8B70\u4FBF\u7576": "\u98A8\u5473\u6703\u8B70",
  "S.\u5C0F\u800C\u7F8E\u4FBF\u7576": "\u5C0F\u800C\u7F8E",
  "C.\u6BCF\u65E5\u7279\u9910": "\u7279\u9910",
  "\u6703\u8B70\u4FBF\u7576": "\u6703\u8B70",
  "\u8543\u8304\u9DF9\u8C46\u6CE5": "\u756A\u8304\u9DF9\u8C46\u6CE5",
  "\u7D05\u9EB4\u8150\u4E73\u677F\u8C46\u8150": "\u7D05\u9EB4\u8C46\u8150",
  "\u91AC\u71D2\u677F\u8C46\u8150": "\u91AC\u71D2\u677F\u8C46\u8150",
  "\u849C\u9999\u8FA3\u6CE1\u83DC": "\u849C\u9999\u8FA3\u6CE1\u83DC"
});
var HISTORICAL_IMAGE_SKIP_NAMES = Object.freeze([
  "B.\u6C34\u716E\u4F4E\u91A3\u5065\u5EB7\u9910",
  "\u514D\u8CBB\u52A0\u98EF",
  "\u624B\u7E8C\u8CBB\u6E1B\u514D",
  "1\u5143"
]);
var historicalImageMappingByName = new Map(
  Object.entries(HISTORICAL_IMAGE_MAPPING).map(([sourceName, targetName]) => [
    normalizeHistoricalImageName(sourceName),
    normalizeHistoricalImageName(targetName)
  ])
);
var historicalImageSkipNames = new Set(
  HISTORICAL_IMAGE_SKIP_NAMES.map(normalizeHistoricalImageName)
);
var currentItemName = /* @__PURE__ */ __name((row) => row?.item_name ?? row?.itemName, "currentItemName");
var currentImageUrl = /* @__PURE__ */ __name((row) => row?.image_url ?? row?.imageUrl, "currentImageUrl");
var historicalImageUrl = /* @__PURE__ */ __name((row) => row?.image_url ?? row?.imageUrl, "historicalImageUrl");
var imageIndexKey = /* @__PURE__ */ __name((vendor, name) => `${normalizeMenuVendor(vendor)}\0${name}`, "imageIndexKey");
var buildHistoricalImageFallbackIndex = /* @__PURE__ */ __name((currentRows = []) => {
  const index = /* @__PURE__ */ new Map();
  for (const row of currentRows) {
    if (row?.enabled === false || row?.enabled === 0) continue;
    const normalizedName = normalizeHistoricalImageName(currentItemName(row));
    if (!normalizedName) continue;
    const key = imageIndexKey(row?.vendor, normalizedName);
    const entry = index.get(key) || {
      rowCount: 0,
      imageUrls: /* @__PURE__ */ new Set()
    };
    entry.rowCount += 1;
    const imageUrl = text4(currentImageUrl(row));
    if (imageUrl) entry.imageUrls.add(imageUrl);
    index.set(key, entry);
  }
  return index;
}, "buildHistoricalImageFallbackIndex");
var currentImageForTarget = /* @__PURE__ */ __name((vendor, targetName, currentImageIndex) => {
  const entry = currentImageIndex.get(imageIndexKey(vendor, targetName));
  if (!entry || entry.rowCount !== 1 || entry.imageUrls.size !== 1) return "";
  return [...entry.imageUrls][0];
}, "currentImageForTarget");
var resolveHistoricalImageDisplayUrl = /* @__PURE__ */ __name((historicalRow, currentImageIndex = /* @__PURE__ */ new Map()) => {
  const explicitImage = text4(historicalImageUrl(historicalRow));
  if (explicitImage) return explicitImage;
  const normalizedName = normalizeHistoricalImageName(historicalRow?.item_name ?? historicalRow?.itemName);
  if (!normalizedName || historicalImageSkipNames.has(normalizedName)) return "";
  const targetName = historicalImageMappingByName.get(normalizedName);
  if (!targetName) return "";
  return currentImageForTarget(historicalRow?.vendor, targetName, currentImageIndex);
}, "resolveHistoricalImageDisplayUrl");

// src/domain/menuItemChanges.js
var HISTORICAL_MENU_CUTOFF = "2026-09-10";
var NORMALIZED_MENU_START_DATE = "2026-09-17";
var LEGACY_IDENTITY_SCHEMA_VERSION = 1;
var NORMALIZED_IDENTITY_SCHEMA_VERSION = 2;
var NORMALIZED_VARIANT_KEYS = Object.freeze(["BASE", "HALF", "PLUS"]);
var HISTORICAL_MENU_VENDOR = HISTORICAL_SQL_VENDOR;
var HE_SHI_MENU_VENDOR = CANONICAL_HE_SHI_VENDOR;
var HISTORICAL_MENU_IMPORTER_VERSION = "legacy-sql-menu";
var SQL_SOURCE_KIND = "legacy_sql";
var GAS_SOURCE_KIND = "gas_compatibility";
var ADMIN_SOURCE_KIND = "admin";
var AP_VARIANT_KEYS = Object.freeze(["ap-variant-1", "ap-variant-2"]);
var COMPATIBILITY_BASELINE_SOURCE_KIND = "compatibility_baseline";
var rowsFrom4 = /* @__PURE__ */ __name((result) => Array.isArray(result) ? result : Array.isArray(result?.results) ? result.results : [], "rowsFrom");
var text5 = /* @__PURE__ */ __name((value) => typeof value === "string" ? value.trim() : "", "text");
var identityKey = /* @__PURE__ */ __name((vendor, itemCode, variantKey) => `${vendor}\0${itemCode}\0${variantKey}`, "identityKey");
var normalizedIdentity = /* @__PURE__ */ __name((itemCode, variantKey) => ({
  item_code: itemCode,
  variant_key: variantKey
}), "normalizedIdentity");
var normalizeLegacyMenuIdentity = /* @__PURE__ */ __name(({ vendor, itemCode, variantKey = "", itemName = "" } = {}) => {
  const normalizedVendor = normalizeMenuVendor(vendor);
  const code = text5(itemCode);
  const codeKey = code.toUpperCase();
  const variant = text5(variantKey).toUpperCase();
  const name = text5(itemName);
  if (!code) return null;
  const direct = normalizedVendor === HISTORICAL_MENU_VENDOR ? /* @__PURE__ */ new Map([
    ["S", normalizedIdentity("S", "BASE")],
    ["SH", normalizedIdentity("S", "HALF")],
    ["S_HALF", normalizedIdentity("S", "HALF")],
    ["C", normalizedIdentity("C", "BASE")],
    ["CH", normalizedIdentity("C", "HALF")],
    ["C95", normalizedIdentity("C", "BASE")],
    ["C95_HALF", normalizedIdentity("C", "HALF")],
    ["CP", normalizedIdentity("CM", "BASE")],
    ["CPH", normalizedIdentity("CM", "HALF")],
    ["C120", normalizedIdentity("CM", "BASE")],
    ["C120_HALF", normalizedIdentity("CM", "HALF")],
    ["E", normalizedIdentity("E", "BASE")],
    ["EP", normalizedIdentity("E", "PLUS")],
    ["E_PLUS", normalizedIdentity("E", "PLUS")],
    ["A", normalizedIdentity("A", "BASE")],
    ["A95", normalizedIdentity("A", "BASE")],
    ["A95_PLUS", normalizedIdentity("A", "PLUS")],
    ["A120", normalizedIdentity("AM", "BASE")],
    ["A120_PLUS", normalizedIdentity("AM", "PLUS")],
    ["APP", normalizedIdentity("AM", "PLUS")],
    ["B", normalizedIdentity("B", "BASE")],
    ["B_HALF", normalizedIdentity("B", "HALF")],
    ["FR", normalizedIdentity("FR", "BASE")],
    ["R", normalizedIdentity("FR", "BASE")]
  ]) : /* @__PURE__ */ new Map();
  if (direct.has(codeKey)) return direct.get(codeKey);
  if (codeKey === "AP") {
    if (normalizedVendor !== HISTORICAL_MENU_VENDOR) return null;
    if (name.includes("\u98A8\u5473\u4FBF\u7576")) return normalizedIdentity("A", "PLUS");
    if (name.includes("\u98A8\u5473\u6703\u8B70")) return normalizedIdentity("AM", "BASE");
    return null;
  }
  if (normalizedVendor === HE_SHI_MENU_VENDOR) {
    const halfMatch = codeKey.match(/^(H[1-5])H$/);
    if (halfMatch) return normalizedIdentity(halfMatch[1], "HALF");
    if (/^H[1-5]$/.test(codeKey)) return normalizedIdentity(codeKey, "BASE");
  }
  if (/^H[1-5]H?$/.test(codeKey)) return null;
  if (NORMALIZED_VARIANT_KEYS.includes(variant)) {
    return normalizedIdentity(code, variant);
  }
  return null;
}, "normalizeLegacyMenuIdentity");
var legacyCodeCannotBeUsedForNormalizedIdentity = /* @__PURE__ */ __name((itemCode) => (/* @__PURE__ */ new Set([
  "AP",
  "APP",
  "SH",
  "EP",
  "E_PLUS",
  "S_HALF",
  "C95",
  "C95_HALF",
  "C120",
  "C120_HALF",
  "CP",
  "CPH",
  "A95",
  "A95_PLUS",
  "A120",
  "A120_PLUS",
  "B_HALF",
  "FR1",
  "REVERT1",
  "R",
  "S_HALF",
  "H1H",
  "H2H",
  "H3H",
  "H4H",
  "H5H"
])).has(String(itemCode || "").trim().toUpperCase()), "legacyCodeCannotBeUsedForNormalizedIdentity");
var projectionHash = /* @__PURE__ */ __name((value) => {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}, "projectionHash");
var projectionVersionId = /* @__PURE__ */ __name((vendor, effectiveDate) => `menu-change-projection_${projectionHash(`${vendor}|${effectiveDate}`)}`, "projectionVersionId");
var projectionItemId = /* @__PURE__ */ __name((vendor, effectiveDate, itemCode, variantKey = "") => `menu-change-item_${projectionHash(`${vendor}|${effectiveDate}|${itemCode}|${variantKey}`)}`, "projectionItemId");
var normalizedChange = /* @__PURE__ */ __name((row) => {
  const vendor = canonicalMenuRowVendor({ vendor: row.vendor, itemCode: row.item_code });
  return {
    menu_item_change_id: row.menu_item_change_id,
    effective_date: row.effective_date,
    vendor,
    item_code: row.item_code,
    variant_key: row.variant_key || "",
    item_name: row.item_name,
    price: Number(row.price),
    enabled: Boolean(row.enabled),
    image_url: row.image_url || "",
    note: row.note || "",
    display_order: Number(row.display_order || 0),
    source_kind: row.source_kind,
    source_batch_id: row.source_batch_id || null,
    source_table: row.source_table || null,
    source_row: row.source_row ?? null,
    source_record_id: row.source_record_id || null,
    updated_by_user_id: row.updated_by_user_id || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    identity_schema_version: Number(row.identity_schema_version || LEGACY_IDENTITY_SCHEMA_VERSION),
    sequence_number: row.sequence_number === void 0 || row.sequence_number === null ? null : Number(row.sequence_number),
    source_read_only: row.source_kind !== ADMIN_SOURCE_KIND,
    menu_item_id: projectionItemId(vendor, row.effective_date, row.item_code, row.variant_key || ""),
    persisted_menu_item_id: row.persisted_menu_item_id || null
  };
}, "normalizedChange");
var sourceKindsFor = /* @__PURE__ */ __name((vendor, targetDate) => {
  if (isHistoricalMenuVendor(vendor) && targetDate <= HISTORICAL_MENU_CUTOFF) {
    return {
      authority: "sql_historical",
      sourceKinds: [SQL_SOURCE_KIND]
    };
  }
  return {
    authority: "live_with_admin_overrides",
    sourceKinds: [GAS_SOURCE_KIND, ADMIN_SOURCE_KIND]
  };
}, "sourceKindsFor");
var resolveRows = /* @__PURE__ */ __name((rows, { vendor, targetDate }) => {
  const normalizedVendor = normalizeMenuVendor(vendor);
  const { authority, sourceKinds } = sourceKindsFor(normalizedVendor, targetDate);
  const selected = /* @__PURE__ */ new Map();
  for (const rawRow of rows) {
    const row = normalizedChange(rawRow);
    if (row.identity_schema_version !== LEGACY_IDENTITY_SCHEMA_VERSION) continue;
    if (row.vendor !== normalizedVendor || text5(rawRow.effective_date) > targetDate) continue;
    if (!sourceKinds.includes(rawRow.source_kind)) continue;
    const key = identityKey(row.vendor, row.item_code, row.variant_key);
    const previous = selected.get(key);
    if (!previous || row.effective_date > previous.effective_date || row.effective_date === previous.effective_date && row.menu_item_change_id > previous.menu_item_change_id) {
      selected.set(key, row);
    }
  }
  return {
    authority,
    sourceKinds,
    rows: [...selected.values()].sort((left, right) => left.display_order - right.display_order || left.item_code.localeCompare(right.item_code) || left.variant_key.localeCompare(right.variant_key) || left.menu_item_change_id.localeCompare(right.menu_item_change_id))
  };
}, "resolveRows");
var resolveNormalizedRows = /* @__PURE__ */ __name((rows, { vendor, targetDate }) => {
  const normalizedVendor = normalizeMenuVendor(vendor);
  const selected = /* @__PURE__ */ new Map();
  for (const rawRow of rows) {
    const row = normalizedChange(rawRow);
    if (row.identity_schema_version !== NORMALIZED_IDENTITY_SCHEMA_VERSION) continue;
    if (row.vendor !== normalizedVendor || text5(row.effective_date) > targetDate) continue;
    if (row.source_kind !== ADMIN_SOURCE_KIND) continue;
    const key = identityKey(row.vendor, row.item_code, row.variant_key);
    const previous = selected.get(key);
    if (!previous || row.effective_date > previous.effective_date || row.effective_date === previous.effective_date && Number(row.sequence_number || 0) > Number(previous.sequence_number || 0)) {
      selected.set(key, row);
    }
  }
  return [...selected.values()].sort((left, right) => left.display_order - right.display_order || left.item_code.localeCompare(right.item_code) || left.variant_key.localeCompare(right.variant_key) || Number(left.sequence_number || 0) - Number(right.sequence_number || 0));
}, "resolveNormalizedRows");
var normalizedProjectionRow = /* @__PURE__ */ __name((row) => {
  const identity = normalizeLegacyMenuIdentity({
    vendor: row.vendor,
    itemCode: row.item_code || row.legacy_item_id,
    variantKey: row.variant_key,
    itemName: row.item_name
  });
  if (!identity) return normalizedChange(row);
  return normalizedChange({
    ...row,
    ...identity,
    identity_schema_version: NORMALIZED_IDENTITY_SCHEMA_VERSION
  });
}, "normalizedProjectionRow");
var normalizedProjectionRows = /* @__PURE__ */ __name((rows) => rows.map(normalizedProjectionRow), "normalizedProjectionRows");
var collapseNormalizedProjectionRows = /* @__PURE__ */ __name((rows) => {
  const selected = /* @__PURE__ */ new Map();
  const passthrough = [];
  for (const row of rows) {
    if (row.identity_schema_version !== NORMALIZED_IDENTITY_SCHEMA_VERSION) {
      passthrough.push(row);
      continue;
    }
    const key = identityKey(row.vendor, row.item_code, row.variant_key);
    const previous = selected.get(key);
    if (!previous || row.effective_date > previous.effective_date || row.effective_date === previous.effective_date && Number(row.sequence_number || 0) > Number(previous.sequence_number || 0)) {
      selected.set(key, row);
    }
  }
  return [...passthrough, ...selected.values()];
}, "collapseNormalizedProjectionRows");
var stateRows = /* @__PURE__ */ __name((rows) => [...rows].sort((left, right) => left.display_order - right.display_order || left.item_code.localeCompare(right.item_code) || left.variant_key.localeCompare(right.variant_key) || String(left.menu_item_change_id).localeCompare(String(right.menu_item_change_id))), "stateRows");
var normalizeCompatibilityRow = /* @__PURE__ */ __name((row, version) => ({
  menu_item_change_id: `compatibility:${row.menu_item_id}`,
  effective_date: version.effective_date,
  vendor: canonicalMenuRowVendor({ vendor: version.vendor, itemCode: row.legacy_item_id }),
  item_code: row.legacy_item_id,
  variant_key: row.variant_key || "",
  item_name: row.item_name,
  price: Number(row.price),
  enabled: Boolean(row.enabled),
  image_url: row.image_url || "",
  note: row.note || "",
  display_order: Number(row.source_order || 0),
  source_kind: COMPATIBILITY_BASELINE_SOURCE_KIND,
  source_batch_id: version.source_batch_id || null,
  source_table: null,
  source_row: null,
  source_record_id: row.menu_item_id,
  updated_by_user_id: null,
  created_at: row.created_at,
  updated_at: row.updated_at,
  source_read_only: true,
  menu_item_id: row.menu_item_id,
  persisted_menu_item_id: row.menu_item_id
}), "normalizeCompatibilityRow");
var compatibilityVersion = /* @__PURE__ */ __name(async (database, vendor, targetDate) => {
  const normalizedVendor = normalizeMenuVendor(vendor);
  const vendors = compatibilityVendorCandidates(normalizedVendor);
  const placeholders = vendors.map(() => "?").join(", ");
  if (isHistoricalMenuVendor(normalizedVendor) && targetDate <= HISTORICAL_MENU_CUTOFF) {
    const effectiveMonth = `${targetDate.slice(0, 7)}-01`;
    return database.prepare(`
      SELECT mv.menu_version_id, mv.vendor, mv.effective_date,
             ib.importer_version, mv.source_batch_id
      FROM menu_versions mv
      JOIN import_batches ib ON ib.batch_id = mv.source_batch_id
      WHERE mv.vendor IN (${placeholders})
        AND ib.importer_version = ?
        AND mv.effective_date <= ?
      ORDER BY mv.effective_date DESC, mv.menu_version_id DESC
      LIMIT 1
    `).bind(...vendors, HISTORICAL_MENU_IMPORTER_VERSION, effectiveMonth).first();
  }
  return database.prepare(`
    SELECT menu_version_id, vendor, effective_date, source_batch_id
    FROM menu_versions
    WHERE vendor IN (${placeholders}) AND effective_date <= ?
    ORDER BY effective_date DESC, menu_version_id DESC
    LIMIT 1
  `).bind(...vendors, targetDate).first();
}, "compatibilityVersion");
var getCompatibilityMenuBaseline = /* @__PURE__ */ __name(async (database, { vendor, targetDate } = {}) => {
  const normalizedVendor = normalizeMenuVendor(vendor);
  const normalizedDate = text5(targetDate);
  if (!normalizedVendor || !isDateOnly(normalizedDate)) {
    throw badRequest("MENU_CHANGE_RESOLUTION_INPUT_INVALID");
  }
  const version = await compatibilityVersion(database, normalizedVendor, normalizedDate);
  if (!version) return { version: null, rows: [] };
  const result = await database.prepare(`
    SELECT menu_item_id, legacy_item_id, variant_key, item_name, price,
           enabled, note, image_url, source_order, created_at, updated_at
    FROM menu_items
    WHERE menu_version_id = ?
    ORDER BY source_order ASC, menu_item_id ASC
  `).bind(version.menu_version_id).all();
  return {
    version,
    rows: rowsFrom4(result).map((row) => normalizeCompatibilityRow(row, version))
  };
}, "getCompatibilityMenuBaseline");
var attachCompatibilityIds = /* @__PURE__ */ __name((rows, baselineRows) => rows.map((row) => {
  const matches = baselineRows.filter((baseline) => baseline.vendor === row.vendor && baseline.item_code === row.item_code && baseline.variant_key === row.variant_key);
  if (matches.length !== 1) return { ...row, persisted_menu_item_id: null };
  return {
    ...row,
    menu_item_id: matches[0].menu_item_id,
    persisted_menu_item_id: matches[0].menu_item_id
  };
}), "attachCompatibilityIds");
var mergeEffectiveMenuRows = /* @__PURE__ */ __name(({ baselineRows = [], changeRows = [] } = {}) => {
  let merged = [...baselineRows];
  for (const change of changeRows) {
    const matchingIndexes = merged.reduce((indexes, row, index) => {
      if (identityKey(row.vendor, row.item_code, row.variant_key) === identityKey(change.vendor, change.item_code, change.variant_key)) {
        indexes.push(index);
      }
      return indexes;
    }, []);
    const persistedMenuItemId = matchingIndexes.length === 1 ? merged[matchingIndexes[0]].persisted_menu_item_id || merged[matchingIndexes[0]].menu_item_id : null;
    if (matchingIndexes.length) {
      merged = merged.filter((row) => identityKey(row.vendor, row.item_code, row.variant_key) !== identityKey(change.vendor, change.item_code, change.variant_key));
    }
    merged.push({
      ...change,
      menu_item_id: persistedMenuItemId || change.menu_item_id,
      persisted_menu_item_id: persistedMenuItemId
    });
  }
  return stateRows(merged);
}, "mergeEffectiveMenuRows");
var resolveMenuItemChanges = /* @__PURE__ */ __name(async (database, { vendor, targetDate } = {}) => {
  const normalizedVendor = normalizeMenuVendor(vendor);
  const normalizedDate = text5(targetDate);
  if (!normalizedVendor || !isDateOnly(normalizedDate)) {
    throw badRequest("MENU_CHANGE_RESOLUTION_INPUT_INVALID");
  }
  const vendors = historicalMenuRowVendorCandidates(normalizedVendor);
  const placeholders = vendors.map(() => "?").join(", ");
  const result = await database.prepare(`
    SELECT mic.menu_item_change_id, mic.effective_date, mic.vendor, mic.item_code, mic.variant_key,
           item_name, price, enabled, image_url, note, display_order,
           source_kind, source_batch_id, source_table, source_row,
           source_record_id, updated_by_user_id, created_at, updated_at,
           mic.identity_schema_version, mis.sequence_number
    FROM menu_item_changes mic
    LEFT JOIN menu_item_change_sequence mis
      ON mis.menu_item_change_id = mic.menu_item_change_id
    WHERE mic.vendor IN (${placeholders}) AND mic.effective_date <= ?
    ORDER BY mic.effective_date DESC, mis.sequence_number DESC, mic.menu_item_change_id DESC
  `).bind(...vendors, normalizedDate).all();
  const legacy = resolveRows(rowsFrom4(result), {
    vendor: normalizedVendor,
    targetDate: normalizedDate
  });
  const normalized = resolveNormalizedRows(rowsFrom4(result), {
    vendor: normalizedVendor,
    targetDate: normalizedDate
  });
  return {
    ...legacy,
    rows: legacy.rows,
    legacyRows: legacy.rows,
    normalizedRows: normalized
  };
}, "resolveMenuItemChanges");
var getLatestCurrentMenuImageRows = /* @__PURE__ */ __name(async (database) => {
  const result = await database.prepare(`
    SELECT mv.menu_version_id, mv.vendor AS version_vendor,
           mv.effective_date AS version_effective_date,
           mv.source_batch_id AS version_source_batch_id,
           mi.menu_item_id, mi.legacy_item_id, mi.variant_key, mi.item_name,
           mi.price, mi.enabled, mi.note, mi.image_url, mi.source_order,
           mi.created_at, mi.updated_at
    FROM menu_versions mv
    JOIN menu_items mi ON mi.menu_version_id = mv.menu_version_id
    LEFT JOIN import_batches ib ON ib.batch_id = mv.source_batch_id
    WHERE ib.importer_version IS NULL OR ib.importer_version <> ?
    ORDER BY mv.effective_date DESC, mv.menu_version_id DESC,
             mi.source_order ASC, mi.menu_item_id ASC
  `).bind(HISTORICAL_MENU_IMPORTER_VERSION).all();
  const selectedVersionByVendor = /* @__PURE__ */ new Map();
  const rows = [];
  for (const rawRow of rowsFrom4(result)) {
    const canonicalVersionVendor = normalizeMenuVendor(rawRow.version_vendor);
    if (!selectedVersionByVendor.has(canonicalVersionVendor)) {
      selectedVersionByVendor.set(canonicalVersionVendor, rawRow.menu_version_id);
    }
    if (selectedVersionByVendor.get(canonicalVersionVendor) !== rawRow.menu_version_id) continue;
    rows.push(normalizeCompatibilityRow(rawRow, {
      vendor: rawRow.version_vendor,
      effective_date: rawRow.version_effective_date,
      source_batch_id: rawRow.version_source_batch_id || null
    }));
  }
  return rows;
}, "getLatestCurrentMenuImageRows");
var projectDisplayImageRows = /* @__PURE__ */ __name(async (database, rows) => {
  const currentRows = await getLatestCurrentMenuImageRows(database);
  const currentImageIndex = buildHistoricalImageFallbackIndex(currentRows);
  return rows.map((row) => ({
    ...row,
    display_image_url: resolveHistoricalImageDisplayUrl(row, currentImageIndex)
  }));
}, "projectDisplayImageRows");
var applyHistoricalImageFallback = /* @__PURE__ */ __name((database, rows) => projectDisplayImageRows(database, rows), "applyHistoricalImageFallback");
var resolveEffectiveMenuState = /* @__PURE__ */ __name(async (database, { vendor, targetDate } = {}) => {
  const changes = await resolveMenuItemChanges(database, { vendor, targetDate });
  const baseline = await getCompatibilityMenuBaseline(database, { vendor, targetDate });
  const useNormalizedIdentity = changes.authority !== "sql_historical" && text5(targetDate) >= NORMALIZED_MENU_START_DATE;
  const effectiveBaselineRows = useNormalizedIdentity ? collapseNormalizedProjectionRows(normalizedProjectionRows(baseline.rows)) : baseline.rows;
  const effectiveChangeRows = useNormalizedIdentity ? [
    ...collapseNormalizedProjectionRows(normalizedProjectionRows(changes.legacyRows || changes.rows)),
    ...changes.normalizedRows || []
  ] : changes.rows;
  const rows = changes.authority === "sql_historical" ? attachCompatibilityIds(changes.rows, baseline.rows) : mergeEffectiveMenuRows({
    baselineRows: effectiveBaselineRows,
    changeRows: effectiveChangeRows
  });
  const displayRows = changes.authority === "sql_historical" ? await applyHistoricalImageFallback(database, rows) : rows;
  return {
    ...changes,
    baselineVersion: baseline.version,
    baselineRows: effectiveBaselineRows,
    rawBaselineRows: baseline.rows,
    changeRows: effectiveChangeRows,
    legacyChangeRows: changes.legacyRows || changes.rows,
    normalizedChangeRows: changes.normalizedRows || [],
    normalizedIdentity: useNormalizedIdentity,
    rows: displayRows
  };
}, "resolveEffectiveMenuState");
var materializerRows = /* @__PURE__ */ __name((rows) => rows.filter((row) => row.enabled).map((row, index) => ({
  ...row,
  source_order: row.display_order > 0 ? row.display_order : index + 1
})), "materializerRows");
var materializationPlan = /* @__PURE__ */ __name(({ vendor, effectiveDate, resolved } = {}) => {
  const normalizedVendor = normalizeMenuVendor(vendor);
  const normalizedDate = text5(effectiveDate);
  if (!normalizedVendor || !isDateOnly(normalizedDate)) {
    throw badRequest("MENU_CHANGE_MATERIALIZATION_INPUT_INVALID");
  }
  if (normalizedVendor === HISTORICAL_MENU_VENDOR && normalizedDate <= HISTORICAL_MENU_CUTOFF) {
    throw conflict("HISTORICAL_MENU_PROJECTION_IMMUTABLE");
  }
  const rows = Array.isArray(resolved) ? resolved : [];
  return {
    menuVersionId: projectionVersionId(normalizedVendor, normalizedDate),
    vendor: normalizedVendor,
    effectiveDate: normalizedDate,
    rows: materializerRows(rows)
  };
}, "materializationPlan");
var materializationStatements = /* @__PURE__ */ __name((database, plan, clock) => {
  const occurredAt = resolveClock(clock).toISOString();
  const statements = [
    prepareStatement(database, `
      INSERT INTO menu_versions (menu_version_id, vendor, effective_date, source_batch_id, created_at)
      VALUES (?, ?, ?, NULL, ?)
      ON CONFLICT(vendor, effective_date) DO NOTHING
    `, [plan.menuVersionId, plan.vendor, plan.effectiveDate, occurredAt]),
    prepareStatement(database, `
      UPDATE menu_items
      SET enabled = 0, updated_at = ?
      WHERE menu_version_id = ?
    `, [occurredAt, plan.menuVersionId])
  ];
  statements.push(...plan.rows.map((row) => prepareStatement(database, `
    INSERT INTO menu_items (
      menu_item_id, menu_version_id, legacy_item_id, variant_key, item_name,
      price, enabled, note, image_url, source_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
    ON CONFLICT(menu_item_id) DO UPDATE SET
      menu_version_id = excluded.menu_version_id,
      legacy_item_id = excluded.legacy_item_id,
      variant_key = excluded.variant_key,
      item_name = excluded.item_name,
      price = excluded.price,
      enabled = excluded.enabled,
      note = excluded.note,
      image_url = excluded.image_url,
      source_order = excluded.source_order,
      updated_at = excluded.updated_at
  `, [
    projectionItemId(plan.vendor, plan.effectiveDate, row.item_code, row.variant_key),
    plan.menuVersionId,
    row.item_code,
    row.variant_key,
    row.item_name,
    row.price,
    row.note,
    row.image_url,
    row.source_order,
    occurredAt,
    occurredAt
  ])));
  return statements;
}, "materializationStatements");
var prepareMenuVersionMaterialization = /* @__PURE__ */ __name(async (database, { vendor, effectiveDate, clock = /* @__PURE__ */ new Date(), resolved = null, authority = null } = {}) => {
  const resolution = resolved ? { rows: resolved, authority } : await resolveEffectiveMenuState(database, { vendor, targetDate: effectiveDate });
  const plan = materializationPlan({
    vendor,
    effectiveDate,
    resolved: resolution.rows
  });
  const existing = await database.prepare(`
    SELECT menu_version_id, source_batch_id
    FROM menu_versions
    WHERE vendor = ? AND effective_date = ?
    LIMIT 1
  `).bind(plan.vendor, plan.effectiveDate).first();
  if (existing && existing.menu_version_id !== plan.menuVersionId) {
    if (existing.source_batch_id) throw conflict("MENU_VERSION_IMMUTABLE");
    plan.menuVersionId = existing.menu_version_id;
  }
  if (!plan.rows.length) throw notFound("MENU_CHANGE_PROJECTION_EMPTY");
  return {
    statements: materializationStatements(database, plan, clock),
    result: {
      success: true,
      authority: resolution.authority || "live_with_admin_overrides",
      menuVersionId: plan.menuVersionId,
      effectiveDate: plan.effectiveDate,
      projectedItemCount: plan.rows.length,
      resolvedItemCount: resolution.rows.length
    }
  };
}, "prepareMenuVersionMaterialization");
var validExternalUrl = /* @__PURE__ */ __name((value) => {
  const normalized = value === void 0 || value === null ? "" : text5(value);
  if (!normalized) return "";
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw badRequest("MENU_CHANGE_IMAGE_URL_INVALID");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw badRequest("MENU_CHANGE_IMAGE_URL_INVALID");
  }
  return normalized;
}, "validExternalUrl");
var requiredText = /* @__PURE__ */ __name((value, code, maxLength = 200) => {
  const normalized = text5(value);
  if (!normalized) throw badRequest(code);
  if (normalized.length > maxLength) throw badRequest(`${code}_TOO_LONG`);
  return normalized;
}, "requiredText");
var optionalText = /* @__PURE__ */ __name((value, code, maxLength = 2e3) => {
  if (value === void 0 || value === null) return "";
  if (typeof value !== "string") throw badRequest(code);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw badRequest(`${code}_TOO_LONG`);
  return normalized;
}, "optionalText");
var knownVariantKeysFor = /* @__PURE__ */ __name((vendor, itemCode) => vendor === HISTORICAL_MENU_VENDOR && itemCode.toUpperCase() === "AP" ? AP_VARIANT_KEYS : [], "knownVariantKeysFor");
var assertVariantIdentity = /* @__PURE__ */ __name(async (database, values) => {
  if (values.identity_schema_version === NORMALIZED_IDENTITY_SCHEMA_VERSION) {
    if (!values.variant_key) {
      throw badRequest("MENU_CHANGE_VARIANT_KEY_INVALID");
    }
    if (legacyCodeCannotBeUsedForNormalizedIdentity(values.item_code)) {
      throw badRequest("MENU_CHANGE_NORMALIZED_ITEM_CODE_INVALID");
    }
    return;
  }
  const knownVariantKeys = knownVariantKeysFor(values.vendor, values.item_code);
  if (knownVariantKeys.length && !values.variant_key) {
    throw badRequest("MENU_CHANGE_VARIANT_KEY_REQUIRED");
  }
  if (knownVariantKeys.length && !knownVariantKeys.includes(values.variant_key)) {
    throw badRequest("MENU_CHANGE_VARIANT_KEY_INVALID");
  }
  const result = await database.prepare(`
    SELECT variant_key, identity_schema_version
    FROM menu_item_changes
    WHERE vendor = ? AND item_code = ? AND effective_date = ?
      AND identity_schema_version = ?
  `).bind(
    values.vendor,
    values.item_code,
    values.effective_date,
    values.identity_schema_version
  ).all();
  const existing = rowsFrom4(result);
  if (!values.variant_key && existing.some((row) => text5(row.variant_key))) {
    throw badRequest("MENU_CHANGE_VARIANT_KEY_REQUIRED");
  }
  if (values.variant_key && existing.some((row) => !text5(row.variant_key))) {
    throw badRequest("MENU_CHANGE_VARIANT_KEY_REQUIRED");
  }
}, "assertVariantIdentity");
var createInput = /* @__PURE__ */ __name((input) => {
  const allowed = /* @__PURE__ */ new Set([
    "effective_date",
    "effectiveDate",
    "vendor",
    "item_code",
    "itemCode",
    "variant_key",
    "variantKey",
    "item_name",
    "itemName",
    "price",
    "enabled",
    "image_url",
    "imageUrl",
    "note",
    "display_order",
    "displayOrder",
    "identity_schema_version",
    "identitySchemaVersion",
    "previous_variant_key",
    "previousVariantKey",
    "previous_identity_schema_version",
    "previousIdentitySchemaVersion"
  ]);
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((field) => !allowed.has(field))) {
    throw badRequest("MENU_CHANGE_UNKNOWN_FIELD");
  }
  const effectiveDate = text5(input.effective_date ?? input.effectiveDate);
  if (!isDateOnly(effectiveDate)) throw badRequest("MENU_CHANGE_EFFECTIVE_DATE_INVALID");
  if (effectiveDate <= HISTORICAL_MENU_CUTOFF) {
    throw badRequest("MENU_CHANGE_EFFECTIVE_DATE_BEFORE_CUTOFF");
  }
  const rawPrice = input.price;
  if (rawPrice === void 0 || rawPrice === null || typeof rawPrice === "string" && !rawPrice.trim()) {
    throw badRequest("MENU_CHANGE_PRICE_INVALID");
  }
  const price = typeof rawPrice === "number" ? rawPrice : typeof rawPrice === "string" ? Number(rawPrice.trim()) : NaN;
  if (!Number.isSafeInteger(price)) throw badRequest("MENU_CHANGE_PRICE_INVALID");
  if (input.enabled !== void 0 && typeof input.enabled !== "boolean") {
    throw badRequest("MENU_CHANGE_ENABLED_INVALID");
  }
  const displayOrderValue = input.display_order ?? input.displayOrder ?? 0;
  const displayOrder = Number(displayOrderValue);
  if (!Number.isSafeInteger(displayOrder) || displayOrder < 0) {
    throw badRequest("MENU_CHANGE_DISPLAY_ORDER_INVALID");
  }
  const vendor = requiredText(input.vendor, "MENU_CHANGE_VENDOR_REQUIRED");
  const itemCode = requiredText(input.item_code ?? input.itemCode, "MENU_CHANGE_ITEM_CODE_REQUIRED");
  const rawIdentityVersion = input.identity_schema_version ?? input.identitySchemaVersion;
  const identitySchemaVersion = rawIdentityVersion === void 0 ? LEGACY_IDENTITY_SCHEMA_VERSION : Number(rawIdentityVersion);
  if (![LEGACY_IDENTITY_SCHEMA_VERSION, NORMALIZED_IDENTITY_SCHEMA_VERSION].includes(identitySchemaVersion)) {
    throw badRequest("MENU_CHANGE_IDENTITY_SCHEMA_VERSION_INVALID");
  }
  if (identitySchemaVersion === NORMALIZED_IDENTITY_SCHEMA_VERSION && effectiveDate < NORMALIZED_MENU_START_DATE) {
    throw badRequest("MENU_CHANGE_NORMALIZED_EFFECTIVE_DATE_INVALID");
  }
  let variantKey = optionalText(input.variant_key ?? input.variantKey, "MENU_CHANGE_VARIANT_KEY_INVALID", 200);
  if (identitySchemaVersion === NORMALIZED_IDENTITY_SCHEMA_VERSION) {
    variantKey = variantKey.toUpperCase();
  }
  return {
    effective_date: effectiveDate,
    vendor: canonicalMenuRowVendor({ vendor, itemCode }),
    item_code: itemCode,
    variant_key: variantKey,
    item_name: requiredText(input.item_name ?? input.itemName, "MENU_CHANGE_ITEM_NAME_REQUIRED"),
    price,
    enabled: input.enabled !== false,
    image_url: validExternalUrl(input.image_url ?? input.imageUrl),
    note: optionalText(input.note, "MENU_CHANGE_NOTE_INVALID"),
    display_order: displayOrder,
    identity_schema_version: identitySchemaVersion,
    previous_variant_key: optionalText(
      input.previous_variant_key ?? input.previousVariantKey,
      "MENU_CHANGE_PREVIOUS_VARIANT_KEY_INVALID",
      200
    ),
    previous_identity_schema_version: input.previous_identity_schema_version ?? input.previousIdentitySchemaVersion ?? null
  };
}, "createInput");
var changeSelect = `
  SELECT mic.menu_item_change_id, mic.effective_date, mic.vendor, mic.item_code, mic.variant_key,
         item_name, price, enabled, image_url, note, display_order,
         source_kind, source_batch_id, source_table, source_row,
         source_record_id, updated_by_user_id, created_at, updated_at,
         mic.identity_schema_version, mis.sequence_number
  FROM menu_item_changes mic
  LEFT JOIN menu_item_change_sequence mis
    ON mis.menu_item_change_id = mic.menu_item_change_id
`;
var filtersFor = /* @__PURE__ */ __name(({ vendor = "", fromDate = "", toDate = "", month = "", itemCode = "", query = "", variantKey = "" } = {}) => {
  const conditions = [];
  const bindings = [];
  const addLike = /* @__PURE__ */ __name((column, value) => {
    const normalized = text5(value);
    if (normalized) {
      conditions.push(`${column} LIKE ? COLLATE NOCASE`);
      bindings.push(`%${normalized}%`);
    }
  }, "addLike");
  addLike("vendor", vendor);
  addLike("item_code", itemCode);
  addLike("variant_key", variantKey);
  const q = text5(query);
  if (q) {
    conditions.push("(item_code LIKE ? COLLATE NOCASE OR item_name LIKE ? COLLATE NOCASE)");
    bindings.push(`%${q}%`, `%${q}%`);
  }
  if (isDateOnly(text5(fromDate))) {
    conditions.push("effective_date >= ?");
    bindings.push(text5(fromDate));
  }
  if (isDateOnly(text5(toDate))) {
    conditions.push("effective_date <= ?");
    bindings.push(text5(toDate));
  }
  if (/^\d{4}-\d{2}$/.test(text5(month))) {
    conditions.push("substr(effective_date, 1, 7) = ?");
    bindings.push(text5(month));
  }
  return {
    suffix: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    bindings
  };
}, "filtersFor");
var listAdminMenuItemChanges = /* @__PURE__ */ __name(async (database, identity, filters = {}) => {
  assertCan(identity, ACTIONS.ADMIN_MENU_CHANGES);
  if (identity?.viewAs || identity?.effectiveSubject?.userId && identity.effectiveSubject.userId !== identity?.actor?.userId) throw forbidden("VIEW_AS_FORBIDDEN");
  const filter = filtersFor(filters);
  const result = await database.prepare(`
    ${changeSelect}
    ${filter.suffix}
    ORDER BY mic.effective_date DESC, mic.vendor ASC, mic.item_code ASC, mic.variant_key ASC,
             mic.display_order ASC, mic.menu_item_change_id ASC
  `).bind(...filter.bindings).all();
  const projectedRows = await projectDisplayImageRows(
    database,
    rowsFrom4(result).map(normalizedChange)
  );
  return {
    success: true,
    changes: projectedRows.map((row) => ({
      ...row,
      image_url: row.display_image_url || row.image_url
    }))
  };
}, "listAdminMenuItemChanges");
var listAdminMenuVendors = /* @__PURE__ */ __name(async (database, identity) => {
  assertCan(identity, ACTIONS.ADMIN_MENU_CHANGES);
  if (identity?.viewAs || identity?.effectiveSubject?.userId && identity.effectiveSubject.userId !== identity?.actor?.userId) throw forbidden("VIEW_AS_FORBIDDEN");
  return {
    success: true,
    vendors: [...CANONICAL_MENU_VENDORS]
  };
}, "listAdminMenuVendors");
var uniqueChangeError = /* @__PURE__ */ __name((error) => /UNIQUE constraint failed:\s*(menu_item_changes\.|idx_menu_item_changes_legacy_identity_unique)/i.test(
  String(error?.cause?.message || error?.message || "")
), "uniqueChangeError");
var createAdminMenuItemChange = /* @__PURE__ */ __name(async (database, identity, input, clock = /* @__PURE__ */ new Date()) => {
  assertCan(identity, ACTIONS.ADMIN_MENU_CHANGES);
  if (identity?.viewAs || identity?.effectiveSubject?.userId && identity.effectiveSubject.userId !== identity?.actor?.userId) {
    throw forbidden("VIEW_AS_MUTATION_FORBIDDEN");
  }
  const values = createInput(input);
  await assertVariantIdentity(database, values);
  const isVariantMove = values.identity_schema_version === NORMALIZED_IDENTITY_SCHEMA_VERSION && values.previous_variant_key && values.previous_variant_key !== values.variant_key;
  if (isVariantMove) {
    const previousVersion = values.previous_identity_schema_version === null ? NORMALIZED_IDENTITY_SCHEMA_VERSION : Number(values.previous_identity_schema_version);
    if (previousVersion !== NORMALIZED_IDENTITY_SCHEMA_VERSION) {
      throw badRequest("MENU_VARIANT_MOVE_NORMALIZED_ONLY");
    }
    const existing = await database.prepare(`
      SELECT menu_item_change_id
      FROM menu_item_changes
      WHERE vendor = ? AND item_code = ? AND variant_key = ?
        AND effective_date = ? AND identity_schema_version = ?
      LIMIT 1
    `).bind(
      values.vendor,
      values.item_code,
      values.variant_key,
      values.effective_date,
      NORMALIZED_IDENTITY_SCHEMA_VERSION
    ).first();
    if (existing) throw conflict("MENU_VARIANT_IDENTITY_CONFLICT");
  }
  const changeId = randomId("menu-change");
  const oldChangeId = isVariantMove ? randomId("menu-change-old") : null;
  const occurredAt = resolveClock(clock).toISOString();
  const insertStatement = /* @__PURE__ */ __name((id, variantKey, enabled) => prepareStatement(database, `
    INSERT INTO menu_item_changes (
      menu_item_change_id, effective_date, vendor, item_code, variant_key,
      item_name, price, enabled, image_url, note, display_order,
      source_kind, source_table, source_record_id, updated_by_user_id,
      created_at, updated_at, identity_schema_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin', 'admin_menu_item_changes', ?, ?, ?, ?, ?)
  `, [
    id,
    values.effective_date,
    values.vendor,
    values.item_code,
    variantKey,
    values.item_name,
    values.price,
    enabled ? 1 : 0,
    values.image_url,
    values.note,
    values.display_order,
    id,
    identity.actor.userId,
    occurredAt,
    occurredAt,
    values.identity_schema_version
  ]), "insertStatement");
  const inserts = [];
  if (isVariantMove) inserts.push(insertStatement(
    oldChangeId,
    values.previous_variant_key,
    false
  ));
  inserts.push(insertStatement(changeId, values.variant_key, values.enabled));
  const audit = auditStatement(database, {
    actorUserId: identity.actor.userId,
    actorAuthMode: identity.actor.authMode,
    actorEmployeeIdSnapshot: identity.actor.employeeId,
    actorLineUserIdSnapshot: identity.actor.lineUserId,
    action: "MENU_ITEM_CHANGE_CREATED",
    metadata: {
      menuItemChangeId: changeId,
      vendor: values.vendor,
      itemCode: values.item_code,
      variantKey: values.variant_key,
      effectiveDate: values.effective_date,
      identitySchemaVersion: values.identity_schema_version,
      previousVariantKey: isVariantMove ? values.previous_variant_key : null,
      previousChangeId: oldChangeId
    },
    occurredAt
  });
  const proposedChange = /* @__PURE__ */ __name((id, variantKey, enabled) => ({
    menu_item_change_id: id,
    effective_date: values.effective_date,
    vendor: values.vendor,
    item_code: values.item_code,
    variant_key: variantKey,
    item_name: values.item_name,
    price: values.price,
    enabled,
    image_url: values.image_url,
    note: values.note,
    display_order: values.display_order,
    source_kind: ADMIN_SOURCE_KIND,
    source_batch_id: null,
    source_table: "admin_menu_item_changes",
    source_record_id: id,
    updated_by_user_id: identity.actor.userId,
    created_at: occurredAt,
    updated_at: occurredAt,
    identity_schema_version: values.identity_schema_version,
    sequence_number: null
  }), "proposedChange");
  const proposedChanges = [];
  if (isVariantMove) proposedChanges.push(proposedChange(
    oldChangeId,
    values.previous_variant_key,
    false
  ));
  proposedChanges.push(proposedChange(changeId, values.variant_key, values.enabled));
  const currentResolution = await resolveEffectiveMenuState(database, {
    vendor: values.vendor,
    targetDate: values.effective_date
  });
  const prospectiveRows = mergeEffectiveMenuRows({
    baselineRows: currentResolution.baselineRows,
    changeRows: [...currentResolution.changeRows, ...proposedChanges]
  });
  const projection = await prepareMenuVersionMaterialization(database, {
    vendor: values.vendor,
    effectiveDate: values.effective_date,
    clock,
    resolved: prospectiveRows,
    authority: currentResolution.authority
  });
  try {
    await runMutationBatch(database, [...inserts, audit, ...projection.statements]);
  } catch (error) {
    if (uniqueChangeError(error)) throw conflict("MENU_CHANGE_DUPLICATE");
    throw error;
  }
  const row = await database.prepare(`${changeSelect} WHERE mic.menu_item_change_id = ?`).bind(changeId).first();
  return {
    success: true,
    change: normalizedChange(row),
    variant_move: isVariantMove ? {
      previous_change_id: oldChangeId,
      previous_variant_key: values.previous_variant_key,
      variant_key: values.variant_key
    } : null
  };
}, "createAdminMenuItemChange");
var getAdminMenuItemPreview = /* @__PURE__ */ __name(async (database, identity, { vendor, targetDate } = {}) => {
  assertCan(identity, ACTIONS.ADMIN_MENU_CHANGES);
  if (identity?.viewAs || identity?.effectiveSubject?.userId && identity.effectiveSubject.userId !== identity?.actor?.userId) throw forbidden("VIEW_AS_FORBIDDEN");
  const resolution = await resolveEffectiveMenuState(database, { vendor, targetDate });
  return {
    success: true,
    authority: resolution.authority,
    targetDate,
    vendor,
    items: resolution.rows,
    selectableItems: resolution.rows.filter((row) => row.enabled)
  };
}, "getAdminMenuItemPreview");

// src/domain/orders.js
var VALID_FLOORS = /* @__PURE__ */ new Set(["1\u6A13", "9\u6A13"]);
var ORDER_OPERATION = "CREATE_OR_REPLACE_ORDER";
var CANCEL_OPERATION = "CANCEL_ORDER";
var text6 = /* @__PURE__ */ __name((value) => typeof value === "string" ? value.trim() : "", "text");
var getInputValue = /* @__PURE__ */ __name((input, ...keys) => {
  for (const key of keys) {
    if (input?.[key] !== void 0) return input[key];
  }
  return void 0;
}, "getInputValue");
var parseQuantity = /* @__PURE__ */ __name((value) => {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const quantity = Number(value.trim());
    return Number.isSafeInteger(quantity) ? quantity : null;
  }
  return null;
}, "parseQuantity");
var currentSetting = /* @__PURE__ */ __name(async (database, orderDate) => database.prepare(`
  SELECT order_date, vendor, mode
  FROM calendar_settings
  WHERE order_date = ?
  LIMIT 1
`).bind(orderDate).first(), "currentSetting");
var currentMenuRows = /* @__PURE__ */ __name(async (database, vendor, targetDate) => {
  const resolution = await resolveEffectiveMenuState(database, { vendor, targetDate });
  const versionId = resolution.baselineVersion?.menu_version_id || null;
  return {
    versionId,
    rows: resolution.rows.map((change) => {
      const persistedMenuItemId = change.persisted_menu_item_id || null;
      return {
        menu_item_id: persistedMenuItemId || change.menu_item_id || projectionItemId(vendor, change.effective_date, change.item_code, change.variant_key),
        persisted_menu_item_id: persistedMenuItemId,
        legacy_item_id: change.item_code,
        variant_key: change.variant_key,
        item_name: change.item_name,
        price: change.price,
        enabled: change.enabled ? 1 : 0,
        note: change.note,
        image_url: change.image_url,
        menu_version_id: versionId,
        effective_date: change.effective_date
      };
    })
  };
}, "currentMenuRows");
var normalizeItems = /* @__PURE__ */ __name((rawItems, menuRows) => {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw badRequest("ORDER_ITEMS_REQUIRED");
  }
  const byInternalId = new Map(menuRows.map((row) => [String(row.menu_item_id), row]));
  const byLegacyId = /* @__PURE__ */ new Map();
  for (const row of menuRows) {
    const key = String(row.legacy_item_id);
    const rows = byLegacyId.get(key) || [];
    rows.push(row);
    byLegacyId.set(key, rows);
  }
  const normalized = [];
  const indexByInternalId = /* @__PURE__ */ new Map();
  for (const rawItem of rawItems) {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      throw badRequest("ORDER_ITEM_INVALID");
    }
    const internalId = text6(getInputValue(rawItem, "menu_item_id", "menuItemId"));
    const legacyId = text6(rawItem.item_id);
    const requestedId = internalId || legacyId;
    const quantity = parseQuantity(rawItem.quantity);
    if (!requestedId || quantity === null) throw badRequest("ORDER_ITEM_INVALID");
    if (quantity === 0) continue;
    let menuItem = internalId ? byInternalId.get(internalId) : null;
    if (!internalId) {
      const legacyRows = byLegacyId.get(legacyId) || [];
      if (legacyRows.length > 1) throw badRequest("MENU_ITEM_AMBIGUOUS");
      menuItem = legacyRows[0];
    }
    if (!menuItem) {
      const disabled = menuRows.some((row) => String(row.menu_item_id) === requestedId || String(row.legacy_item_id) === requestedId);
      throw badRequest(disabled ? "MENU_ITEM_DISABLED" : "MENU_ITEM_INVALID");
    }
    if (Number(menuItem.enabled) !== 1) throw badRequest("MENU_ITEM_DISABLED");
    const key = String(menuItem.menu_item_id);
    const existingIndex = indexByInternalId.get(key);
    if (existingIndex === void 0) {
      normalized.push({
        menuItemId: key,
        persistedMenuItemId: Object.hasOwn(menuItem, "persisted_menu_item_id") ? menuItem.persisted_menu_item_id : menuItem.menu_item_id,
        legacyItemId: String(menuItem.legacy_item_id),
        itemName: menuItem.item_name,
        price: Number(menuItem.price),
        quantity
      });
      indexByInternalId.set(key, normalized.length - 1);
    } else {
      const mergedQuantity = normalized[existingIndex].quantity + quantity;
      if (!Number.isSafeInteger(mergedQuantity)) throw badRequest("ORDER_ITEM_INVALID");
      normalized[existingIndex].quantity = mergedQuantity;
    }
  }
  if (normalized.length === 0) throw badRequest("ORDER_ITEMS_EMPTY");
  return normalized;
}, "normalizeItems");
var assertOrderRequest = /* @__PURE__ */ __name(async (database, identity, input, clock) => {
  const actor = getAuthenticatedOrderActor(identity);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw badRequest("INVALID_JSON");
  }
  const targetDate = text6(getInputValue(input, "targetDate", "target_date", "date"));
  if (!isDateOnly(targetDate)) throw badRequest("INVALID_DATE");
  const pickupFloor = text6(getInputValue(input, "pickupFloor", "pickup_floor"));
  if (!VALID_FLOORS.has(pickupFloor)) throw badRequest("INVALID_PICKUP_FLOOR");
  const note = text6(input.note);
  if (note.length > 2e3) throw badRequest("ORDER_NOTE_TOO_LONG");
  const setting = await currentSetting(database, targetDate);
  if (!setting || !text6(setting.vendor)) throw notFound("ORDER_PAGE_SETTING_NOT_FOUND");
  const now = resolveClock(clock);
  const requestedTargetUserId = normalizeTargetUserId(
    getInputValue(input, "targetUserId", "target_user_id")
  );
  const permission = await resolveOrderPermission(database, identity, {
    targetUserId: requestedTargetUserId,
    targetDate,
    mode: setting.mode,
    now
  });
  if (!permission.target || !permission.target.displayName) {
    throw forbidden("PROFILE_COMPLETION_REQUIRED");
  }
  if (!permission.timing.allowed) throw badRequest("DEADLINE_CLOSED");
  const menu = await currentMenuRows(database, setting.vendor, targetDate);
  const items = normalizeItems(getInputValue(input, "items", "orderItems"), menu.rows);
  const replaceExisting = input.replaceExisting !== false && input.replace_existing !== false;
  const activeOrder = await database.prepare(`
    SELECT order_id, total_amount
    FROM orders
    WHERE user_id = ? AND order_date = ? AND status = 'ACTIVE'
    LIMIT 1
  `).bind(permission.targetUserId, targetDate).first();
  return {
    actor,
    target: permission.target,
    targetUserId: permission.targetUserId,
    isDelegated: permission.isDelegated,
    requestedTargetUserId,
    permission,
    targetDate,
    pickupFloor,
    note,
    setting,
    items,
    replaceExisting,
    activeOrder,
    now,
    deadline: permission.timing.deadline
  };
}, "assertOrderRequest");
var menuCte = /* @__PURE__ */ __name((items) => `
  WITH requested(line_no, menu_item_id, legacy_item_id, item_name, price, quantity, enabled) AS (
    VALUES ${items.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ")}
  ),
  priced AS (
    SELECT line_no, menu_item_id, legacy_item_id, item_name, price, quantity
    FROM requested
    WHERE enabled = 1
  )
`, "menuCte");
var menuParams = /* @__PURE__ */ __name((items) => items.flatMap((item, index) => [
  index + 1,
  item.persistedMenuItemId ?? null,
  item.legacyItemId,
  item.itemName,
  item.price,
  item.quantity,
  1
]), "menuParams");
var mapTransactionFailure = /* @__PURE__ */ __name((error) => {
  if (error?.code !== "TRANSACTION_FAILED") throw error;
  const source = error.cause || error;
  const message = String(source?.message || "").toLowerCase();
  if (message.includes("idx_orders_one_active_actor_date")) {
    throw conflict("ORDER_ALREADY_ACTIVE");
  }
  if (message.includes("busy") || message.includes("locked")) {
    throw conflict("TRANSACTION_RETRY_REQUIRED");
  }
  throw conflict("MUTATION_CONFLICT");
}, "mapTransactionFailure");
var buildOrderStatements = /* @__PURE__ */ __name((database, context, actor, details) => {
  const {
    targetDate,
    pickupFloor,
    note,
    items,
    replaceExisting,
    now,
    target,
    targetUserId,
    isDelegated,
    permission
  } = context;
  const {
    orderId,
    refundTransactionId,
    replacementTransitionId,
    createdTransitionId,
    guard
  } = details;
  const occurredAt = now.toISOString();
  const guardSql = guard.sql;
  const guardParams = guard.params;
  const metadata = JSON.stringify({
    replacementOrderId: context.activeOrder?.order_id || null,
    actorUserId: actor.userId,
    targetUserId
  });
  const deadlineA = deadlineAt(targetDate, "A").toISOString();
  const deadlineB = deadlineAt(targetDate, "B").toISOString();
  const calendarTimingPredicate = permission.timing.cutoffApplies ? `AND (
        (cs.mode = 'A' AND ? <= ?)
        OR (cs.mode = 'B' AND ? <= ?)
      )` : "";
  const calendarTimingParams = permission.timing.cutoffApplies ? [occurredAt, deadlineA, occurredAt, deadlineB] : [];
  const validityPredicate = `
    EXISTS (
      SELECT 1 FROM users WHERE user_id = ? AND active = 1
    )
    AND EXISTS (
      SELECT 1
      FROM calendar_settings cs
      WHERE cs.order_date = ?
        AND length(trim(cs.vendor)) > 0
        ${calendarTimingPredicate}
    )
    AND (SELECT COUNT(*) FROM priced) = ?
    AND (? = 1 OR NOT EXISTS (
      SELECT 1 FROM orders
      WHERE user_id = ? AND order_date = ? AND status = 'ACTIVE'
    ))
  `;
  const validityParams = [
    targetUserId,
    targetDate,
    ...calendarTimingParams,
    items.length,
    replaceExisting ? 1 : 0,
    targetUserId,
    targetDate
  ];
  const assertRequest = prepareStatement(database, `${menuCte(items)}
    UPDATE idempotency_keys
    SET status = CASE WHEN (${validityPredicate}) THEN status ELSE 'FAILED' END
    WHERE ${guardSql}
  `, [...menuParams(items), ...validityParams, ...guardParams]);
  const replacementRefund = ledgerMutationStatements(database, {
    transactionId: refundTransactionId,
    userId: targetUserId,
    employeeIdSnapshot: target.employeeId,
    lineUserIdSnapshot: target.lineUserId,
    displayNameSnapshot: target.displayName,
    // The amount is selected from the active order inside the batch.  Zero
    // only makes the entry shape valid when there is no order to replace.
    amount: context.activeOrder ? Number(context.activeOrder.total_amount) : 0,
    type: "REFUND",
    referenceId: context.activeOrder?.order_id || "ORDER_REPLACEMENT",
    operatorUserId: actor.userId,
    operatorEmployeeIdSnapshot: actor.employeeId,
    operatorLineUserIdSnapshot: actor.lineUserId,
    operatorDisplayNameSnapshot: actor.displayName,
    operatorAuthMode: actor.authMode,
    authMode: actor.authMode,
    note: "ORDER_REPLACED",
    occurredAt
  }, {
    guard,
    dynamicBalanceAfter: true,
    dynamicOrder: { orderDate: targetDate }
  }).statements;
  const replacementHistory = prepareStatement(database, `
    INSERT INTO order_status_history (
      transition_id, order_id, from_status, to_status, actor_user_id,
      actor_auth_mode, employee_id_snapshot, line_user_id_snapshot,
      display_name_snapshot, reason, metadata_json, occurred_at
    )
    SELECT ?, o.order_id, 'ACTIVE', 'CANCELLED', ?, ?, u.employee_id,
           u.line_user_id, u.display_name, 'ORDER_REPLACED', ?, ?
    FROM orders o
    JOIN users u ON u.user_id = o.user_id
    WHERE o.user_id = ? AND o.order_date = ? AND o.status = 'ACTIVE'
      AND ${guardSql}
  `, [
    replacementTransitionId,
    actor.userId,
    actor.authMode,
    metadata,
    occurredAt,
    targetUserId,
    targetDate,
    ...guardParams
  ]);
  const cancelPrevious = prepareStatement(database, `
    UPDATE orders
    SET status = 'CANCELLED',
        cancelled_by_user_id = ?,
        cancelled_auth_mode = ?,
        updated_at = ?
    WHERE user_id = ? AND order_date = ? AND status = 'ACTIVE'
      AND ${guardSql}
  `, [actor.userId, actor.authMode, occurredAt, targetUserId, targetDate, ...guardParams]);
  const totalAmount = items.reduce(
    (sum, item) => sum + item.quantity * item.price,
    0
  );
  if (!Number.isSafeInteger(totalAmount) || totalAmount < 0) {
    throw badRequest("ORDER_AMOUNT_INVALID");
  }
  const insertOrder = prepareStatement(database, `${menuCte(items)}
    INSERT INTO orders (
      order_id, user_id, employee_id_snapshot, line_user_id_snapshot,
      display_name_snapshot, order_date, vendor, pickup_floor, note,
      total_amount, status, created_by_user_id, created_auth_mode,
      created_at, updated_at
    )
    SELECT ?, ?, u.employee_id, u.line_user_id, u.display_name, ?, cs.vendor,
           ?, ?,
           CASE WHEN (SELECT COUNT(*) FROM priced) = ?
                THEN (SELECT SUM(quantity * price) FROM priced)
                ELSE NULL END,
           'ACTIVE', ?, ?, ?, ?
    FROM calendar_settings cs
    JOIN users u ON u.user_id = ?
      WHERE cs.order_date = ?
      AND length(trim(cs.vendor)) > 0
      ${calendarTimingPredicate}
      AND ${guardSql}
  `, [
    ...menuParams(items),
    orderId,
    targetUserId,
    targetDate,
    pickupFloor,
    note,
    items.length,
    actor.userId,
    actor.authMode,
    occurredAt,
    occurredAt,
    actor.userId,
    targetDate,
    ...calendarTimingParams,
    ...guardParams
  ]);
  const assertOrderInserted = prepareStatement(database, `
    UPDATE idempotency_keys
    SET status = CASE WHEN EXISTS (
      SELECT 1 FROM orders
      WHERE order_id = ? AND user_id = ? AND status = 'ACTIVE'
    ) THEN status ELSE 'FAILED' END
    WHERE ${guardSql}
  `, [orderId, targetUserId, ...guardParams]);
  const insertItems = prepareStatement(database, `${menuCte(items)}
    INSERT INTO order_items (
      order_id, line_no, menu_item_id, legacy_item_id, item_name_snapshot,
      quantity, unit_price, subtotal
    )
    SELECT ?, p.line_no, p.menu_item_id, p.legacy_item_id, p.item_name,
           p.quantity, p.price, p.quantity * p.price
    FROM priced p
    WHERE ${guardSql}
  `, [...menuParams(items), orderId, ...guardParams]);
  const assertItemsInserted = prepareStatement(database, `
    UPDATE idempotency_keys
    SET status = CASE WHEN (
      SELECT COUNT(*) FROM order_items WHERE order_id = ?
    ) = ? THEN status ELSE 'FAILED' END
    WHERE ${guardSql}
  `, [orderId, items.length, ...guardParams]);
  const orderDebit = ledgerMutationStatements(database, {
    transactionId: details.orderTransactionId,
    userId: targetUserId,
    employeeIdSnapshot: target.employeeId,
    lineUserIdSnapshot: target.lineUserId,
    displayNameSnapshot: target.displayName,
    amount: -totalAmount,
    type: "ORDER",
    referenceId: orderId,
    operatorUserId: actor.userId,
    operatorEmployeeIdSnapshot: actor.employeeId,
    operatorLineUserIdSnapshot: actor.lineUserId,
    operatorDisplayNameSnapshot: actor.displayName,
    operatorAuthMode: actor.authMode,
    authMode: actor.authMode,
    note: "ORDER_CREATED",
    occurredAt
  }, { guard, dynamicBalanceAfter: true }).statements;
  const createdHistory = prepareStatement(database, `
    INSERT INTO order_status_history (
      transition_id, order_id, from_status, to_status, actor_user_id,
      actor_auth_mode, employee_id_snapshot, line_user_id_snapshot,
      display_name_snapshot, reason, metadata_json, occurred_at
    )
    SELECT ?, o.order_id, NULL, 'ACTIVE', ?, ?, u.employee_id,
           u.line_user_id, u.display_name, 'ORDER_CREATED', ?, ?
    FROM orders o
    JOIN users u ON u.user_id = o.user_id
    WHERE o.order_id = ? AND o.user_id = ? AND o.status = 'ACTIVE'
      AND ${guardSql}
  `, [
    createdTransitionId,
    actor.userId,
    actor.authMode,
    JSON.stringify({ replaced: Boolean(context.activeOrder) }),
    occurredAt,
    orderId,
    targetUserId,
    ...guardParams
  ]);
  const orderAudit = isDelegated ? auditStatement(database, {
    auditId: details.orderAuditId,
    actorUserId: actor.userId,
    actorAuthMode: actor.authMode,
    actorEmployeeIdSnapshot: actor.employeeId,
    actorLineUserIdSnapshot: actor.lineUserId,
    targetUserId: target.userId,
    targetEmployeeIdSnapshot: target.employeeId,
    targetLineUserIdSnapshot: target.lineUserId,
    action: context.activeOrder ? "ORDER_UPDATE" : "ORDER_CREATE",
    metadata: { orderId, replacedOrderId: context.activeOrder?.order_id || null },
    occurredAt,
    onlyIfPriorMutation: true
  }) : null;
  return [
    assertRequest,
    ...replacementRefund,
    replacementHistory,
    cancelPrevious,
    insertOrder,
    assertOrderInserted,
    ...orderDebit,
    insertItems,
    assertItemsInserted,
    createdHistory,
    ...orderAudit ? [orderAudit] : []
  ];
}, "buildOrderStatements");
var createOrReplaceOrder = /* @__PURE__ */ __name(async (database, identity, input, clock = /* @__PURE__ */ new Date()) => {
  const idempotencyKey3 = requireIdempotencyKey(input?.idempotencyKey);
  const context = await assertOrderRequest(database, identity, input, clock);
  const { actor } = context;
  const requestPayload = {
    targetDate: context.targetDate,
    targetUserId: context.targetUserId,
    pickupFloor: context.pickupFloor,
    note: context.note,
    replaceExisting: context.replaceExisting,
    items: context.items.map(({ menuItemId, quantity }) => ({ menuItemId, quantity }))
  };
  const requestHash = await hashRequest(requestPayload);
  const existingResult = await readExistingIdempotencyResult(database, {
    actorUserId: actor.userId,
    operation: ORDER_OPERATION,
    idempotencyKey: idempotencyKey3,
    requestHash
  });
  if (existingResult) return existingResult;
  if (!context.replaceExisting && context.activeOrder) throw conflict("ORDER_ALREADY_ACTIVE");
  const orderId = "ORD-" + randomId("");
  const details = {
    actorUserId: actor.userId,
    operation: ORDER_OPERATION,
    idempotencyKey: idempotencyKey3,
    requestHash,
    occurredAt: context.now.toISOString(),
    orderId,
    refundTransactionId: randomId("txn"),
    orderTransactionId: randomId("txn"),
    replacementTransitionId: randomId("transition"),
    createdTransitionId: randomId("transition"),
    orderAuditId: randomId("audit")
  };
  try {
    return await runIdempotentMutation(database, {
      ...details,
      responseSpec: mutationResponseSpec({
        message: "ORDER_SAVED",
        orderId,
        balanceUserId: context.targetUserId
      }),
      buildStatements: /* @__PURE__ */ __name((claim) => buildOrderStatements(
        database,
        context,
        actor,
        { ...details, ...claim }
      ), "buildStatements")
    });
  } catch (error) {
    mapTransactionFailure(error);
  }
}, "createOrReplaceOrder");
var activeOrderForCancellation = /* @__PURE__ */ __name(async (database, orderId) => database.prepare(`
  SELECT o.order_id, o.user_id, o.order_date, o.total_amount, o.status,
         cs.mode
  FROM orders o
  LEFT JOIN calendar_settings cs ON cs.order_date = o.order_date
  WHERE o.order_id = ?
  LIMIT 1
`).bind(orderId).first(), "activeOrderForCancellation");
var cancelOrder = /* @__PURE__ */ __name(async (database, identity, orderIdInput, idempotencyKeyInput, clock = /* @__PURE__ */ new Date(), requestedTargetUserId = null) => {
  const actor = getAuthenticatedOrderActor(identity);
  const orderId = text6(orderIdInput);
  if (!orderId) throw badRequest("ORDER_ID_REQUIRED");
  const idempotencyKey3 = requireIdempotencyKey(idempotencyKeyInput);
  const normalizedTargetUserId = normalizeTargetUserId(requestedTargetUserId);
  const requestHash = await hashRequest({
    orderId,
    targetUserId: normalizedTargetUserId
  });
  const existingResult = await readExistingIdempotencyResult(database, {
    actorUserId: actor.userId,
    operation: CANCEL_OPERATION,
    idempotencyKey: idempotencyKey3,
    requestHash
  });
  if (existingResult) return existingResult;
  const order = await activeOrderForCancellation(database, orderId);
  if (!order) throw notFound("ORDER_NOT_FOUND");
  if (!order.mode) throw notFound("ORDER_PAGE_SETTING_NOT_FOUND");
  const now = resolveClock(clock);
  const actorTarget = await resolveOrderActorTarget(
    database,
    identity,
    normalizedTargetUserId
  );
  if (order.user_id !== actorTarget.targetUserId) throw forbidden("ORDER_FORBIDDEN");
  if (order.status !== "ACTIVE") throw conflict("ORDER_ALREADY_CANCELLED");
  const permission = {
    ...actorTarget,
    timing: resolveOrderMutationTiming({
      actor: actorTarget.actor,
      isDelegated: actorTarget.isDelegated,
      targetDate: order.order_date,
      mode: order.mode,
      now
    })
  };
  if (!permission.timing.allowed) throw badRequest("DEADLINE_CLOSED");
  const occurredAt = now.toISOString();
  const refundTransactionId = randomId("txn");
  const transitionId = randomId("transition");
  const details = {
    actorUserId: actor.userId,
    operation: CANCEL_OPERATION,
    idempotencyKey: idempotencyKey3,
    requestHash,
    occurredAt,
    orderId,
    refundTransactionId,
    transitionId,
    cancelAuditId: randomId("audit")
  };
  try {
    return await runIdempotentMutation(database, {
      ...details,
      responseSpec: mutationResponseSpec({
        message: "ORDER_CANCELLED",
        orderId,
        balanceUserId: permission.targetUserId
      }),
      buildStatements: /* @__PURE__ */ __name(({ guard }) => {
        const guardSql = guard.sql;
        const guardParams = guard.params;
        const deadlineA = deadlineAt(order.order_date, "A").toISOString();
        const deadlineB = deadlineAt(order.order_date, "B").toISOString();
        const calendarTimingPredicate = permission.timing.cutoffApplies ? `AND (
              (cs.mode = 'A' AND ? <= ?)
              OR (cs.mode = 'B' AND ? <= ?)
            )` : "";
        const calendarTimingParams = permission.timing.cutoffApplies ? [occurredAt, deadlineA, occurredAt, deadlineB] : [];
        const validOrder = `
          EXISTS (
            SELECT 1
            FROM orders o
            JOIN calendar_settings cs ON cs.order_date = o.order_date
            WHERE o.order_id = ?
              AND o.user_id = ?
              AND o.status = 'ACTIVE'
              AND NOT EXISTS (
                SELECT 1 FROM balance_ledger bl
                WHERE bl.type = 'REFUND' AND bl.reference_id = o.order_id
              )
              ${calendarTimingPredicate}
          )
        `;
        const assertRequest = prepareStatement(database, `
          UPDATE idempotency_keys
          SET status = CASE WHEN (${validOrder}) THEN status ELSE 'FAILED' END
          WHERE ${guardSql}
        `, [
          orderId,
          permission.targetUserId,
          ...calendarTimingParams,
          ...guardParams
        ]);
        const refundLedger = ledgerMutationStatements(database, {
          transactionId: refundTransactionId,
          userId: permission.targetUserId,
          employeeIdSnapshot: permission.target.employeeId,
          lineUserIdSnapshot: permission.target.lineUserId,
          displayNameSnapshot: permission.target.displayName,
          amount: Number(order.total_amount),
          type: "REFUND",
          referenceId: orderId,
          operatorUserId: actor.userId,
          operatorEmployeeIdSnapshot: actor.employeeId,
          operatorLineUserIdSnapshot: actor.lineUserId,
          operatorDisplayNameSnapshot: actor.displayName,
          operatorAuthMode: actor.authMode,
          authMode: actor.authMode,
          note: "ORDER_CANCELLED",
          occurredAt
        }, { guard, dynamicBalanceAfter: true }).statements;
        const statusHistory = prepareStatement(database, `
          INSERT INTO order_status_history (
            transition_id, order_id, from_status, to_status, actor_user_id,
            actor_auth_mode, employee_id_snapshot, line_user_id_snapshot,
            display_name_snapshot, reason, metadata_json, occurred_at
          )
          SELECT ?, o.order_id, 'ACTIVE', 'CANCELLED', ?, ?, u.employee_id,
                 u.line_user_id, u.display_name, 'ORDER_CANCELLED', '{}', ?
          FROM orders o
          JOIN users u ON u.user_id = o.user_id
          WHERE o.order_id = ? AND o.user_id = ? AND o.status = 'ACTIVE'
            AND ${guardSql}
        `, [
          transitionId,
          actor.userId,
          actor.authMode,
          occurredAt,
          orderId,
          permission.targetUserId,
          ...guardParams
        ]);
        const cancel = prepareStatement(database, `
          UPDATE orders
          SET status = 'CANCELLED',
              cancelled_by_user_id = ?,
              cancelled_auth_mode = ?,
              updated_at = ?
          WHERE order_id = ? AND user_id = ? AND status = 'ACTIVE'
            AND ${guardSql}
        `, [
          actor.userId,
          actor.authMode,
          occurredAt,
          orderId,
          permission.targetUserId,
          ...guardParams
        ]);
        const orderAudit = permission.isDelegated ? auditStatement(database, {
          auditId: details.cancelAuditId,
          actorUserId: actor.userId,
          actorAuthMode: actor.authMode,
          actorEmployeeIdSnapshot: actor.employeeId,
          actorLineUserIdSnapshot: actor.lineUserId,
          targetUserId: permission.target.userId,
          targetEmployeeIdSnapshot: permission.target.employeeId,
          targetLineUserIdSnapshot: permission.target.lineUserId,
          action: "ORDER_CANCEL",
          metadata: { orderId },
          occurredAt,
          onlyIfPriorMutation: true
        }) : null;
        const assertCancelled = prepareStatement(database, `
          UPDATE idempotency_keys
          SET status = CASE WHEN EXISTS (
            SELECT 1 FROM orders
            WHERE order_id = ? AND user_id = ? AND status = 'CANCELLED'
          ) THEN status ELSE 'FAILED' END
          WHERE ${guardSql}
        `, [orderId, permission.targetUserId, ...guardParams]);
        return [
          assertRequest,
          ...refundLedger,
          statusHistory,
          cancel,
          ...orderAudit ? [orderAudit] : [],
          assertCancelled
        ];
      }, "buildStatements")
    });
  } catch (error) {
    mapTransactionFailure(error);
  }
}, "cancelOrder");
var ORDER_OPERATIONS = Object.freeze({
  CREATE_OR_REPLACE_ORDER: ORDER_OPERATION,
  CANCEL_ORDER: CANCEL_OPERATION
});

// src/routes/orders.js
var readJson3 = /* @__PURE__ */ __name(async (request) => {
  if (!request.body) return {};
  try {
    const raw = await request.text();
    if (!raw.trim()) return {};
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("body");
    }
    return value;
  } catch {
    throw badRequest("INVALID_JSON");
  }
}, "readJson");
var idempotencyKey = /* @__PURE__ */ __name((request, body) => request.headers.get("Idempotency-Key")?.trim() || body.idempotencyKey || body.idempotency_key || "", "idempotencyKey");
var orderIdFromCancelPath = /* @__PURE__ */ __name((pathname) => {
  const match = pathname.match(/^\/api\/orders\/([^/]+)\/cancel$/);
  if (!match) return null;
  try {
    const orderId = decodeURIComponent(match[1]).trim();
    return orderId || null;
  } catch {
    throw badRequest("ORDER_ID_INVALID");
  }
}, "orderIdFromCancelPath");
var handleOrderRoute = /* @__PURE__ */ __name(async (request, env, {
  fetchImpl = globalThis.fetch,
  now = /* @__PURE__ */ new Date()
} = {}) => {
  const url = new URL(request.url);
  const isCreate = request.method === "POST" && url.pathname === "/api/orders";
  const isTargets = request.method === "GET" && url.pathname === "/api/orders/targets";
  const cancelId = request.method === "POST" ? orderIdFromCancelPath(url.pathname) : null;
  if (!isCreate && !isTargets && !cancelId) return null;
  const identity = await requireIdentity(request, env, {
    fetchImpl,
    allowViewAs: false,
    now
  });
  if (isTargets) {
    return jsonResponse({
      success: true,
      targets: await getEligibleOrderTargets(env.DB, identity)
    });
  }
  const body = isCreate || cancelId ? await readJson3(request) : {};
  const key = idempotencyKey(request, body);
  if (isCreate) {
    return jsonResponse(await createOrReplaceOrder(
      env.DB,
      identity,
      { ...body, idempotencyKey: key },
      now
    ));
  }
  return jsonResponse(await cancelOrder(
    env.DB,
    identity,
    cancelId,
    key,
    now,
    body.targetUserId ?? body.target_user_id
  ));
}, "handleOrderRoute");

// src/domain/ledgerConsistency.js
var policyIdFromNote = /* @__PURE__ */ __name((note) => {
  const match = String(note || "").match(/(?:^|\s)policy_id=([^\s]+)/i);
  return match ? match[1] : null;
}, "policyIdFromNote");
var rowDetails = /* @__PURE__ */ __name((row) => ({
  sequenceNumber: Number(row.sequence_number),
  transactionId: row.transaction_id,
  type: row.type,
  amount: Number(row.amount),
  balanceBefore: Number(row.balance_after) - Number(row.amount),
  occurredAt: row.occurred_at || null,
  note: row.note || "",
  policyId: policyIdFromNote(row.note)
}), "rowDetails");
var analyzeLedgerRows = /* @__PURE__ */ __name((rows = []) => {
  const ordered = rows.slice().sort((left, right) => Number(left.sequence_number) - Number(right.sequence_number));
  if (ordered.length === 0) {
    return {
      status: "CONSISTENT",
      initialBalanceBefore: null,
      sequenceDiscontinuities: [],
      propagatedRows: []
    };
  }
  const first = ordered[0];
  const initialBalanceBefore = Number(first.balance_after) - Number(first.amount);
  let cumulativeAmount = 0;
  const sequenceDiscontinuities = [];
  const propagatedRows = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const row = ordered[index];
    const amount = Number(row.amount);
    const actualBalanceAfter = Number(row.balance_after);
    cumulativeAmount += amount;
    const reconstructedBalanceAfter = initialBalanceBefore + cumulativeAmount;
    const previous = ordered[index - 1] || null;
    const previousBalanceAfter = previous ? Number(previous.balance_after) : null;
    const expectedBalanceAfter = previous ? previousBalanceAfter + amount : null;
    const localBreak = previous !== null && actualBalanceAfter !== expectedBalanceAfter;
    const chainOffset = actualBalanceAfter - reconstructedBalanceAfter;
    const details = {
      ...rowDetails(row),
      previousSequence: previous ? Number(previous.sequence_number) : null,
      previousBalanceAfter,
      expectedBalanceAfter,
      actualBalanceAfter,
      delta: localBreak ? actualBalanceAfter - expectedBalanceAfter : 0,
      reconstructedBalanceAfter,
      chainOffset
    };
    if (localBreak) sequenceDiscontinuities.push(details);
    else if (chainOffset !== 0) propagatedRows.push(details);
  }
  return {
    status: sequenceDiscontinuities.length > 0 ? "LEDGER_CHAIN_DISCONTINUITY" : "CONSISTENT",
    initialBalanceBefore,
    sequenceDiscontinuities,
    propagatedRows
  };
}, "analyzeLedgerRows");
var inMonth = /* @__PURE__ */ __name((row, monthStart, monthEnd) => row.occurred_at >= monthStart && row.occurred_at < monthEnd, "inMonth");
var buildMonthlyReconciliation = /* @__PURE__ */ __name(({
  allRows = [],
  monthRows = [],
  monthStart,
  monthEnd,
  openingBalance,
  closingBalance,
  openingSequence = null,
  closingSequence = null,
  totalCredit,
  totalDebit
}) => {
  const expectedClosingBalance = openingBalance === null || openingBalance === void 0 ? null : Number(openingBalance) + Number(totalCredit) - Number(totalDebit);
  const monthlyDelta = expectedClosingBalance === null || closingBalance === null ? null : Number(closingBalance) - expectedClosingBalance;
  const monthIds = new Set(monthRows.map((row) => row.transaction_id));
  const firstMonthIndex = allRows.findIndex((row) => monthIds.has(row.transaction_id));
  let lastMonthIndex = -1;
  for (let index = allRows.length - 1; index >= 0; index -= 1) {
    if (monthIds.has(allRows[index].transaction_id)) {
      lastMonthIndex = index;
      break;
    }
  }
  const outOfPeriodSequenceRows = firstMonthIndex >= 0 && lastMonthIndex >= firstMonthIndex ? allRows.slice(firstMonthIndex, lastMonthIndex + 1).filter((row) => !inMonth(row, monthStart, monthEnd)).map((row) => ({
    ...rowDetails(row),
    balanceAfter: Number(row.balance_after)
  })) : [];
  const adjustmentRows = monthRows.filter((row) => row.type === "ADJUSTMENT").map((row) => ({
    ...rowDetails(row),
    balanceAfter: Number(row.balance_after)
  }));
  const ledger = analyzeLedgerRows(allRows);
  const status = ledger.sequenceDiscontinuities.length > 0 ? "LEDGER_CHAIN_DISCONTINUITY" : monthlyDelta === 0 ? "CONSISTENT" : outOfPeriodSequenceRows.length > 0 ? "SEQUENCE_DATE_BOUNDARY_MISMATCH" : "MONTHLY_AMOUNT_BALANCE_MISMATCH";
  return {
    status,
    expectedClosingBalance,
    actualClosingBalance: closingBalance,
    monthlyDelta,
    openingSequence: openingSequence === null || openingSequence === void 0 ? null : Number(openingSequence),
    closingSequence: closingSequence === null || closingSequence === void 0 ? null : Number(closingSequence),
    openingBalanceSource: openingSequence === null || openingSequence === void 0 ? monthRows.length > 0 ? "first_sequenced_row_baseline" : "empty_ledger_zero" : "sequenced_ledger",
    closingBalanceSource: closingSequence === null || closingSequence === void 0 ? "opening_balance_fallback" : "sequenced_ledger",
    outOfPeriodSequenceRows,
    adjustmentRows,
    sequenceDiscontinuities: ledger.sequenceDiscontinuities,
    propagatedRows: ledger.propagatedRows
  };
}, "buildMonthlyReconciliation");

// src/domain/ledger.js
var MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
var TAIPEI_UTC_OFFSET_MS = 8 * 60 * 60 * 1e3;
var monthBounds = /* @__PURE__ */ __name((month) => {
  const match = String(month || "").match(MONTH_PATTERN);
  if (!match) throw badRequest("INVALID_MONTH");
  const start = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1) - TAIPEI_UTC_OFFSET_MS);
  const end = new Date(Date.UTC(Number(match[1]), Number(match[2]), 1) - TAIPEI_UTC_OFFSET_MS);
  return { month: `${match[1]}-${match[2]}`, start: start.toISOString(), end: end.toISOString() };
}, "monthBounds");
var openingBalanceSnapshot = /* @__PURE__ */ __name((database, userId) => database.prepare(`
  SELECT snapshot_balance, policy_status
  FROM opening_balance_snapshots
  WHERE user_id = ?
  LIMIT 1
`).bind(userId).first(), "openingBalanceSnapshot");
var TRANSACTION_DESCRIPTIONS = Object.freeze({
  ORDER_CREATED: "\u9EDE\u9910",
  ORDER_CANCELLED: "\u53D6\u6D88\u9EDE\u9910"
});
var descriptionFor = /* @__PURE__ */ __name((row) => TRANSACTION_DESCRIPTIONS[row.note] || row.note || row.type || "BALANCE_CHANGE", "descriptionFor");
var getBalanceHistory = /* @__PURE__ */ __name(async (database, userId, monthInput) => {
  const month = monthBounds(monthInput);
  const user = await getUserById(database, userId);
  const snapshot = await openingBalanceSnapshot(database, userId);
  if (!user) throw conflict("USER_NOT_FOUND");
  if (snapshot?.policy_status === "REQUIRED") {
    throw conflict("OPENING_BALANCE_POLICY_REQUIRED");
  }
  const allRows = await getLedgerRows(database, userId);
  if (allRows.length === 0 && user.balance !== 0) {
    throw conflict("OPENING_BALANCE_POLICY_REQUIRED");
  }
  const monthRows = allRows.filter((row) => row.occurred_at >= month.start && row.occurred_at < month.end);
  const prior = await getLatestLedgerRow(database, userId, month.start);
  const closing = await getLatestLedgerRow(database, userId, month.end);
  const orderDetails = await getHistoricalOrderDetails(database, allRows.filter((row) => row.type === "ORDER" || row.type === "REFUND").map((row) => row.reference_id));
  const first = monthRows[0];
  const openingBalance = prior ? Number(prior.balance_after) : first ? Number(first.balance_after) - Number(first.amount) : allRows.length ? null : 0;
  if (openingBalance === null && user.balance !== 0) {
    throw conflict("OPENING_BALANCE_POLICY_REQUIRED");
  }
  let totalCredit = 0;
  let totalDebit = 0;
  for (const row of monthRows) {
    if (row.amount >= 0) totalCredit += Number(row.amount);
    else totalDebit += Math.abs(Number(row.amount));
  }
  const transactions = monthRows.slice().reverse().map((row) => ({
    id: row.transaction_id,
    transactionId: row.transaction_id,
    type: row.type,
    referenceId: row.reference_id || "",
    description: descriptionFor(row),
    note: row.note || "",
    topupMethod: row.topup_method || null,
    occurredAt: row.occurred_at,
    timestamp: row.occurred_at.slice(0, 16),
    businessDate: row.order_date || null,
    order: row.type === "ORDER" || row.type === "REFUND" ? orderDetails.get(row.reference_id) || null : null,
    amount: Number(row.amount),
    changeAmount: Number(row.amount),
    sequenceNumber: Number(row.sequence_number),
    balanceBefore: Number(row.balance_after) - Number(row.amount),
    balanceAfter: Number(row.balance_after),
    balance: Number(row.balance_after)
  }));
  const closingBalance = closing ? Number(closing.balance_after) : openingBalance ?? 0;
  const reconciliation = buildMonthlyReconciliation({
    allRows,
    monthRows,
    monthStart: month.start,
    monthEnd: month.end,
    openingBalance: openingBalance ?? null,
    closingBalance,
    openingSequence: prior?.sequence_number ?? null,
    closingSequence: closing?.sequence_number ?? null,
    totalCredit,
    totalDebit
  });
  return {
    success: true,
    ok: true,
    month: month.month,
    year: Number(month.month.slice(0, 4)),
    monthNumber: Number(month.month.slice(5, 7)),
    openingBalance: openingBalance ?? null,
    totalCredit,
    totalDebit,
    closingBalance,
    reconciliation,
    transactions,
    openingBalancePolicyRequired: openingBalance === null
  };
}, "getBalanceHistory");

// src/routes/balance.js
var TOP_UP_OPERATION = "ADMIN_BALANCE_TOP_UP";
var readJson4 = /* @__PURE__ */ __name(async (request) => {
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("body");
    return value;
  } catch {
    throw badRequest("INVALID_JSON");
  }
}, "readJson");
var idempotencyKey2 = /* @__PURE__ */ __name((request, body) => request.headers.get("Idempotency-Key")?.trim() || body.idempotencyKey || body.idempotency_key || "", "idempotencyKey");
var text7 = /* @__PURE__ */ __name((value) => typeof value === "string" ? value.trim() : "", "text");
var positiveInteger = /* @__PURE__ */ __name((value) => {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}, "positiveInteger");
var actorForTopUp = /* @__PURE__ */ __name((identity) => {
  assertCan(identity, ACTIONS.ADMIN_TOP_UP);
  return identity.actor;
}, "actorForTopUp");
var topUpBalance = /* @__PURE__ */ __name(async (database, identity, input, clock = /* @__PURE__ */ new Date()) => {
  const actor = actorForTopUp(identity);
  const targetUserInput = text7(
    input?.targetUserId || input?.userId || input?.targetEmployeeId || input?.targetLineUserId
  );
  const amount = positiveInteger(input?.amount);
  const note = text7(input?.note);
  if (!targetUserInput) throw badRequest("TOP_UP_TARGET_REQUIRED");
  if (amount === null) throw badRequest("TOP_UP_AMOUNT_INVALID");
  const topupMethod = requireTopupMethod(input?.topupMethod);
  if (note.length > 2e3) throw badRequest("TOP_UP_NOTE_TOO_LONG");
  const idempotency = requireIdempotencyKey(input?.idempotencyKey);
  const target = input?.targetEmployeeId ? await getUserByEmployeeId(database, targetUserInput) : input?.targetLineUserId ? await getUserByLineId(database, targetUserInput) : await getUserById(database, targetUserInput);
  if (!target) throw notFound("TOP_UP_TARGET_NOT_FOUND");
  const targetUserId = target.userId;
  const requestHash = await hashRequest({ targetUserId, amount, topupMethod, note });
  const existing = await readExistingIdempotencyResult(database, {
    actorUserId: actor.userId,
    operation: TOP_UP_OPERATION,
    idempotencyKey: idempotency,
    requestHash
  });
  if (existing) return existing;
  const now = resolveClock(clock).toISOString();
  const transactionId = randomId("txn");
  const auditId = randomId("audit");
  const details = {
    actorUserId: actor.userId,
    operation: TOP_UP_OPERATION,
    idempotencyKey: idempotency,
    requestHash,
    claimToken: randomId("claim"),
    occurredAt: now
  };
  try {
    return await runIdempotentMutation(database, {
      ...details,
      responseSpec: balanceMutationResponseSpec({
        message: "BALANCE_TOPPED_UP",
        targetUserId,
        balanceUserId: targetUserId,
        transactionId
      }),
      buildStatements: /* @__PURE__ */ __name(({ guard }) => {
        const audit = auditStatement(database, {
          auditId,
          actorUserId: actor.userId,
          actorAuthMode: actor.authMode,
          actorEmployeeIdSnapshot: actor.employeeId,
          actorLineUserIdSnapshot: actor.lineUserId,
          targetUserId,
          targetEmployeeIdSnapshot: target.employeeId,
          targetLineUserIdSnapshot: target.lineUserId,
          action: "BALANCE_TOP_UP",
          metadata: { amount, topupMethod, note, transactionId },
          occurredAt: now
        });
        const ledger = ledgerMutationStatements(database, {
          transactionId,
          userId: targetUserId,
          employeeIdSnapshot: target.employeeId,
          lineUserIdSnapshot: target.lineUserId,
          displayNameSnapshot: target.displayName,
          amount,
          // Dynamic balance mutations resolve their opening balance from the
          // sequence-backed projection inside the atomic batch.
          balanceAfter: 0,
          type: "TOPUP",
          topupMethod,
          referenceId: auditId,
          operatorUserId: actor.userId,
          operatorEmployeeIdSnapshot: actor.employeeId,
          operatorLineUserIdSnapshot: actor.lineUserId,
          operatorDisplayNameSnapshot: actor.displayName,
          operatorAuthMode: actor.authMode,
          authMode: actor.authMode,
          note,
          occurredAt: now
        }, { guard, dynamicBalanceAfter: true });
        return [audit, ...ledger.statements];
      }, "buildStatements")
    });
  } catch (error) {
    if (error?.code === "TRANSACTION_FAILED") throw conflict("MUTATION_CONFLICT");
    throw error;
  }
}, "topUpBalance");
var handleBalanceRoute = /* @__PURE__ */ __name(async (request, env, {
  fetchImpl = globalThis.fetch,
  now = /* @__PURE__ */ new Date()
} = {}) => {
  const url = new URL(request.url);
  const isHistory = request.method === "GET" && url.pathname === "/api/me/balance/history";
  const isTopUp = request.method === "POST" && url.pathname === "/api/admin/balances/top-up";
  if (!isHistory && !isTopUp) return null;
  const identity = await requireIdentity(request, env, {
    fetchImpl,
    allowViewAs: isHistory,
    now
  });
  if (isHistory) {
    assertCan(identity, ACTIONS.READ_SELF);
    const month = url.searchParams.get("month") || "";
    return jsonResponse(await getBalanceHistory(
      env.DB,
      identity.effectiveSubject.userId,
      month
    ));
  }
  const body = await readJson4(request);
  return jsonResponse(await topUpBalance(env.DB, identity, {
    ...body,
    idempotencyKey: idempotencyKey2(request, body)
  }, now));
}, "handleBalanceRoute");

// src/domain/vendors.js
var rowsFrom5 = /* @__PURE__ */ __name((result) => Array.isArray(result) ? result : Array.isArray(result?.results) ? result.results : [], "rowsFrom");
var VENDOR_COLUMNS = `
  vendor_id, name, description, phone, address, website_url,
  menu_source_url, menu_image_url, menu_updated_at, enabled,
  created_at, updated_at
`;
var EDITABLE_FIELDS = Object.freeze([
  "description",
  "phone",
  "address",
  "website_url",
  "menu_source_url",
  "menu_image_url",
  "menu_updated_at",
  "enabled"
]);
var EDITABLE_FIELD_SET = new Set(EDITABLE_FIELDS);
var URL_FIELDS = /* @__PURE__ */ new Set(["website_url", "menu_source_url", "menu_image_url"]);
var text8 = /* @__PURE__ */ __name((value) => typeof value === "string" ? value.trim() : "", "text");
var urlValue = /* @__PURE__ */ __name((value, code) => {
  const normalized = text8(value);
  if (!normalized) return "";
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw badRequest(code);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw badRequest(code);
  return normalized;
}, "urlValue");
var dateValue = /* @__PURE__ */ __name((value) => {
  const normalized = text8(value);
  if (!normalized) return null;
  if (!isDateOnly(normalized)) throw badRequest("VENDOR_MENU_DATE_INVALID");
  return normalized;
}, "dateValue");
var recentGroupFromRow = /* @__PURE__ */ __name((row, now) => {
  const orderDate = text8(row.order_date);
  if (!isDateOnly(orderDate)) return null;
  const mode = row.mode === "B" ? "B" : "A";
  const info = deadlineInfo(orderDate, mode, now);
  return {
    order_date: orderDate,
    mode,
    deadline: info?.deadline || null,
    is_expired: Boolean(info?.isExpired)
  };
}, "recentGroupFromRow");
var readRecentGroups = /* @__PURE__ */ __name(async (database, name, now) => {
  const candidates = compatibilityVendorCandidates(normalizeMenuVendor(name));
  const placeholders = candidates.map(() => "?").join(", ");
  const result = await database.prepare(`
    SELECT order_date, vendor, mode
    FROM calendar_settings
    WHERE trim(vendor) IN (${placeholders})
      AND length(trim(vendor)) > 0
    ORDER BY order_date DESC
    LIMIT 5
  `).bind(...candidates).all();
  return rowsFrom5(result).map((row) => recentGroupFromRow(row, now)).filter(Boolean);
}, "readRecentGroups");
var withOpenOrdering = /* @__PURE__ */ __name((row, recentGroups, now) => {
  const today = getTaipeiDate(now);
  const isOpenForOrdering = Number(row.enabled) === 1 && recentGroups.some((group) => group.order_date >= today && !group.is_expired);
  return {
    id: row.vendor_id,
    name: normalizeMenuVendor(text8(row.name)),
    description: text8(row.description),
    phone: text8(row.phone),
    address: text8(row.address),
    website_url: text8(row.website_url),
    menu_source_url: text8(row.menu_source_url),
    menu_image_url: text8(row.menu_image_url),
    menu_updated_at: isDateOnly(text8(row.menu_updated_at)) ? text8(row.menu_updated_at) : null,
    enabled: Number(row.enabled) === 1,
    is_open_for_ordering: isOpenForOrdering,
    recent_groups: recentGroups,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}, "withOpenOrdering");
var vendorFromRow = /* @__PURE__ */ __name((row, recentGroups = [], now = /* @__PURE__ */ new Date()) => row ? withOpenOrdering(row, recentGroups, now) : null, "vendorFromRow");
var readVendorRows = /* @__PURE__ */ __name(async (database, where = "", bindings = []) => {
  const result = await database.prepare(`
    SELECT ${VENDOR_COLUMNS}
    FROM vendors
    ${where}
  `).bind(...bindings).all();
  return rowsFrom5(result);
}, "readVendorRows");
var readVendor = /* @__PURE__ */ __name(async (database, vendorId) => {
  const rows = await readVendorRows(database, "WHERE vendor_id = ? LIMIT 1", [vendorId]);
  return rows[0] || null;
}, "readVendor");
var normalizeVendor = /* @__PURE__ */ __name(async (database, row, now) => vendorFromRow(row, await readRecentGroups(database, row.name, now), now), "normalizeVendor");
var listVendors = /* @__PURE__ */ __name(async (database, { now = /* @__PURE__ */ new Date() } = {}) => {
  const rows = await readVendorRows(database, "ORDER BY enabled DESC, name ASC, vendor_id ASC");
  const canonicalRows = /* @__PURE__ */ new Map();
  rows.forEach((row) => {
    const rawName = text8(row.name);
    const canonicalName = normalizeMenuVendor(rawName);
    const existing = canonicalRows.get(canonicalName);
    const isCanonical = rawName === canonicalName;
    const existingIsCanonical = existing && text8(existing.name) === canonicalName;
    if (!existing || isCanonical && !existingIsCanonical) canonicalRows.set(canonicalName, row);
  });
  return {
    vendors: (await Promise.all([...canonicalRows.values()].map((row) => normalizeVendor(database, row, now)))).filter(Boolean)
  };
}, "listVendors");
var getVendor = /* @__PURE__ */ __name(async (database, vendorId, { now = /* @__PURE__ */ new Date() } = {}) => {
  const row = await readVendor(database, vendorId);
  if (!row) throw notFound("VENDOR_NOT_FOUND");
  return normalizeVendor(database, row, now);
}, "getVendor");
var assertKnownFields = /* @__PURE__ */ __name((input) => {
  if (Object.keys(input).some((field) => !EDITABLE_FIELD_SET.has(field))) {
    throw badRequest("VENDOR_UNKNOWN_FIELD");
  }
  if (Object.keys(input).length === 0) throw badRequest("VENDOR_PATCH_EMPTY");
}, "assertKnownFields");
var patchInput = /* @__PURE__ */ __name((input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw badRequest("INVALID_JSON");
  }
  assertKnownFields(input);
  const patch = {};
  for (const field of EDITABLE_FIELDS) {
    if (!(field in input)) continue;
    if (field === "enabled") {
      if (typeof input[field] !== "boolean") throw badRequest("VENDOR_ENABLED_INVALID");
      patch[field] = input[field];
    } else if (URL_FIELDS.has(field)) {
      patch[field] = urlValue(input[field], "VENDOR_URL_INVALID");
    } else if (field === "menu_updated_at") {
      patch[field] = dateValue(input[field]);
    } else {
      patch[field] = text8(input[field]);
    }
  }
  return patch;
}, "patchInput");
var updateVendor = /* @__PURE__ */ __name(async (database, identity, vendorId, input, clock = /* @__PURE__ */ new Date()) => {
  assertCan(identity, ACTIONS.ADMIN_VENDORS);
  const existing = await readVendor(database, vendorId);
  if (!existing) throw notFound("VENDOR_NOT_FOUND");
  const patch = patchInput(input);
  const occurredAt = resolveClock(clock).toISOString();
  const assignments = [];
  const bindings = [];
  for (const field of EDITABLE_FIELDS) {
    if (!(field in patch)) continue;
    assignments.push(`${field} = ?`);
    bindings.push(field === "enabled" ? patch[field] ? 1 : 0 : patch[field]);
  }
  assignments.push("updated_at = ?");
  bindings.push(occurredAt, vendorId);
  const update = prepareStatement(database, `
    UPDATE vendors
    SET ${assignments.join(", ")}
    WHERE vendor_id = ?
  `, bindings);
  const audit = auditStatement(database, {
    auditId: randomId("audit"),
    actorUserId: identity.actor.userId,
    actorAuthMode: identity.actor.authMode,
    actorEmployeeIdSnapshot: identity.actor.employeeId,
    actorLineUserIdSnapshot: identity.actor.lineUserId,
    action: "VENDOR_UPDATED",
    metadata: { vendorId, fields: Object.keys(patch) },
    occurredAt
  });
  await runMutationBatch(database, [update, audit]);
  return getVendor(database, vendorId, { now: resolveClock(clock) });
}, "updateVendor");

// src/routes/vendors.js
var readJson5 = /* @__PURE__ */ __name(async (request) => {
  if (!request.body) throw badRequest("INVALID_JSON");
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("body");
    return value;
  } catch {
    throw badRequest("INVALID_JSON");
  }
}, "readJson");
var vendorIdFromPath = /* @__PURE__ */ __name((pathname, pattern) => {
  const match = pathname.match(pattern);
  if (!match) return null;
  let vendorId;
  try {
    vendorId = decodeURIComponent(match[1]).trim();
  } catch {
    throw badRequest("VENDOR_ID_INVALID");
  }
  if (!vendorId) throw badRequest("VENDOR_ID_REQUIRED");
  return vendorId;
}, "vendorIdFromPath");
var requireRegisteredRead = /* @__PURE__ */ __name((identity) => {
  if (!identity?.actor?.registered) throw forbidden("NOT_REGISTERED");
  assertCan(identity, ACTIONS.READ_SELF);
}, "requireRegisteredRead");
var handleVendorRoute = /* @__PURE__ */ __name(async (request, env, {
  fetchImpl = globalThis.fetch,
  now = /* @__PURE__ */ new Date()
} = {}) => {
  const url = new URL(request.url);
  const isList = request.method === "GET" && url.pathname === "/api/vendors";
  const detailId = request.method === "GET" ? vendorIdFromPath(url.pathname, /^\/api\/vendors\/([^/]+)$/) : null;
  const updateId = request.method === "PATCH" ? vendorIdFromPath(url.pathname, /^\/api\/admin\/vendors\/([^/]+)$/) : null;
  if (!isList && detailId === null && updateId === null) return null;
  const identity = await requireIdentity(request, env, {
    fetchImpl,
    allowViewAs: updateId === null,
    now
  });
  if (isList) {
    requireRegisteredRead(identity);
    return jsonResponse(await listVendors(env.DB, { now }));
  }
  if (detailId !== null) {
    requireRegisteredRead(identity);
    return jsonResponse(await getVendor(env.DB, detailId, { now }));
  }
  return jsonResponse(await updateVendor(
    env.DB,
    identity,
    updateId,
    await readJson5(request),
    now
  ));
}, "handleVendorRoute");

// src/domain/menu.js
var HISTORICAL_MENU_ITEM_CODE_ALIASES = Object.freeze({ R: "FR" });
var menuItemFromResolvedChange = /* @__PURE__ */ __name((change, compatibilityRows, isHistorical) => {
  const matchingRows = compatibilityRows.filter((row) => row.vendor === change.vendor && String(row.item_code ?? row.legacy_item_id) === change.item_code && String(row.variant_key || "") === change.variant_key);
  const compatibility = matchingRows.length === 1 ? matchingRows[0] : null;
  const menuItemId = change.persisted_menu_item_id || compatibility?.persisted_menu_item_id || compatibility?.menu_item_id || change.menu_item_id;
  return {
    menu_item_id: menuItemId,
    item_id: isHistorical ? change.item_code : menuItemId,
    legacy_item_id: change.item_code,
    variant_key: change.variant_key,
    selection_key: isHistorical ? change.item_code : menuItemId,
    item_name: change.item_name,
    price: change.price,
    enabled: change.enabled,
    note: change.note,
    image_url: change.display_image_url || change.image_url
  };
}, "menuItemFromResolvedChange");
var menuItemFromCompatibilityBaseline = /* @__PURE__ */ __name((row, isHistorical) => ({
  menu_item_id: row.menu_item_id,
  item_id: row.item_code,
  legacy_item_id: row.item_code,
  variant_key: row.variant_key,
  selection_key: isHistorical ? row.item_code : row.menu_item_id,
  item_name: row.item_name,
  price: row.price,
  enabled: row.enabled,
  note: row.note,
  image_url: row.display_image_url || row.image_url
}), "menuItemFromCompatibilityBaseline");
var menuFromChanges = /* @__PURE__ */ __name((resolution) => {
  const rows = resolution.rows.length ? resolution.rows : resolution.baselineRows;
  if (!rows.length) return null;
  const isHistorical = resolution.authority === "sql_historical";
  return rows.filter((change) => change.enabled).map((change) => change.source_kind === "compatibility_baseline" ? menuItemFromCompatibilityBaseline(change, isHistorical) : menuItemFromResolvedChange(change, resolution.baselineRows, isHistorical));
}, "menuFromChanges");
var getCustomerMenu = /* @__PURE__ */ __name(async (database, { vendor, targetDate } = {}) => {
  const resolution = await resolveEffectiveMenuState(database, { vendor, targetDate });
  const fromChanges = menuFromChanges(resolution);
  if (fromChanges) return fromChanges;
  return [];
}, "getCustomerMenu");

// src/domain/ordersRead.js
var rowsFrom6 = /* @__PURE__ */ __name((result) => Array.isArray(result) ? result : Array.isArray(result?.results) ? result.results : [], "rowsFrom");
var isHistoricalOrderDate = /* @__PURE__ */ __name((orderDate, now = /* @__PURE__ */ new Date()) => isDateOnly(orderDate) && orderDate < getTaipeiDate(now), "isHistoricalOrderDate");
var orderStatusPredicate = /* @__PURE__ */ __name(({ alias = "o", includeCompleted = false } = {}) => includeCompleted ? `${alias}.status IN ('ACTIVE', 'COMPLETED')` : `${alias}.status = 'ACTIVE'`, "orderStatusPredicate");
var getHistoricalOrdersMap = /* @__PURE__ */ __name(async (database, userId, now = /* @__PURE__ */ new Date()) => {
  const today = getTaipeiDate(now);
  const result = await database.prepare(`
    SELECT order_date
    FROM orders
    WHERE user_id = ?
      AND (
        status = 'ACTIVE'
        OR (status = 'COMPLETED' AND order_date < ?)
      )
    ORDER BY order_date ASC
  `).bind(userId, today).all();
  return rowsFrom6(result).reduce((map, row) => {
    map[row.order_date] = true;
    return map;
  }, {});
}, "getHistoricalOrdersMap");
var textValue = /* @__PURE__ */ __name((value) => String(value ?? ""), "textValue");
var getOrderItemSelectionKey = /* @__PURE__ */ __name((row, menuItems = []) => {
  const directMatch = row?.menu_item_id ? menuItems.find((item) => textValue(item?.menu_item_id) === textValue(row.menu_item_id)) : null;
  if (directMatch) {
    return textValue(directMatch.selection_key || directMatch.menu_item_id || directMatch.item_id) || null;
  }
  const sourceCode = textValue(row?.legacy_item_id);
  const menuCode = HISTORICAL_MENU_ITEM_CODE_ALIASES[sourceCode] || sourceCode;
  const exactMatches = menuItems.filter((item) => textValue(item?.legacy_item_id || item?.item_id) === menuCode && textValue(item?.item_name) === textValue(row?.item_name_snapshot) && Number(item?.price) === Number(row?.unit_price));
  if (exactMatches.length !== 1) return null;
  return textValue(exactMatches[0].selection_key || exactMatches[0].menu_item_id || exactMatches[0].item_id) || null;
}, "getOrderItemSelectionKey");
var getReadableOrder = /* @__PURE__ */ __name(async (database, userId, orderDate, { includeCompleted = false, menuItems = [] } = {}) => {
  const order = await database.prepare(`
    SELECT order_id, order_date, vendor, pickup_floor, note, total_amount,
           status
    FROM orders o
    WHERE o.user_id = ? AND o.order_date = ?
      AND ${orderStatusPredicate({ alias: "o", includeCompleted })}
    ORDER BY created_at DESC, order_id DESC
    LIMIT 1
  `).bind(userId, orderDate).first();
  if (!order) return {
    orderId: "",
    items: [],
    note: "",
    status: null,
    readOnly: false
  };
  const result = await database.prepare(`
    SELECT order_id, line_no, menu_item_id, legacy_item_id,
           item_name_snapshot, quantity, unit_price, subtotal
    FROM order_items
    WHERE order_id = ?
    ORDER BY line_no ASC
  `).bind(order.order_id).all();
  return {
    orderId: order.order_id,
    note: order.note || "",
    status: order.status,
    readOnly: order.status === "COMPLETED",
    totalAmount: Number(order.total_amount),
    items: rowsFrom6(result).map((row) => ({
      order_id: row.order_id,
      menu_item_id: row.menu_item_id,
      item_id: row.legacy_item_id,
      legacy_item_id: row.legacy_item_id,
      selection_key: getOrderItemSelectionKey(row, menuItems),
      item_name: row.item_name_snapshot,
      quantity: Number(row.quantity),
      unit_price: Number(row.unit_price),
      subtotal: Number(row.subtotal)
    }))
  };
}, "getReadableOrder");

// src/domain/adminSummary.js
var rowsFrom7 = /* @__PURE__ */ __name((result) => Array.isArray(result) ? result : Array.isArray(result?.results) ? result.results : [], "rowsFrom");
var memberRows = /* @__PURE__ */ __name(async (database) => {
  const result = await database.prepare(`
    SELECT u.user_id, u.employee_id, u.line_user_id, u.display_name, u.pickup_floor,
           ${currentBalanceProjection("u")} AS balance,
           u.role, u.active, u.verification_status, u.created_at, u.updated_at
    FROM users u
    ORDER BY u.display_name ASC, u.user_id ASC
  `).all();
  return rowsFrom7(result).map((row) => publicUser({
    userId: row.user_id,
    employeeId: row.employee_id,
    lineUserId: row.line_user_id,
    displayName: row.display_name,
    pickupFloor: row.pickup_floor,
    balance: Number(row.balance),
    role: row.role,
    active: Boolean(row.active),
    verificationStatus: row.verification_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}, "memberRows");
var getAdminSummary = /* @__PURE__ */ __name(async (database, identity, targetDate, { includeMemberBalances = false, now = /* @__PURE__ */ new Date() } = {}) => {
  assertCan(identity, ACTIONS.READ_ADMIN_SUMMARY);
  if (!isDateOnly(targetDate)) throw badRequest("INVALID_DATE");
  const includeCompleted = isHistoricalOrderDate(targetDate, now);
  const result = await database.prepare(`
    SELECT o.order_id, o.order_date, o.pickup_floor, o.note, o.created_at,
           o.status,
           u.display_name,
           oi.legacy_item_id, oi.item_name_snapshot, oi.quantity,
           oi.unit_price, oi.subtotal
    FROM orders o
    JOIN users u ON u.user_id = o.user_id
    JOIN order_items oi ON oi.order_id = o.order_id
    WHERE o.order_date = ?
      AND ${orderStatusPredicate({ alias: "o", includeCompleted })}
    ORDER BY o.pickup_floor ASC, o.order_id ASC, oi.line_no ASC
  `).bind(targetDate).all();
  const todayOrders = rowsFrom7(result).map((row) => ({
    order_id: row.order_id,
    name: row.display_name,
    pickup_floor: row.pickup_floor,
    item_id: row.legacy_item_id || "",
    item_name: row.item_name_snapshot,
    quantity: Number(row.quantity),
    unit_price: Number(row.unit_price),
    subtotal: Number(row.subtotal),
    status: row.status,
    readOnly: row.status === "COMPLETED",
    created_at: row.created_at,
    note: row.note || ""
  }));
  const itemMap = /* @__PURE__ */ new Map();
  const pickupSummary = {};
  let totalItems = 0;
  let totalAmount = 0;
  for (const order of todayOrders) {
    const key = order.item_id || order.item_name;
    const item = itemMap.get(key) || {
      item_id: order.item_id,
      item_name: order.item_name,
      quantity: 0,
      totalAmount: 0
    };
    item.quantity += order.quantity;
    item.totalAmount += order.subtotal;
    itemMap.set(key, item);
    totalItems += order.quantity;
    totalAmount += order.subtotal;
    const floor = order.pickup_floor || "\u5176\u4ED6";
    pickupSummary[floor] ||= { totalItems: 0, totalAmount: 0 };
    pickupSummary[floor].totalItems += order.quantity;
    pickupSummary[floor].totalAmount += order.subtotal;
  }
  const canReadMembers = identity.actor.capabilities?.includes(ACTIONS.READ_MEMBER_BALANCES) && (includeMemberBalances || Boolean(identity.viewAs));
  if (canReadMembers || identity.viewAs) {
    await appendAuditEvent(database, {
      actorUserId: identity.authorizationActor.userId,
      actorAuthMode: identity.authorizationActor.authMode,
      actorEmployeeIdSnapshot: identity.authorizationActor.employeeId,
      actorLineUserIdSnapshot: identity.authorizationActor.lineUserId,
      targetUserId: identity.effectiveSubject.userId,
      targetEmployeeIdSnapshot: identity.effectiveSubject.employeeId,
      targetLineUserIdSnapshot: identity.effectiveSubject.lineUserId,
      action: identity.viewAs ? "VIEW_AS_ADMIN_SUMMARY" : "ADMIN_SUMMARY_READ",
      metadata: { targetDate, includeMemberBalances: canReadMembers },
      occurredAt: now.toISOString()
    });
  }
  return {
    success: true,
    targetDate,
    requesterRole: identity.authorizationActor.role,
    usersSummary: canReadMembers ? await memberRows(database) : [],
    todayOrders,
    totalItems,
    totalAmount,
    items: [...itemMap.values()],
    pickupSummary
  };
}, "getAdminSummary");
var getMemberBalances = /* @__PURE__ */ __name(async (database, identity, now = /* @__PURE__ */ new Date()) => {
  assertCan(identity, ACTIONS.READ_MEMBER_BALANCES);
  await appendAuditEvent(database, {
    actorUserId: identity.authorizationActor.userId,
    actorAuthMode: identity.authorizationActor.authMode,
    actorEmployeeIdSnapshot: identity.authorizationActor.employeeId,
    actorLineUserIdSnapshot: identity.authorizationActor.lineUserId,
    targetUserId: identity.viewAs?.targetUserId || null,
    targetEmployeeIdSnapshot: identity.viewAs ? identity.effectiveSubject.employeeId : null,
    targetLineUserIdSnapshot: identity.viewAs ? identity.effectiveSubject.lineUserId : null,
    action: identity.viewAs ? "VIEW_AS_MEMBER_BALANCES_READ" : "MEMBER_BALANCES_READ",
    metadata: {},
    occurredAt: now.toISOString()
  });
  const members = await memberRows(database);
  return {
    success: true,
    requesterRole: identity.authorizationActor.role,
    members,
    users: members
  };
}, "getMemberBalances");

// src/domain/adminIdentity.js
var statementChanges2 = /* @__PURE__ */ __name((result) => Number(
  result?.meta?.changes ?? result?.changes ?? 0
), "statementChanges");
var auditInput = /* @__PURE__ */ __name(({
  identity,
  target,
  employeeIdDigest,
  decision,
  result,
  occurredAt,
  onlyIfPriorMutation = false
}) => ({
  actorUserId: identity.authorizationActor.userId,
  actorAuthMode: identity.authorizationActor.authMode,
  actorEmployeeIdSnapshot: identity.authorizationActor.employeeId,
  actorLineUserIdSnapshot: identity.authorizationActor.lineUserId,
  targetUserId: target.userId,
  targetEmployeeIdSnapshot: target.employeeId,
  targetLineUserIdSnapshot: target.lineUserId,
  action: "ADMIN_EMPLOYEE_BIND",
  metadata: {
    submittedEmployeeIdDigest: employeeIdDigest,
    verificationDecision: decision.decision,
    verificationReason: decision.reason,
    verificationStatus: decision.verificationStatus,
    result
  },
  occurredAt,
  onlyIfPriorMutation
}), "auditInput");
var alreadyBound = /* @__PURE__ */ __name(async (database, identity, target, employeeIdDigest, now) => {
  const decision = {
    decision: VERIFICATION_DECISIONS.NO_CHANGE,
    reason: "ALREADY_BOUND",
    verificationStatus: target.verificationStatus
  };
  await appendAuditEvent(database, auditInput({
    identity,
    target,
    employeeIdDigest,
    decision,
    result: "ALREADY_BOUND",
    occurredAt: now
  }));
  return {
    success: true,
    status: "ALREADY_BOUND",
    verificationDecision: decision.decision,
    verificationStatus: target.verificationStatus,
    identityState: publicUser(target).identityState,
    user: publicUser(target)
  };
}, "alreadyBound");
var adminBindEmployee = /* @__PURE__ */ __name(async (database, identity, targetUserId, { employeeId: employeeIdInput } = {}, clock = /* @__PURE__ */ new Date()) => {
  const actor = identity?.authorizationActor;
  const registeredAdmin = Boolean(
    isRegisteredLinePrincipal(actor) && actor.role === "Admin"
  );
  if (!registeredAdmin) {
    throw forbidden("ADMIN_LINE_AUTH_REQUIRED");
  }
  assertCan(identity, ACTIONS.ADMIN_EMPLOYEE_BIND);
  const targetId = String(targetUserId || "").trim();
  if (!targetId) throw notFound("USER_NOT_FOUND");
  const employeeId = employeeIdText(employeeIdInput);
  const timestamp2 = resolveClock(clock).toISOString();
  const target = await getUserById(database, targetId);
  if (!target) throw notFound("USER_NOT_FOUND");
  if (!target.active) throw conflict("EMPLOYEE_INACTIVE");
  const employeeIdDigest = await digestEmployeeId(employeeId);
  if (target.employeeId) {
    if (sameEmployeeId(target.employeeId, employeeId)) {
      return alreadyBound(database, identity, target, employeeIdDigest, timestamp2);
    }
    throw conflict("USER_EMPLOYEE_ALREADY_BOUND");
  }
  const owner = await getUserByEmployeeId(database, employeeId);
  if (owner && owner.userId !== target.userId) {
    throw conflict("EMPLOYEE_ID_ALREADY_BOUND");
  }
  const decision = {
    decision: VERIFICATION_DECISIONS.NO_CHANGE,
    reason: "LEGACY_COMPATIBILITY_UNCHANGED",
    verificationStatus: target.verificationStatus
  };
  const update = prepareStatement(database, `
    UPDATE users
    SET employee_id = ?, updated_at = ?
    WHERE user_id = ? AND employee_id IS NULL AND active = 1
  `, [employeeId, timestamp2, target.userId]);
  const audit = auditStatement(database, auditInput({
    identity,
    target,
    employeeIdDigest,
    decision,
    result: "BOUND",
    occurredAt: timestamp2,
    onlyIfPriorMutation: true
  }));
  try {
    const [updateResult] = await runMutationBatch(database, [update, audit]);
    if (statementChanges2(updateResult) !== 1) {
      const replay = await getUserById(database, target.userId);
      if (sameEmployeeId(replay?.employeeId, employeeId)) {
        return alreadyBound(database, identity, replay, employeeIdDigest, timestamp2);
      }
      const conflicting = await getUserByEmployeeId(database, employeeId);
      if (conflicting && conflicting.userId !== target.userId) {
        throw conflict("EMPLOYEE_ID_ALREADY_BOUND");
      }
      throw conflict("EMPLOYEE_BIND_CONFLICT");
    }
  } catch (error) {
    if (error?.status === 409) throw error;
    if (/unique|constraint/i.test(error?.message || error?.cause?.message || "")) {
      const conflicting = await getUserByEmployeeId(database, employeeId);
      if (conflicting?.userId === target.userId) {
        return alreadyBound(database, identity, conflicting, employeeIdDigest, timestamp2);
      }
      throw conflict("EMPLOYEE_ID_ALREADY_BOUND");
    }
    throw error;
  }
  const bound = await getUserById(database, target.userId);
  if (!bound || !sameEmployeeId(bound.employeeId, employeeId)) throw conflict("EMPLOYEE_BIND_CONFLICT");
  return {
    success: true,
    status: "BOUND",
    verificationDecision: decision.decision,
    verificationStatus: bound.verificationStatus,
    identityState: publicUser(bound).identityState,
    user: publicUser(bound)
  };
}, "adminBindEmployee");

// src/domain/announcements.js
var rowsFrom8 = /* @__PURE__ */ __name((result) => Array.isArray(result) ? result : Array.isArray(result?.results) ? result.results : [], "rowsFrom");
var EDITABLE_FIELDS2 = Object.freeze([
  "title",
  "content",
  "start_date",
  "end_date",
  "enabled",
  "images"
]);
var editableFieldSet = new Set(EDITABLE_FIELDS2);
var text9 = /* @__PURE__ */ __name((value) => typeof value === "string" ? value.trim() : "", "text");
var assertKnownFields2 = /* @__PURE__ */ __name((input) => {
  if (Object.keys(input).some((field) => !editableFieldSet.has(field))) {
    throw badRequest("ANNOUNCEMENT_UNKNOWN_FIELD");
  }
}, "assertKnownFields");
var requiredText2 = /* @__PURE__ */ __name((value, code) => {
  const normalized = text9(value);
  if (!normalized) throw badRequest(code);
  return normalized;
}, "requiredText");
var dateValue2 = /* @__PURE__ */ __name((value) => {
  const normalized = text9(value);
  if (!isDateOnly(normalized)) throw badRequest("INVALID_DATE");
  return normalized;
}, "dateValue");
var enabledValue = /* @__PURE__ */ __name((value) => {
  if (typeof value !== "boolean") throw badRequest("ANNOUNCEMENT_ENABLED_INVALID");
  return value;
}, "enabledValue");
var imageUrlsValue = /* @__PURE__ */ __name((value) => {
  if (value === void 0) return [];
  if (!Array.isArray(value) || value.length > 8) {
    throw badRequest("ANNOUNCEMENT_IMAGES_INVALID");
  }
  const normalized = value.map((item) => text9(item)).filter(Boolean);
  if (normalized.length !== value.length || new Set(normalized).size !== normalized.length) {
    throw badRequest("ANNOUNCEMENT_IMAGES_INVALID");
  }
  for (const imageUrl of normalized) {
    if (imageUrl.length > 2e3) throw badRequest("ANNOUNCEMENT_IMAGES_INVALID");
    let parsed;
    try {
      parsed = new URL(imageUrl);
    } catch {
      throw badRequest("ANNOUNCEMENT_IMAGES_INVALID");
    }
    if (parsed.protocol !== "https:") throw badRequest("ANNOUNCEMENT_IMAGES_INVALID");
  }
  return normalized;
}, "imageUrlsValue");
var parseStoredImages = /* @__PURE__ */ __name((value) => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string" && item) : [];
  } catch {
    return [];
  }
}, "parseStoredImages");
var assertDateRange = /* @__PURE__ */ __name((startDate, endDate) => {
  if (endDate < startDate) throw badRequest("ANNOUNCEMENT_DATE_RANGE_INVALID");
}, "assertDateRange");
var adminAnnouncement = /* @__PURE__ */ __name((row) => ({
  id: row.announcement_id,
  title: row.title,
  content: row.content,
  start_date: row.start_date,
  end_date: row.end_date,
  enabled: Number(row.enabled) === 1,
  images: parseStoredImages(row.image_urls_json)
}), "adminAnnouncement");
var getAnnouncementRow = /* @__PURE__ */ __name(async (database, id) => database.prepare(`
  SELECT announcement_id, title, content, start_date, end_date, enabled, source_order, image_urls_json
  FROM announcements
  WHERE announcement_id = ?
`).bind(id).first(), "getAnnouncementRow");
var createInput2 = /* @__PURE__ */ __name((input) => {
  assertKnownFields2(input);
  const title = requiredText2(input.title, "ANNOUNCEMENT_TITLE_REQUIRED");
  const content = requiredText2(input.content, "ANNOUNCEMENT_CONTENT_REQUIRED");
  const start_date = dateValue2(input.start_date);
  const end_date = dateValue2(input.end_date);
  assertDateRange(start_date, end_date);
  const enabled = input.enabled === void 0 ? true : enabledValue(input.enabled);
  const images = imageUrlsValue(input.images);
  return { title, content, start_date, end_date, enabled, images };
}, "createInput");
var patchInput2 = /* @__PURE__ */ __name((input, existing) => {
  assertKnownFields2(input);
  if (Object.keys(input).length === 0) throw badRequest("ANNOUNCEMENT_PATCH_EMPTY");
  const patch = {};
  if ("title" in input) patch.title = requiredText2(input.title, "ANNOUNCEMENT_TITLE_REQUIRED");
  if ("content" in input) patch.content = requiredText2(input.content, "ANNOUNCEMENT_CONTENT_REQUIRED");
  if ("start_date" in input) patch.start_date = dateValue2(input.start_date);
  if ("end_date" in input) patch.end_date = dateValue2(input.end_date);
  if ("enabled" in input) patch.enabled = enabledValue(input.enabled);
  if ("images" in input) patch.images = imageUrlsValue(input.images);
  const startDate = patch.start_date || existing.start_date;
  const endDate = patch.end_date || existing.end_date;
  if (!isDateOnly(startDate) || !isDateOnly(endDate)) throw badRequest("INVALID_DATE");
  assertDateRange(startDate, endDate);
  return patch;
}, "patchInput");
var getActiveAnnouncements = /* @__PURE__ */ __name(async (database, now = /* @__PURE__ */ new Date()) => {
  const today = getTaipeiDate(now);
  const result = await database.prepare(`
    SELECT announcement_id, title, content, start_date, end_date, enabled, source_order, image_urls_json
    FROM announcements
    WHERE enabled = 1
    ORDER BY start_date DESC, source_order DESC
  `).all();
  return rowsFrom8(result).filter((row) => isDateOnly(row.start_date) && isDateOnly(row.end_date) && row.start_date <= today && today <= row.end_date).map((row) => ({
    id: row.announcement_id,
    title: row.title,
    content: row.content,
    start_date: row.start_date,
    end_date: row.end_date,
    images: parseStoredImages(row.image_urls_json)
  }));
}, "getActiveAnnouncements");
var getAdminAnnouncements = /* @__PURE__ */ __name(async (database, identity) => {
  assertCan(identity, ACTIONS.ADMIN_ANNOUNCEMENTS);
  const result = await database.prepare(`
    SELECT announcement_id, title, content, start_date, end_date, enabled, source_order, image_urls_json
    FROM announcements
    ORDER BY start_date DESC, source_order DESC, announcement_id DESC
  `).all();
  return { announcements: rowsFrom8(result).map(adminAnnouncement) };
}, "getAdminAnnouncements");
var createAnnouncement = /* @__PURE__ */ __name(async (database, identity, input, clock = /* @__PURE__ */ new Date()) => {
  assertCan(identity, ACTIONS.ADMIN_ANNOUNCEMENTS);
  const values = createInput2(input);
  const announcementId = randomId("announcement");
  const occurredAt = resolveClock(clock).toISOString();
  const insert = prepareStatement(database, `
    INSERT INTO announcements (
      announcement_id, title, content, start_date, end_date, enabled,
      image_urls_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    announcementId,
    values.title,
    values.content,
    values.start_date,
    values.end_date,
    values.enabled ? 1 : 0,
    JSON.stringify(values.images),
    occurredAt,
    occurredAt
  ]);
  const audit = auditStatement(database, {
    actorUserId: identity.actor.userId,
    actorAuthMode: identity.actor.authMode,
    actorEmployeeIdSnapshot: identity.actor.employeeId,
    actorLineUserIdSnapshot: identity.actor.lineUserId,
    action: "ANNOUNCEMENT_CREATED",
    metadata: { announcementId },
    occurredAt
  });
  await runMutationBatch(database, [insert, audit]);
  return adminAnnouncement(await getAnnouncementRow(database, announcementId));
}, "createAnnouncement");
var updateAnnouncement = /* @__PURE__ */ __name(async (database, identity, announcementId, input, clock = /* @__PURE__ */ new Date()) => {
  assertCan(identity, ACTIONS.ADMIN_ANNOUNCEMENTS);
  const existing = await getAnnouncementRow(database, announcementId);
  if (!existing) throw notFound("ANNOUNCEMENT_NOT_FOUND");
  const patch = patchInput2(input, existing);
  const occurredAt = resolveClock(clock).toISOString();
  const assignments = [];
  const bindings = [];
  for (const field of EDITABLE_FIELDS2) {
    if (!(field in patch)) continue;
    if (field === "images") {
      assignments.push("image_urls_json = ?");
      bindings.push(JSON.stringify(patch.images));
      continue;
    }
    assignments.push(`${field} = ?`);
    bindings.push(field === "enabled" ? patch[field] ? 1 : 0 : patch[field]);
  }
  assignments.push("updated_at = ?");
  bindings.push(occurredAt, announcementId);
  const update = prepareStatement(database, `
    UPDATE announcements
    SET ${assignments.join(", ")}
    WHERE announcement_id = ?
  `, bindings);
  const audit = auditStatement(database, {
    actorUserId: identity.actor.userId,
    actorAuthMode: identity.actor.authMode,
    actorEmployeeIdSnapshot: identity.actor.employeeId,
    actorLineUserIdSnapshot: identity.actor.lineUserId,
    action: "ANNOUNCEMENT_UPDATED",
    metadata: { announcementId, fields: Object.keys(patch) },
    occurredAt
  });
  await runMutationBatch(database, [update, audit]);
  return adminAnnouncement(await getAnnouncementRow(database, announcementId));
}, "updateAnnouncement");
var deleteAnnouncement = /* @__PURE__ */ __name(async (database, identity, announcementId, clock = /* @__PURE__ */ new Date()) => {
  assertCan(identity, ACTIONS.ADMIN_ANNOUNCEMENTS);
  const existing = await getAnnouncementRow(database, announcementId);
  if (!existing) throw notFound("ANNOUNCEMENT_NOT_FOUND");
  const occurredAt = resolveClock(clock).toISOString();
  const remove = prepareStatement(database, `
    DELETE FROM announcements WHERE announcement_id = ?
  `, [announcementId]);
  const audit = auditStatement(database, {
    actorUserId: identity.actor.userId,
    actorAuthMode: identity.actor.authMode,
    actorEmployeeIdSnapshot: identity.actor.employeeId,
    actorLineUserIdSnapshot: identity.actor.lineUserId,
    action: "ANNOUNCEMENT_DELETED",
    metadata: { announcementId },
    occurredAt
  });
  await runMutationBatch(database, [remove, audit]);
}, "deleteAnnouncement");

// src/domain/caiTeacherDailyFlavorParser.js
var CAI_TEACHER_DAILY_FLAVOR_SOURCE_URL = "https://www.vegetsai.com.tw/products.html#specials";
var SOURCE_IMAGE_BASE_URL = "https://www.vegetsai.com.tw/img/sp_meals_s/";
var MAX_HTML_LENGTH = 2 * 1024 * 1024;
var MAX_ROW_COUNT = 500;
var DailyFlavorParseError = class extends Error {
  static {
    __name(this, "DailyFlavorParseError");
  }
  constructor(code, stage = "parse") {
    super(code);
    this.name = "DailyFlavorParseError";
    this.code = code;
    this.stage = stage;
  }
};
var parseError = /* @__PURE__ */ __name((code, stage) => {
  throw new DailyFlavorParseError(code, stage);
}, "parseError");
var isWhitespace = /* @__PURE__ */ __name((character) => /\s/u.test(character || ""), "isWhitespace");
var parseStringLiteral = /* @__PURE__ */ __name((source, state) => {
  if (source[state.index] !== '"') parseError("DAILY_FLAVOR_MENU_DATA_INVALID");
  const start = state.index;
  state.index += 1;
  let escaped = false;
  while (state.index < source.length) {
    const character = source[state.index];
    if (escaped) {
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === '"') {
      state.index += 1;
      try {
        return JSON.parse(source.slice(start, state.index));
      } catch {
        parseError("DAILY_FLAVOR_MENU_DATA_INVALID");
      }
    }
    state.index += 1;
  }
  return parseError("DAILY_FLAVOR_MENU_DATA_INVALID");
}, "parseStringLiteral");
var skipWhitespace = /* @__PURE__ */ __name((source, state) => {
  while (isWhitespace(source[state.index])) state.index += 1;
}, "skipWhitespace");
var parseObject = /* @__PURE__ */ __name((source, state) => {
  if (source[state.index] !== "{") parseError("DAILY_FLAVOR_MENU_DATA_INVALID");
  state.index += 1;
  const values = /* @__PURE__ */ Object.create(null);
  let propertyCount = 0;
  while (state.index < source.length) {
    skipWhitespace(source, state);
    if (source[state.index] === "}") {
      state.index += 1;
      if (propertyCount === 0) parseError("DAILY_FLAVOR_MENU_DATA_INVALID");
      return values;
    }
    const keyMatch = source.slice(state.index).match(/^[A-Za-z_$][\w$]*/u);
    if (!keyMatch) parseError("DAILY_FLAVOR_MENU_DATA_INVALID");
    const key = keyMatch[0];
    if (Object.hasOwn(values, key)) parseError("DAILY_FLAVOR_MENU_DATA_INVALID");
    state.index += key.length;
    skipWhitespace(source, state);
    if (source[state.index] !== ":") parseError("DAILY_FLAVOR_MENU_DATA_INVALID");
    state.index += 1;
    skipWhitespace(source, state);
    values[key] = parseStringLiteral(source, state);
    propertyCount += 1;
    skipWhitespace(source, state);
    if (source[state.index] === ",") {
      state.index += 1;
      continue;
    }
    if (source[state.index] !== "}") parseError("DAILY_FLAVOR_MENU_DATA_INVALID");
  }
  return parseError("DAILY_FLAVOR_MENU_DATA_INVALID");
}, "parseObject");
var readMenuDataArray = /* @__PURE__ */ __name((script) => {
  const assignments = Array.from(script.matchAll(/\bconst\s+menuData\s*=\s*/gu));
  if (assignments.length !== 1) parseError("DAILY_FLAVOR_MENU_DATA_AMBIGUOUS");
  const state = { index: assignments[0].index + assignments[0][0].length };
  if (script[state.index] !== "[") parseError("DAILY_FLAVOR_MENU_DATA_INVALID");
  state.index += 1;
  const records = [];
  const finishArray = /* @__PURE__ */ __name(() => {
    state.index += 1;
    skipWhitespace(script, state);
    if (script[state.index] !== ";") parseError("DAILY_FLAVOR_MENU_DATA_INVALID");
    if (records.length === 0) parseError("DAILY_FLAVOR_ROWS_EMPTY", "validate");
    return records;
  }, "finishArray");
  while (state.index < script.length) {
    skipWhitespace(script, state);
    if (script[state.index] === "]") return finishArray();
    records.push(parseObject(script, state));
    if (records.length > MAX_ROW_COUNT) parseError("DAILY_FLAVOR_ROW_COUNT_INVALID", "validate");
    skipWhitespace(script, state);
    if (script[state.index] === "]") return finishArray();
    if (script[state.index] !== ",") parseError("DAILY_FLAVOR_MENU_DATA_INVALID");
    state.index += 1;
    skipWhitespace(script, state);
    if (script[state.index] === "]") return finishArray();
  }
  return parseError("DAILY_FLAVOR_MENU_DATA_INVALID");
}, "readMenuDataArray");
var normalizeServiceDate = /* @__PURE__ */ __name((value) => {
  const match = String(value || "").trim().match(/^(\d{4})\/(\d{2})\/(\d{2})$/u);
  if (!match) parseError("DAILY_FLAVOR_DATE_INVALID", "validate");
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const isoDate = `${yearText}-${monthText}-${dayText}`;
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (parsedDate.getUTCFullYear() !== year || parsedDate.getUTCMonth() + 1 !== month || parsedDate.getUTCDate() !== day) {
    parseError("DAILY_FLAVOR_DATE_INVALID", "validate");
  }
  return isoDate;
}, "normalizeServiceDate");
var toDailyFlavorRow = /* @__PURE__ */ __name((record) => {
  const flavorName = String(record.title || "").trim();
  if (!flavorName || flavorName.length > 160) {
    parseError("DAILY_FLAVOR_NAME_MISSING", "validate");
  }
  const imageFile = String(record.img || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\.(?:jpe?g|png|webp|avif)$/iu.test(imageFile)) {
    parseError("DAILY_FLAVOR_IMAGE_INVALID", "validate");
  }
  const description = String(record.note || "").trim();
  if (description.length > 500) parseError("DAILY_FLAVOR_DESCRIPTION_INVALID", "validate");
  return {
    service_date: normalizeServiceDate(record.date),
    flavor_name: flavorName,
    description,
    image_url: `${SOURCE_IMAGE_BASE_URL}${imageFile}`
  };
}, "toDailyFlavorRow");
var parseCaiTeacherDailyFlavorHtml = /* @__PURE__ */ __name((html) => {
  if (typeof html !== "string" || !html.trim()) {
    parseError("DAILY_FLAVOR_HTML_INVALID");
  }
  if (html.length > MAX_HTML_LENGTH) parseError("DAILY_FLAVOR_HTML_TOO_LARGE");
  const scripts = Array.from(html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/giu)).map((match) => match[1]).filter((script) => /\bconst\s+menuData\s*=/u.test(script));
  if (scripts.length === 0) parseError("DAILY_FLAVOR_MENU_DATA_NOT_FOUND");
  if (scripts.length !== 1) parseError("DAILY_FLAVOR_MENU_DATA_AMBIGUOUS");
  const records = readMenuDataArray(scripts[0]);
  const seenDates = /* @__PURE__ */ new Set();
  return records.map((record) => {
    const row = toDailyFlavorRow(record);
    if (seenDates.has(row.service_date)) {
      parseError("DAILY_FLAVOR_DATE_DUPLICATE", "validate");
    }
    seenDates.add(row.service_date);
    return row;
  });
}, "parseCaiTeacherDailyFlavorHtml");

// src/domain/dailyFlavors.js
var SOURCE_URL_FOR_FETCH = CAI_TEACHER_DAILY_FLAVOR_SOURCE_URL.split("#")[0];
var FLAVOR_ITEM_CODES = /* @__PURE__ */ new Set(["E", "A", "AM"]);
var resultCounts = /* @__PURE__ */ __name(() => ({
  parsedCount: 0,
  consideredCount: 0,
  addedCount: 0,
  updatedCount: 0,
  unchangedCount: 0
}), "resultCounts");
var sha256 = /* @__PURE__ */ __name(async (value) => {
  if (typeof globalThis.crypto?.subtle?.digest !== "function") {
    throw Object.assign(new Error("DAILY_FLAVOR_HASH_UNAVAILABLE"), {
      code: "DAILY_FLAVOR_HASH_UNAVAILABLE",
      stage: "hash"
    });
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}, "sha256");
var sourceHashFor = /* @__PURE__ */ __name((row) => sha256(JSON.stringify([
  row.service_date,
  row.flavor_name,
  row.description,
  row.image_url
])), "sourceHashFor");
var countResult = /* @__PURE__ */ __name((counts, status, errorCode = null) => ({
  status,
  ...counts,
  errorCode
}), "countResult");
var runCaiTeacherDailyFlavorSync = /* @__PURE__ */ __name(async (database, { fetchImpl = globalThis.fetch, now = /* @__PURE__ */ new Date() } = {}) => {
  const instant = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (Number.isNaN(instant.getTime())) throw new TypeError("A valid sync time is required.");
  const startedAt = instant.toISOString();
  const runId = randomId("daily-flavor-run");
  const counts = resultCounts();
  await database.prepare(`
    INSERT INTO vendor_daily_flavor_sync_runs (
      run_id, vendor, source_url, started_at, status, stage
    ) VALUES (?, ?, ?, ?, 'RUNNING', 'fetch')
  `).bind(runId, HISTORICAL_SQL_VENDOR, CAI_TEACHER_DAILY_FLAVOR_SOURCE_URL, startedAt).run();
  const finish = /* @__PURE__ */ __name(async (status, stage, errorCode = null) => {
    await database.prepare(`
      UPDATE vendor_daily_flavor_sync_runs
      SET finished_at = ?, status = ?, stage = ?, error_code = ?,
          parsed_count = ?, considered_count = ?, added_count = ?,
          updated_count = ?, unchanged_count = ?
      WHERE run_id = ?
    `).bind(
      instant.toISOString(),
      status,
      stage,
      errorCode,
      counts.parsedCount,
      counts.consideredCount,
      counts.addedCount,
      counts.updatedCount,
      counts.unchangedCount,
      runId
    ).run();
    return countResult(counts, status, errorCode);
  }, "finish");
  try {
    const response = await fetchImpl(SOURCE_URL_FOR_FETCH, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.7",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36"
      },
      redirect: "follow"
    });
    if (!response?.ok) return await finish("FAILED", "fetch", "DAILY_FLAVOR_SOURCE_UNAVAILABLE");
    const html = await response.text();
    let parsedRows;
    try {
      parsedRows = parseCaiTeacherDailyFlavorHtml(html);
    } catch (error) {
      if (error instanceof DailyFlavorParseError) {
        counts.parsedCount = 0;
        return await finish("FAILED", error.stage, error.code);
      }
      throw error;
    }
    counts.parsedCount = parsedRows.length;
    const serviceDate = getTaipeiDate(instant);
    const eligibleRows = parsedRows.filter((row) => row.service_date >= serviceDate);
    if (!eligibleRows.length) {
      return await finish("FAILED", "validate", "DAILY_FLAVOR_FUTURE_ROWS_EMPTY");
    }
    counts.consideredCount = eligibleRows.length;
    const rowsWithHash = await Promise.all(eligibleRows.map(async (row) => ({
      ...row,
      source_hash: await sourceHashFor(row)
    })));
    const existingResult = await database.prepare(`
      SELECT service_date, source_hash
      FROM vendor_daily_flavors
      WHERE vendor = ?
    `).bind(HISTORICAL_SQL_VENDOR).all();
    const existing = new Map((existingResult?.results || []).map((row) => [row.service_date, row.source_hash]));
    const changedRows = [];
    for (const row of rowsWithHash) {
      const oldHash = existing.get(row.service_date);
      if (oldHash === void 0) {
        counts.addedCount += 1;
        changedRows.push(row);
      } else if (oldHash !== row.source_hash) {
        counts.updatedCount += 1;
        changedRows.push(row);
      } else {
        counts.unchangedCount += 1;
      }
    }
    if (changedRows.length) {
      const fetchedAt = instant.toISOString();
      const statements = changedRows.map((row) => database.prepare(`
        INSERT INTO vendor_daily_flavors (
          vendor, service_date, flavor_name, description, image_url,
          source_url, source_hash, fetched_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(vendor, service_date) DO UPDATE SET
          flavor_name = excluded.flavor_name,
          description = excluded.description,
          image_url = excluded.image_url,
          source_url = excluded.source_url,
          source_hash = excluded.source_hash,
          fetched_at = excluded.fetched_at,
          updated_at = excluded.updated_at
        WHERE vendor_daily_flavors.source_hash <> excluded.source_hash
      `).bind(
        HISTORICAL_SQL_VENDOR,
        row.service_date,
        row.flavor_name,
        row.description,
        row.image_url,
        CAI_TEACHER_DAILY_FLAVOR_SOURCE_URL,
        row.source_hash,
        fetchedAt,
        fetchedAt,
        fetchedAt
      ));
      await runMutationBatch(database, statements);
    }
    return await finish("SUCCESS", "complete");
  } catch (error) {
    const stage = error?.stage || (error?.code === "TRANSACTION_FAILED" ? "write" : "fetch");
    const errorCode = error?.code === "DAILY_FLAVOR_HASH_UNAVAILABLE" ? error.code : stage === "write" ? "DAILY_FLAVOR_WRITE_FAILED" : stage === "hash" ? "DAILY_FLAVOR_HASH_FAILED" : "DAILY_FLAVOR_FETCH_FAILED";
    return await finish("FAILED", stage, errorCode);
  }
}, "runCaiTeacherDailyFlavorSync");
var getCaiTeacherDailyFlavor = /* @__PURE__ */ __name(async (database, { vendor, targetDate, menu } = {}) => {
  if (normalizeMenuVendor(vendor) !== HISTORICAL_SQL_VENDOR || !isDateOnly(targetDate) || !Array.isArray(menu) || !menu.some((item) => FLAVOR_ITEM_CODES.has(String(item?.legacy_item_id || "").trim().toUpperCase()))) return null;
  const row = await database.prepare(`
    SELECT service_date, flavor_name, description, image_url
    FROM vendor_daily_flavors
    WHERE vendor = ? AND service_date = ?
    LIMIT 1
  `).bind(HISTORICAL_SQL_VENDOR, targetDate).first();
  if (!row) return null;
  return {
    service_date: row.service_date,
    name: row.flavor_name,
    description: row.description,
    image_url: row.image_url
  };
}, "getCaiTeacherDailyFlavor");
var getDailyFlavorSyncStatus = /* @__PURE__ */ __name(async (database, now = /* @__PURE__ */ new Date()) => {
  const serviceDate = getTaipeiDate(now instanceof Date ? now : new Date(now));
  const [countRow, run] = await Promise.all([
    database.prepare(`
      SELECT COUNT(*) AS count
      FROM vendor_daily_flavors
      WHERE vendor = ? AND service_date >= ?
    `).bind(HISTORICAL_SQL_VENDOR, serviceDate).first(),
    database.prepare(`
      SELECT status, stage, error_code, started_at, finished_at,
             parsed_count, considered_count, added_count, updated_count, unchanged_count
      FROM vendor_daily_flavor_sync_runs
      WHERE vendor = ?
      ORDER BY started_at DESC, run_id DESC
      LIMIT 1
    `).bind(HISTORICAL_SQL_VENDOR).first()
  ]);
  return {
    success: true,
    availableDateCount: Number(countRow?.count || 0),
    lastRun: run ? {
      status: run.status,
      stage: run.stage,
      errorCode: run.error_code || null,
      startedAt: run.started_at,
      finishedAt: run.finished_at,
      parsedCount: run.parsed_count,
      consideredCount: run.considered_count,
      addedCount: run.added_count,
      updatedCount: run.updated_count,
      unchangedCount: run.unchanged_count
    } : null
  };
}, "getDailyFlavorSyncStatus");

// src/routes/admin.js
var asBoolean = /* @__PURE__ */ __name((value) => value === true || String(value).toLowerCase() === "true", "asBoolean");
var readJson6 = /* @__PURE__ */ __name(async (request) => {
  if (!request.body) throw badRequest("INVALID_JSON");
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("body");
    return value;
  } catch {
    throw badRequest("INVALID_JSON");
  }
}, "readJson");
var announcementIdFromPath = /* @__PURE__ */ __name((pathname, method) => {
  if (!["PATCH", "DELETE"].includes(method)) return null;
  const match = pathname.match(/^\/api\/admin\/announcements\/([^/]+)$/);
  if (!match) return null;
  let id;
  try {
    id = decodeURIComponent(match[1]).trim();
  } catch {
    throw badRequest("ANNOUNCEMENT_ID_INVALID");
  }
  if (!id) throw badRequest("ANNOUNCEMENT_ID_REQUIRED");
  return id;
}, "announcementIdFromPath");
var handleAdminRoute = /* @__PURE__ */ __name(async (request, env, {
  fetchImpl = globalThis.fetch,
  now = /* @__PURE__ */ new Date()
} = {}) => {
  const url = new URL(request.url);
  const isSummary = request.method === "GET" && url.pathname === "/api/admin/summary";
  const isMembers = request.method === "GET" && url.pathname === "/api/admin/members/balances";
  const bindingMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/employee-binding$/);
  const isEmployeeBinding = request.method === "POST" && Boolean(bindingMatch);
  const isAnnouncementList = request.method === "GET" && url.pathname === "/api/admin/announcements";
  const isAnnouncementCreate = request.method === "POST" && url.pathname === "/api/admin/announcements";
  const isAnnouncementMutation = ["PATCH", "DELETE"].includes(request.method);
  const isAnnouncementMissingId = isAnnouncementMutation && url.pathname === "/api/admin/announcements/";
  const announcementId = announcementIdFromPath(url.pathname, request.method);
  const isAnnouncementUpdate = request.method === "PATCH" && announcementId !== null;
  const isAnnouncementDelete = request.method === "DELETE" && announcementId !== null;
  const isAnnouncementRoute = isAnnouncementList || isAnnouncementCreate || isAnnouncementUpdate || isAnnouncementDelete || isAnnouncementMissingId;
  const isMenuChangeList = request.method === "GET" && url.pathname === "/api/admin/menu/changes";
  const isMenuChangeCreate = request.method === "POST" && url.pathname === "/api/admin/menu/changes";
  const isMenuPreview = request.method === "GET" && url.pathname === "/api/admin/menu/preview";
  const isMenuVendorList = request.method === "GET" && url.pathname === "/api/admin/menu/vendors";
  const isMenuRoute = isMenuChangeList || isMenuChangeCreate || isMenuPreview || isMenuVendorList;
  const isDailyFlavorStatus = request.method === "GET" && url.pathname === "/api/admin/daily-flavors/sync-status";
  const isDailyFlavorSync = request.method === "POST" && url.pathname === "/api/admin/daily-flavors/sync";
  const isDailyFlavorRoute = isDailyFlavorStatus || isDailyFlavorSync;
  if (!isSummary && !isMembers && !isEmployeeBinding && !isAnnouncementList && !isAnnouncementCreate && !isAnnouncementUpdate && !isAnnouncementDelete && !isAnnouncementMissingId && !isMenuChangeList && !isMenuChangeCreate && !isMenuPreview && !isMenuVendorList && !isDailyFlavorRoute) return null;
  const identity = await requireIdentity(request, env, {
    fetchImpl,
    allowViewAs: !isAnnouncementRoute && !isMenuRoute && !isEmployeeBinding && !isDailyFlavorRoute,
    now
  });
  if (isDailyFlavorRoute) {
    assertCan(identity, ACTIONS.ADMIN_MENU_CHANGES);
    if (isDailyFlavorStatus) return jsonResponse(await getDailyFlavorSyncStatus(env.DB, now));
    return jsonResponse(await runCaiTeacherDailyFlavorSync(env.DB, { fetchImpl, now }));
  }
  if (isAnnouncementMissingId) throw badRequest("ANNOUNCEMENT_ID_REQUIRED");
  if (isEmployeeBinding) {
    let targetUserId;
    try {
      targetUserId = decodeURIComponent(bindingMatch[1]).trim();
    } catch {
      throw badRequest("USER_ID_INVALID");
    }
    if (!targetUserId) throw badRequest("USER_ID_REQUIRED");
    return jsonResponse(await adminBindEmployee(
      env.DB,
      identity,
      targetUserId,
      await readJson6(request),
      now
    ));
  }
  if (isAnnouncementList) {
    return jsonResponse(await getAdminAnnouncements(env.DB, identity));
  }
  if (isAnnouncementCreate) {
    return jsonResponse(await createAnnouncement(
      env.DB,
      identity,
      await readJson6(request),
      now
    ), 201);
  }
  if (isAnnouncementUpdate) {
    return jsonResponse(await updateAnnouncement(
      env.DB,
      identity,
      announcementId,
      await readJson6(request),
      now
    ));
  }
  if (isAnnouncementDelete) {
    await deleteAnnouncement(env.DB, identity, announcementId, now);
    return emptyResponse();
  }
  if (isMenuChangeList) {
    return jsonResponse(await listAdminMenuItemChanges(env.DB, identity, {
      vendor: url.searchParams.get("vendor") || "",
      itemCode: url.searchParams.get("itemCode") || url.searchParams.get("item_code") || "",
      variantKey: url.searchParams.get("variantKey") || url.searchParams.get("variant_key") || "",
      query: url.searchParams.get("q") || url.searchParams.get("query") || "",
      fromDate: url.searchParams.get("fromDate") || url.searchParams.get("from_date") || "",
      toDate: url.searchParams.get("toDate") || url.searchParams.get("to_date") || "",
      month: url.searchParams.get("month") || ""
    }));
  }
  if (isMenuChangeCreate) {
    return jsonResponse(await createAdminMenuItemChange(
      env.DB,
      identity,
      await readJson6(request),
      now
    ), 201);
  }
  if (isMenuPreview) {
    return jsonResponse(await getAdminMenuItemPreview(env.DB, identity, {
      vendor: url.searchParams.get("vendor") || "",
      targetDate: url.searchParams.get("targetDate") || url.searchParams.get("date") || ""
    }));
  }
  if (isMenuVendorList) {
    return jsonResponse(await listAdminMenuVendors(env.DB, identity));
  }
  if (isMembers) return jsonResponse(await getMemberBalances(env.DB, identity, now));
  return jsonResponse(await getAdminSummary(
    env.DB,
    identity,
    url.searchParams.get("date") || url.searchParams.get("targetDate") || "",
    {
      includeMemberBalances: asBoolean(url.searchParams.get("includeMemberBalances")),
      now
    }
  ));
}, "handleAdminRoute");

// src/domain/calendar.js
var rowsFrom9 = /* @__PURE__ */ __name((result) => Array.isArray(result) ? result : Array.isArray(result?.results) ? result.results : [], "rowsFrom");
var effectiveMode = /* @__PURE__ */ __name((row) => row.mode === "B" ? "B" : "A", "effectiveMode");
var statementChanges3 = /* @__PURE__ */ __name((result) => Number(
  result?.meta?.changes ?? result?.changes ?? 0
), "statementChanges");
var getCalendarSetting = /* @__PURE__ */ __name(async (database, orderDate) => {
  if (!isDateOnly(orderDate)) return null;
  const row = await database.prepare(`
    SELECT order_date, vendor, mode, vendor_source
    FROM calendar_settings
    WHERE order_date = ?
    LIMIT 1
  `).bind(orderDate).first();
  return row ? { order_date: row.order_date, vendor: normalizeMenuVendor(row.vendor), mode: effectiveMode(row) } : null;
}, "getCalendarSetting");
var persistCalendarSetting = /* @__PURE__ */ __name(async (database, {
  orderDate,
  vendor,
  mode,
  vendorSource = "CONFIGURED",
  updatedByUserId = null,
  onlyIfUnassigned = false,
  audit = null
}, clock = /* @__PURE__ */ new Date()) => {
  const occurredAt = resolveClock(clock).toISOString();
  const conditionalClause = onlyIfUnassigned ? `
    WHERE length(trim(calendar_settings.vendor)) = 0` : "";
  const upsert = prepareStatement(database, `
    INSERT INTO calendar_settings (
      order_date, vendor, mode, vendor_source, updated_by_user_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(order_date) DO UPDATE SET
      vendor = excluded.vendor,
      mode = excluded.mode,
      vendor_source = excluded.vendor_source,
      updated_by_user_id = excluded.updated_by_user_id,
      updated_at = excluded.updated_at${conditionalClause}
  `, [
    orderDate,
    vendor,
    mode,
    vendorSource,
    updatedByUserId,
    occurredAt,
    occurredAt
  ]);
  const statements = [upsert];
  if (audit) {
    statements.push(auditStatement(database, {
      ...audit,
      occurredAt
    }));
  }
  const results = await runMutationBatch(database, statements);
  return {
    changed: statementChanges3(results[0]) === 1,
    setting: await getCalendarSetting(database, orderDate)
  };
}, "persistCalendarSetting");
var cancelCalendarGroup = /* @__PURE__ */ __name(async (database, { identity, orderDate, mode = "A" }, clock = /* @__PURE__ */ new Date()) => {
  const occurredAt = resolveClock(clock).toISOString();
  const actor = identity.actor;
  const activeResult = await database.prepare(`
    SELECT o.order_id, o.user_id, o.total_amount,
           u.employee_id, u.line_user_id, u.display_name,
           COALESCE(SUM(oi.quantity), 0) AS total_quantity,
           EXISTS (
             SELECT 1 FROM balance_ledger bl
             WHERE bl.type = 'REFUND' AND bl.reference_id = o.order_id
           ) AS has_refund
    FROM orders o
    JOIN users u ON u.user_id = o.user_id
    LEFT JOIN order_items oi ON oi.order_id = o.order_id
    WHERE o.order_date = ? AND o.status = 'ACTIVE'
    GROUP BY o.order_id, o.user_id, o.total_amount,
             u.employee_id, u.line_user_id, u.display_name
    ORDER BY o.order_id
  `).bind(orderDate).all();
  const activeOrders = rowsFrom9(activeResult);
  if (activeOrders.some((order) => Number(order.has_refund) === 1)) {
    const error = new Error("Active order already has a refund.");
    error.code = "CALENDAR_REFUND_INVARIANT";
    throw error;
  }
  const statements = [];
  for (const order of activeOrders) {
    const activeGuard = {
      sql: `EXISTS (
        SELECT 1 FROM orders current_order
        WHERE current_order.order_id = ?
          AND current_order.user_id = ?
          AND current_order.order_date = ?
          AND current_order.status = 'ACTIVE'
      )`,
      params: [order.order_id, order.user_id, orderDate]
    };
    const refundableGuard = {
      sql: `${activeGuard.sql}
        AND NOT EXISTS (
          SELECT 1 FROM balance_ledger bl
          WHERE bl.type = 'REFUND' AND bl.reference_id = ?
        )`,
      params: [...activeGuard.params, order.order_id]
    };
    statements.push(...ledgerMutationStatements(database, {
      transactionId: randomId("txn"),
      userId: order.user_id,
      employeeIdSnapshot: order.employee_id,
      lineUserIdSnapshot: order.line_user_id,
      displayNameSnapshot: order.display_name,
      amount: Number(order.total_amount),
      type: "REFUND",
      referenceId: order.order_id,
      operatorUserId: actor.userId,
      operatorEmployeeIdSnapshot: actor.employeeId,
      operatorLineUserIdSnapshot: actor.lineUserId,
      operatorDisplayNameSnapshot: actor.displayName,
      operatorAuthMode: actor.authMode,
      authMode: actor.authMode,
      note: "GROUP_CANCELLED",
      occurredAt
    }, {
      guard: refundableGuard,
      dynamicBalanceAfter: true
    }).statements);
    statements.push(prepareStatement(database, `
      INSERT INTO order_status_history (
        transition_id, order_id, from_status, to_status, actor_user_id,
        actor_auth_mode, employee_id_snapshot, line_user_id_snapshot,
        display_name_snapshot, reason, metadata_json, occurred_at
      )
      SELECT ?, o.order_id, 'ACTIVE', 'CANCELLED', ?, ?, u.employee_id,
             u.line_user_id, u.display_name, 'GROUP_CANCELLED', ?, ?
      FROM orders o
      JOIN users u ON u.user_id = o.user_id
      WHERE o.order_id = ? AND o.user_id = ? AND o.order_date = ?
        AND o.status = 'ACTIVE'
    `, [
      randomId("transition"),
      actor.userId,
      actor.authMode,
      JSON.stringify({ orderDate }),
      occurredAt,
      order.order_id,
      order.user_id,
      orderDate
    ]));
    statements.push(prepareStatement(database, `
      UPDATE orders
      SET status = 'CANCELLED',
          cancelled_by_user_id = ?,
          cancelled_auth_mode = ?,
          updated_at = ?
      WHERE order_id = ? AND user_id = ? AND order_date = ? AND status = 'ACTIVE'
    `, [
      actor.userId,
      actor.authMode,
      occurredAt,
      order.order_id,
      order.user_id,
      orderDate
    ]));
  }
  statements.push(prepareStatement(database, `
    INSERT INTO calendar_settings (
      order_date, vendor, mode, vendor_source, updated_by_user_id,
      created_at, updated_at
    ) VALUES (?, '', ?, 'CONFIGURED', ?, ?, ?)
    ON CONFLICT(order_date) DO UPDATE SET
      vendor = '',
      mode = excluded.mode,
      vendor_source = 'CONFIGURED',
      updated_by_user_id = excluded.updated_by_user_id,
      updated_at = excluded.updated_at
  `, [orderDate, mode, actor.userId, occurredAt, occurredAt]));
  const summary = {
    userCount: new Set(activeOrders.map((order) => order.user_id)).size,
    orderCount: activeOrders.length,
    totalQuantity: activeOrders.reduce((sum, order) => sum + Number(order.total_quantity || 0), 0),
    totalAmount: activeOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0)
  };
  statements.push(auditStatement(database, {
    auditId: randomId("audit"),
    actorUserId: actor.userId,
    actorAuthMode: actor.authMode,
    actorEmployeeIdSnapshot: actor.employeeId,
    actorLineUserIdSnapshot: actor.lineUserId,
    action: "CALENDAR_SETTING_UPDATED",
    metadata: {
      orderDate,
      vendor: "",
      mode,
      groupCancellation: true,
      ...summary
    },
    occurredAt
  }));
  await runMutationBatch(database, statements);
  return {
    success: true,
    setting: await getCalendarSetting(database, orderDate),
    cancellationSummary: summary
  };
}, "cancelCalendarGroup");
var getCalendarEvents = /* @__PURE__ */ __name(async (database, {
  fromDate = null,
  toDate = null,
  now = /* @__PURE__ */ new Date(),
  includeLikes = false,
  userId = null,
  includeSource = false
} = {}) => {
  const result = await database.prepare(`
    SELECT order_date, vendor, mode, vendor_source
    FROM calendar_settings
    ORDER BY order_date ASC
  `).all();
  const orderQuantitiesResult = await database.prepare(`
    SELECT o.order_date, SUM(oi.quantity) AS total_quantity
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.order_id
    WHERE o.status <> 'CANCELLED'
    GROUP BY o.order_date
    ORDER BY o.order_date ASC
  `).all();
  const dailyFlavorsResult = await database.prepare(`
    SELECT flavor.service_date, flavor.flavor_name, flavor.image_url,
      EXISTS (
        SELECT 1 FROM taiwan_government_holidays holiday
        WHERE holiday.holiday_date = flavor.service_date
      ) AS is_holiday
    FROM vendor_daily_flavors flavor
    WHERE flavor.vendor = '\u8521\u8001\u5E2B'
    ORDER BY flavor.service_date ASC
  `).all();
  const events = {};
  const likesResult = includeLikes ? await database.prepare(`
      SELECT order_date, user_id
      FROM likes
      ORDER BY order_date ASC, user_id ASC
    `).all() : { results: [] };
  const likeRows = rowsFrom9(likesResult);
  const orderQuantitiesByDate = rowsFrom9(orderQuantitiesResult).reduce((totals, row) => {
    totals[row.order_date] = Number(row.total_quantity || 0);
    return totals;
  }, {});
  const dailyFlavorsByDate = rowsFrom9(dailyFlavorsResult).reduce((flavors, row) => {
    const date = String(row.service_date || "").trim();
    const name = String(row.flavor_name || "").trim();
    if (isDateOnly(date) && name) {
      flavors[date] = {
        name,
        imageUrl: row.is_holiday ? "" : String(row.image_url || "").trim()
      };
    }
    return flavors;
  }, {});
  const likesByDate = likeRows.reduce((result2, row) => {
    const current = result2[row.order_date] || { count: 0, users: /* @__PURE__ */ new Set() };
    current.count += 1;
    current.users.add(row.user_id);
    result2[row.order_date] = current;
    return result2;
  }, {});
  for (const row of rowsFrom9(result)) {
    if (!isDateOnly(row.order_date)) continue;
    if (fromDate && row.order_date < fromDate) continue;
    if (toDate && row.order_date > toDate) continue;
    const vendor = normalizeMenuVendor(row.vendor);
    const mode = effectiveMode(row);
    const likeState = likesByDate[row.order_date] || { count: 0, users: /* @__PURE__ */ new Set() };
    events[row.order_date] = {
      order_date: row.order_date,
      vendor,
      mode,
      deadline: deadlineInfo(row.order_date, mode, now)?.deadline || null,
      isExpired: Boolean(deadlineInfo(row.order_date, mode, now)?.isExpired),
      lunarLabel: null,
      totalQuantity: orderQuantitiesByDate[row.order_date] || 0,
      ...dailyFlavorsByDate[row.order_date] ? {
        dailyFlavorName: dailyFlavorsByDate[row.order_date].name,
        ...(!vendor || vendor === "\u8521\u8001\u5E2B") && dailyFlavorsByDate[row.order_date].imageUrl ? { dailyFlavorImageUrl: dailyFlavorsByDate[row.order_date].imageUrl } : {}
      } : {},
      ...includeLikes ? {
        likeCount: likeState.count,
        isUserLiked: likeState.users.has(userId),
        ...includeSource ? { vendorSource: row.vendor_source || "CONFIGURED" } : {}
      } : {}
    };
  }
  if (includeLikes) {
    for (const [date, likeState] of Object.entries(likesByDate)) {
      if (events[date] || fromDate && date < fromDate || toDate && date > toDate) continue;
      const fallback = deadlineInfo(date, "A", now);
      events[date] = {
        order_date: date,
        vendor: "",
        mode: "A",
        deadline: fallback?.deadline || null,
        isExpired: Boolean(fallback?.isExpired),
        lunarLabel: null,
        totalQuantity: orderQuantitiesByDate[date] || 0,
        ...dailyFlavorsByDate[date] ? {
          dailyFlavorName: dailyFlavorsByDate[date].name,
          ...dailyFlavorsByDate[date].imageUrl ? { dailyFlavorImageUrl: dailyFlavorsByDate[date].imageUrl } : {}
        } : {},
        likeCount: likeState.count,
        isUserLiked: likeState.users.has(userId),
        ...includeSource ? { vendorSource: "LIKE_DEFAULT" } : {}
      };
    }
  }
  for (const [date, dailyFlavor] of Object.entries(dailyFlavorsByDate)) {
    if (events[date] || fromDate && date < fromDate || toDate && date > toDate) continue;
    const fallback = deadlineInfo(date, "A", now);
    events[date] = {
      order_date: date,
      vendor: "",
      mode: "A",
      deadline: fallback?.deadline || null,
      isExpired: Boolean(fallback?.isExpired),
      lunarLabel: null,
      totalQuantity: orderQuantitiesByDate[date] || 0,
      dailyFlavorName: dailyFlavor.name,
      ...dailyFlavor.imageUrl ? { dailyFlavorImageUrl: dailyFlavor.imageUrl } : {},
      ...includeLikes ? {
        likeCount: 0,
        isUserLiked: false,
        ...includeSource ? { vendorSource: "DAILY_FLAVOR_DEFAULT" } : {}
      } : {}
    };
  }
  return events;
}, "getCalendarEvents");
var getLikes = /* @__PURE__ */ __name(async (database, { userId, now = /* @__PURE__ */ new Date() } = {}) => {
  const result = await database.prepare(`
    SELECT order_date, user_id
    FROM likes
    ORDER BY order_date ASC, user_id ASC
  `).all();
  return rowsFrom9(result).reduce((state, row) => {
    const current = state[row.order_date] || {
      likeCount: 0,
      isUserLiked: false,
      calendarEvent: null
    };
    current.likeCount += 1;
    if (row.user_id === userId) current.isUserLiked = true;
    current.calendarEvent = {
      order_date: row.order_date,
      vendor: "",
      mode: "A",
      deadline: deadlineInfo(row.order_date, "A", now)?.deadline || null,
      isExpired: Boolean(deadlineInfo(row.order_date, "A", now)?.isExpired),
      lunarLabel: null
    };
    state[row.order_date] = current;
    return state;
  }, {});
}, "getLikes");

// src/routes/calendar.js
var text10 = /* @__PURE__ */ __name((value) => typeof value === "string" ? value.trim() : "", "text");
var readJson7 = /* @__PURE__ */ __name(async (request) => {
  if (!request.body) return {};
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("body");
    return value;
  } catch {
    throw badRequest("INVALID_JSON");
  }
}, "readJson");
var dateFromPath = /* @__PURE__ */ __name((pathname, pattern) => {
  const match = pathname.match(pattern);
  if (!match) return null;
  const date = decodeURIComponent(match[1]).trim();
  if (!isDateOnly(date)) throw badRequest("INVALID_DATE");
  return date;
}, "dateFromPath");
var toggleLike = /* @__PURE__ */ __name(async (database, identity, orderDate, clock = /* @__PURE__ */ new Date()) => {
  assertCan(identity, ACTIONS.WRITE_SELF);
  assertSelfTarget(identity, identity.actor.userId);
  if (!isDateOnly(orderDate)) throw badRequest("INVALID_DATE");
  const occurredAt = resolveClock(clock).toISOString();
  const toggle = prepareStatement(database, `
    DELETE FROM likes
    WHERE order_date = ? AND user_id = ?
  `, [orderDate, identity.actor.userId]);
  const add = prepareStatement(database, `
    INSERT INTO likes (order_date, user_id, created_at)
    SELECT ?, ?, ?
    WHERE changes() = 0
  `, [orderDate, identity.actor.userId, occurredAt]);
  const autoOpen = prepareStatement(database, `
    INSERT INTO calendar_settings (
      order_date, vendor, mode, vendor_source, updated_by_user_id,
      created_at, updated_at
    )
    SELECT ?, '\u8521\u8001\u5E2B', 'A', 'LIKE_DEFAULT', NULL, ?, ?
    WHERE EXISTS (SELECT 1 FROM likes WHERE order_date = ?)
      AND NOT EXISTS (
        SELECT 1 FROM calendar_settings
        WHERE order_date = ? AND length(trim(vendor)) > 0
      )
    ON CONFLICT(order_date) DO UPDATE SET
      vendor = '\u8521\u8001\u5E2B',
      mode = 'A',
      vendor_source = 'LIKE_DEFAULT',
      updated_by_user_id = NULL,
      updated_at = excluded.updated_at
  `, [orderDate, occurredAt, occurredAt, orderDate, orderDate]);
  const autoClose = prepareStatement(database, `
    UPDATE calendar_settings
    SET vendor = '', mode = 'A', vendor_source = 'LIKE_DEFAULT',
        updated_by_user_id = NULL, updated_at = ?
    WHERE order_date = ? AND vendor = '\u8521\u8001\u5E2B'
      AND NOT EXISTS (SELECT 1 FROM likes WHERE order_date = ?)
      AND NOT EXISTS (
        SELECT 1 FROM orders
        WHERE order_date = ? AND status = 'ACTIVE'
      )
  `, [occurredAt, orderDate, orderDate, orderDate]);
  await runMutationBatch(database, [toggle, add, autoOpen, autoClose]);
  const state = await database.prepare(`
      SELECT EXISTS(
      SELECT 1 FROM likes WHERE order_date = ? AND user_id = ?
    ) AS is_liked,
    (SELECT COUNT(*) FROM likes WHERE order_date = ?) AS total_likes
  `).bind(orderDate, identity.actor.userId, orderDate).first();
  return {
    success: true,
    isLiked: Boolean(state?.is_liked),
    totalLikes: Number(state?.total_likes || 0),
    setting: await getCalendarSetting(database, orderDate)
  };
}, "toggleLike");
var setCalendarSetting = /* @__PURE__ */ __name(async (database, identity, orderDate, input, clock = /* @__PURE__ */ new Date()) => {
  assertCan(identity, ACTIONS.ADMIN_CALENDAR);
  if (!isDateOnly(orderDate)) throw badRequest("INVALID_DATE");
  const vendor = normalizeMenuVendor(input?.vendor);
  const mode = text10(input?.mode).toUpperCase();
  if (!["A", "B"].includes(mode)) throw badRequest("CALENDAR_MODE_REQUIRED");
  if (vendor.length > 200) throw badRequest("CALENDAR_VENDOR_TOO_LONG");
  if (!vendor) {
    return cancelCalendarGroup(database, { identity, orderDate, mode }, clock);
  }
  const auditId = randomId("audit");
  const result = await persistCalendarSetting(database, {
    orderDate,
    vendor,
    mode,
    updatedByUserId: identity.actor.userId,
    audit: {
      auditId,
      actorUserId: identity.actor.userId,
      actorAuthMode: identity.actor.authMode,
      actorEmployeeIdSnapshot: identity.actor.employeeId,
      actorLineUserIdSnapshot: identity.actor.lineUserId,
      action: "CALENDAR_SETTING_UPDATED",
      metadata: { orderDate, vendor, mode }
    }
  }, clock);
  return { success: true, setting: result.setting };
}, "setCalendarSetting");
var handleCalendarRoute = /* @__PURE__ */ __name(async (request, env, {
  fetchImpl = globalThis.fetch,
  now = /* @__PURE__ */ new Date()
} = {}) => {
  const url = new URL(request.url);
  const likeDate = request.method === "POST" ? dateFromPath(url.pathname, /^\/api\/calendar\/([^/]+)\/like$/) : null;
  const adminDate = request.method === "PUT" ? dateFromPath(url.pathname, /^\/api\/admin\/calendar\/([^/]+)$/) : null;
  if (!likeDate && !adminDate) return null;
  const identity = await requireIdentity(request, env, {
    fetchImpl,
    allowViewAs: false,
    now
  });
  if (likeDate) return jsonResponse(await toggleLike(env.DB, identity, likeDate, now));
  return jsonResponse(await setCalendarSetting(
    env.DB,
    identity,
    adminDate,
    await readJson7(request),
    now
  ));
}, "handleCalendarRoute");

// src/routes/roles.js
var VALID_ROLES = /* @__PURE__ */ new Set(["User", "ProxyAdmin", "Admin"]);
var readJson8 = /* @__PURE__ */ __name(async (request) => {
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("body");
    return value;
  } catch {
    throw badRequest("INVALID_JSON");
  }
}, "readJson");
var assignRole = /* @__PURE__ */ __name(async (database, identity, targetUserInput, input, clock = /* @__PURE__ */ new Date()) => {
  assertCan(identity, ACTIONS.ADMIN_ROLE);
  const targetKey = String(targetUserInput || "").trim();
  const role = String(input?.role || input?.newRole || "").trim();
  if (!targetKey) throw badRequest("ROLE_TARGET_REQUIRED");
  if (!VALID_ROLES.has(role)) throw badRequest("ROLE_INVALID");
  const existing = await getUserById(database, targetKey) || await getUserByEmployeeId(database, targetKey) || await getUserByLineId(database, targetKey);
  if (!existing) throw notFound("ROLE_TARGET_NOT_FOUND");
  const occurredAt = resolveClock(clock).toISOString();
  const auditId = randomId("audit");
  const update = prepareStatement(database, `
    UPDATE users SET role = ?, updated_at = ? WHERE user_id = ?
  `, [role, occurredAt, existing.userId]);
  const audit = auditStatement(database, {
    auditId,
    actorUserId: identity.actor.userId,
    actorAuthMode: identity.actor.authMode,
    actorEmployeeIdSnapshot: identity.actor.employeeId,
    actorLineUserIdSnapshot: identity.actor.lineUserId,
    targetUserId: existing.userId,
    targetEmployeeIdSnapshot: existing.employeeId,
    targetLineUserIdSnapshot: existing.lineUserId,
    action: "ROLE_UPDATED",
    metadata: { fromRole: existing.role, toRole: role },
    occurredAt
  });
  await runMutationBatch(database, [update, audit]);
  return {
    success: true,
    message: "ROLE_UPDATED",
    user: publicUser(await getUserById(database, existing.userId))
  };
}, "assignRole");
var handleRoleRoute = /* @__PURE__ */ __name(async (request, env, {
  fetchImpl = globalThis.fetch,
  now = /* @__PURE__ */ new Date()
} = {}) => {
  const url = new URL(request.url);
  const match = request.method === "PUT" ? url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/role$/) : null;
  if (!match) return null;
  let target;
  try {
    target = decodeURIComponent(match[1]).trim();
  } catch {
    throw badRequest("ROLE_TARGET_INVALID");
  }
  const identity = await requireIdentity(request, env, {
    fetchImpl,
    allowViewAs: false,
    now
  });
  return jsonResponse(await assignRole(env.DB, identity, target, await readJson8(request), now));
}, "handleRoleRoute");

// src/contract.js
var BOOT_ID_PATTERN = /^BOOT-\d{8,17}-[a-z0-9]{4,12}$/i;
var asText = /* @__PURE__ */ __name((value) => value === null || value === void 0 ? "" : String(value), "asText");
var asNumber = /* @__PURE__ */ __name((value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}, "asNumber");
var normalizeBootId = /* @__PURE__ */ __name((value, fallback = null) => {
  const text11 = asText(value).trim();
  return BOOT_ID_PATTERN.test(text11) ? text11 : fallback;
}, "normalizeBootId");

// src/routes/readOnly.js
var requireRegistered = /* @__PURE__ */ __name((identity) => {
  if (!identity?.actor?.registered) throw forbidden("NOT_REGISTERED");
  assertCan(identity, ACTIONS.READ_SELF);
}, "requireRegistered");
var bootId = /* @__PURE__ */ __name(() => "BOOT-" + Date.now().toString() + "-" + Math.random().toString(36).slice(2, 8), "bootId");
var requiredBootId = /* @__PURE__ */ __name((url) => {
  const value = normalizeBootId(url.searchParams.get("bootId"), null);
  if (!value) throw badRequest("INVALID_BOOT_ID");
  return value;
}, "requiredBootId");
var explicitOrderTarget = /* @__PURE__ */ __name((url) => normalizeTargetUserId(
  url.searchParams.get("targetUserId")
), "explicitOrderTarget");
var viewAsAndDelegatedTarget = /* @__PURE__ */ __name((url, targetUserId) => Boolean(
  targetUserId && (url.searchParams.get("viewAs") || url.searchParams.get("viewAsUserId"))
), "viewAsAndDelegatedTarget");
var handleReadOnlyRequest = /* @__PURE__ */ __name(async (request, env, {
  fetchImpl = globalThis.fetch,
  now = /* @__PURE__ */ new Date()
} = {}) => {
  const url = new URL(request.url);
  if (request.method !== "GET") return null;
  const allowViewAs = url.pathname !== "/api/me";
  const identity = await resolveCanonicalIdentity(request, env, fetchImpl, { allowViewAs, now });
  if (url.pathname === "/api/me") {
    return jsonResponse(getMe(identity));
  }
  requireRegistered(identity);
  const subject = identity.effectiveSubject;
  if (url.pathname === "/api/calendar") {
    const announcements = await getActiveAnnouncements(env.DB, now);
    return jsonResponse({
      success: true,
      events: await getCalendarEvents(env.DB, {
        fromDate: url.searchParams.get("from") || null,
        toDate: url.searchParams.get("to") || null,
        now,
        includeLikes: true,
        userId: subject.userId,
        includeSource: true
      }),
      announcements,
      announcement: announcements[0] || null
    });
  }
  if (url.pathname === "/api/bootstrap") {
    const announcements = [];
    return jsonResponse({
      ...getMe(identity),
      user: publicUser(subject),
      calendar: {
        events: await getCalendarEvents(env.DB, { now }),
        announcements,
        announcement: null
      },
      ordersMap: await getHistoricalOrdersMap(env.DB, subject.userId, now),
      targetDate: url.searchParams.get("targetDate") || null,
      bootId: bootId()
    });
  }
  if (url.pathname === "/api/bootstrap/deferred") {
    const requestedBootId = requiredBootId(url);
    const announcements = await getActiveAnnouncements(env.DB, now);
    return jsonResponse({
      success: true,
      registered: true,
      likes: await getLikes(env.DB, { userId: subject.userId, now }),
      announcements,
      announcement: announcements[0] || null,
      bootId: requestedBootId
    });
  }
  if (url.pathname === "/api/orders/map") {
    const targetUserId = explicitOrderTarget(url);
    if (viewAsAndDelegatedTarget(url, targetUserId)) {
      throw forbidden("ORDER_TARGET_MODE_CONFLICT");
    }
    const target = targetUserId ? (await resolveOrderPermission(env.DB, identity, {
      targetUserId,
      targetDate: getTaipeiDate(now),
      mode: "A",
      now
    })).target : subject;
    return jsonResponse({
      success: true,
      ordersMap: await getHistoricalOrdersMap(env.DB, target.userId, now),
      ...targetUserId ? { targetUser: publicUser(target) } : {}
    });
  }
  if (url.pathname === "/api/order-page") {
    const targetDate = url.searchParams.get("targetDate") || "";
    if (!isDateOnly(targetDate)) throw badRequest("INVALID_DATE");
    const targetUserId = explicitOrderTarget(url);
    if (viewAsAndDelegatedTarget(url, targetUserId)) {
      throw forbidden("ORDER_TARGET_MODE_CONFLICT");
    }
    const setting = await getCalendarSetting(env.DB, targetDate);
    if (!setting || !setting.vendor) {
      throw notFound("ORDER_PAGE_SETTING_NOT_FOUND");
    }
    const menu = await getCustomerMenu(env.DB, { vendor: setting.vendor, targetDate });
    const dailyFlavor = await getCaiTeacherDailyFlavor(env.DB, {
      vendor: setting.vendor,
      targetDate,
      menu
    });
    const permission = identity.viewAs ? null : await resolveOrderPermission(env.DB, identity, {
      targetUserId,
      targetDate,
      mode: setting.mode,
      now,
      enforceProxyDelegatedDate: false
    });
    const orderSubject = permission?.target || subject;
    const myOrder = await getReadableOrder(env.DB, orderSubject.userId, targetDate, {
      includeCompleted: isHistoricalOrderDate(targetDate, now),
      menuItems: menu
    });
    return jsonResponse({
      success: true,
      setting,
      deadline: permission?.timing.deadline || deadlineInfo(targetDate, setting.mode, now),
      menu,
      ...dailyFlavor ? { dailyFlavor } : {},
      myOrder,
      targetUser: publicUser(orderSubject),
      orderPolicy: permission ? orderPolicyResponse(permission) : {
        actorUserId: identity.authorizationActor.userId,
        targetUserId: orderSubject.userId,
        delegated: false,
        cutoffApplies: false,
        deadlineBypassed: false,
        canMutate: false
      }
    });
  }
  return null;
}, "handleReadOnlyRequest");

// src/domain/businessDays.js
var isWeekend = /* @__PURE__ */ __name((date) => {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}, "isWeekend");
var formatDate = /* @__PURE__ */ __name((date) => date.toISOString().slice(0, 10), "formatDate");
var secondFollowingBusinessDay = /* @__PURE__ */ __name((dateOnly, nonWorkingDates = /* @__PURE__ */ new Set()) => {
  if (!isDateOnly(dateOnly)) return null;
  const [year, month, day] = dateOnly.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (isWeekend(date) || nonWorkingDates.has(dateOnly)) return null;
  let followingBusinessDays = 0;
  while (followingBusinessDays < 2) {
    date.setUTCDate(date.getUTCDate() + 1);
    const nextDate = formatDate(date);
    if (!isWeekend(date) && !nonWorkingDates.has(nextDate)) followingBusinessDays += 1;
  }
  return formatDate(date);
}, "secondFollowingBusinessDay");
var scheduledBusinessDates = /* @__PURE__ */ __name((scheduledTime, nonWorkingDates = /* @__PURE__ */ new Set()) => {
  const businessDate = getTaipeiDate(resolveClock(scheduledTime));
  return {
    businessDate,
    targetDate: secondFollowingBusinessDay(businessDate, nonWorkingDates)
  };
}, "scheduledBusinessDates");

// src/domain/taiwanHolidays.js
var DATASET_URL = "https://data.gov.tw/dataset/14718";
var SOURCE_HOST = "https://www.dgpa.gov.tw";
var HOLIDAY_FLAG = "2";
var FALLBACK_HOLIDAY_PATTERN = /(補假|放假|國定假日|休假)/u;
var browserHeaders = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/csv;q=0.8,*/*;q=0.7",
  "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.7",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36"
};
var decodeHtml = /* @__PURE__ */ __name((value) => String(value || "").replace(/&amp;/g, "&").replace(/&#38;/g, "&"), "decodeHtml");
var normalizeDate = /* @__PURE__ */ __name((value) => {
  const raw = String(value || "").replace(/^\uFEFF/u, "").trim();
  let match = raw.match(/^(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})$/u);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() + 1 !== Number(m) || date.getUTCDate() !== Number(d)) return null;
  return `${y}-${m}-${d}`;
}, "normalizeDate");
var parseCsvLine = /* @__PURE__ */ __name((line) => {
  const fields = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        value += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        value += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      fields.push(value);
      value = "";
    } else {
      value += ch;
    }
  }
  fields.push(value);
  return fields.map((field) => field.trim());
}, "parseCsvLine");
var parseGovernmentHolidayCsv = /* @__PURE__ */ __name((csv) => {
  const lines = String(csv || "").replace(/^\uFEFF/u, "").split(/\r?\n/u).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((value) => value.replace(/^\uFEFF/u, ""));
  const dateIndex = headers.findIndex((value) => /西元日期/u.test(value));
  const holidayIndex = headers.findIndex((value) => /是否放假/u.test(value));
  const noteIndex = headers.findIndex((value) => /備註/u.test(value));
  if (dateIndex < 0 || holidayIndex < 0) return [];
  return lines.slice(1).reduce((rows, line) => {
    const fields = parseCsvLine(line);
    if (String(fields[holidayIndex] || "").trim() !== HOLIDAY_FLAG) return rows;
    const holidayDate = normalizeDate(fields[dateIndex]);
    if (!holidayDate) return rows;
    rows.push({
      holiday_date: holidayDate,
      holiday_name: noteIndex >= 0 ? String(fields[noteIndex] || "").trim() : ""
    });
    return rows;
  }, []);
}, "parseGovernmentHolidayCsv");
var resourceUrlForYear = /* @__PURE__ */ __name((html, westernYear) => {
  const rocYear = westernYear - 1911;
  const source = String(html || "");
  const label = `${rocYear}\u5E74\u4E2D\u83EF\u6C11\u570B\u653F\u5E9C\u884C\u653F\u6A5F\u95DC\u8FA6\u516C\u65E5\u66C6\u8868`;
  const labelIndex = source.indexOf(label);
  if (labelIndex < 0) return null;
  const context = source.slice(Math.max(0, labelIndex - 1800), labelIndex);
  const links = Array.from(context.matchAll(/<a\b[^>]*href=["']([^"']+\.csv[^"']*)["'][^>]*>/giu));
  const match = links.at(-1);
  if (!match) return null;
  const href = decodeHtml(match[1]);
  return href.startsWith("http") ? href : new URL(href, SOURCE_HOST).toString();
}, "resourceUrlForYear");
var syncTaiwanGovernmentHolidays = /* @__PURE__ */ __name(async (database, { fetchImpl = globalThis.fetch, now = /* @__PURE__ */ new Date() } = {}) => {
  const year = now.getUTCFullYear();
  const years = [year, year + 1];
  const page = await fetchImpl(DATASET_URL, { headers: browserHeaders, redirect: "follow" });
  if (!page?.ok) return { status: "FAILED", errorCode: "TAIWAN_HOLIDAY_DATASET_UNAVAILABLE", importedYears: [] };
  const html = await page.text();
  const importedYears = [];
  let importedCount = 0;
  for (const targetYear of years) {
    const resourceUrl = resourceUrlForYear(html, targetYear);
    if (!resourceUrl) continue;
    const response = await fetchImpl(resourceUrl, { headers: browserHeaders, redirect: "follow" });
    if (!response?.ok) continue;
    const holidays = parseGovernmentHolidayCsv(await response.text());
    if (!holidays.length) continue;
    const fetchedAt = now.toISOString();
    const statements = [
      database.prepare("DELETE FROM taiwan_government_holidays WHERE source_year = ?").bind(targetYear),
      ...holidays.map((row) => database.prepare(`
        INSERT INTO taiwan_government_holidays (
          holiday_date, holiday_name, source_year, source_url, fetched_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(holiday_date) DO UPDATE SET
          holiday_name = excluded.holiday_name,
          source_year = excluded.source_year,
          source_url = excluded.source_url,
          fetched_at = excluded.fetched_at
      `).bind(row.holiday_date, row.holiday_name, targetYear, resourceUrl, fetchedAt))
    ];
    if (typeof database.batch === "function") await database.batch(statements);
    else {
      for (const statement of statements) await statement.run();
    }
    importedYears.push(targetYear);
    importedCount += holidays.length;
  }
  return importedYears.length ? { status: "SUCCESS", importedYears, importedCount } : { status: "FAILED", errorCode: "TAIWAN_HOLIDAY_RESOURCE_NOT_FOUND", importedYears: [] };
}, "syncTaiwanGovernmentHolidays");
var loadNonWorkingDates = /* @__PURE__ */ __name(async (database, fromDate, toDate) => {
  const official = await database.prepare(`
    SELECT holiday_date
    FROM taiwan_government_holidays
    WHERE holiday_date BETWEEN ? AND ?
  `).bind(fromDate, toDate).all();
  const flavorRows = await database.prepare(`
    SELECT service_date, flavor_name
    FROM vendor_daily_flavors
    WHERE service_date BETWEEN ? AND ?
  `).bind(fromDate, toDate).all();
  const dates = new Set((official?.results || []).map((row) => row.holiday_date));
  for (const row of flavorRows?.results || []) {
    if (FALLBACK_HOLIDAY_PATTERN.test(String(row.flavor_name || ""))) dates.add(row.service_date);
  }
  return dates;
}, "loadNonWorkingDates");

// src/domain/automaticOpening.js
var addDays = /* @__PURE__ */ __name((dateOnly, days) => {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}, "addDays");
var runAutomaticDailyOpening = /* @__PURE__ */ __name(async (database, scheduledTime) => {
  const businessDate = getTaipeiDate(resolveClock(scheduledTime));
  const nonWorkingDates = await loadNonWorkingDates(
    database,
    businessDate,
    addDays(businessDate, 31)
  );
  const { targetDate } = scheduledBusinessDates(scheduledTime, nonWorkingDates);
  if (!targetDate) {
    return {
      status: "SKIP_NON_BUSINESS_DAY",
      businessDate,
      targetDate: null
    };
  }
  const result = await persistCalendarSetting(database, {
    orderDate: targetDate,
    vendor: CANONICAL_HE_SHI_VENDOR,
    mode: "B",
    onlyIfUnassigned: true
  }, scheduledTime);
  const vendor = result.changed ? CANONICAL_HE_SHI_VENDOR : result.setting?.vendor || null;
  return {
    status: result.changed ? "OPENED" : "SKIP_ALREADY_OPEN",
    businessDate,
    targetDate,
    vendor
  };
}, "runAutomaticDailyOpening");

// src/formalWorker.js
var AUTOMATIC_OPENING_LOG_EVENT = "automatic_daily_group_opening";
var AUTOMATIC_OPENING_LOG_SOURCE = "automatic_daily_cron";
var handleScheduled = /* @__PURE__ */ __name(async (controller, env, { logger = console, fetchImpl = globalThis.fetch } = {}) => {
  if (controller?.cron === "0 8 * * *") {
    const result2 = await runCaiTeacherDailyFlavorSync(env.DB, {
      fetchImpl,
      now: controller?.scheduledTime === void 0 ? /* @__PURE__ */ new Date() : new Date(controller.scheduledTime)
    });
    const logEntry2 = {
      event: "cai_teacher_daily_flavor_sync",
      source: "daily_flavor_cron",
      ...result2
    };
    if (typeof logger?.log === "function") logger.log(JSON.stringify(logEntry2));
    return result2;
  }
  if (controller?.cron === "30 0 15 6-12 *") {
    const result2 = await syncTaiwanGovernmentHolidays(env.DB, {
      fetchImpl,
      now: controller?.scheduledTime === void 0 ? /* @__PURE__ */ new Date() : new Date(controller.scheduledTime)
    });
    const logEntry2 = {
      event: "taiwan_government_holiday_sync",
      source: "holiday_calendar_cron",
      ...result2
    };
    if (typeof logger?.log === "function") logger.log(JSON.stringify(logEntry2));
    return result2;
  }
  const result = await runAutomaticDailyOpening(env.DB, controller?.scheduledTime);
  const logEntry = {
    event: AUTOMATIC_OPENING_LOG_EVENT,
    source: AUTOMATIC_OPENING_LOG_SOURCE,
    status: result.status,
    businessDate: result.businessDate,
    targetDate: result.targetDate,
    ...result.vendor ? { vendor: result.vendor } : {}
  };
  if (typeof logger?.log === "function") logger.log(JSON.stringify(logEntry));
  return result;
}, "handleScheduled");
var handleFormalRequest = /* @__PURE__ */ __name(async (request, env, options = {}) => {
  let response;
  try {
    if (request.method === "OPTIONS") {
      response = emptyResponse();
    } else if (request.method === "GET" && new URL(request.url).pathname === "/api/health") {
      try {
        const row = await env?.DB?.prepare("SELECT COUNT(*) AS users FROM users").first();
        response = jsonResponse({
          ok: true,
          database: true,
          users: asNumber(row?.users)
        });
      } catch {
        response = jsonResponse({
          ok: false,
          database: false,
          users: 0,
          error: "DATABASE_UNAVAILABLE"
        }, 503);
      }
    } else {
      const authResponse = await handleAuthRoute(request, env, options);
      if (authResponse) response = authResponse;
      if (!response) {
        const meResponse = await handleMeRoute(request, env, options);
        if (meResponse) response = meResponse;
      }
      if (!response) {
        const orderResponse = await handleOrderRoute(request, env, options);
        if (orderResponse) response = orderResponse;
      }
      if (!response) {
        const calendarResponse = await handleCalendarRoute(request, env, options);
        if (calendarResponse) response = calendarResponse;
      }
      if (!response) {
        const roleResponse = await handleRoleRoute(request, env, options);
        if (roleResponse) response = roleResponse;
      }
      if (!response) {
        const adminResponse = await handleAdminRoute(request, env, options);
        if (adminResponse) response = adminResponse;
      }
      if (!response) {
        const balanceResponse = await handleBalanceRoute(request, env, options);
        if (balanceResponse) response = balanceResponse;
      }
      if (!response) {
        const vendorResponse = await handleVendorRoute(request, env, options);
        if (vendorResponse) response = vendorResponse;
      }
      if (!response) {
        const readResponse = await handleReadOnlyRequest(request, env, options);
        if (readResponse) response = readResponse;
      }
      if (!response) response = jsonResponse({ error: "NOT_FOUND" }, 404);
    }
  } catch (error) {
    const publicError = toPublicError(error);
    if (!(error instanceof HttpError) && options.onInternalError) {
      try {
        options.onInternalError(error);
      } catch {
      }
    }
    response = jsonResponse(publicError.body, publicError.status);
  }
  return applyCorsPolicy(response, request, env);
}, "handleFormalRequest");
var formalWorker_default = {
  fetch(request, env) {
    return handleFormalRequest(request, env);
  },
  scheduled(controller, env) {
    return handleScheduled(controller, env);
  }
};
export {
  formalWorker_default as default,
  handleFormalRequest,
  handleScheduled
};
//# sourceMappingURL=formalWorker.js.map
