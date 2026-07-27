PRAGMA foreign_keys=OFF;

ALTER TABLE "InviteCode" RENAME TO "OldInviteCode";
DROP INDEX "InviteCode_code_key";
DROP INDEX "InviteCode_createdById_idx";

CREATE TABLE "RegistrationCode" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" DATETIME,
    "expiresAt" DATETIME,
    "disabledAt" DATETIME,
    "createdById" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RegistrationCode_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "RegistrationCode" ("id", "code", "note", "maxUses", "usedCount", "lastUsedAt", "createdById", "createdAt")
SELECT "id", "code", "note", NULL, CASE WHEN "usedById" IS NULL THEN 0 ELSE 1 END, "usedAt", "createdById", "createdAt"
FROM "OldInviteCode";

CREATE UNIQUE INDEX "RegistrationCode_code_key" ON "RegistrationCode"("code");
CREATE INDEX "RegistrationCode_createdById_idx" ON "RegistrationCode"("createdById");
CREATE INDEX "RegistrationCode_disabledAt_expiresAt_idx" ON "RegistrationCode"("disabledAt", "expiresAt");

CREATE TABLE "InviteCode" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" DATETIME,
    "expiresAt" DATETIME,
    "disabledAt" DATETIME,
    "ownerId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InviteCode_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "InviteCode_code_key" ON "InviteCode"("code");
CREATE INDEX "InviteCode_ownerId_createdAt_idx" ON "InviteCode"("ownerId", "createdAt");
CREATE INDEX "InviteCode_disabledAt_expiresAt_idx" ON "InviteCode"("disabledAt", "expiresAt");

ALTER TABLE "User" ADD COLUMN "registrationCodeId" INTEGER REFERENCES "RegistrationCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "User" ADD COLUMN "inviteCodeId" INTEGER REFERENCES "InviteCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "User"
SET "registrationCodeId" = (
    SELECT "id" FROM "OldInviteCode" WHERE "OldInviteCode"."usedById" = "User"."id"
);

CREATE INDEX "User_registrationCodeId_idx" ON "User"("registrationCodeId");
CREATE INDEX "User_inviteCodeId_idx" ON "User"("inviteCodeId");

DROP TABLE "OldInviteCode";

PRAGMA foreign_keys=ON;
PRAGMA foreign_key_check;
