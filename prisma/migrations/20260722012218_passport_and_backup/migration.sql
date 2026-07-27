-- CreateTable
CREATE TABLE "PassportDeviceCode" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "deviceCodeHash" TEXT NOT NULL,
    "userCode" TEXT NOT NULL,
    "instanceName" TEXT NOT NULL,
    "scopesJson" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "approvedById" INTEGER,
    "authorizationId" INTEGER,
    "expiresAt" DATETIME NOT NULL,
    "lastPolledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PassportAuthorization" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "instanceName" TEXT NOT NULL,
    "scopesJson" TEXT NOT NULL,
    "lastUsedAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PassportAuthorization_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PassportToken" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "authorizationId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PassportToken_authorizationId_fkey" FOREIGN KEY ("authorizationId") REFERENCES "PassportAuthorization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InstanceBackup" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "instanceLabel" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "storagePath" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InstanceBackup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PassportDeviceCode_deviceCodeHash_key" ON "PassportDeviceCode"("deviceCodeHash");

-- CreateIndex
CREATE UNIQUE INDEX "PassportDeviceCode_userCode_key" ON "PassportDeviceCode"("userCode");

-- CreateIndex
CREATE INDEX "PassportAuthorization_userId_revokedAt_idx" ON "PassportAuthorization"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PassportToken_tokenHash_key" ON "PassportToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PassportToken_authorizationId_kind_status_idx" ON "PassportToken"("authorizationId", "kind", "status");

-- CreateIndex
CREATE INDEX "InstanceBackup_userId_createdAt_idx" ON "InstanceBackup"("userId", "createdAt");
